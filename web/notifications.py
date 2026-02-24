"""Notification handlers: WhatsApp, Telegram, Email, weekly report."""

import os
import requests
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify
import sqlite3
import subprocess

from .db import DB_PATH, get_job_display_name
from .utils import get_local_datetime

notifications_bp = Blueprint('notifications', __name__)

# Telegram config
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.environ.get('TELEGRAM_CHAT_ID', '')
TELEGRAM_ENABLED = bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)

# WhatsApp (WAHA) config
WHATSAPP_API_URL = os.environ.get('WHATSAPP_API_URL', '')
WHATSAPP_API_KEY = os.environ.get('WHATSAPP_API_KEY', '')
WHATSAPP_CHAT_ID = os.environ.get('WHATSAPP_CHAT_ID', '')
WHATSAPP_ENABLED = bool(WHATSAPP_API_KEY and WHATSAPP_CHAT_ID)

# SMTP config
SMTP_HOST = os.environ.get('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.environ.get('SMTP_PORT', '587'))
SMTP_USER = os.environ.get('SMTP_USER', '')
SMTP_PASSWORD = os.environ.get('SMTP_PASSWORD', '')
SMTP_FROM = os.environ.get('SMTP_FROM', '')
SMTP_TO = os.environ.get('SMTP_TO', '')
SMTP_ENABLED = bool(SMTP_USER and SMTP_PASSWORD)

# App URL for report footer
APP_URL = os.environ.get('APP_URL', '')


def extract_log_summary(log_content):
    """Extract key info from log content (compression + files)."""
    if not log_content:
        return None

    summary = []
    try:
        lines = log_content.split('\n')
        for line in lines:
            if 'METRICS:' in line:
                parts = line.split(':')
                if len(parts) >= 6:
                    try:
                        original = int(parts[2])
                        compressed = int(parts[3])
                        files_count = int(parts[5])
                        summary.append(f"{files_count} files")
                        summary.append(f"{original}MB -> {compressed}MB")
                    except Exception:
                        pass
            elif 'error' in line.lower() or 'failed' in line.lower():
                summary.append(line.strip()[:100])

        return '\n'.join(summary[:5]) if summary else None
    except Exception:
        return None


def send_telegram_notification(message, parse_mode='Markdown'):
    """Send a Telegram notification."""
    if not TELEGRAM_ENABLED:
        return False

    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            'chat_id': TELEGRAM_CHAT_ID,
            'text': message,
            'parse_mode': parse_mode,
            'disable_web_page_preview': True
        }
        response = requests.post(url, json=payload, timeout=10)
        if response.status_code == 200:
            print("Telegram notification sent")
            return True
        else:
            print(f"Telegram error: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"Telegram send error: {e}")
        return False


def send_whatsapp_notification(message, log_content=None, job_name=None):
    """Send a WhatsApp notification via WAHA with log summary."""
    if not WHATSAPP_ENABLED:
        return False

    try:
        if log_content:
            log_summary = extract_log_summary(log_content)
            if log_summary:
                message += f"\n\n*Details:*\n{log_summary}"

        url = f"{WHATSAPP_API_URL}/api/sendText"
        headers = {
            'Content-Type': 'application/json',
            'X-Api-Key': WHATSAPP_API_KEY
        }
        payload = {
            'session': 'default',
            'chatId': WHATSAPP_CHAT_ID,
            'text': message
        }

        response = requests.post(url, json=payload, headers=headers, timeout=10)

        if response.status_code in (200, 201):
            print(f"WhatsApp notification sent{'  with summary' if log_content else ''}")
            return True
        else:
            print(f"WhatsApp error: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        print(f"WhatsApp send error: {e}")
        return False


def generate_weekly_report_data():
    """Generate weekly report data (last 7 days)."""
    now = get_local_datetime()
    week_ago = now - timedelta(days=7)
    week_start = week_ago.strftime('%Y-%m-%d %H:%M:%S')

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    total_runs = conn.execute(
        'SELECT COUNT(*) as cnt FROM backup_runs WHERE start_time >= ?', (week_start,)
    ).fetchone()['cnt']
    success_runs = conn.execute(
        'SELECT COUNT(*) as cnt FROM backup_runs WHERE start_time >= ? AND status = ?',
        (week_start, 'success')
    ).fetchone()['cnt']
    failed_runs = total_runs - success_runs
    success_rate = round((success_runs / total_runs * 100), 1) if total_runs > 0 else 0

    volume_row = conn.execute(
        'SELECT COALESCE(SUM(transferred_mb), 0) as total FROM backup_runs WHERE start_time >= ?',
        (week_start,)
    ).fetchone()
    total_volume_mb = volume_row['total']

    compression_row = conn.execute(
        'SELECT AVG(compression_ratio) as avg_ratio FROM backup_metrics WHERE created_at >= ? AND compression_ratio > 0',
        (week_start,)
    ).fetchone()
    avg_compression = round(compression_row['avg_ratio'], 1) if compression_row['avg_ratio'] else 0

    jobs = conn.execute('''
        SELECT
            jc.job_name, jc.display_name, jc.icon_url, jc.enabled,
            COUNT(br.id) as runs,
            SUM(CASE WHEN br.status = 'success' THEN 1 ELSE 0 END) as successes,
            SUM(CASE WHEN br.status != 'success' THEN 1 ELSE 0 END) as failures,
            AVG(br.duration) as avg_duration,
            MAX(br.start_time) as last_run
        FROM job_configs jc
        LEFT JOIN backup_runs br ON jc.job_name = br.job_name AND br.start_time >= ?
        GROUP BY jc.job_name
        ORDER BY jc.run_order, jc.job_name
    ''', (week_start,)).fetchall()

    job_stats = []
    jobs_in_error = []
    jobs_inactive = []

    for job in jobs:
        stat = {
            'name': job['job_name'],
            'display_name': job['display_name'],
            'icon_url': job['icon_url'] or '',
            'runs': job['runs'] or 0,
            'successes': job['successes'] or 0,
            'failures': job['failures'] or 0,
            'avg_duration': round(job['avg_duration'] / 60, 1) if job['avg_duration'] else 0,
            'last_run': job['last_run'] or 'Never',
        }
        job_stats.append(stat)

        if stat['failures'] > 0:
            err_row = conn.execute('''
                SELECT error_message FROM backup_runs
                WHERE job_name = ? AND status != 'success' AND start_time >= ?
                ORDER BY start_time DESC LIMIT 1
            ''', (job['job_name'], week_start)).fetchone()
            jobs_in_error.append({
                **stat,
                'error_message': err_row['error_message'][:200] if err_row and err_row['error_message'] else 'Unknown error'
            })

        if job['enabled'] and (job['runs'] or 0) == 0:
            jobs_inactive.append(stat)

    # Storage info
    nas_info = {'used_gb': 0, 'free_gb': 0, 'capacity_gb': 0, 'usage_pct': 0}
    storage_path = os.environ.get('STORAGE_MOUNT_PATH', '/mnt/data')
    try:
        df_output = subprocess.check_output(['df', '-k', storage_path], universal_newlines=True)
        lines = df_output.strip().split('\n')
        if len(lines) >= 2:
            fields = lines[1].split()
            nas_info['capacity_gb'] = int(fields[1]) // (1024 * 1024)
            nas_info['used_gb'] = int(fields[2]) // (1024 * 1024)
            nas_info['free_gb'] = int(fields[3]) // (1024 * 1024)
            nas_info['usage_pct'] = round(nas_info['used_gb'] / nas_info['capacity_gb'] * 100, 1) if nas_info['capacity_gb'] > 0 else 0
    except Exception as e:
        print(f"Report: df error: {e}")

    conn.close()

    return {
        'period_start': week_ago.strftime('%d/%m/%Y'),
        'period_end': now.strftime('%d/%m/%Y'),
        'total_runs': total_runs,
        'success_runs': success_runs,
        'failed_runs': failed_runs,
        'success_rate': success_rate,
        'total_volume_mb': round(total_volume_mb, 1),
        'avg_compression': avg_compression,
        'job_stats': job_stats,
        'jobs_in_error': jobs_in_error,
        'jobs_inactive': jobs_inactive,
        'nas': nas_info,
        'generated_at': now.strftime('%d/%m/%Y %H:%M'),
    }


def build_report_html(data):
    """Build weekly report HTML (inline CSS for email compatibility)."""
    volume = data['total_volume_mb']
    volume_str = f"{volume / 1024:.1f} GB" if volume >= 1024 else f"{volume:.0f} MB"

    nas = data['nas']
    nas_str = f"{nas['used_gb']} / {nas['capacity_gb']} GB" if nas['capacity_gb'] > 0 else "N/A"
    nas_pct = nas['usage_pct']

    rate = data['success_rate']
    if rate >= 95:
        rate_color = '#10b981'
    elif rate >= 80:
        rate_color = '#f59e0b'
    else:
        rate_color = '#ef4444'

    job_rows = ''
    for job in data['job_stats']:
        if job['runs'] == 0:
            status_dot = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#6b7280;"></span>'
        elif job['failures'] == 0:
            status_dot = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#10b981;"></span>'
        else:
            status_dot = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;"></span>'

        icon_html = f'<img src="{job["icon_url"]}" width="20" height="20" style="vertical-align:middle;margin-right:6px;border-radius:4px;" />' if job['icon_url'] else ''

        last_run = job['last_run']
        if last_run and last_run != 'Never':
            try:
                dt = datetime.strptime(last_run, '%Y-%m-%d %H:%M:%S')
                last_run = dt.strftime('%d/%m %H:%M')
            except Exception:
                pass

        job_rows += f'''<tr style="border-bottom:1px solid #2d2d44;">
            <td style="padding:10px 12px;color:#e2e8f0;">{icon_html}{job['display_name']}</td>
            <td style="padding:10px 12px;text-align:center;color:#e2e8f0;">{job['runs']}</td>
            <td style="padding:10px 12px;text-align:center;color:#10b981;">{job['successes']}</td>
            <td style="padding:10px 12px;text-align:center;color:#ef4444;">{job['failures']}</td>
            <td style="padding:10px 12px;text-align:center;color:#94a3b8;">{job['avg_duration']} min</td>
            <td style="padding:10px 12px;text-align:center;color:#94a3b8;">{last_run}</td>
            <td style="padding:10px 12px;text-align:center;">{status_dot}</td>
        </tr>'''

    alerts_html = ''
    if data['jobs_in_error']:
        error_items = ''
        for job in data['jobs_in_error']:
            error_items += f'''<div style="padding:10px 14px;margin-bottom:8px;background:#3b1c1c;border-left:3px solid #ef4444;border-radius:4px;">
                <strong style="color:#fca5a5;">{job['display_name']}</strong>
                <span style="color:#94a3b8;"> — {job['failures']} failure(s)</span>
                <div style="color:#9ca3af;font-size:12px;margin-top:4px;">{job['error_message']}</div>
            </div>'''
        alerts_html += f'''<div style="margin-bottom:20px;">
            <h3 style="color:#fca5a5;font-size:16px;margin:0 0 10px;">Jobs in error</h3>
            {error_items}
        </div>'''

    if data['jobs_inactive']:
        inactive_items = ''
        for job in data['jobs_inactive']:
            inactive_items += f'<span style="display:inline-block;padding:4px 10px;margin:3px;background:#3b2e1a;color:#fbbf24;border-radius:4px;font-size:13px;">{job["display_name"]}</span>'
        alerts_html += f'''<div style="margin-bottom:20px;">
            <h3 style="color:#fbbf24;font-size:16px;margin:0 0 10px;">Inactive jobs (0 runs in 7d)</h3>
            <div>{inactive_items}</div>
        </div>'''

    footer_link = f'<a href="{APP_URL}" style="color:#818cf8;text-decoration:none;">{APP_URL}</a>' if APP_URL else 'Backup Manager'

    html = f'''<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#0f0f1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0f0f1a;padding:20px 0;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="background-color:#1a1a2e;border-radius:12px;overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:28px 32px;">
        <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">Weekly Backup Report</h1>
        <p style="margin:6px 0 0;color:#e0e0ff;font-size:14px;">{data['period_start']} — {data['period_end']}</p>
    </td></tr>
    <tr><td style="padding:24px 24px 8px;">
        <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
            <td width="25%" style="padding:6px;">
                <div style="background:#16162a;border-radius:8px;padding:16px;text-align:center;">
                    <div style="font-size:28px;font-weight:700;color:{rate_color};">{data['success_rate']}%</div>
                    <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Success rate</div>
                </div>
            </td>
            <td width="25%" style="padding:6px;">
                <div style="background:#16162a;border-radius:8px;padding:16px;text-align:center;">
                    <div style="font-size:28px;font-weight:700;color:#e2e8f0;">{data['total_runs']}</div>
                    <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Backups</div>
                </div>
            </td>
            <td width="25%" style="padding:6px;">
                <div style="background:#16162a;border-radius:8px;padding:16px;text-align:center;">
                    <div style="font-size:28px;font-weight:700;color:#38bdf8;">{volume_str}</div>
                    <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Transferred</div>
                </div>
            </td>
            <td width="25%" style="padding:6px;">
                <div style="background:#16162a;border-radius:8px;padding:16px;text-align:center;">
                    <div style="font-size:28px;font-weight:700;color:#a78bfa;">{nas_pct}%</div>
                    <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Storage ({nas_str})</div>
                </div>
            </td>
        </tr>
        </table>
    </td></tr>
    <tr><td style="padding:16px 24px;">
        <h2 style="color:#e2e8f0;font-size:16px;margin:0 0 12px;">Job details</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#16162a;border-radius:8px;overflow:hidden;">
            <tr style="background:#1e1e3a;">
                <th style="padding:10px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:600;">Job</th>
                <th style="padding:10px 12px;text-align:center;color:#94a3b8;font-size:12px;font-weight:600;">Runs</th>
                <th style="padding:10px 12px;text-align:center;color:#94a3b8;font-size:12px;font-weight:600;">OK</th>
                <th style="padding:10px 12px;text-align:center;color:#94a3b8;font-size:12px;font-weight:600;">KO</th>
                <th style="padding:10px 12px;text-align:center;color:#94a3b8;font-size:12px;font-weight:600;">Avg time</th>
                <th style="padding:10px 12px;text-align:center;color:#94a3b8;font-size:12px;font-weight:600;">Last</th>
                <th style="padding:10px 12px;text-align:center;color:#94a3b8;font-size:12px;font-weight:600;">Status</th>
            </tr>
            {job_rows}
        </table>
    </td></tr>
    {'<tr><td style="padding:8px 24px 16px;">' + alerts_html + '</td></tr>' if alerts_html else ''}
    <tr><td style="padding:8px 24px 20px;">
        <div style="background:#16162a;border-radius:8px;padding:14px 16px;">
            <span style="color:#94a3b8;font-size:13px;">Average compression ratio: <strong style="color:#a78bfa;">{data['avg_compression']}%</strong></span>
        </div>
    </td></tr>
    <tr><td style="padding:16px 24px 24px;border-top:1px solid #2d2d44;">
        <p style="margin:0;color:#64748b;font-size:12px;text-align:center;">
            {footer_link} &nbsp;&#183;&nbsp; Generated on {data['generated_at']}
        </p>
    </td></tr>
</table>
</td></tr>
</table>
</body>
</html>'''

    return html


def send_email_report(html, subject):
    """Send HTML report via SMTP."""
    if not SMTP_ENABLED:
        print("SMTP not configured, email not sent")
        return False

    try:
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = SMTP_FROM
        msg['To'] = SMTP_TO
        msg.attach(MIMEText(html, 'html', 'utf-8'))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, SMTP_TO, msg.as_string())

        print(f"Email report sent to {SMTP_TO}")
        return True
    except Exception as e:
        print(f"Email send error: {e}")
        return False


def send_weekly_report():
    """Orchestrate weekly report generation and sending."""
    try:
        print("Generating weekly report...")
        data = generate_weekly_report_data()
        html = build_report_html(data)
        subject = f"Backup Report — Week {data['period_start']} to {data['period_end']}"
        success = send_email_report(html, subject)
        if success:
            print(f"Weekly report sent ({data['total_runs']} runs, {data['success_rate']}% success)")
        return success
    except Exception as e:
        print(f"Weekly report error: {e}")
        return False


# --- Routes ---

@notifications_bp.route('/api/weekly-report')
def api_weekly_report():
    """Generate weekly report. ?preview=true to see HTML without sending."""
    try:
        data = generate_weekly_report_data()
        html = build_report_html(data)

        if request.args.get('preview') == 'true':
            return html, 200, {'Content-Type': 'text/html; charset=utf-8'}

        subject = f"Backup Report — Week {data['period_start']} to {data['period_end']}"
        success = send_email_report(html, subject)
        if success:
            return jsonify({'status': 'sent', 'to': SMTP_TO, 'subject': subject})
        else:
            return jsonify({'status': 'error', 'message': 'SMTP not configured or send error'}), 500
    except Exception as e:
        print(f"Error api_weekly_report: {e}")
        return jsonify({'error': str(e)}), 500
