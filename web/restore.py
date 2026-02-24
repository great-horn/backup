"""Restore routes: list, browse, run, search."""

import os
import json
import threading
import subprocess
import shutil
import tarfile
import zstandard
from datetime import datetime
from contextlib import contextmanager
from flask import Blueprint, request, jsonify

from .db import get_job_config, get_all_job_configs

RCLONE_CONFIG = os.environ.get('RCLONE_CONFIG', '/app/rclone.conf')
RCLONE_CACHE_DIR = '/tmp/restore/_rclone_cache'

def _rclone_cmd(args, timeout=30):
    """Run rclone command with config."""
    return subprocess.run(
        ['rclone', '--config', RCLONE_CONFIG] + args,
        capture_output=True, text=True, timeout=timeout
    )


def _get_rclone_dest(config):
    """Get rclone remote:path from job config. Returns None if not rclone."""
    if config.get('backend_type') != 'rclone':
        return None
    try:
        bc = json.loads(config.get('backend_config', '{}'))
        remote = bc.get('remote', '')
        path = bc.get('path', '')
        if remote and path:
            return f"{remote}:{path}"
    except Exception:
        pass
    return None


def _rclone_download_archive(rclone_dest, filename):
    """Download an archive from rclone remote to local cache. Returns local path or None."""
    os.makedirs(RCLONE_CACHE_DIR, exist_ok=True)
    local_path = os.path.join(RCLONE_CACHE_DIR, filename)

    # Reuse cached file if already downloaded
    if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
        return local_path

    remote_file = f"{rclone_dest}/{filename}"
    try:
        result = _rclone_cmd(['copyto', remote_file, local_path], timeout=60)
        if result.returncode == 0 and os.path.exists(local_path):
            return local_path
        print(f"rclone download failed: {result.stderr}")
    except subprocess.TimeoutExpired:
        print(f"rclone download timeout for {filename}")
    except Exception as e:
        print(f"rclone download error: {e}")

    # Cleanup partial file
    if os.path.exists(local_path):
        os.remove(local_path)
    return None


restore_bp = Blueprint('restore', __name__)


def _get_socketio():
    """Lazy import to avoid circular dependency."""
    from .app import socketio
    return socketio


@contextmanager
def open_tar_zst(path):
    """Open a .tar.zst archive in streaming mode (memory-efficient)."""
    dctx = zstandard.ZstdDecompressor()
    fh = open(path, 'rb')
    reader = dctx.stream_reader(fh)
    tf = tarfile.open(fileobj=reader, mode='r|')
    try:
        yield tf
    finally:
        tf.close()
        reader.close()
        fh.close()


@restore_bp.route('/api/restore/list', methods=['GET'])
def api_restore_list():
    """List available backups for each job."""
    try:
        jobs = get_all_job_configs()
        result = []

        for job in jobs:
            if not job.get('enabled'):
                continue

            dest = job['dest_path']
            rclone_dest = _get_rclone_dest(job)
            job_info = {
                'job_name': job['job_name'],
                'display_name': job['display_name'],
                'mode': job['mode'],
                'icon_url': job['icon_url'],
                'dest_path': dest,
                'backend_type': job.get('backend_type', 'rsync'),
                'backups': []
            }

            # --- rclone backend ---
            if rclone_dest:
                if job['mode'] == 'compression':
                    try:
                        r = _rclone_cmd(['lsf', rclone_dest, '--include', '*.tar.zst', '--format', 'sp'])
                        if r.returncode == 0:
                            archives = []
                            for line in r.stdout.strip().splitlines():
                                line = line.strip()
                                if not line:
                                    continue
                                # Format: "size;filename" (--format "sp")
                                parts = line.split(';', 1)
                                if len(parts) == 2:
                                    try:
                                        size_bytes = int(parts[0])
                                    except ValueError:
                                        size_bytes = 0
                                    fname = parts[1].strip()
                                    # Extract date from filename pattern: *_YYYYMMDD_HHMMSS.tar.zst
                                    date_str = ''
                                    try:
                                        base = fname.replace('.tar.zst', '')
                                        date_part = '_'.join(base.split('_')[-2:])
                                        dt = datetime.strptime(date_part, '%Y%m%d_%H%M%S')
                                        date_str = dt.isoformat()
                                    except Exception:
                                        date_str = ''
                                    archives.append({
                                        'filename': fname,
                                        'size_mb': round(size_bytes / (1024 * 1024), 1),
                                        'date': date_str
                                    })
                            # Sort by filename descending (most recent first)
                            archives.sort(key=lambda a: a['filename'], reverse=True)
                            job_info['backups'] = archives
                    except Exception as e:
                        print(f"rclone list error for {job['job_name']}: {e}")
                else:
                    # Direct mode: just indicate remote path exists
                    try:
                        r = _rclone_cmd(['lsf', rclone_dest, '--max-depth', '1', '--dirs-only'])
                        if r.returncode == 0:
                            job_info['backups'] = [{
                                'filename': '(remote direct mirror)',
                                'date': ''
                            }]
                    except Exception as e:
                        print(f"rclone list error for {job['job_name']}: {e}")

                result.append(job_info)
                continue

            # --- rsync/filesystem backend ---
            if not os.path.exists(dest):
                result.append(job_info)
                continue

            if job['mode'] == 'compression':
                archives = []
                for f in sorted(os.listdir(dest), reverse=True):
                    if f.endswith('.tar.zst'):
                        fpath = os.path.join(dest, f)
                        try:
                            stat = os.stat(fpath)
                            archives.append({
                                'filename': f,
                                'size_mb': round(stat.st_size / (1024 * 1024), 1),
                                'date': datetime.fromtimestamp(stat.st_mtime).isoformat()
                            })
                        except Exception:
                            pass
                job_info['backups'] = archives
            else:
                try:
                    job_info['backups'] = [{
                        'filename': '(direct mirror)',
                        'date': datetime.fromtimestamp(os.path.getmtime(dest)).isoformat()
                    }]
                except Exception:
                    pass

            result.append(job_info)

        return jsonify({'jobs': result})
    except Exception as e:
        print(f"Error api_restore_list: {e}")
        return jsonify({'error': str(e)}), 500


