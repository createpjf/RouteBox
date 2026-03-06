#!/bin/sh
set -e

BACKUP_DIR=/backups
RETAIN_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="routebox_${TIMESTAMP}.sql.gz"

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

# Dump and compress
pg_dump -h postgres -U routebox routebox | gzip > "${BACKUP_DIR}/${FILENAME}"
echo "[$(date -Iseconds)] Backup created: ${FILENAME}"

# Purge backups older than RETAIN_DAYS
find "${BACKUP_DIR}" -name "routebox_*.sql.gz" -mtime +${RETAIN_DAYS} -delete
echo "[$(date -Iseconds)] Cleaned backups older than ${RETAIN_DAYS} days"
