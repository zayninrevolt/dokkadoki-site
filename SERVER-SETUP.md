# Server setup — git-pull deploy on Unraid

The site is served by the **hugo** container reading its source from
`/mnt/user/appdata/hugo/site`. That folder is a **git clone** of this repo, so
publishing = the server running `git pull`. No Mac, no SMB — an interrupted
pull leaves the previous version intact instead of a half-empty folder.

Do this once. After that, publishing is just `./deploy.sh` (a `git push`) from
the Mac, and the server picks it up.

## 1. Add git to Unraid

Community Apps → search **NerdTools** → install. Then **Settings → NerdTools**,
enable **git** (and **openssh** if offered), Apply. Check in the Unraid
terminal: `git --version`.

## 2. Make a read-only access token

The repo is private, so the server needs read access. A fine-grained token
scoped to just this repo is safest:

1. GitHub → Settings → Developer settings → **Fine-grained tokens** →
   **Generate new token**.
2. **Repository access** → Only select repositories → `dokkadoki-site`.
3. **Permissions** → Repository permissions → **Contents: Read-only**.
4. Expiration: pick the longest you're comfortable with (fine-grained max is
   1 year — set a calendar reminder to regenerate).
5. Generate and copy the token (`github_pat_…`).

## 3. Clone the repo into the site folder

In the Unraid terminal (replace `<TOKEN>` with the token from step 2):

```bash
cd /mnt/user/appdata/hugo
git clone https://<TOKEN>@github.com/zayninrevolt/dokkadoki-site.git site-new
mv site site-old && mv site-new site && rm -rf site-old
chown -R nobody:users site && chmod -R ug+rwX site
```

The token is now saved inside `site/.git/config`, which lives on the persistent
`appdata` share — so pulls keep working after a reboot.

Then **restart the hugo container** (Docker tab → hugo → Restart) so it reads
the freshly-cloned folder.

## 4. Auto-pull (optional but recommended)

So a `git push` from the Mac publishes on its own:

Community Apps → install **User Scripts** → Settings → User Scripts →
**Add New Script**, name it `dokkadoki-pull`, edit it to:

```bash
#!/bin/bash
git -C /mnt/user/appdata/hugo/site pull --quiet
```

Set its schedule to **Custom** with cron `*/5 * * * *` (every 5 minutes). Done —
the site now updates itself within 5 minutes of any push. The container's
`--poll` flag then rebuilds from the changed files automatically.

Without this, just run `git -C /mnt/user/appdata/hugo/site pull` by hand (or ask
Claude to walk you through it) whenever you want to publish.

## Publishing, from now on

1. `./deploy.sh` on the Mac (pushes to GitHub).
2. Server pulls within 5 min (or pull by hand for instant).

That's it. The Mac SMB mount is no longer part of publishing.
