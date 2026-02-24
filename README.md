# Backup

A self-hosted web application to schedule, monitor, and restore Docker volume backups with rsync and rclone backends.

Built with Flask, Vue.js 3, SQLite, and Socket.IO.

![Dashboard](screenshots/dashboard.png)

![Analytics](screenshots/analytics.png)

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
docker compose -f docker-compose.standalone.yml up -d --build
```

Open [http://localhost:9895](http://localhost:9895) in your browser.

Two demo jobs (disabled) are created on first run. Follow the guide below to configure your first real backup job.

## Setting Up a Backup Job

### 1. Mount your source directories

Edit `docker-compose.standalone.yml` to expose the directories you want to back up:

```yaml
volumes:
  - ./data:/app/logs
  - /path/to/myapp:/data/myapp:ro        # your source directory
  - /path/to/another:/data/another:ro     # add as many as needed
  - /tmp/restore:/tmp/restore
```

> Directories are mounted under `/data/` inside the container. Use **read-only** (`:ro`) unless you need restore capability.

### 2. Choose a backend

#### Option A: rsync daemon (default)

For backing up to a server running rsyncd (port 873):

```bash
# Create the password file
echo "your_rsync_password" > rsync.secret
chmod 600 rsync.secret
```

Uncomment the rsync volume in `docker-compose.standalone.yml`:
```yaml
- ./rsync.secret:/app/rsync.secret:ro
```

Configure the rsync host in `.env`:
```
RSYNC_HOST=192.168.0.100
RSYNC_USER=backup
RSYNC_MODULE=backup
```

#### Option B: rclone (SMB, S3, SFTP, GDrive, WebDAV, ...)

rclone is a universal backend that supports [40+ storage providers](https://rclone.org/overview/).

**Step 1** — Get an obscured password (needed for most remotes):
```bash
docker exec backup rclone obscure 'yourpassword'
# outputs something like: jJ89bJX_FgueJ8rC0Yjom7VsnQocRqq...
```

**Step 2** — Create `rclone.conf` in the project directory:

<details>
<summary><b>SMB / CIFS</b> (NAS, Windows share)</summary>

```ini
[mynas]
type = smb
host = 192.168.0.100
user = myuser
pass = <obscured_password>
```
</details>

<details>
<summary><b>SFTP</b></summary>

```ini
[myserver]
type = sftp
host = 192.168.0.100
user = myuser
pass = <obscured_password>
```
</details>

<details>
<summary><b>S3</b> (AWS, MinIO, Backblaze B2)</summary>

```ini
[mys3]
type = s3
provider = AWS
access_key_id = AKIAXXXXXXXXXXXXXXXX
secret_access_key = <obscured_key>
region = eu-west-1
```
</details>

<details>
<summary><b>Google Drive</b></summary>

```ini
[gdrive]
type = drive
client_id = your_client_id
client_secret = <obscured_secret>
token = {"access_token":"...","token_type":"Bearer","refresh_token":"...","expiry":"..."}
```

> Run `rclone config` on your local machine first to generate the token via OAuth flow, then copy the resulting config.
</details>

See the full list of providers at [rclone.org/overview](https://rclone.org/overview/).

**Step 3** — Secure the file and mount it:

```bash
chmod 600 rclone.conf
```

Uncomment the rclone volume in `docker-compose.standalone.yml`:
```yaml
- ./rclone.conf:/app/rclone.conf:ro
```

**Step 4** — Verify the connection:

```bash
docker compose -f docker-compose.standalone.yml up -d
docker exec backup rclone --config /app/rclone.conf lsd mynas:
```

You should see the available shares or buckets listed.

### 3. Restart and create the job

```bash
docker compose -f docker-compose.standalone.yml up -d
```

Open the web UI → **Settings** → **New Job** and fill in:

| Field | Example |
|-------|---------|
| Name | `myapp` |
| Source path | `/data/myapp` |
| Destination path | `/backups/myapp` (rsync) or `ShareName/path` (rclone) |
| Mode | Compression (tar+zstd) or Direct (rsync mirror) |
| Backend | rsync or rclone |
| Remote name | *(rclone only)* `mynas` — must match the `[name]` in rclone.conf |
| Remote path | *(rclone only)* `ShareName/backups/myapp` |
| Retention | Number of versions to keep (default: 7) |
| Schedule | Cron expression, e.g. `0 3 * * *` for 3 AM daily |

Click **Save**, then hit the play button to run a test backup.

## Configuration

All settings are managed via environment variables. See [.env.example](.env.example) for the full list.

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Web UI port | `9895` |
| `TZ` | Timezone | `Europe/Zurich` |
| `RSYNC_HOST` | rsync daemon host | `192.168.0.100` |
| `RSYNC_USER` | rsync daemon user | `backup` |
| `RSYNC_MODULE` | rsync module name | `backup` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | *(disabled)* |
| `TELEGRAM_CHAT_ID` | Telegram chat ID | *(disabled)* |
| `SMTP_HOST` | SMTP server for email reports | *(disabled)* |

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
├── shared/             # Shared CSS/JS (themes, layout, components)
└── Dockerfile
```

- Single container: Flask + APScheduler + backup.sh
- SQLite in WAL mode for job configs, backup history, and metrics
- backup.sh handles execution with retry logic (3 attempts, 30s delay)
- Vue.js 3 SPA with Socket.IO for real-time updates

## Backup Modes

| Mode | Description |
|------|-------------|
| **Compression** | rsync to temp → tar+zstd → push archive (default) |
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
