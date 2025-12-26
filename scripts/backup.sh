#!/bin/bash
# Training Tracker Database Backup Script
# Runs hourly via cron, creates compressed backups with rotation

set -e

# Configuration
DB_PATH="${DB_PATH:-/app/data/training.db}"
BACKUP_DIR="${BACKUP_DIR:-/app/data/backups}"
RETENTION_HOURS="${RETENTION_HOURS:-168}"  # Keep 7 days of hourly backups
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="training_${TIMESTAMP}.db.gz"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo "ERROR: Database not found at $DB_PATH"
    exit 1
fi

# Create backup using SQLite's backup command (safe for running databases)
# Then compress with gzip
echo "Creating backup: $BACKUP_NAME"
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/training_${TIMESTAMP}.db'"
gzip "$BACKUP_DIR/training_${TIMESTAMP}.db"

# Verify backup was created
if [ -f "$BACKUP_DIR/$BACKUP_NAME" ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_DIR/$BACKUP_NAME" | cut -f1)
    echo "Backup created successfully: $BACKUP_NAME ($BACKUP_SIZE)"
else
    echo "ERROR: Backup creation failed"
    exit 1
fi

# Cleanup old backups (older than RETENTION_HOURS)
echo "Cleaning up backups older than $RETENTION_HOURS hours..."
find "$BACKUP_DIR" -name "training_*.db.gz" -mmin +$((RETENTION_HOURS * 60)) -delete 2>/dev/null || true

# Count remaining backups
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/training_*.db.gz 2>/dev/null | wc -l)
echo "Total backups: $BACKUP_COUNT"

echo "Backup completed at $(date)"
