#!/usr/bin/env bash
# Sync the Hugo site source to the Unraid Hugo container's folder.
# The container builds/serves it from there.
#
# Default destination is the mounted appdata share; override with:
#   UNRAID_DEST=/some/other/path ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

UNRAID_DEST="${UNRAID_DEST:-/Volumes/appdata/hugo/site}"

if [ ! -d "$UNRAID_DEST" ]; then
  echo "Destination $UNRAID_DEST not found — is the Unraid share mounted? (Finder → Cmd+K → smb://<unraid-ip>)"
  exit 1
fi

# Clean-slate copy via tar (macOS rsync is unreliable over SMB mounts).
# Leave the container's own root-owned output dirs (resources/, public/) alone.
find "$UNRAID_DEST" -mindepth 1 -maxdepth 1 ! -name resources ! -name public -exec rm -rf {} +
tar -cf - \
  --exclude .git \
  --exclude public \
  --exclude resources \
  --exclude .hugo_build.lock \
  --exclude deploy.sh \
  --exclude signup-api \
  --exclude .DS_Store \
  . | (cd "$UNRAID_DEST" && tar -xf -)

echo "Deployed source to $UNRAID_DEST — the Hugo container picks it up from there."
