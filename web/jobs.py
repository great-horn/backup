"""CRUD routes for backup job configurations."""

import json
from flask import Blueprint, request, jsonify

from .db import DB_PATH, get_all_job_configs, get_job_display_name
from .scheduler import get_next_run_for_job, reload_schedules
from .utils import get_local_datetime

import sqlite3

jobs_bp = Blueprint('jobs', __name__)


@jobs_bp.route('/api/jobs', methods=['GET'])
def api_get_jobs():
    """List all jobs with config + last run status."""
    try:
        jobs = get_all_job_configs()
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row

        for job in jobs:
            last_run = conn.execute('''
                SELECT status, start_time, end_time, duration
                FROM backup_runs WHERE job_name = ?
                ORDER BY start_time DESC LIMIT 1
            ''', (job['job_name'],)).fetchone()

            if last_run:
                job['last_status'] = last_run['status']
                job['last_run_date'] = last_run['start_time']
                job['last_duration'] = last_run['duration']
            else:
                job['last_status'] = 'unknown'
                job['last_run_date'] = None
                job['last_duration'] = None

            try:
                job['excludes'] = json.loads(job['excludes']) if isinstance(job['excludes'], str) else job['excludes']
            except (json.JSONDecodeError, TypeError):
                job['excludes'] = []

            job['next_run'] = get_next_run_for_job(job['job_name'])

        conn.close()
        return jsonify({'jobs': jobs})
    except Exception as e:
        print(f"Error api_get_jobs: {e}")
        return jsonify({'error': str(e)}), 500


@jobs_bp.route('/api/jobs', methods=['POST'])
def api_create_job():
    """Create a new backup job."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON data required'}), 400

        required = ['job_name', 'display_name', 'source_path', 'dest_path']
        for field in required:
            if not data.get(field):
                return jsonify({'error': f'Missing required field: {field}'}), 400

        conn = sqlite3.connect(DB_PATH)

        existing = conn.execute('SELECT id FROM job_configs WHERE job_name = ?', (data['job_name'],)).fetchone()
        if existing:
            conn.close()
            return jsonify({'error': f'Job "{data["job_name"]}" already exists'}), 409

        excludes = json.dumps(data.get('excludes', []))

        conn.execute('''
            INSERT INTO job_configs (job_name, display_name, source_path, dest_path, mode, excludes,
                icon_url, run_group, run_order, retention_count, backend_type, backend_config)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            data['job_name'],
            data['display_name'],
            data['source_path'],
            data['dest_path'],
            data.get('mode', 'compression'),
            excludes,
            data.get('icon_url', ''),
            data.get('run_group', 'medium'),
            data.get('run_order', 0),
            data.get('retention_count', 7),
            data.get('backend_type', 'rsync'),
            json.dumps(data.get('backend_config', {}))
        ))

        conn.execute('INSERT OR IGNORE INTO backup_jobs (job_name, status) VALUES (?, ?)', (data['job_name'], 'idle'))
        conn.commit()
        conn.close()

        return jsonify({'status': 'created', 'job_name': data['job_name']}), 201
    except Exception as e:
        print(f"Error api_create_job: {e}")
        return jsonify({'error': str(e)}), 500


@jobs_bp.route('/api/jobs/<name>', methods=['PUT'])
def api_update_job(name):
    """Update an existing backup job."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON data required'}), 400

        conn = sqlite3.connect(DB_PATH)

        existing = conn.execute('SELECT id FROM job_configs WHERE job_name = ?', (name,)).fetchone()
        if not existing:
            conn.close()
            return jsonify({'error': f'Job "{name}" not found'}), 404

        fields = {}
        allowed = ['display_name', 'source_path', 'dest_path', 'mode', 'icon_url',
                    'enabled', 'run_group', 'run_order', 'retention_count',
                    'backend_type', 'backend_config']
        for field in allowed:
            if field in data:
                if field == 'backend_config' and isinstance(data[field], dict):
                    fields[field] = json.dumps(data[field])
                else:
                    fields[field] = data[field]

        if 'excludes' in data:
            fields['excludes'] = json.dumps(data['excludes']) if isinstance(data['excludes'], list) else data['excludes']

        if 'schedule_enabled' in data:
            fields['schedule_enabled'] = data['schedule_enabled']
        if 'schedule_cron' in data:
            fields['schedule_cron'] = data['schedule_cron']

        if fields:
            fields['updated_at'] = get_local_datetime().isoformat()
            set_clause = ', '.join(f'{k} = ?' for k in fields.keys())
            values = list(fields.values()) + [name]
            conn.execute(f'UPDATE job_configs SET {set_clause} WHERE job_name = ?', values)
            conn.commit()

        conn.close()

        if 'schedule_enabled' in data or 'schedule_cron' in data:
            reload_schedules()

        return jsonify({'status': 'updated', 'job_name': name})
    except Exception as e:
        print(f"Error api_update_job: {e}")
        return jsonify({'error': str(e)}), 500


@jobs_bp.route('/api/jobs/<name>', methods=['DELETE'])
def api_delete_job(name):
    """Delete a backup job."""
    try:
        conn = sqlite3.connect(DB_PATH)

        existing = conn.execute('SELECT id FROM job_configs WHERE job_name = ?', (name,)).fetchone()
        if not existing:
            conn.close()
            return jsonify({'error': f'Job "{name}" not found'}), 404

        conn.execute('DELETE FROM job_configs WHERE job_name = ?', (name,))
        conn.commit()
        conn.close()

        reload_schedules()

        return jsonify({'status': 'deleted', 'job_name': name})
    except Exception as e:
        print(f"Error api_delete_job: {e}")
        return jsonify({'error': str(e)}), 500
