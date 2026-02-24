"""Database initialization, schema, seeds, migrations, and log helpers."""

import sqlite3
import os
import gzip
import re
import json
from datetime import datetime, timedelta

from .utils import get_local_datetime

DB_PATH = os.getenv('DB_PATH', '/app/logs/backup_stats.db')

# Demo seeds for new installations (disabled by default)
DEMO_SEEDS = [
    {
        'job_name': 'demo_app',
        'display_name': 'Demo App Backup',
        'source_path': '/source/myapp',
        'dest_path': '/backup/myapp',
        'mode': 'compression',
        'excludes': json.dumps(["logs/**", "__pycache__/**", "*.pyc"]),
        'icon_url': 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/docker-light.svg',
        'run_group': 'light',
        'run_order': 0,
        'retention_count': 7,
        'enabled': 0,
        'backend_type': 'rsync',
        'backend_config': '{}'
    },
    {
        'job_name': 'demo_media',
        'display_name': 'Demo Media Sync',
        'source_path': '/source/media',
        'dest_path': '/backup/media',
        'mode': 'direct',
        'excludes': json.dumps(["thumbs/**", "cache/**"]),
        'icon_url': 'https://cdn.jsdelivr.net/gh/selfhst/icons/svg/duplicati-light.svg',
        'run_group': 'medium',
        'run_order': 10,
        'retention_count': 7,
        'enabled': 0,
        'backend_type': 'rsync',
        'backend_config': '{}'
    }
]


