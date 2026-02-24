#!/usr/bin/bash

set -e

# rsync daemon variables (NAS via rsyncd port 873)
RSYNC_HOST="${RSYNC_HOST:-192.168.0.100}"
RSYNC_USER="${RSYNC_USER:-backup}"
RSYNC_MODULE="${RSYNC_MODULE:-backup}"
RSYNC_PASSWORD_FILE="${RSYNC_PASSWORD_FILE:-/app/rsync.secret}"
export RCLONE_CONFIG="${RCLONE_CONFIG:-/app/rclone.conf}"
RSYNC_BASE="rsync://${RSYNC_USER}@${RSYNC_HOST}/${RSYNC_MODULE}"

LOG_DIR=/app/logs
if [ "$1" = "all" ]; then
    LOG_FILE="/dev/null"
else
    if [ -n "$BACKUP_LOG_FILE" ]; then
        LOG_FILE="$BACKUP_LOG_FILE"
    else
        LOG_FILE="$LOG_DIR/backup_manual_$(date +%Y-%m-%d_%H-%M-%S).log"
    fi
fi

DB_PATH="$LOG_DIR/backup_stats.db"
mkdir -p "$LOG_DIR"

start=$(date +%s)
echo "🕘 Backup started: $(date)" | tee -a "$LOG_FILE"
echo "===============================" | tee -a "$LOG_FILE"

# Cleanup old archives (configurable retention)
cleanup_old_archives() {
    local dest_dir="$1"
    local backup_name="$2"
    local retention="${3:-7}"

    if [ -d "$dest_dir" ]; then
        echo "🧹 Cleaning up old archives for [$backup_name] (retention: $retention)..." | tee -a "$LOG_FILE"

        local archive_count=$(find "$dest_dir" -name "*.tar.zst" -type f | wc -l | tr -d ' ')
        echo "📊 Current archives for [$backup_name]: $archive_count" | tee -a "$LOG_FILE"

        if [ "$archive_count" -gt "$retention" ]; then
            local to_delete=$((archive_count - retention))
            echo "🗑️ Deleting $to_delete old archive(s) for [$backup_name]..." | tee -a "$LOG_FILE"

            find "$dest_dir" -name "*.tar.zst" -type f -printf '%T@ %p\n' | sort -n | head -n "$to_delete" | cut -d' ' -f2- | while read -r file; do
                echo "   - Deleting: $(basename "$file")" | tee -a "$LOG_FILE"
                rm -f "$file"
            done

            local remaining=$(find "$dest_dir" -name "*.tar.zst" -type f | wc -l | tr -d ' ')
            echo "✅ Cleanup done. Remaining archives for [$backup_name]: $remaining" | tee -a "$LOG_FILE"
        else
            echo "✅ No cleanup needed for [$backup_name] (≤ $retention archives)" | tee -a "$LOG_FILE"
        fi
    fi
}

# Rclone cleanup (for rclone backend in compression mode)
cleanup_old_archives_rclone() {
    local remote_path="$1"
    local backup_name="$2"
    local retention="${3:-7}"

    echo "🧹 Rclone cleanup for [$backup_name] (retention: $retention)..." | tee -a "$LOG_FILE"

    local archive_count=$(rclone lsf "$remote_path" --include "*.tar.zst" 2>/dev/null | wc -l | tr -d ' ')
    echo "📊 Current archives for [$backup_name]: $archive_count" | tee -a "$LOG_FILE"

    if [ "$archive_count" -gt "$retention" ]; then
        local to_delete=$((archive_count - retention))
        echo "🗑️ Deleting $to_delete old archive(s) for [$backup_name]..." | tee -a "$LOG_FILE"

        rclone lsf "$remote_path" --include "*.tar.zst" --format "tp" 2>/dev/null | sort | head -n "$to_delete" | cut -d';' -f2 | while read -r file; do
            echo "   - Deleting: $file" | tee -a "$LOG_FILE"
            rclone deletefile "$remote_path/$file" 2>/dev/null || true
        done

        local remaining=$(rclone lsf "$remote_path" --include "*.tar.zst" 2>/dev/null | wc -l | tr -d ' ')
        echo "✅ Cleanup done. Remaining archives for [$backup_name]: $remaining" | tee -a "$LOG_FILE"
    else
        echo "✅ No cleanup needed for [$backup_name] (≤ $retention archives)" | tee -a "$LOG_FILE"
    fi
}