@restore_bp.route('/api/restore/browse/<job_name>', methods=['GET'])
def api_restore_browse(job_name):
    """Browse the contents of a backup (archive or directory)."""
    try:
        config = get_job_config(job_name)
        if not config:
            return jsonify({'error': 'Job not found'}), 404

        file_param = request.args.get('file', '')
        path_param = request.args.get('path', '')
        rclone_dest = _get_rclone_dest(config)

        entries = []

        # --- rclone backend ---
        if rclone_dest:
            if config['mode'] == 'compression' and file_param:
                # Download archive to cache, then browse with open_tar_zst
                local_archive = _rclone_download_archive(rclone_dest, file_param)
                if not local_archive:
                    return jsonify({'error': 'Failed to download archive from remote'}), 500

                with open_tar_zst(local_archive) as tf:
                    if path_param and not path_param.endswith('/'):
                        path_param += '/'

                    seen_dirs = set()
                    for member in tf:
                        name = member.name
                        if member.isdir() and not name.endswith('/'):
                            name += '/'

                        if path_param and not name.startswith(path_param):
                            continue

                        rel = name[len(path_param):] if path_param else name
                        if not rel or rel == '/':
                            continue

                        parts = rel.rstrip('/').split('/')
                        if len(parts) == 1 and not member.isdir():
                            entries.append({
                                'name': parts[0],
                                'type': 'file',
                                'size': member.size,
                                'path': name
                            })
                        elif len(parts) >= 1 and (member.isdir() or len(parts) > 1):
                            dir_name = parts[0]
                            if dir_name not in seen_dirs:
                                seen_dirs.add(dir_name)
                                entries.append({
                                    'name': dir_name,
                                    'type': 'directory',
                                    'size': 0,
                                    'path': path_param + dir_name + '/'
                                })

                        if len(entries) >= 500:
                            break

            elif config['mode'] == 'direct':
                # List remote directory contents with rclone lsf
                subpath = f"{rclone_dest}/{path_param}" if path_param else rclone_dest
                # Remove trailing slash for rclone
                subpath = subpath.rstrip('/')
                try:
                    r = _rclone_cmd(['lsf', subpath, '--format', 'sp', '--max-depth', '1'])
                    if r.returncode != 0:
                        return jsonify({'error': f'Remote path not found: {r.stderr.strip()}'}), 404

                    for line in r.stdout.strip().splitlines():
                        line = line.strip()
                        if not line:
                            continue
                        parts = line.split(';', 1)
                        if len(parts) == 2:
                            try:
                                size_bytes = int(parts[0])
                            except ValueError:
                                size_bytes = 0
                            name = parts[1].strip()
                            is_dir = name.endswith('/')
                            clean_name = name.rstrip('/')
                            entries.append({
                                'name': clean_name,
                                'type': 'directory' if is_dir else 'file',
                                'size': 0 if is_dir else size_bytes,
                                'path': os.path.join(path_param, clean_name) + ('/' if is_dir else '')
                            })
                            if len(entries) >= 500:
                                break
                except Exception as e:
                    return jsonify({'error': f'rclone browse error: {e}'}), 500

            return jsonify({
                'job_name': job_name,
                'mode': config['mode'],
                'path': path_param,
                'entries': entries,
                'total': len(entries)
            })

        # --- rsync/filesystem backend ---
        if config['mode'] == 'compression' and file_param:
            archive_path = os.path.join(config['dest_path'], file_param)
            if not os.path.realpath(archive_path).startswith(os.path.realpath(config['dest_path'])):
                return jsonify({'error': 'Unauthorized path'}), 403

            if not os.path.exists(archive_path):
                return jsonify({'error': 'Archive not found'}), 404

            with open_tar_zst(archive_path) as tf:
                if path_param and not path_param.endswith('/'):
                    path_param += '/'

                seen_dirs = set()
                for member in tf:
                    name = member.name
                    if member.isdir() and not name.endswith('/'):
                        name += '/'

                    if path_param and not name.startswith(path_param):
                        continue

                    rel = name[len(path_param):] if path_param else name
                    if not rel or rel == '/':
                        continue

                    parts = rel.rstrip('/').split('/')
                    if len(parts) == 1 and not member.isdir():
                        entries.append({
                            'name': parts[0],
                            'type': 'file',
                            'size': member.size,
                            'path': name
                        })
                    elif len(parts) >= 1 and (member.isdir() or len(parts) > 1):
                        dir_name = parts[0]
                        if dir_name not in seen_dirs:
                            seen_dirs.add(dir_name)
                            entries.append({
                                'name': dir_name,
                                'type': 'directory',
                                'size': 0,
                                'path': path_param + dir_name + '/'
                            })

                    if len(entries) >= 500:
                        break

        elif config['mode'] == 'direct':
            browse_path = os.path.join(config['dest_path'], path_param)
            if not os.path.realpath(browse_path).startswith(os.path.realpath(config['dest_path'])):
                return jsonify({'error': 'Unauthorized path'}), 403

            if not os.path.exists(browse_path):
                return jsonify({'error': 'Path not found'}), 404

            count = 0
            for item in sorted(os.scandir(browse_path), key=lambda e: (not e.is_dir(), e.name)):
                try:
                    entries.append({
                        'name': item.name,
                        'type': 'directory' if item.is_dir() else 'file',
                        'size': item.stat().st_size if item.is_file() else 0,
                        'path': os.path.join(path_param, item.name) + ('/' if item.is_dir() else '')
                    })
                    count += 1
                    if count >= 500:
                        break
                except Exception:
                    pass

        return jsonify({
            'job_name': job_name,
            'mode': config['mode'],
            'path': path_param,
            'entries': entries,
            'total': len(entries)
        })
    except Exception as e:
        print(f"Error api_restore_browse: {e}")
        return jsonify({'error': str(e)}), 500


