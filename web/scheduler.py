"""APScheduler management: load/reload schedules, VACUUM, schedule updates."""

import sqlite3
from flask import Blueprint, request, jsonify
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from .db import DB_PATH
from .notifications import SMTP_ENABLED, send_weekly_report
from .utils import get_local_datetime

scheduler_bp = Blueprint('scheduler', __name__)

TIMEZONE = 'Europe/Zurich'
scheduler = BackgroundScheduler(timezone=TIMEZONE)


def trigger_backup_job(job_name):
    """Trigger a backup via internal API (called by APScheduler)."""
    try:
        import requests
        port = int(__import__('os').environ.get('PORT', '9895'))
        print(f"APScheduler: Triggering backup {job_name}")
        requests.get(f'http://localhost:{port}/run?job={job_name}', timeout=10)
    except Exception as e:
        print(f"APScheduler: Error triggering {job_name}: {e}")


def load_schedules():
    """Load schedules from job_configs and create APScheduler triggers."""
    try:
        for existing_job in scheduler.get_jobs():
            existing_job.remove()

        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        jobs = conn.execute('''
            SELECT job_name, schedule_cron FROM job_configs
            WHERE schedule_enabled = 1 AND schedule_cron != ''
        ''').fetchall()
        conn.close()

        for job in jobs:
            try:
                cron_parts = job['schedule_cron'].split()
                if len(cron_parts) == 5:
                    trigger = CronTrigger(
                        minute=cron_parts[0],
                        hour=cron_parts[1],
                        day=cron_parts[2],
                        month=cron_parts[3],
                        day_of_week=cron_parts[4],
                        timezone=TIMEZONE
                    )
                    scheduler.add_job(
                        trigger_backup_job,
                        trigger=trigger,
                        args=[job['job_name']],
                        id=f'backup_{job["job_name"]}',
                        replace_existing=True,
                        name=f'Backup {job["job_name"]}'
                    )
                    print(f"APScheduler: Schedule added for {job['job_name']} ({job['schedule_cron']})")
                else:
                    print(f"APScheduler: Invalid cron for {job['job_name']}: {job['schedule_cron']}")
            except Exception as e:
                print(f"APScheduler: Error scheduling {job['job_name']}: {e}")

        # Bi-monthly VACUUM (1st and 15th at 3am)
        scheduler.add_job(
            vacuum_db,
            CronTrigger(minute=0, hour=3, day='1,15', timezone=TIMEZONE),
            id='vacuum_db',
            replace_existing=True,
            name='VACUUM SQLite'
        )

        # Weekly email report (Monday 8am)
        if SMTP_ENABLED:
            scheduler.add_job(
                send_weekly_report,
                CronTrigger(day_of_week='mon', hour=8, minute=0, timezone=TIMEZONE),
                id='weekly_report',
                replace_existing=True,
                name='Weekly email report'
            )
            print("APScheduler: Weekly report scheduled (Monday 8am)")
        else:
            print("APScheduler: Weekly report disabled (SMTP not configured)")

        print(f"APScheduler: {len(scheduler.get_jobs())} schedule(s) active")
    except Exception as e:
        print(f"APScheduler: Error load_schedules: {e}")


def vacuum_db():
    """VACUUM the SQLite database to reclaim disk space."""
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute('VACUUM')
        conn.close()
        print("APScheduler: VACUUM completed")
    except Exception as e:
        print(f"APScheduler: VACUUM error: {e}")


def reload_schedules():
    """Reload schedules (called after API modifications)."""
    load_schedules()


def get_next_run_for_job(job_name):
    """Return the next scheduled run time for a job."""
    try:
        job = scheduler.get_job(f'backup_{job_name}')
        if job and job.next_run_time:
            return job.next_run_time.isoformat()
    except Exception:
        pass
    return None


# --- Routes ---

@scheduler_bp.route('/api/jobs/<name>/schedule', methods=['PUT'])
def api_update_schedule(name):
    """Update a job's schedule."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON data required'}), 400

        conn = sqlite3.connect(DB_PATH)
        existing = conn.execute('SELECT id FROM job_configs WHERE job_name = ?', (name,)).fetchone()
        if not existing:
            conn.close()
            return jsonify({'error': f'Job "{name}" not found'}), 404

        schedule_enabled = data.get('schedule_enabled', 0)
        schedule_cron = data.get('schedule_cron', '')

        conn.execute('''
            UPDATE job_configs SET schedule_enabled = ?, schedule_cron = ?, updated_at = ?
            WHERE job_name = ?
        ''', (schedule_enabled, schedule_cron, get_local_datetime().isoformat(), name))
        conn.commit()
        conn.close()

        reload_schedules()

        return jsonify({'status': 'updated', 'job_name': name})
    except Exception as e:
        print(f"Error api_update_schedule: {e}")
        return jsonify({'error': str(e)}), 500
