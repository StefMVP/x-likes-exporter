#!/usr/bin/env bash
# Copy saved exports to a backup drive. Refuse when the drive is not mounted.
set -euo pipefail

source_dir=${1:-}
destination=${2:-}
if [[ -z $source_dir || -z $destination ]]; then
  echo "Usage: backup.sh SOURCE_DIR DESTINATION_DIR" >&2
  exit 64
fi

status_file=${BACKUP_STATUS_FILE:-${XDG_STATE_HOME:-$HOME/.local/state}/twitter-extractor/backup-status.json}
write_status() {
  local ok=$1 detail=$2 files=${3:-0} bytes=${4:-0}
  mkdir -p "$(dirname "$status_file")"
  printf '{"ok":%s,"source":%s,"destination":%s,"files":%s,"bytes":%s,"finished":%s,"detail":%s}\n' \
    "$ok" "$(json "$source_dir")" "$(json "$destination")" "$files" "$bytes" \
    "$(json "$(date -Iseconds)")" "$(json "$detail")" > "$status_file"
}
json() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '"%s"' "$value"
}
fail() {
  echo "$1" >&2
  write_status false "$1"
  exit "${2:-1}"
}

[[ -d $source_dir ]] || fail "Source folder not found: $source_dir" 66
mkdir -p "$destination"
[[ -w $destination ]] || fail "Destination is not writable: $destination" 77

source_device=$(stat -c %d "$source_dir")
destination_device=$(stat -c %d "$destination")
if [[ $source_device == "$destination_device" ]]; then
  fail "Refusing to copy into $destination: it is on the same filesystem as $source_dir. Mount the backup drive first." 78
fi

rsync -a --delete --itemize-changes --stats "$source_dir"/ "$destination"/ > "${BACKUP_LOG:-/dev/null}" 2>&1 ||
  fail "rsync failed for $destination; see ${BACKUP_LOG:-the service log}" 1

files=$(find "$destination" -type f | wc -l)
bytes=$(find "$destination" -type f -printf '%s\n' | awk '{total += $1} END {print total + 0}')
source_files=$(find "$source_dir" -type f | wc -l)
if [[ $files != "$source_files" ]]; then
  fail "Copied $files files but the source has $source_files" 1
fi

write_status true "Copied $source_dir to $destination" "$files" "$bytes"
echo "Copied $files files ($bytes bytes) to $destination"