@restore_bp.route('/api/restore/run', methods=['POST'])
def api_restore_run():
    """Execute a restore operation."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON data required'}), 400

        job_name = data.get('job_name')
        backup_file = data.get('backup_file', '')
        files = data.get('files', [])
        target_path = data.get('target_path', '')

        config = get_job_config(job_name)
        if not config:
            return jsonify({'error': 'Job not found'}), 404

        rclone_dest = _get_rclone_dest(config)

        if target_path:
            real_target = os.path.realpath(target_path)
            allowed_prefixes = ['/data/', '/tmp/restore/']
            if not any(real_target.startswith(prefix) for prefix in allowed_prefixes):
                return jsonify({'error': 'Unauthorized destination path. Must be under /data/ or /tmp/restore/'}), 403
        else:
            target_path = config['source_path']

        os.makedirs(target_path, exist_ok=True)

        def do_restore():
            try:
                _get_socketio().emit('restore_progress', {
                    'job_name': job_name,
                    'status': 'running',
                    'message': f'Restoring {job_name}...'
                })

                # --- rclone backend ---
                if rclone_dest:
                    if config['mode'] == 'compression' and backup_file:
                        # Download archive to cache, then extract
                        _get_socketio().emit('restore_progress', {
                            'job_name': job_name,
                            'status': 'running',
                            'message': f'Downloading archive from remote...'
                        })
                        local_archive = _rclone_download_archive(rclone_dest, backup_file)
                        if not local_archive:
                            raise RuntimeError('Failed to download archive from remote')

                        _get_socketio().emit('restore_progress', {
                            'job_name': job_name,
                            'status': 'running',
                            'message': f'Extracting archive...'
                        })
                        with open_tar_zst(local_archive) as tf:
                            if files:
                                files_set = set(files)
                                restored = 0
                                for member in tf:
                                    if member.name in files_set:
                                        tf.extract(member, target_path, filter='data')
                                        restored += 1
                                        if restored >= len(files_set):
                                            break
                                msg = f'{restored} file(s) restored from remote archive'
                            else:
                                tf.extractall(target_path, filter='data')
                                msg = 'Full restore completed from remote archive'

                    elif config['mode'] == 'direct':
                        # Use rclone copy to restore from remote
                        if files:
                            restored = 0
                            for f in files:
                                remote_file = f"{rclone_dest}/{f}"
                                dst_file = os.path.join(target_path, f)
                                os.makedirs(os.path.dirname(dst_file), exist_ok=True)
                                try:
                                    r = _rclone_cmd(['copyto', remote_file, dst_file], timeout=60)
                                    if r.returncode == 0:
                                        restored += 1
                                    else:
                                        # Try as directory
                                        r = _rclone_cmd(['copy', remote_file, dst_file], timeout=60)
                                        if r.returncode == 0:
                                            restored += 1
                                except Exception as e:
                                    print(f"rclone restore file error {f}: {e}")
                            msg = f'{restored} file(s) restored from remote'
                        else:
                            r = _rclone_cmd(['copy', rclone_dest, target_path], timeout=60)
                            if r.returncode != 0:
                                raise RuntimeError(f'rclone copy failed: {r.stderr.strip()}')
                            msg = 'Full restore completed from remote (rclone copy)'
                    else:
                        msg = 'Unsupported mode'

                # --- rsync/filesystem backend ---
                elif config['mode'] == 'compression' and backup_file:
                    archive_path = os.path.join(config['dest_path'], backup_file)
                    if not os.path.realpath(archive_path).startswith(os.path.realpath(config['dest_path'])):
                        raise ValueError('Unauthorized archive path')

                    with open_tar_zst(archive_path) as tf:
                        if files:
                            files_set = set(files)
                            restored = 0
                            for member in tf:
                                if member.name in files_set:
                                    tf.extract(member, target_path, filter='data')
                                    restored += 1
                                    if restored >= len(files_set):
                                        break
                            msg = f'{restored} file(s) restored'
                        else:
                            tf.extractall(target_path, filter='data')
                            msg = 'Full restore completed'

                elif config['mode'] == 'direct':
                    src = config['dest_path']
                    if files:
                        for f in files:
                            src_file = os.path.join(src, f)
                            dst_file = os.path.join(target_path, f)
                            if not os.path.realpath(src_file).startswith(os.path.realpath(src)):
                                continue
                            os.makedirs(os.path.dirname(dst_file), exist_ok=True)
                            if os.path.isdir(src_file):
                                shutil.copytree(src_file, dst_file, dirs_exist_ok=True)
                            else:
                                shutil.copy2(src_file, dst_file)
                        msg = f'{len(files)} file(s) restored'
                    else:
                        subprocess.run(
                            ['rsync', '-av', '--no-owner', '--no-group', f'{src}/', f'{target_path}/'],
                            check=True, capture_output=True, text=True
                        )
                        msg = 'Full restore completed (rsync)'
                else:
                    msg = 'Unsupported mode'

                _get_socketio().emit('restore_progress', {
                    'job_name': job_name,
                    'status': 'success',
                    'message': msg
                })
                print(f"Restore: {msg} for {job_name} -> {target_path}")

            except Exception as e:
                _get_socketio().emit('restore_progress', {
                    'job_name': job_name,
                    'status': 'error',
                    'message': str(e)
                })
                print(f"Restore thread error: {e}")

        restore_thread = threading.Thread(target=do_restore, daemon=True)
        restore_thread.start()

        return jsonify({
            'status': 'started',
            'job_name': job_name,
            'target_path': target_path
        })
    except Exception as e:
        print(f"Error api_restore_run: {e}")
        return jsonify({'error': str(e)}), 500


@restore_bp.route('/api/restore/search', methods=['GET'])
def api_restore_search():
    """Search for a file across all backups."""
    try:
        query = request.args.get('q', '').strip()
        if len(query) < 3:
            return jsonify({'error': 'Minimum 3 characters'}), 400

        query_lower = query.lower()
        results = []
        jobs = get_all_job_configs()

        for job in jobs:
            if not job.get('enabled'):
                continue

            rclone_dest = _get_rclone_dest(job)

            # --- rclone backend ---
            if rclone_dest:
                if job['mode'] == 'compression':
                    # List remote archives, download the most recent, then scan
                    try:
                        r = _rclone_cmd(['lsf', rclone_dest, '--include', '*.tar.zst'])
                        if r.returncode != 0:
                            continue
                        remote_archives = sorted(r.stdout.strip().splitlines(), reverse=True)[:1]
                        for archive_name in remote_archives:
                            archive_name = archive_name.strip()
                            if not archive_name:
                                continue
                            local_archive = _rclone_download_archive(rclone_dest, archive_name)
                            if not local_archive:
                                continue
                            try:
                                with open_tar_zst(local_archive) as tf:
                                    for member in tf:
                                        if member.isdir():
                                            continue
                                        if query_lower in member.name.lower():
                                            results.append({
                                                'job_name': job['job_name'],
                                                'display_name': job['display_name'],
                                                'backup_file': archive_name,
                                                'file_path': member.name,
                                                'size': member.size,
                                                'mode': 'compression'
                                            })
                                            if len(results) >= 50:
                                                break
                            except Exception:
                                pass
                            if len(results) >= 50:
                                break
                    except Exception as e:
                        print(f"rclone search error for {job['job_name']}: {e}")

                elif job['mode'] == 'direct':
                    # Use rclone lsf recursive to search remote directory
                    try:
                        r = _rclone_cmd(['lsf', rclone_dest, '--recursive', '--format', 'sp', '--files-only'])
                        if r.returncode == 0:
                            count = 0
                            for line in r.stdout.strip().splitlines():
                                line = line.strip()
                                if not line:
                                    continue
                                parts = line.split(';', 1)
                                if len(parts) == 2:
                                    try:
                                        size_bytes = int(parts[0])
                                    except ValueError:
                                        size_bytes = 0
                                    fpath = parts[1].strip()
                                    fname = os.path.basename(fpath)
                                    if query_lower in fname.lower():
                                        results.append({
                                            'job_name': job['job_name'],
                                            'display_name': job['display_name'],
                                            'backup_file': '',
                                            'file_path': fpath,
                                            'size': size_bytes,
                                            'mode': 'direct'
                                        })
                                        count += 1
                                        if count >= 10 or len(results) >= 50:
                                            break
                    except Exception as e:
                        print(f"rclone search error for {job['job_name']}: {e}")

                if len(results) >= 50:
                    break
                continue

            # --- rsync/filesystem backend ---
            if not os.path.exists(job['dest_path']):
                continue

            if job['mode'] == 'compression':
                archives = sorted(
                    [f for f in os.listdir(job['dest_path']) if f.endswith('.tar.zst')],
                    reverse=True
                )[:3]

                for archive_name in archives:
                    archive_path = os.path.join(job['dest_path'], archive_name)
                    try:
                        with open_tar_zst(archive_path) as tf:
                            for member in tf:
                                if member.isdir():
                                    continue
                                if query_lower in member.name.lower():
                                    results.append({
                                        'job_name': job['job_name'],
                                        'display_name': job['display_name'],
                                        'backup_file': archive_name,
                                        'file_path': member.name,
                                        'size': member.size,
                                        'mode': 'compression'
                                    })
                                    if len(results) >= 50:
                                        break
                    except Exception:
                        pass

                    if len(results) >= 50:
                        break

            elif job['mode'] == 'direct':
                count = 0
                for root, dirs, files_list in os.walk(job['dest_path']):
                    for f in files_list:
                        if query_lower in f.lower():
                            rel_path = os.path.relpath(os.path.join(root, f), job['dest_path'])
                            try:
                                fsize = os.path.getsize(os.path.join(root, f))
                            except Exception:
                                fsize = 0
                            results.append({
                                'job_name': job['job_name'],
                                'display_name': job['display_name'],
                                'backup_file': '',
                                'file_path': rel_path,
                                'size': fsize,
                                'mode': 'direct'
                            })
                            count += 1
                            if count >= 10 or len(results) >= 50:
                                break
                    if count >= 10 or len(results) >= 50:
                        break

            if len(results) >= 50:
                break

        return jsonify({'results': results, 'total': len(results), 'query': query})
    except Exception as e:
        print(f"Error api_restore_search: {e}")
        return jsonify({'error': str(e)}), 500
