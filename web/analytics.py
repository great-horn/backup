"""Analytics routes: stats, metrics, anomalies, storage, logs, Prometheus."""

import os
import re
import gzip
import sqlite3
from datetime import datetime
from flask import Blueprint, request, jsonify

from .db import DB_PATH, get_job_display_name, get_all_job_configs

analytics_bp = Blueprint('analytics', __name__)


def get_backup_stats():
    """Get backup statistics with normalized names and compression stats."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row

        stats = conn.execute('''
            SELECT job_name,
                   COUNT(*) as total_runs,
                   COALESCE(AVG(duration), 0) as avg_duration,
                   COALESCE(SUM(transferred_mb), 0) as total_transferred,
                   COALESCE(AVG(CASE WHEN status = 'success' THEN 1 ELSE 0 END) * 100, 0) as success_rate,
                   MAX(start_time) as last_run
            FROM backup_runs
            WHERE start_time > datetime('now', '-30 days')
            GROUP BY job_name
            ORDER BY last_run DESC
        ''').fetchall()

        current_jobs = conn.execute('''
            SELECT * FROM backup_jobs WHERE status != 'idle' ORDER BY last_run DESC
        ''').fetchall()

        recent_runs = conn.execute('''
            SELECT * FROM backup_runs
            WHERE start_time > datetime('now', '-30 days')
            ORDER BY start_time DESC
        ''').fetchall()

        compression_stats = conn.execute('''
            SELECT
                AVG(compression_ratio) as avg_compression_ratio,
                COUNT(*) as total_compressed_backups,
                SUM(original_size_mb) as total_original_mb,
                SUM(compressed_size_mb) as total_compressed_mb
            FROM backup_metrics bm
            JOIN backup_runs br ON bm.run_id = br.id
            WHERE br.start_time > datetime('now', '-30 days')
              AND bm.compression_ratio > 0
        ''').fetchone()

        conn.close()

        stats_normalized = []
        for row in stats:
            stat_dict = dict(row)
            stat_dict['display_name'] = get_job_display_name(stat_dict['job_name'])
            stats_normalized.append(stat_dict)

        recent_runs_normalized = []
        seen_combinations = set()

        for row in recent_runs:
            run_dict = dict(row)
            run_dict['display_name'] = get_job_display_name(run_dict['job_name'])

            if 'log_content' in run_dict:
                del run_dict['log_content']

            if run_dict['start_time']:
                try:
                    dt = datetime.fromisoformat(run_dict['start_time'].replace('Z', '+00:00'))
                    dt_rounded = dt.replace(second=0, microsecond=0)
                    unique_key = f"{run_dict['job_name']}-{dt_rounded.isoformat()}"

                    if unique_key not in seen_combinations:
                        seen_combinations.add(unique_key)
                        recent_runs_normalized.append(run_dict)
                except Exception:
                    recent_runs_normalized.append(run_dict)
            else:
                recent_runs_normalized.append(run_dict)

        compression_data = {
            'avg_compression_ratio': compression_stats[0] if compression_stats and compression_stats[0] else 0,
            'total_compressed_backups': compression_stats[1] if compression_stats and compression_stats[1] else 0,
            'total_original_mb': compression_stats[2] if compression_stats and compression_stats[2] else 0,
            'total_compressed_mb': compression_stats[3] if compression_stats and compression_stats[3] else 0
        }

        return {
            'stats': stats_normalized,
            'current_jobs': [dict(row) for row in current_jobs],
            'recent_runs': recent_runs_normalized,
            'compression_stats': compression_data
        }
    except Exception as e:
        print(f"Error get_backup_stats: {e}")
        return {
            'stats': [],
            'current_jobs': [],
            'recent_runs': [],
            'compression_stats': {
                'avg_compression_ratio': 0,
                'total_compressed_backups': 0,
                'total_original_mb': 0,
                'total_compressed_mb': 0
            }
        }


# --- Routes ---

@analytics_bp.route('/api/stats')
def api_stats():
    """API to get stats as JSON."""
    return jsonify(get_backup_stats())


@analytics_bp.route('/api/metrics')
def api_metrics():
    """API to get aggregated metrics for the dashboard."""
    try:
        stats_data = get_backup_stats()
        all_stats = stats_data.get('stats', [])
        recent_runs = stats_data.get('recent_runs', [])

        if all_stats:
            success_rate = sum(s.get('success_rate', 0) for s in all_stats) / len(all_stats)
            avg_duration = sum(s.get('avg_duration', 0) for s in all_stats) / len(all_stats)
            total_data = sum(s.get('total_transferred', 0) for s in all_stats)
        else:
            success_rate = 0
            avg_duration = 0
            total_data = 0

        last_backup = '--'
        if recent_runs:
            try:
                last_run = recent_runs[0]
                if last_run.get('start_time'):
                    dt = datetime.fromisoformat(last_run['start_time'].replace('Z', '+00:00'))
                    last_backup = dt.strftime('%d/%m/%Y')
            except Exception:
                pass

        return jsonify({
            'success_rate': f"{int(success_rate)}%",
            'avg_duration': f"{int(avg_duration)}s",
            'total_data': f"{int(total_data)} MB",
            'last_backup': last_backup
        })
    except Exception as e:
        print(f"Error api_metrics: {e}")
        return jsonify({
            'success_rate': '--',
            'avg_duration': '--',
            'total_data': '--',
            'last_backup': '--'
        })


@analytics_bp.route('/api/job-status')
def api_job_status():
    """API to get the last backup status of each job."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row

        job_names = conn.execute('SELECT job_name FROM job_configs WHERE enabled = 1').fetchall()
        jobs = [row['job_name'] for row in job_names]

        jobs_status = {}
        for job in jobs:
            result = conn.execute('''
                SELECT status, start_time, end_time
                FROM backup_runs WHERE job_name = ?
                ORDER BY start_time DESC LIMIT 1
            ''', (job,)).fetchone()

            if result:
                try:
                    dt = datetime.fromisoformat(result['start_time'].replace('Z', '+00:00'))
                    jobs_status[job] = {
                        'status': result['status'] or 'unknown',
                        'date': dt.strftime('%d/%m %H:%M')
                    }
                except Exception:
                    jobs_status[job] = {'status': result['status'] or 'unknown', 'date': '--'}
            else:
                jobs_status[job] = {'status': 'unknown', 'date': '--'}

        conn.close()
        return jsonify(jobs_status)
    except Exception as e:
        print(f"Error api_job_status: {e}")
        return jsonify({}), 500


