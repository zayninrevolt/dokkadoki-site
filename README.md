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

Hugo runs as a container on the Unraid server; the site **source** lives in
`appdata/hugo/site` (mounted on the Mac at `/Volumes/appdata/hugo/site`).

Publishing an update from this Mac is one command:

```bash
./deploy.sh
```

It rsyncs the source (content, layouts, assets, config) to the share; the Hugo
container builds/serves it from there.

**Container notes** (one-time): if the container runs `hugo server`, make sure
its args include the production flags, otherwise generated links point at
localhost instead of the real domain:

```
server --bind 0.0.0.0 --baseURL https://dokkadoki.co.uk/ --appendPort=false --disableLiveReload
```

**Cloudflare tunnel:** in Cloudflare Zero Trust → Networks → Tunnels → your
tunnel → Public Hostnames, edit the `dokkadoki.co.uk` hostname and change the
service from the WordPress container to `http://<unraid-ip>:<hugo-port>`.
The swap is instant and just as instantly reversible.

**Afterwards:** once you're happy, the WordPress + database containers can be
stopped. The DB is already exported (`wp_dokka.sql` in Downloads) — keep that
as the archive of the old shop.

## When Neko Catch is approved 🐾

Paste the App Store link into `appStoreURL` in `hugo.toml` and run
`./deploy.sh`. The "Coming soon to the App Store" badge on the homepage
automatically becomes a download button.

## Launch-list note

The email signup form stores addresses in the visitor's `localStorage` only —
there is **no backend**, so nothing is collected yet. To actually gather
sign-ups, wire the form to Formspree/Buttondown/Mailchimp — the submit handler
is at the bottom of `layouts/home.html`.

## Design notes

- Fonts: Zen Maru Gothic + Zen Kaku Gothic New (Google Fonts) with system fallbacks.
- Respects `prefers-reduced-motion` (petals disabled).
- No external assets beyond the fonts — emoji used for imagery so it stays light.
