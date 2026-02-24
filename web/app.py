"""Backup Manager — Main Flask application with SocketIO."""

import os
import re
import time
import threading
import subprocess
import sqlite3
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit

from .utils import get_local_datetime
from .db import (
    DB_PATH, init_db, log_backup_start, log_backup_end,
    store_log_content_in_db, cleanup_old_data, get_job_display_name
)
from .analytics import analytics_bp, get_backup_stats
from .jobs import jobs_bp
from .scheduler import scheduler_bp, scheduler, load_schedules
from .restore import restore_bp
from .notifications import notifications_bp

# --- Flask App ---

app = Flask(__name__, static_folder='/app/web/static', static_url_path='/static')
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'change-me-in-production')

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode='threading',
    ping_timeout=120,
    ping_interval=60,
    logger=True,
    engineio_logger=False
)

# Register blueprints
app.register_blueprint(analytics_bp)
app.register_blueprint(jobs_bp)
app.register_blueprint(scheduler_bp)
app.register_blueprint(restore_bp)
app.register_blueprint(notifications_bp)

# --- Global state ---

running_processes = {}
PORT = int(os.environ.get('PORT', '9895'))


# --- Static routes ---

@app.route('/shared/<path:filename>')
def serve_shared(filename):
    """Serve shared assets."""
    return send_from_directory('/app/shared', filename)


@app.route("/")
def index():
    return send_from_directory('/app/web/static', 'index.html')


@app.route('/analytics')
@app.route('/logs')
@app.route('/settings')
@app.route('/restore')
def spa_redirect():
    """Redirect old URLs to the SPA."""
    return send_from_directory('/app/web/static', 'index.html')


# --- Execution routes ---

def parse_log_stats_for_job(job_name, log_file_path=None):
    """Parse stats from a specific job's log file."""
    transferred_mb = 0
    percent = 0

    try:
        if not log_file_path and job_name in running_processes:
            log_file_path = running_processes[job_name]['log_file']

        if not log_file_path or not os.path.exists(log_file_path):
            return 0, 0

        with open(log_file_path, 'r') as f:
            content = f.read()

            sent_matches = re.findall(r'Total bytes sent:\s*([\d,]+)', content)
            if sent_matches:
                total_bytes = sum(int(m.replace(',', '')) for m in sent_matches)
                transferred_mb = int(total_bytes / (1024 * 1024))

            if "Termin" in content or "Complete" in content:
                percent = 100
            elif "chec" in content or "fail" in content or "Error" in content:
                percent = 0
            else:
                percent = 50
    except Exception as e:
        print(f"Error parse_log_stats_for_job {job_name}: {e}")

    return transferred_mb, percent


def monitor_backup_process(process, job_name, run_id):
    """Monitor a backup process and record results."""
    try:
        start_time = time.time()
        print(f"Monitoring started for {job_name} (PID: {process.pid})")

        return_code = process.wait()
        final_duration = int(time.time() - start_time)
        status = 'success' if return_code == 0 else 'error'

        print(f"{job_name} completed in {final_duration}s with code {return_code}")

        log_file_path = running_processes[job_name]['log_file']
        transferred_mb, percent = parse_log_stats_for_job(job_name, log_file_path)

        store_log_content_in_db(run_id, log_file_path)

        log_backup_end(job_name, status, final_duration, transferred_mb, percent,
                       f"Exit code: {return_code}" if return_code != 0 else None)

        if job_name in running_processes:
            del running_processes[job_name]

        try:
            socketio.emit('backup_status', {
                'job': job_name,
                'status': status,
                'run_id': run_id,
                'duration': final_duration,
                'transferred_mb': transferred_mb,
                'return_code': return_code
            })
            socketio.emit('backup_stats', get_backup_stats())
        except Exception as e:
            print(f"WebSocket emit error for {job_name}: {e}")

    except Exception as e:
        print(f"Monitoring error {job_name}: {e}")
        if job_name in running_processes:
            del running_processes[job_name]
        log_backup_end(job_name, 'error', 0, error_msg=str(e))
        try:
            socketio.emit('backup_status', {
                'job': job_name,
                'status': 'error',
                'run_id': run_id,
                'error': str(e)
            })
        except Exception:
            pass


