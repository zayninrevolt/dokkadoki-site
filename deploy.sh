#!/usr/bin/env bash
# Crash-safe deploy of the Hugo source to the Unraid share.
#
# The slow, connection-dependent part (uploading over SMB) goes into a staging
# folder that lives in the PARENT dir (hugo/), not the served site/ folder. The
# live site/ is only touched by fast local renames, and only once the upload is
# verified complete. So:
#   * a dropped SMB mount mid-upload leaves the live site untouched, and
#   * the served folder always stays pristine (no temp/backup dirs inside it).
#
# macOS smbfs is buggy: removing a directory over SMB can leave an un-deletable
# phantom entry. Those ghosts are confined to hidden .deploy-* dirs in hugo/
# (never in site/, never served, ignored by everything). Clear them any time,
# server-side, with:  rm -rf /mnt/user/appdata/hugo/.deploy-*
#
#   UNRAID_DEST=/some/path ./deploy.sh   # override destination if needed
set -euo pipefail
cd "$(dirname "$0")"

DEST="${UNRAID_DEST:-/Volumes/appdata/hugo/site}"
PARENT="$(dirname "$DEST")"
STAGING="$PARENT/.deploy-staging-$$"
TRASH="$PARENT/.deploy-trash-$$"

if [ ! -d "$DEST" ]; then
  echo "Destination $DEST not found — is the Unraid share mounted?"
  echo "  (Finder → Cmd+K → smb://192.168.0.69/appdata)"
  exit 1
fi

# Refuse to publish a source tree that the installed Hugo cannot build cleanly.
hugo --renderToMemory --panicOnWarning >/dev/null

# smbfs rm -rf is flaky and may leave a phantom dir; retry, then give up
# quietly (leftover is a harmless hidden dir in the parent, cleared server-side).
rm_quiet() {
  local p="$1" i
  [ -e "$p" ] || return 0
  for i in 1 2 3; do
    rm -rf "$p" 2>/dev/null || true
    [ -e "$p" ] || return 0
    sleep 1
  done
  return 0
}

# 1. Upload the full site into staging (the slow, SMB-dependent step).
mkdir -p "$STAGING"
tar -cf - \
  --exclude .git --exclude public --exclude resources \
  --exclude .hugo_build.lock --exclude 'deploy*.sh' \
  --exclude signup-api --exclude .DS_Store \
  . | (cd "$STAGING" && tar -xf -)

# 2. Refuse to touch the live site unless the upload clearly completed.
for required in hugo.toml content layouts assets; do
  if [ ! -e "$STAGING/$required" ]; then
    echo "Upload looks incomplete ($required missing) — live site left untouched."
    rm_quiet "$STAGING"
    exit 1
  fi
done

# 3. Swap into place: move the old top-level item OUT to trash (in the parent),
#    then move the new one IN. Old versions never linger inside site/. Replacing
#    whole dirs like content/ also removes anything deleted inside them.
mkdir -p "$TRASH"
shopt -s dotglob nullglob
for item in "$STAGING"/*; do
  name="$(basename "$item")"
  { [ "$name" = "." ] || [ "$name" = ".." ]; } && continue
  [ -e "$DEST/$name" ] && mv "$DEST/$name" "$TRASH/$name"
  mv "$item" "$DEST/$name"
done
shopt -u dotglob nullglob

# 4. Best-effort cleanup of this run's temp dirs (in the parent, not site/).
rm_quiet "$STAGING"
rm_quiet "$TRASH"

echo "Deployed to $DEST — staged then swapped; the served folder stays clean and a dropped connection can't corrupt it."
