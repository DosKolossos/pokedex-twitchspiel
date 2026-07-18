#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$ROOT/backups"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/pokedex-data-$STAMP.tar.gz" -C "$ROOT" data
find "$BACKUP_DIR" -type f -name 'pokedex-data-*.tar.gz' -mtime +30 -delete
printf 'Backup erstellt: %s\n' "$BACKUP_DIR/pokedex-data-$STAMP.tar.gz"