# Generate a standardized archive filename
get_archive_name() {
    local backup_name="$1"
    local date_str=$(date +%Y-%m-%d)

    local normalized_name=$(echo "$backup_name" | tr ' ' '.' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9.]//g')
    echo "${normalized_name}.${date_str}.tar.zst"
}

MAX_RETRIES=3
RETRY_DELAY=30

# Convert NFS path to rsyncd URL
# /mnt/data/MyBackup → rsync://backup@192.168.0.100/backup/MyBackup
to_rsync_dest() {
    local nfs_path="$1"
    local relative="${nfs_path#/mnt/data/}"
    echo "${RSYNC_BASE}/${relative}"
}

run_backup() {
    SRC="$1"
    DEST="$2"
    LABEL="$3"
    shift 3
    EXCLUDES=("$@")
    START_TIME=$(date +%s)

    # Read from env (set by run_job_from_db)
    local backend="${BACKEND_TYPE:-rsync}"
    local retention="${RETENTION_COUNT:-7}"
    local rclone_remote="${RCLONE_REMOTE:-}"
    local rclone_path="${RCLONE_DEST_PATH:-}"

    echo "" | tee -a "$LOG_FILE"
    echo "📦 Backup [$LABEL]" | tee -a "$LOG_FILE"
    echo "↪️ Source: $SRC" | tee -a "$LOG_FILE"
    echo "🎯 Target: $DEST" | tee -a "$LOG_FILE"
    echo "🔧 Backend: $backend | Retention: $retention" | tee -a "$LOG_FILE"
    [ "${#EXCLUDES[@]}" -gt 0 ] && echo "🚫 Excludes: ${EXCLUDES[*]}" | tee -a "$LOG_FILE"

    if [ ! -d "$SRC" ]; then
        echo "❌ Source directory $SRC does not exist" | tee -a "$LOG_FILE"
        ERRORS=$((ERRORS+1))
        return 1
    fi

    # --- Backend connectivity test ---
    if [ "$backend" = "rclone" ]; then
        if [ -z "$rclone_remote" ]; then
            echo "❌ rclone remote not configured for [$LABEL]" | tee -a "$LOG_FILE"
            ERRORS=$((ERRORS+1))
            return 1
        fi
        local rclone_dest="${rclone_remote}:${rclone_path}"
        echo "☁️ Backend rclone: $rclone_dest" | tee -a "$LOG_FILE"

        if ! timeout 15 rclone lsf "$rclone_remote:" --max-depth 1 --dirs-only -q 2>/dev/null | head -1 > /dev/null; then
            echo "❌ rclone remote unreachable ($rclone_remote)" | tee -a "$LOG_FILE"
            ERRORS=$((ERRORS+1))
            return 1
        fi
        echo "✅ rclone remote reachable ($rclone_remote)" | tee -a "$LOG_FILE"
    else
        mkdir -p "$DEST" 2>/dev/null || true

        if [ ! -f "$RSYNC_PASSWORD_FILE" ]; then
            echo "❌ rsync password file not found ($RSYNC_PASSWORD_FILE)" | tee -a "$LOG_FILE"
            ERRORS=$((ERRORS+1))
            return 1
        fi

        echo "test" > /tmp/.rsync_test_$$
        if ! rsync --password-file="$RSYNC_PASSWORD_FILE" --timeout=10 \
            /tmp/.rsync_test_$$ "${RSYNC_BASE}/.backup_test_$$" > /dev/null 2>&1; then
            echo "❌ NAS unreachable via rsync daemon (${RSYNC_HOST}:873)" | tee -a "$LOG_FILE"
            rm -f /tmp/.rsync_test_$$
            ERRORS=$((ERRORS+1))
            return 1
        fi
        rm -f /tmp/.rsync_test_$$
        rm -f /mnt/data/.backup_test_$$ 2>/dev/null || true
        echo "✅ NAS reachable via rsync daemon (${RSYNC_HOST}:873)" | tee -a "$LOG_FILE"
    fi

    local skip_compression=false
    # Use BACKUP_MODE if set (read from DB), otherwise fallback to label detection
    if [ -n "$BACKUP_MODE" ]; then
        if [ "$BACKUP_MODE" = "direct" ]; then
            skip_compression=true
            echo "ℹ️ Direct mode (DB config) for [$LABEL]" | tee -a "$LOG_FILE"
        else
            echo "ℹ️ Compression mode (DB config) for [$LABEL]" | tee -a "$LOG_FILE"
        fi
    elif [[ "$LABEL" == *"Jellyfin"* ]] || [[ "$LABEL" == *"Photos"* ]] || [[ "$LABEL" == *"Documents Originaux"* ]]; then
        skip_compression=true
        echo "ℹ️ Direct mode (label detection) for [$LABEL]" | tee -a "$LOG_FILE"
    fi

    # === MODE DIRECT ===
    if [ "$skip_compression" = true ]; then
        RSYNC_EXCLUDES=""
        for exclude in "${EXCLUDES[@]}"; do
            if [[ $exclude == --exclude ]]; then
                continue
            fi
            RSYNC_EXCLUDES="$RSYNC_EXCLUDES --exclude=$exclude"
        done

        SIZE_BEFORE=$(du -sm "$SRC" 2>/dev/null | cut -f1 || echo "0")

        if [ "$backend" = "rclone" ]; then
            # --- rclone direct sync ---
            echo "☁️ rclone sync to $rclone_dest" | tee -a "$LOG_FILE"

            RC=1
            for attempt in $(seq 1 $MAX_RETRIES); do
                [ "$attempt" -gt 1 ] && echo "🔄 Retry $attempt/$MAX_RETRIES for [$LABEL] (waiting ${RETRY_DELAY}s)..." | tee -a "$LOG_FILE" && sleep "$RETRY_DELAY"
                rclone sync "$SRC/" "$rclone_dest/" \
                    --progress --stats-one-line --stats 30s \
                    $RSYNC_EXCLUDES >> "$LOG_FILE" 2>&1 && RC=0 || RC=$?
                if [ "$RC" -eq 0 ]; then
                    break
                fi
                echo "⚠️ Attempt $attempt/$MAX_RETRIES failed (code: $RC)" | tee -a "$LOG_FILE"
            done

            DUR=$(($(date +%s) - $START_TIME))

            if [ "$RC" -eq 0 ]; then
                echo "✅ Completed [$LABEL] in ${DUR}s (rclone)" | tee -a "$LOG_FILE"
                echo "📊 Source size: ${SIZE_BEFORE} MB" | tee -a "$LOG_FILE"
            else
                echo "❌ Failed [$LABEL] after $MAX_RETRIES attempts (code: $RC)" | tee -a "$LOG_FILE"
                ERRORS=$((ERRORS+1))
            fi
        else
            # --- rsync direct ---
            RSYNC_DEST=$(to_rsync_dest "$DEST")
            echo "🔗 Destination rsyncd: $RSYNC_DEST" | tee -a "$LOG_FILE"

            RC=1
            for attempt in $(seq 1 $MAX_RETRIES); do
                [ "$attempt" -gt 1 ] && echo "🔄 Retry $attempt/$MAX_RETRIES for [$LABEL] (waiting ${RETRY_DELAY}s)..." | tee -a "$LOG_FILE" && sleep "$RETRY_DELAY"
                rsync -av --delete --timeout=300 --password-file="$RSYNC_PASSWORD_FILE" \
                    --no-owner --no-group --chmod=D755,F644 --no-links \
                    --stats --ignore-errors --partial --progress --itemize-changes \
                    $RSYNC_EXCLUDES "$SRC/" "$RSYNC_DEST/" >> "$LOG_FILE" 2>&1 && RC=0 || RC=$?
                if [ "$RC" -eq 0 ] || [ "$RC" -eq 23 ] || [ "$RC" -eq 24 ]; then
                    break
                fi
                echo "⚠️ Attempt $attempt/$MAX_RETRIES failed (code: $RC)" | tee -a "$LOG_FILE"
            done

            SIZE_AFTER=$(du -sm "$DEST" 2>/dev/null | cut -f1 || echo "0")
            DUR=$(($(date +%s) - $START_TIME))

            if [ "$RC" -eq 0 ] || [ "$RC" -eq 23 ] || [ "$RC" -eq 24 ]; then
                echo "✅ Completed [$LABEL] in ${DUR}s" | tee -a "$LOG_FILE"
                echo "📊 Destination size: ${SIZE_AFTER} MB" | tee -a "$LOG_FILE"
            else
                echo "❌ Failed [$LABEL] after $MAX_RETRIES attempts (code: $RC)" | tee -a "$LOG_FILE"
                ERRORS=$((ERRORS+1))
            fi
        fi

    # === MODE COMPRESSION ===
    else
        local temp_dir="/tmp/backup_$(basename "$SRC")_$$"
        local archive_name=$(get_archive_name "$LABEL")
        local local_archive_dir="/tmp/backup_archives"
        local local_archive_path="$local_archive_dir/$archive_name"

        echo "📦 Compression mode enabled (zstd)" | tee -a "$LOG_FILE"
        echo "🗜️ Archive: $archive_name" | tee -a "$LOG_FILE"

        if [ "$backend" = "rclone" ]; then
            echo "☁️ Destination rclone: $rclone_dest" | tee -a "$LOG_FILE"
            # Cleanup via rclone
            cleanup_old_archives_rclone "$rclone_dest" "$LABEL" "$retention"
        else
            local RSYNC_DEST_DIR=$(to_rsync_dest "$DEST")
            echo "🔗 Destination rsyncd: $RSYNC_DEST_DIR" | tee -a "$LOG_FILE"

            # Remove today's existing archive on NAS (via NFS)
            if [ -f "$DEST/$archive_name" ]; then
                echo "🗑️ Replacing today's existing backup" | tee -a "$LOG_FILE"
                rm -f "$DEST/$archive_name"
            fi
            cleanup_old_archives "$DEST" "$LABEL" "$retention"
        fi

        mkdir -p "$temp_dir"
        mkdir -p "$local_archive_dir"

        RSYNC_EXCLUDES=()
        for exclude in "${EXCLUDES[@]}"; do
            if [[ $exclude == --exclude ]]; then
                continue
            fi
            RSYNC_EXCLUDES+=("--exclude=$exclude")
        done

        SIZE_BEFORE=$(du -sm "$SRC" 2>/dev/null | cut -f1 || echo "0")
        echo "📊 Source size: ${SIZE_BEFORE} MB" | tee -a "$LOG_FILE"

        echo "📋 Copying to temp directory..." | tee -a "$LOG_FILE"
        RC=1
        for attempt in $(seq 1 $MAX_RETRIES); do
            [ "$attempt" -gt 1 ] && echo "🔄 Retry rsync $attempt/$MAX_RETRIES for [$LABEL] (waiting ${RETRY_DELAY}s)..." | tee -a "$LOG_FILE" && sleep "$RETRY_DELAY"
            rsync -av --no-owner --no-group --no-perms --no-links --ignore-errors "${RSYNC_EXCLUDES[@]}" "$SRC/" "$temp_dir/" >> "$LOG_FILE" 2>&1 && RC=0 || RC=$?
            if [ "$RC" -eq 0 ] || [ "$RC" -eq 23 ] || [ "$RC" -eq 24 ]; then
                break
            fi
            echo "⚠️ rsync attempt $attempt/$MAX_RETRIES failed (code: $RC)" | tee -a "$LOG_FILE"
        done

        if [ "$RC" -eq 0 ] || [ "$RC" -eq 23 ] || [ "$RC" -eq 24 ]; then
            echo "🗜️ zstd compression in progress..." | tee -a "$LOG_FILE"

            ZSTD_RC=1
            for attempt in $(seq 1 $MAX_RETRIES); do
                [ "$attempt" -gt 1 ] && echo "🔄 Retry compression $attempt/$MAX_RETRIES for [$LABEL] (waiting ${RETRY_DELAY}s)..." | tee -a "$LOG_FILE" && sleep "$RETRY_DELAY" && rm -f "$local_archive_path"
                tar -cf - -C "$(dirname "$temp_dir")" "$(basename "$temp_dir")" | zstd -3 -o "$local_archive_path" >> "$LOG_FILE" 2>&1 && ZSTD_RC=0 || ZSTD_RC=$?
                if [ "$ZSTD_RC" -eq 0 ]; then
                    break
                fi
                echo "⚠️ Compression attempt $attempt/$MAX_RETRIES failed (code: $ZSTD_RC)" | tee -a "$LOG_FILE"
            done

            if [ "$ZSTD_RC" -eq 0 ]; then
                SIZE_TEMP=$(du -sm "$temp_dir" 2>/dev/null | cut -f1 || echo "0")
                SIZE_ARCHIVE=$(du -sm "$local_archive_path" 2>/dev/null | cut -f1 || echo "0")
                FILES_COUNT=$(find "$temp_dir" -type f | wc -l | tr -d ' ')

                if [ "$SIZE_TEMP" -gt 0 ]; then
                    COMPRESSION_RATIO=$(echo "scale=2; 100 - ($SIZE_ARCHIVE * 100 / $SIZE_TEMP)" | bc 2>/dev/null || echo "0")
                else
                    COMPRESSION_RATIO="0"
                fi

                # Local integrity check
                echo "🔍 Archive integrity check (local)..." | tee -a "$LOG_FILE"
                zstd -t "$local_archive_path" >> "$LOG_FILE" 2>&1 && VERIFY_RC=0 || VERIFY_RC=$?
                if [ "$VERIFY_RC" -eq 0 ]; then
                    tar -tf "$local_archive_path" > /dev/null 2>&1 && VERIFY_RC=0 || VERIFY_RC=$?
                fi

                if [ "$VERIFY_RC" -eq 0 ]; then
                    echo "✅ Archive verified and valid" | tee -a "$LOG_FILE"

                    PUSH_RC=1
                    if [ "$backend" = "rclone" ]; then
                        # --- Push via rclone ---
                        echo "📤 Pushing to rclone remote..." | tee -a "$LOG_FILE"
                        for attempt in $(seq 1 $MAX_RETRIES); do
                            [ "$attempt" -gt 1 ] && echo "🔄 Retry push $attempt/$MAX_RETRIES for [$LABEL] (waiting ${RETRY_DELAY}s)..." | tee -a "$LOG_FILE" && sleep "$RETRY_DELAY"
                            rclone copyto "$local_archive_path" "$rclone_dest/$archive_name" \
                                --progress >> "$LOG_FILE" 2>&1 && PUSH_RC=0 || PUSH_RC=$?
                            if [ "$PUSH_RC" -eq 0 ]; then
                                break
                            fi
                            echo "⚠️ Push attempt $attempt/$MAX_RETRIES failed (code: $PUSH_RC)" | tee -a "$LOG_FILE"
                        done
                    else
                        # --- Push via rsyncd ---
                        echo "📤 Pushing to NAS via rsyncd..." | tee -a "$LOG_FILE"
                        for attempt in $(seq 1 $MAX_RETRIES); do
                            [ "$attempt" -gt 1 ] && echo "🔄 Retry push $attempt/$MAX_RETRIES for [$LABEL] (waiting ${RETRY_DELAY}s)..." | tee -a "$LOG_FILE" && sleep "$RETRY_DELAY"
                            rsync -av --timeout=300 --password-file="$RSYNC_PASSWORD_FILE" \
                                --no-owner --no-group --chmod=F644 \
                                --progress "$local_archive_path" "$RSYNC_DEST_DIR/$archive_name" >> "$LOG_FILE" 2>&1 && PUSH_RC=0 || PUSH_RC=$?
                            if [ "$PUSH_RC" -eq 0 ] || [ "$PUSH_RC" -eq 23 ]; then
                                break
                            fi
                            echo "⚠️ Push attempt $attempt/$MAX_RETRIES failed (code: $PUSH_RC)" | tee -a "$LOG_FILE"
                        done
                    fi

                    DUR=$(($(date +%s) - $START_TIME))

                    if [ "$PUSH_RC" -eq 0 ] || [ "$PUSH_RC" -eq 23 ]; then
                        echo "✅ Compression + push completed [$LABEL] in ${DUR}s" | tee -a "$LOG_FILE"

                        echo "📊 Compression summary [$LABEL]:" | tee -a "$LOG_FILE"
                        echo "  Source: ${SIZE_BEFORE} MB" | tee -a "$LOG_FILE"
                        echo "  Before compression: ${SIZE_TEMP} MB" | tee -a "$LOG_FILE"
                        echo "  Final archive: ${SIZE_ARCHIVE} MB" | tee -a "$LOG_FILE"
                        echo "  Ratio: ${COMPRESSION_RATIO}%" | tee -a "$LOG_FILE"
                        echo "  Files: ${FILES_COUNT}" | tee -a "$LOG_FILE"

                        if command -v bc >/dev/null 2>&1; then
                            echo "METRICS:$LABEL:$SIZE_TEMP:$SIZE_ARCHIVE:$COMPRESSION_RATIO:$FILES_COUNT" >> "$LOG_FILE"
                        fi

                        echo "Total bytes sent: $(($SIZE_ARCHIVE * 1024 * 1024))" >> "$LOG_FILE"
                    else
                        echo "❌ Push failed [$LABEL] after $MAX_RETRIES attempts (code: $PUSH_RC)" | tee -a "$LOG_FILE"
                        ERRORS=$((ERRORS+1))
                        echo "Total bytes sent: 0" >> "$LOG_FILE"
                    fi
                else
                    echo "❌ CORRUPT ARCHIVE DETECTED! Deleting..." | tee -a "$LOG_FILE"
                    rm -f "$local_archive_path"
                    ERRORS=$((ERRORS+1))
                    echo "Total bytes sent: 0" >> "$LOG_FILE"
                fi
            else
                echo "❌ Compression failed [$LABEL] (zstd code: $ZSTD_RC)" | tee -a "$LOG_FILE"
                ERRORS=$((ERRORS+1))
                echo "Total bytes sent: 0" >> "$LOG_FILE"
            fi
        else
            echo "❌ Copy to temp failed [$LABEL] (rsync code: $RC)" | tee -a "$LOG_FILE"
            ERRORS=$((ERRORS+1))
            echo "Total bytes sent: 0" >> "$LOG_FILE"
        fi

        rm -rf "$temp_dir" 2>/dev/null || true
        rm -f "$local_archive_path" 2>/dev/null || true
    fi
}