def get_db():
    """Get a database connection with WAL mode and busy timeout."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA busy_timeout=5000')
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize the SQLite database with schema, indexes, seeds, and migrations."""
    try:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        conn = get_db()

        # Main runs table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS backup_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_name TEXT NOT NULL,
                start_time DATETIME NOT NULL,
                end_time DATETIME,
                duration INTEGER,
                status TEXT NOT NULL,
                transferred_mb INTEGER DEFAULT 0,
                percent_complete INTEGER DEFAULT 0,
                error_message TEXT,
                log_file TEXT,
                log_content TEXT
            )
        ''')

        # Migration: add log_content if missing
        try:
            conn.execute('ALTER TABLE backup_runs ADD COLUMN log_content TEXT')
        except sqlite3.OperationalError:
            pass

        # Jobs status table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS backup_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_name TEXT NOT NULL,
                status TEXT DEFAULT 'idle',
                last_run DATETIME,
                next_run DATETIME,
                pid INTEGER,
                UNIQUE(job_name)
            )
        ''')

        # Compression metrics table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS backup_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER REFERENCES backup_runs(id),
                original_size_mb INTEGER,
                compressed_size_mb INTEGER,
                compression_ratio REAL,
                files_count INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Job configuration table
        conn.execute('''
            CREATE TABLE IF NOT EXISTS job_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_name TEXT NOT NULL UNIQUE,
                display_name TEXT NOT NULL,
                source_path TEXT NOT NULL,
                dest_path TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT 'compression',
                excludes TEXT DEFAULT '[]',
                icon_url TEXT DEFAULT '',
                enabled INTEGER DEFAULT 1,
                schedule_enabled INTEGER DEFAULT 0,
                schedule_cron TEXT DEFAULT '',
                run_group TEXT DEFAULT 'medium',
                run_order INTEGER DEFAULT 0,
                retention_count INTEGER DEFAULT 7,
                backend_type TEXT DEFAULT 'rsync',
                backend_config TEXT DEFAULT '{}',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # Migrations: add new columns if missing
        for col, default in [
            ('backend_type', "'rsync'"),
            ('backend_config', "'{}'"),
        ]:
            try:
                conn.execute(f'ALTER TABLE job_configs ADD COLUMN {col} TEXT DEFAULT {default}')
            except sqlite3.OperationalError:
                pass

        # Indexes
        conn.execute('CREATE INDEX IF NOT EXISTS idx_backup_runs_start_time ON backup_runs(start_time DESC)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_backup_runs_job_status ON backup_runs(job_name, status)')

        # Seed demo jobs
        seed_default_jobs(conn)

        # Initialize backup_jobs from job_configs
        job_configs = conn.execute('SELECT job_name FROM job_configs WHERE enabled = 1').fetchall()
        all_job_names = ['all'] + [row[0] for row in job_configs]
        for job_name in all_job_names:
            conn.execute('''
                INSERT OR IGNORE INTO backup_jobs (job_name, status)
                VALUES (?, 'idle')
            ''', (job_name,))

        conn.commit()
        conn.close()
        print(f"Database initialized: {DB_PATH}")
    except Exception as e:
        print(f"Error init DB: {e}")


def seed_default_jobs(conn):
    """Insert demo jobs if job_configs table is empty."""
    count = conn.execute('SELECT COUNT(*) FROM job_configs').fetchone()[0]
    if count > 0:
        return

    for job in DEMO_SEEDS:
        conn.execute('''
            INSERT INTO job_configs (job_name, display_name, source_path, dest_path, mode, excludes,
                icon_url, run_group, run_order, retention_count, enabled, backend_type, backend_config)
            VALUES (:job_name, :display_name, :source_path, :dest_path, :mode, :excludes,
                :icon_url, :run_group, :run_order, :retention_count, :enabled, :backend_type, :backend_config)
        ''', job)

    print(f"Seed: {len(DEMO_SEEDS)} demo jobs inserted (disabled)")


def get_job_display_name(job_name):
    """Get display name for a job from job_configs."""
    if job_name == 'all':
        return 'Full Backup'
    try:
        conn = sqlite3.connect(DB_PATH)
        result = conn.execute('SELECT display_name FROM job_configs WHERE job_name = ?', (job_name,)).fetchone()
        conn.close()
        if result:
            return result[0]
    except Exception:
        pass
    return job_name.title()


def get_job_config(job_name):
    """Get full config for a job from job_configs."""
    try:
        conn = get_db()
        result = conn.execute('SELECT * FROM job_configs WHERE job_name = ?', (job_name,)).fetchone()
        conn.close()
        if result:
            return dict(result)
    except Exception as e:
        print(f"Error get_job_config: {e}")
    return None


def get_all_job_configs():
    """Get all job configs ordered by run_group and run_order."""
    try:
        conn = get_db()
        results = conn.execute('SELECT * FROM job_configs ORDER BY run_group, run_order').fetchall()
        conn.close()
        return [dict(row) for row in results]
    except Exception as e:
        print(f"Error get_all_job_configs: {e}")
        return []


def log_backup_start(job_name, log_file, pid=None):
    """Record the start of a backup run."""
    try:
        conn = sqlite3.connect(DB_PATH)
        local_now = get_local_datetime()

        cursor = conn.execute('''
            INSERT INTO backup_runs (job_name, start_time, status, log_file)
            VALUES (?, ?, 'running', ?)
        ''', (job_name, local_now.isoformat(), os.path.basename(log_file)))

        run_id = cursor.lastrowid

        conn.execute('''
            INSERT OR REPLACE INTO backup_jobs (job_name, status, last_run, pid)
            VALUES (?, 'running', ?, ?)
        ''', (job_name, local_now.isoformat(), pid))

        conn.commit()
        conn.close()
        print(f"Backup {job_name} started at {local_now.strftime('%Y-%m-%d %H:%M:%S')} (run_id: {run_id})")
        return run_id
    except Exception as e:
        print(f"Error log_backup_start: {e}")
        return None


def store_log_content_in_db(run_id, log_file_path):
    """Store compressed log content in the DB and parse metrics."""
    try:
        if not os.path.exists(log_file_path):
            print(f"Log file not found: {log_file_path}")
            return

        with open(log_file_path, 'r', encoding='utf-8', errors='ignore') as f:
            log_content = f.read()

        log_compressed = gzip.compress(log_content.encode('utf-8'))
        original_size = len(log_content.encode('utf-8'))
        compressed_size = len(log_compressed)
        compression_ratio = (compressed_size / original_size * 100) if original_size > 0 else 0

        print(f"Log compression: {original_size} -> {compressed_size} bytes ({compression_ratio:.1f}%)")

        conn = sqlite3.connect(DB_PATH)

        conn.execute('''
            UPDATE backup_runs SET log_content = ? WHERE id = ?
        ''', (log_compressed, run_id))

        # Parse and store compression metrics if present
        metrics_lines = re.findall(r'METRICS:([^:]+):(\d+):(\d+):([\d.]+):(\d+)', log_content)

        for metric in metrics_lines:
            backup_name, original_mb, compressed_mb, ratio, files_count = metric
            conn.execute('''
                INSERT INTO backup_metrics
                (run_id, original_size_mb, compressed_size_mb, compression_ratio, files_count)
                VALUES (?, ?, ?, ?, ?)
            ''', (run_id, int(original_mb), int(compressed_mb), float(ratio), int(files_count)))
            print(f"Metrics stored for {backup_name}: {original_mb}MB -> {compressed_mb}MB ({ratio}%)")

        conn.commit()
        conn.close()

        # Delete physical log file after DB storage
        try:
            os.remove(log_file_path)
            print(f"Log file deleted: {os.path.basename(log_file_path)}")
        except Exception as e:
            print(f"Error deleting log {log_file_path}: {e}")

        print(f"Log stored in DB for run_id {run_id}")

    except Exception as e:
        print(f"Error storing log in DB: {e}")


def log_backup_end(job_name, status, duration, transferred_mb=0, percent=0, error_msg=None):
    """Record the end of a backup run with notifications."""
    try:
        from .notifications import send_whatsapp_notification

        conn = sqlite3.connect(DB_PATH)
        local_now = get_local_datetime()

        # Get log content BEFORE updating (for notification)
        log_content = None
        try:
            result = conn.execute('''
                SELECT log_content FROM backup_runs
                WHERE job_name = ? AND end_time IS NULL
                ORDER BY start_time DESC LIMIT 1
            ''', (job_name,)).fetchone()

            if result and result[0]:
                log_content = gzip.decompress(result[0]).decode('utf-8')
        except Exception as e:
            print(f"Error retrieving log: {e}")

        # Update the run
        conn.execute('''
            UPDATE backup_runs
            SET end_time = ?, duration = ?, status = ?, transferred_mb = ?,
                percent_complete = ?, error_message = ?
            WHERE job_name = ? AND end_time IS NULL
            ORDER BY start_time DESC LIMIT 1
        ''', (local_now.isoformat(), duration, status, transferred_mb, percent, error_msg, job_name))

        # Send notifications
        if status == 'error':
            display_name = get_job_display_name(job_name)
            message = f"*Backup failed*\n\nJob: `{display_name}`\nDuration: {duration}s"
            if error_msg:
                message += f"\nError: `{error_msg[:200]}`"
            send_whatsapp_notification(message, log_content, job_name)

        elif status == 'success':
            display_name = get_job_display_name(job_name)

            # Get compression ratio
            compression_ratio = None
            try:
                run_result = conn.execute('''
                    SELECT id FROM backup_runs
                    WHERE job_name = ? AND status = 'success'
                    ORDER BY start_time DESC LIMIT 1
                ''', (job_name,)).fetchone()

                if run_result:
                    metrics_result = conn.execute('''
                        SELECT compression_ratio FROM backup_metrics
                        WHERE run_id = ? LIMIT 1
                    ''', (run_result[0],)).fetchone()
                    if metrics_result:
                        compression_ratio = metrics_result[0]
            except Exception:
                pass

            if job_name == 'all':
                message = f"*Full backup completed*\nTotal duration: {duration}s"
                if compression_ratio is not None:
                    message += f"\nCompression: {compression_ratio}%"
                else:
                    message += f"\nTransferred: {transferred_mb} MB"
            else:
                message = f"*{display_name}*\n{duration}s"
                if compression_ratio is not None:
                    message += f" | {compression_ratio}%"
                elif transferred_mb > 0:
                    message += f" | {transferred_mb} MB"

            send_whatsapp_notification(message, log_content, job_name)

        # Update next run
        tomorrow_4am = (local_now + timedelta(days=1)).replace(hour=4, minute=0, second=0, microsecond=0)
        conn.execute('''
            UPDATE backup_jobs SET status = 'idle', next_run = ?, pid = NULL WHERE job_name = ?
        ''', (tomorrow_4am.isoformat(), job_name))

        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error log_backup_end: {e}")


def cleanup_old_data():
    """Clean up old data according to retention rules (365 days)."""
    try:
        conn = sqlite3.connect(DB_PATH)
        result = conn.execute('''
            DELETE FROM backup_runs WHERE start_time < datetime('now', '-365 days')
        ''')
        deleted = result.rowcount
        conn.commit()
        conn.close()

        if deleted > 0:
            print(f"DB cleanup: {deleted} old runs deleted (> 1 year)")
        return deleted
    except Exception as e:
        print(f"Error DB cleanup: {e}")
        return 0
