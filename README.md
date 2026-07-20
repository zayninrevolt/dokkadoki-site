# Dokkadoki — dokkadoki.co.uk 🌸

The website for **Dokkadoki**, a manga café & reading library opening in **Bury, UK**.
Replaces the old WordPress shop: the site now advertises the café, links to the
[eBay store](https://www.ebay.co.uk/usr/dokkadoki), plugs the Neko Catch app, and has a blog.

- **Stack:** [Hugo](https://gohugo.io) static site — no database, no admin panel, no PHP.
  Sakura theme (pastel blue + pink, falling petals) lives in `layouts/` + `assets/css/main.css`.
- **Hosting:** GitHub Pages, built automatically with GitHub Actions. The API
  remains on Unraid behind a dedicated Cloudflare Tunnel hostname.

## Run locally

```bash
hugo server --source . --port 4321   # live-reloading preview at http://localhost:4321
```

(Install Hugo with `brew install hugo` if needed.) Forms on localhost and
private-network addresses automatically use the API on port `3456`; the API's
`ALLOWED_ORIGINS` must include the exact preview address, such as
`http://localhost:4321`.

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
section of the homepage (newest 3). Commit and push to `main` to publish.

## 🚀 Deploy with GitHub Pages

The workflow in `.github/workflows/hugo.yaml` builds the site and publishes the
generated `public/` directory whenever a commit reaches `main`. GitHub Pages
must use **GitHub Actions** as its publishing source in the repository's Pages
settings.

Before pushing, verify the production build locally:

```bash
hugo --gc --minify --panicOnWarning
```

The Pages workflow supplies GitHub's deployment URL as Hugo's `baseURL`, so it
works both at the temporary project URL and at `https://dokkadoki.co.uk/` after
the custom domain is connected.

The old `deploy.sh` script and Hugo container are retained only until the Pages
cutover is verified. They are not part of the new publishing flow.

The public API URL is configured with `params.apiURL` in `hugo.toml`. Local and
private-network previews automatically use the API on port `3456` instead.

## When Neko Catch is approved 🐾

Paste the App Store link into `appStoreURL` in `hugo.toml` and push the change
to `main`. The "Coming soon to the App Store" badge on the homepage
automatically becomes a download button.

## Launch-list signup (MariaDB)

The homepage form POSTs to `https://api.dokkadoki.co.uk/api/subscribe`, served
by the tiny Node API in `signup-api/` (rate-limited, bot honeypot, stores email
+ timestamp only).
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
   - Port: host `3456` → container `3001`
   - Env vars: `DB_HOST=192.168.0.69`, `DB_PORT=3306`, `DB_USER=dokkadoki`,
     `DB_PASS=<the password>`, `DB_NAME=dokkadoki`, plus:
     - `VOTE_SALT=<a random value of at least 32 characters>` is recommended
       for production (generate once with `openssl rand -hex 32`, then keep it
       stable). If omitted for LAN testing, the API securely creates and reuses
       `/app/.vote-salt`; keep that file private and backed up.
     - `TRUST_PROXY=cloudflare` so rate limits use Cloudflare's verified client
       address header when the API is reached through the tunnel
     - `ALLOWED_ORIGINS=https://dokkadoki.co.uk,https://zayninrevolt.github.io`
       (include `http://localhost:4321` when previewing from this Mac)
     - Optional eBay homepage feed: `EBAY_CLIENT_ID=<production client id>`,
       `EBAY_CLIENT_SECRET=<production client secret>`, `EBAY_SELLER=dokkadoki`.
       Credentials come from an eBay Developers production keyset and remain
       server-side. Results are cached for 15 minutes; without credentials the
       homepage simply hides the latest-items section.
   - Post Arguments: `sh -c "cd /app && npm install --omit=dev && node server.js"`

   (The API source is already in `appdata/dokkadoki-api`; after code changes,
   re-copy `signup-api/server.js` there and restart the container.)

3. **Cloudflare tunnel** - add a Public Hostname for
   `api.dokkadoki.co.uk` with service `http://192.168.0.69:3456`.

Check it works: `curl https://api.dokkadoki.co.uk/api/health` should return
`{"ok":true,"db":true}`.

Do not expose port `3456` to the internet; it should be reachable only on the
trusted LAN and through the Cloudflare tunnel. Keep MariaDB private to the
Docker network/LAN as well. Without `ALLOWED_ORIGINS`, browser access defaults
to localhost and private-network origins only; set the explicit production
origin before directing Cloudflare at the API.

Run the API checks after changes:

```bash
cd signup-api && npm test
```

**Reading the list:** `SELECT email, created_at FROM dokkadoki.launch_list;`
— or ask Claude to export it when it's newsletter time.

## Design notes

- Fonts: Zen Maru Gothic + Zen Kaku Gothic New (Google Fonts) with system fallbacks.
- Respects `prefers-reduced-motion` (petals disabled).
- No external assets beyond the fonts — emoji used for imagery so it stays light.
