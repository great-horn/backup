"""Restore routes: list, browse, run, search."""

import os
import threading
import subprocess
import shutil
import tarfile
import zstandard
from datetime import datetime
from contextlib import contextmanager
from flask import Blueprint, request, jsonify

from .db import get_job_config, get_all_job_configs

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
            job_info = {
                'job_name': job['job_name'],
                'display_name': job['display_name'],
                'mode': job['mode'],
                'icon_url': job['icon_url'],
                'dest_path': dest,
                'backups': []
            }

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

        entries = []

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

                if config['mode'] == 'compression' and backup_file:
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
            if not job.get('enabled') or not os.path.exists(job['dest_path']):
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