@app.route("/run")
def run_job():
    """Start a backup job."""
    try:
        job = request.args.get("job", "all")
        print(f"Launch request for job: {job}")

        if job == "all":
            process = subprocess.Popen(
                ["/bin/bash", "/app/backup.sh", "all"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True
            )
            return jsonify({
                'status': 'started',
                'job': 'all',
                'pid': process.pid,
                'message': 'Sequence started'
            })

        if job in running_processes:
            process = running_processes[job]['process']
            if process.poll() is None:
                return jsonify({
                    'status': 'already_running',
                    'job': job,
                    'pid': process.pid
                })
            else:
                del running_processes[job]

        local_now = get_local_datetime()
        timestamp = local_now.strftime("%Y-%m-%d_%H-%M-%S-%f")[:-3]
        log_file = f"/app/logs/backup_{job}_{timestamp}.log"

        env = os.environ.copy()
        env['BACKUP_LOG_FILE'] = log_file

        process = subprocess.Popen(
            ["/bin/bash", "/app/backup.sh", job],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            env=env
        )

        run_id = log_backup_start(job, log_file, process.pid)

        running_processes[job] = {
            'process': process,
            'run_id': run_id,
            'start_time': time.time(),
            'log_file': log_file
        }

        monitor_thread = threading.Thread(
            target=monitor_backup_process,
            args=(process, job, run_id),
            name=f"monitor-{job}",
            daemon=True
        )
        monitor_thread.start()

        return jsonify({
            'status': 'started',
            'job': job,
            'run_id': run_id,
            'pid': process.pid,
            'total_running': len(running_processes)
        })

    except Exception as e:
        print(f"Error run_job: {e}")
        return jsonify({'error': str(e)}), 500


@app.route("/kill")
def kill_job():
    """Stop a running backup job."""
    try:
        job = request.args.get("job")
        if not job or job not in running_processes:
            return jsonify({'error': 'Job not found or not running'}), 404

        process = running_processes[job]['process']
        process.terminate()

        time.sleep(2)
        if process.poll() is None:
            process.kill()

        log_backup_end(job, 'killed', 0, error_msg="Killed by user")
        del running_processes[job]

        socketio.emit('backup_status', {'job': job, 'status': 'killed'})

        return jsonify({'status': 'killed', 'job': job})
    except Exception as e:
        print(f"Error kill_job: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/status')
def debug():
    """Application status endpoint."""
    try:
        db_stats = get_backup_stats()
        debug_info = {
            'running_processes': {},
            'timezone': str(get_local_datetime().tzinfo),
            'current_time': get_local_datetime().isoformat()
        }

        for job, data in running_processes.items():
            debug_info['running_processes'][job] = {
                'pid': data['process'].pid,
                'run_id': data['run_id'],
                'start_time': data['start_time'],
                'duration': int(time.time() - data['start_time']),
                'poll_status': data['process'].poll()
            }

        return jsonify({
            'status': 'ok',
            'db_path': DB_PATH,
            'db_exists': os.path.exists(DB_PATH),
            'stats_count': len(db_stats['stats']),
            'running_jobs': len(running_processes),
            'debug_info': debug_info
        })
    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


# --- Process cleanup ---

def cleanup_finished_processes():
    """Clean up finished processes from tracking."""
    to_remove = []
    for job_name, data in running_processes.items():
        if data['process'].poll() is not None:
            to_remove.append(job_name)

    for job_name in to_remove:
        del running_processes[job_name]

    if to_remove:
        socketio.emit('backup_stats', get_backup_stats())


# --- WebSocket events ---

@socketio.on('connect')
def handle_connect():
    """Client WebSocket connected."""
    emit('backup_stats', get_backup_stats())
    for job, data in running_processes.items():
        emit('backup_status', {
            'job': job,
            'status': 'running',
            'run_id': data['run_id'],
            'duration': int(time.time() - data['start_time'])
        })


@socketio.on('disconnect')
def handle_disconnect():
    pass


@socketio.on('heartbeat')
def handle_heartbeat():
    emit('heartbeat_ack', {'timestamp': time.time()})


@socketio.on('request_stats')
def handle_stats_request():
    emit('backup_stats', get_backup_stats())

