FROM python:3.12-slim

# Install system dependencies including rclone
RUN apt-get update && \
    apt-get install -y bash rsync curl sqlite3 iputils-ping zstd bc unzip && \
    curl https://rclone.org/install.sh | bash && \
    apt-get clean

# Install Python dependencies
RUN pip install flask==3.0.3 pytz flask-socketio==5.3.7 python-socketio==5.11.4 python-engineio==4.9.1 requests apscheduler zstandard

# Create working directory
WORKDIR /app

# Copy application files
COPY backup.sh /app/backup.sh
COPY run.py /app/run.py
COPY web/ /app/web/
COPY shared/ /app/shared/

# Set permissions
RUN chmod +x /app/backup.sh && mkdir -p /app/logs

CMD ["python3", "run.py"]
