#!/usr/bin/env bash
# Publish the site by pushing to GitHub. The Unraid server pulls from there —
# no Mac SMB mount involved (see SERVER-SETUP.md).
#
# The server auto-pulls every few minutes via a User Scripts cron, so usually
# a push is all you need. To publish instantly, run the pull yourself on Unraid:
#   git -C /mnt/user/appdata/hugo/site pull
#
# The old push-over-SMB method is kept as ./deploy-smb.sh for emergencies.
set -euo pipefail
cd "$(dirname "$0")"

git push

echo
echo "Pushed to GitHub. The server auto-pulls within a few minutes."
echo "To publish now, run this on the Unraid terminal:"
echo "  git -C /mnt/user/appdata/hugo/site pull"
