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

rsync -av --delete \
  --exclude .git \
  --exclude public/ \
  --exclude resources/ \
  --exclude .hugo_build.lock \
  --exclude deploy.sh \
  ./ "$UNRAID_DEST/"

echo "Deployed source to $UNRAID_DEST — the Hugo container picks it up from there."
