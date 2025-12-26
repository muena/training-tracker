#!/bin/sh
# Training Tracker Database Backup Script
# Runs hourly via cron in sidecar container, creates compressed backups with rotation

set -e

# Configuration (paths for sidecar container with shared /data volume)
DB_PATH="${DB_PATH:-/data/training.db}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
RETENTION_HOURS="${RETENTION_HOURS:-168}"  # Keep 7 days of hourly backups
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="training_${TIMESTAMP}.db.gz"

# Log with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "=== Starting backup ==="

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    log "ERROR: Database not found at $DB_PATH"
    exit 1
fi

# Create backup using SQLite's backup command (safe for running databases)
# Then compress with gzip
log "Creating backup: $BACKUP_NAME"
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/training_${TIMESTAMP}.db'"
gzip "$BACKUP_DIR/training_${TIMESTAMP}.db"

# Verify backup was created
if [ -f "$BACKUP_DIR/$BACKUP_NAME" ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_DIR/$BACKUP_NAME" | cut -f1)
    log "Backup created successfully: $BACKUP_NAME ($BACKUP_SIZE)"
else
    log "ERROR: Backup creation failed"
    exit 1
fi

# Cleanup old backups (older than RETENTION_HOURS)
log "Cleaning up backups older than $RETENTION_HOURS hours..."
find "$BACKUP_DIR" -name "training_*.db.gz" -mmin +$((RETENTION_HOURS * 60)) -delete 2>/dev/null || true

# Count remaining backups
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/training_*.db.gz 2>/dev/null | wc -l)
log "Total backups: $BACKUP_COUNT"

log "=== Backup completed ==="
