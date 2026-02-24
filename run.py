#!/usr/bin/env python3
"""Entry point for Backup Manager."""
from web.app import app, socketio, running_processes, get_local_datetime, PORT
from web.db import DB_PATH, init_db, cleanup_old_data
from web.scheduler import scheduler, load_schedules

import sqlite3
import time
import threading

if __name__ == '__main__':
    print("Starting Backup Manager...")

    local_time = get_local_datetime()
    print(f"Timezone: {local_time.tzinfo} (current: {local_time.strftime('%Y-%m-%d %H:%M:%S')})")

    init_db()

    # Clean ghost jobs at startup
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("UPDATE backup_jobs SET status = 'idle', pid = NULL WHERE status = 'running'")
        conn.commit()
        conn.close()
        print("Ghost jobs cleaned at startup")
    except Exception as e:
        print(f"Startup cleanup error: {e}")

    # Start APScheduler
    load_schedules()
    scheduler.start()
    print(f"APScheduler started with {len(scheduler.get_jobs())} schedule(s)")

    # Periodic process cleanup thread
    def periodic_cleanup():
        from web.app import cleanup_finished_processes
        while True:
            time.sleep(30)
            try:
                cleanup_finished_processes()
            except Exception:
                pass

    cleanup_thread = threading.Thread(target=periodic_cleanup, daemon=True)
    cleanup_thread.start()

    # Daily DB cleanup thread
    def periodic_db_cleanup():
        while True:
            time.sleep(24 * 60 * 60)
            try:
                cleanup_old_data()
            except Exception:
                pass

    db_cleanup_thread = threading.Thread(target=periodic_db_cleanup, daemon=True)
    db_cleanup_thread.start()

    print(f"Starting on port {PORT}...")
    socketio.run(app, host="0.0.0.0", port=PORT, debug=False, allow_unsafe_werkzeug=True)