ERRORS=0

# Run a job from SQLite config
run_job_from_db() {
    local job_name="$1"
    local row
    row=$(sqlite3 -cmd '.timeout 5000' -separator '|' "$DB_PATH" \
        "SELECT source_path, dest_path, display_name, mode, excludes, retention_count, backend_type, backend_config FROM job_configs WHERE job_name='$job_name' AND enabled=1" 2>/dev/null)

    if [ -z "$row" ]; then
        echo "❌ Job '$job_name' not found or disabled in DB" | tee -a "$LOG_FILE"
        ERRORS=$((ERRORS+1))
        return 1
    fi

    local source_path dest_path display_name mode excludes_json retention_count backend_type backend_config_json
    IFS='|' read -r source_path dest_path display_name mode excludes_json retention_count backend_type backend_config_json <<< "$row"

    # Defaults
    retention_count="${retention_count:-7}"
    backend_type="${backend_type:-rsync}"

    # Build exclude arguments from JSON
    local exclude_args=()
    if [ -n "$excludes_json" ] && [ "$excludes_json" != "[]" ]; then
        local excludes_list
        excludes_list=$(echo "$excludes_json" | sed 's/\[//g;s/\]//g;s/"//g;s/,/\n/g' | sed '/^$/d')
        while IFS= read -r excl; do
            excl=$(echo "$excl" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            if [ -n "$excl" ]; then
                exclude_args+=("--exclude" "$excl")
            fi
        done <<< "$excludes_list"
    fi

    # Compression/direct mode
    if [ "$mode" = "direct" ]; then
        export BACKUP_MODE="direct"
    else
        export BACKUP_MODE="compression"
    fi

    # Retention
    export RETENTION_COUNT="$retention_count"

    # Backend type + rclone config
    export BACKEND_TYPE="$backend_type"
    if [ "$backend_type" = "rclone" ] && [ -n "$backend_config_json" ] && [ "$backend_config_json" != "{}" ]; then
        # Parse rclone remote and path from JSON
        local rclone_remote rclone_path
        rclone_remote=$(echo "$backend_config_json" | sed -n 's/.*"remote"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
        rclone_path=$(echo "$backend_config_json" | sed -n 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
        export RCLONE_REMOTE="${rclone_remote:-}"
        export RCLONE_DEST_PATH="${rclone_path:-}"
    fi

    run_backup "$source_path" "$dest_path" "$display_name" "${exclude_args[@]}"

    unset BACKUP_MODE RETENTION_COUNT BACKEND_TYPE RCLONE_REMOTE RCLONE_DEST_PATH
}

# Individual job: read from DB
run_job_from_db "$1"

END=$(date +%s)
TOTAL=$((END - start))

echo "" | tee -a "$LOG_FILE"
echo "===============================" | tee -a "$LOG_FILE"
if [ "$ERRORS" -eq 0 ]; then
  echo "🟢 All backups completed successfully" | tee -a "$LOG_FILE"
else
  echo "🔴 $ERRORS task(s) failed" | tee -a "$LOG_FILE"
fi

echo "🕒 Total duration: ${TOTAL}s" | tee -a "$LOG_FILE"

exit "$ERRORS"