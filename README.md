# Dokkadoki — dokkadoki.co.uk 🌸

The website for **Dokkadoki**, a manga café & reading library opening in **Bury, UK**.
Replaces the old WordPress shop: the site now advertises the café, links to the
[eBay store](https://www.ebay.co.uk/usr/dokkadoki), plugs the Neko Catch app, and has a blog.

- **Stack:** [Hugo](https://gohugo.io) static site — no database, no admin panel, no PHP.
  Sakura theme (pastel blue + pink, falling petals) lives in `layouts/` + `assets/css/main.css`.
- **Hosting:** Hugo container on the Unraid server (source in `appdata/hugo/site`),
  exposed through the existing Cloudflare tunnel.

## Run locally

```bash
hugo server --source . --port 4321   # live-reloading preview at http://localhost:4321
```

(Install Hugo with `brew install hugo` if needed.)

## ✍️ Add a blog post

Create a markdown file in `content/blog/` — that's it:

```bash
hugo new blog/my-post-title.md    # or just create the file by hand
```

```markdown
---
title: "We found our unit! 🎉"
date: 2026-08-01
description: "A short teaser shown in previews and search results."
---

Write the post here in plain markdown. **Bold**, [links](https://example.com),
images, lists — all work. Raw HTML is allowed too (e.g. an iframe embed).
```

Posts appear automatically on `/blog/` and in the "Latest from Dokkadoki"
section of the homepage (newest 3). Then run `./deploy.sh` to publish.

## 🚀 Deploy to Unraid

Hugo runs as a container on the Unraid server, serving its source from
`/mnt/user/appdata/hugo/site` (mounted on the Mac at `/Volumes/appdata/hugo/site`).

Publishing an update:

```bash
./deploy.sh
```

`deploy.sh` is **crash-safe**: it uploads the new site into a staging folder
(in the parent `hugo/` dir, not the served `site/`) and only swaps it into the
live folder once the upload is verified complete. If the SMB mount drops
mid-upload, the live site is left untouched, and the served folder never
contains temp/backup dirs.

macOS smbfs can't reliably delete a folder over SMB (it leaves a phantom entry),
so hidden `.deploy-*` dirs slowly accumulate in `hugo/` — harmless (never served,
ignored by Hugo). Sweep them any time, server-side:

```bash
rm -rf /mnt/user/appdata/hugo/.deploy-* /mnt/user/appdata/hugo/site/.deploy-staging*
```

**If the share won't mount** (macOS SMB sessions can go stale): unmount and
reconnect by IP —

```bash
umount -f /Volumes/appdata 2>/dev/null; open 'smb://192.168.0.69/appdata'
```

**If a deploy ever gets "permission denied":** the folder was recreated
root-owned (e.g. after a server reboot). Fix once on the Unraid terminal:

```bash
chown -R nobody:users /mnt/user/appdata/hugo && chmod -R u+rwX,g+rwX /mnt/user/appdata/hugo
```

**Container args** (one-time): the hugo container runs

```
server --bind 0.0.0.0 --baseURL https://dokkadoki.co.uk/ --appendPort=false --disableLiveReload --poll 30s
```

The `--poll 30s` is essential on Unraid — the file-watcher can't see changes on
user shares, so it polls instead.

**Cloudflare tunnel:** in Cloudflare Zero Trust → Networks → Tunnels → your
tunnel → Public Hostnames, point the `dokkadoki.co.uk` hostname at
`http://<unraid-ip>:<hugo-port>` (and the `api/*` path at the signup API — see
below). The swap is instant and just as instantly reversible.

**Afterwards:** once you're happy, the WordPress + database containers can be
stopped. The DB is already exported (`wp_dokka.sql` in Downloads) — keep that
as the archive of the old shop.

## When Neko Catch is approved 🐾

Paste the App Store link into `appStoreURL` in `hugo.toml` and run
`./deploy.sh`. The "Coming soon to the App Store" badge on the homepage
automatically becomes a download button.

## Launch-list signup (MariaDB)

The homepage form POSTs to `/api/subscribe`, served by the tiny Node API in
`signup-api/` (rate-limited, bot honeypot, stores email + timestamp only).
It creates its own `launch_list` table on startup.

**One-time setup:**

1. **MariaDB** — create the database and user (Unraid console for the mariadb
   container → `mariadb -u root -p`):

   ```sql
   CREATE DATABASE dokkadoki CHARACTER SET utf8mb4;
   CREATE USER 'dokkadoki'@'%' IDENTIFIED BY 'CHOOSE-A-PASSWORD';
   GRANT ALL PRIVILEGES ON dokkadoki.* TO 'dokkadoki'@'%';
   FLUSH PRIVILEGES;
   ```

2. **API container** — Unraid → Docker → Add Container:
   - Name: `dokkadoki-api` · Repository: `node:22-alpine`
   - Path: `/mnt/user/appdata/dokkadoki-api` → `/app`
   - Port: host `3001` → container `3001`
   - Env vars: `DB_HOST=192.168.0.69`, `DB_PORT=3306`, `DB_USER=dokkadoki`,
     `DB_PASS=<the password>`, `DB_NAME=dokkadoki`
   - Post Arguments: `sh -c "cd /app && npm install --omit=dev && node server.js"`

   (The API source is already in `appdata/dokkadoki-api`; after code changes,
   re-copy `signup-api/server.js` there and restart the container.)

3. **Cloudflare tunnel** — add a Public Hostname **above** the site's one:
   `dokkadoki.co.uk`, path `api/*`, service `http://192.168.0.69:3001`.

Check it works: `curl https://dokkadoki.co.uk/api/health` → `{"ok":true,"db":true}`.

**Reading the list:** `SELECT email, created_at FROM dokkadoki.launch_list;`
— or ask Claude to export it when it's newsletter time.

## Design notes

- Fonts: Zen Maru Gothic + Zen Kaku Gothic New (Google Fonts) with system fallbacks.
- Respects `prefers-reduced-motion` (petals disabled).
- No external assets beyond the fonts — emoji used for imagery so it stays light.