@analytics_bp.route('/api/logs')
def get_logs_list():
    """API to get the list of logs from the DB."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row

        logs_from_db = conn.execute('''
            SELECT job_name, start_time, end_time, duration, status,
                   transferred_mb, log_file, id
            FROM backup_runs
            WHERE log_file IS NOT NULL
            ORDER BY start_time DESC
            LIMIT 100
        ''').fetchall()

        conn.close()

        logs = []
        for row in logs_from_db:
            try:
                log_dict = dict(row)
                backup_name = get_job_display_name(log_dict['job_name'])
                start_time = datetime.fromisoformat(log_dict['start_time'].replace('Z', '+00:00'))
                size_str = f"{log_dict['transferred_mb'] or 0} MB"

                logs.append({
                    'filename': f"run_{log_dict['id']}.log",
                    'backup_name': backup_name,
                    'date': start_time.isoformat(),
                    'size': size_str,
                    'status': log_dict['status'] or 'unknown',
                    'duration': log_dict['duration'],
                    'transferred_mb': log_dict['transferred_mb'],
                    'run_id': log_dict['id']
                })
            except Exception as e:
                print(f"Error parsing log DB {row}: {e}")
                continue

        return jsonify({'logs': logs})
    except Exception as e:
        print(f"Error get_logs_list: {e}")
        return jsonify({'error': str(e)}), 500


@analytics_bp.route('/log/<path:log_identifier>')
def get_log_content(log_identifier):
    """Get log content from the DB."""
    try:
        if log_identifier.startswith('run_') and log_identifier.endswith('.log'):
            run_id = log_identifier[4:-4]

            conn = sqlite3.connect(DB_PATH)
            result = conn.execute('''
                SELECT log_content, job_name, start_time
                FROM backup_runs WHERE id = ?
            ''', (run_id,)).fetchone()
            conn.close()

            if result:
                log_content_compressed, job_name, start_time = result
                if log_content_compressed:
                    try:
                        if isinstance(log_content_compressed, bytes):
                            log_content = gzip.decompress(log_content_compressed).decode('utf-8')
                        else:
                            log_content = log_content_compressed

                        return jsonify({
                            'content': log_content,
                            'filename': log_identifier,
                            'job_name': job_name,
                            'start_time': start_time
                        })
                    except Exception as e:
                        print(f"Error decompressing log {run_id}: {e}")
                        return jsonify({'error': 'Log decompression error'}), 500
                else:
                    return jsonify({'error': 'Log content not available'}), 404
            else:
                return jsonify({'error': 'Log not found'}), 404
        else:
            return jsonify({'error': 'Invalid identifier format'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@analytics_bp.route('/api/anomalies/<job_name>')
def check_anomalies(job_name):
    """Detect anomalies for a job based on its 14-day history."""
    try:
        conn = sqlite3.connect(DB_PATH)

        last_run = conn.execute('''
            SELECT transferred_mb, duration, status
            FROM backup_runs WHERE job_name = ?
            ORDER BY start_time DESC LIMIT 1
        ''', (job_name,)).fetchone()

        if not last_run or last_run[2] != 'success':
            conn.close()
            return jsonify({'job': job_name, 'anomalies': []})

        current_size_mb, current_duration, _ = last_run

        stats = conn.execute('''
            SELECT
                AVG(transferred_mb) as avg_size,
                AVG(duration) as avg_duration,
                COUNT(*) as count
            FROM backup_runs
            WHERE job_name = ? AND status = 'success'
              AND start_time > datetime('now', '-14 days')
        ''', (job_name,)).fetchone()

        conn.close()

        anomalies = []

        if stats and stats[2] > 5:
            avg_size = stats[0] or 0
            avg_duration = stats[1] or 0

            if avg_size > 0 and abs(current_size_mb - avg_size) / avg_size > 0.30:
                diff = ((current_size_mb - avg_size) / avg_size) * 100
                anomalies.append({
                    'type': 'size',
                    'severity': 'warning',
                    'message': f"Abnormal size: {diff:+.1f}% vs average",
                    'current': current_size_mb,
                    'average': avg_size
                })

            if avg_duration > 0 and current_duration > avg_duration * 1.5:
                diff = ((current_duration - avg_duration) / avg_duration) * 100
                anomalies.append({
                    'type': 'duration',
                    'severity': 'warning',
                    'message': f"Abnormal duration: {diff:+.1f}% vs average",
                    'current': current_duration,
                    'average': avg_duration
                })

        return jsonify({
            'job': job_name,
            'anomalies': anomalies,
            'stats': {
                'avg_size_mb': stats[0] if stats else 0,
                'avg_duration': stats[1] if stats else 0,
                'sample_size': stats[2] if stats else 0
            }
        })
    except Exception as e:
        print(f"Error check_anomalies: {e}")
        return jsonify({'error': str(e)}), 500


@analytics_bp.route('/api/storage-prediction')
def storage_prediction():
    """Display current storage usage."""
    try:
        import subprocess
        storage_path = os.environ.get('STORAGE_MOUNT_PATH', '/mnt/data')
        try:
            df_output = subprocess.check_output(['df', '-k', storage_path], universal_newlines=True)
            lines = df_output.strip().split('\n')
            if len(lines) >= 2:
                fields = lines[1].split()
                nas_capacity_mb = int(fields[1]) // 1024
                nas_used_mb = int(fields[2]) // 1024
                nas_free_mb = int(fields[3]) // 1024
            else:
                nas_capacity_mb = 0
                nas_used_mb = 0
                nas_free_mb = 0
        except Exception as e:
            print(f"df error: {e}")
            nas_capacity_mb = 0
            nas_used_mb = 0
            nas_free_mb = 0

        return jsonify({
            'nas_used_mb': int(nas_used_mb),
            'nas_used_gb': int(nas_used_mb / 1024) if nas_used_mb else 0,
            'nas_free_mb': int(nas_free_mb),
            'nas_free_gb': int(nas_free_mb / 1024) if nas_free_mb else 0,
            'nas_capacity_mb': nas_capacity_mb,
            'nas_capacity_gb': int(nas_capacity_mb / 1024) if nas_capacity_mb else 0
        })
    except Exception as e:
        print(f"Error storage_prediction: {e}")
        return jsonify({'error': str(e)}), 500


@analytics_bp.route('/api/job_status/<job>')
def get_job_status(job):
    """Return the status of a job."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.execute('SELECT status FROM backup_jobs WHERE job_name = ?', (job,))
        row = cursor.fetchone()
        conn.close()

        if row:
            return jsonify({'status': row[0]})
        return jsonify({'status': 'unknown'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@analytics_bp.route('/metrics')
def prometheus_metrics():
    """Export metrics in Prometheus format."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row

        metrics = []

        job_rows = conn.execute('SELECT job_name FROM job_configs WHERE enabled = 1').fetchall()
        jobs = [row['job_name'] for row in job_rows]

        for job in jobs:
            last_run = conn.execute('''
                SELECT status, duration, transferred_mb, start_time
                FROM backup_runs WHERE job_name = ?
                ORDER BY start_time DESC LIMIT 1
            ''', (job,)).fetchone()

            if last_run:
                success = 1 if last_run['status'] == 'success' else 0
                duration = last_run['duration'] or 0
                size_mb = last_run['transferred_mb'] or 0

                timestamp = 0
                if last_run['start_time']:
                    try:
                        dt = datetime.fromisoformat(last_run['start_time'].replace('Z', '+00:00'))
                        timestamp = int(dt.timestamp())
                    except Exception:
                        pass

                metrics.append(f'backup_last_run_timestamp{{backup_job="{job}"}} {timestamp}')
                metrics.append(f'backup_duration_seconds{{backup_job="{job}"}} {duration}')
                metrics.append(f'backup_size_mb{{backup_job="{job}"}} {size_mb}')
                metrics.append(f'backup_success{{backup_job="{job}"}} {success}')

            stats_30d = conn.execute('''
                SELECT
                    COUNT(*) as total_runs,
                    COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
                    COUNT(CASE WHEN status = 'error' THEN 1 END) as error_count,
                    AVG(duration) as avg_duration,
                    AVG(transferred_mb) as avg_size
                FROM backup_runs
                WHERE job_name = ? AND start_time > datetime('now', '-30 days')
            ''', (job,)).fetchone()

            if stats_30d:
                total = stats_30d['total_runs'] or 0
                success_cnt = stats_30d['success_count'] or 0
                errors = stats_30d['error_count'] or 0
                avg_dur = stats_30d['avg_duration'] or 0
                avg_sz = stats_30d['avg_size'] or 0
                success_rate = (success_cnt / total * 100) if total > 0 else 0

                metrics.append(f'backup_total_runs{{backup_job="{job}"}} {total}')
                metrics.append(f'backup_success_total{{backup_job="{job}"}} {success_cnt}')
                metrics.append(f'backup_errors_total{{backup_job="{job}"}} {errors}')
                metrics.append(f'backup_success_rate_percent{{backup_job="{job}"}} {success_rate:.2f}')
                metrics.append(f'backup_avg_duration_seconds{{backup_job="{job}"}} {avg_dur:.2f}')
                metrics.append(f'backup_avg_size_mb{{backup_job="{job}"}} {avg_sz:.2f}')

        global_stats = conn.execute('''
            SELECT
                COUNT(*) as total_runs,
                COUNT(CASE WHEN status = 'success' THEN 1 END) as total_success,
                COUNT(CASE WHEN status = 'error' THEN 1 END) as total_errors,
                SUM(transferred_mb) as total_size_mb
            FROM backup_runs
        ''').fetchone()

        if global_stats:
            metrics.append(f'backup_global_total_runs {global_stats["total_runs"] or 0}')
            metrics.append(f'backup_global_success_total {global_stats["total_success"] or 0}')
            metrics.append(f'backup_global_errors_total {global_stats["total_errors"] or 0}')
            metrics.append(f'backup_global_total_size_mb {global_stats["total_size_mb"] or 0}')

        db_size = os.path.getsize(DB_PATH) / (1024 * 1024)
        metrics.append(f'backup_db_size_mb {db_size:.2f}')

        from .app import running_processes
        running_count = len(running_processes)
        metrics.append(f'backup_running_jobs {running_count}')

        conn.close()

        output = '\n'.join(metrics) + '\n'
        return output, 200, {'Content-Type': 'text/plain; charset=utf-8'}
    except Exception as e:
        print(f"Error prometheus_metrics: {e}")
        return f"# Error: {e}\n", 500, {'Content-Type': 'text/plain'}
