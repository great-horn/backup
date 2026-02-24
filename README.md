# Backup

A self-hosted web application to schedule, monitor, and restore Docker volume backups with rsync and rclone backends.

Built with Flask, Vue.js 3, SQLite, and Socket.IO.

![Dashboard](screenshots/dashboard.png)

## Features

- **Web dashboard** with real-time status via WebSocket
- **Analytics** with Chart.js (timeline, distribution, performance, anomaly detection)
- **Per-job retention** policy (configurable number of versions to keep)
- **Dual backend**: rsync (default) + rclone (S3, GDrive, WebDAV, SMB, SFTP)
- **Compression** via zstd (tar.zst archives) or direct rsync mirror
- **Notifications**: Telegram, WhatsApp (WAHA), Email weekly report
- **Restore browser**: navigate archives, search files, one-click restore
- **6 languages**: FR, EN, DE, IT, ES, PT with browser auto-detection
- **5 themes**: Dark, Light, OLED, Neon, Ember
- **Scheduler**: APScheduler with cron expressions per job
- **Prometheus** metrics endpoint at `/metrics`
- PWA-ready

## Quick Start

```bash
git clone https://github.com/great-horn/backup.git
cd backup
cp .env.example .env
# Edit .env with your rsync host, notifications, etc.
echo "your_rsync_password" > rsync.secret
chmod 600 rsync.secret
docker-compose -f docker-compose.standalone.yml up -d --build
```

Open [http://localhost:9895](http://localhost:9895) in your browser.

Two demo jobs (disabled) are created on first run. Configure your own jobs via Settings.

## Configuration

All settings are managed via environment variables. See [.env.example](.env.example) for the full list.

Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Web UI port | `9895` |
| `TZ` | Timezone | `Europe/Zurich` |
| `RSYNC_HOST` | rsync daemon host | `192.168.0.100` |
| `RSYNC_USER` | rsync daemon user | `backup` |
| `RSYNC_MODULE` | rsync module name | `backup` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | (disabled) |
| `TELEGRAM_CHAT_ID` | Telegram chat ID | (disabled) |
| `SMTP_HOST` | SMTP server for email reports | (disabled) |

## Architecture

```
backup/
├── run.py              # Entry point
├── backup.sh           # Backup execution (rsync/rclone + zstd + retry)
├── web/
│   ├── app.py          # Flask + SocketIO + routes
│   ├── db.py           # SQLite schema, seeds, migrations
│   ├── jobs.py         # CRUD job configs
│   ├── scheduler.py    # APScheduler management
│   ├── analytics.py    # Stats, metrics, Prometheus
│   ├── restore.py      # Browse + restore archives
│   ├── notifications.py# Telegram, WhatsApp, Email
│   ├── utils.py        # Shared utilities
│   └── static/         # Vue.js 3 SPA frontend
└── Dockerfile
```

- Single container: Flask + APScheduler + backup.sh
- SQLite in WAL mode for job configs, backup history, and metrics
- backup.sh handles execution with retry logic (3 attempts, 30s delay)
- Vue.js 3 SPA with Socket.IO for real-time updates

## Backends

### rsync (default)

Uses rsync daemon (rsyncd) on port 873 for writes. Requires a password file mounted at `/app/rsync.secret`.

### rclone

Universal backend supporting S3, Google Drive, WebDAV, SMB, SFTP, and more. Mount your `rclone.conf` at `/app/rclone.conf` and configure the remote name and path per job in Settings.

## Backup Modes

| Mode | Description |
|------|-------------|
| **Compression** | rsync to temp + tar+zstd + push archive (default) |
| **Direct** | rsync mirror with `--delete` (for large media) |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /run?job=<name>` | Start a backup job |
| `GET /kill?job=<name>` | Stop a running job |
| `GET /api/jobs` | List all job configs |
| `POST /api/jobs` | Create a new job |
| `PUT /api/jobs/<name>` | Update a job |
| `DELETE /api/jobs/<name>` | Delete a job |
| `GET /api/stats` | Backup statistics |
| `GET /api/logs` | Backup history |
| `GET /api/restore/list` | Available backups |
| `GET /api/restore/search?q=` | Search across archives |
| `GET /metrics` | Prometheus metrics |

## Pages

| Page | URL | Description |
|------|-----|-------------|
| Dashboard | `/` | Job grid with real-time status |
| Analytics | `/analytics` | Charts, anomalies, storage |
| Logs | `/logs` | Backup history with filters |
| Settings | `/settings` | Job CRUD, schedules |
| Restore | `/restore` | Browse and restore files |

## License

[GPL-3.0](LICENSE)

---

Built with Flask, Vue.js 3, Chart.js, Socket.IO, and APScheduler.
