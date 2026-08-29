# Dokkadoki

Website for the Dokkadoki manga café and reading room in Bury, UK.

## Local preview

```bash
hugo server --port 4321
```

## Deployment

Pushing to `main` builds the site with Hugo and publishes it through GitHub
Pages using `.github/workflows/hugo.yaml`.

Production site: <https://dokkadoki.co.uk>

Temporary Pages address:
<https://zayninrevolt.github.io/dokkadoki-site/>

## API

The Node API remains on Unraid and is exposed through Cloudflare Tunnel at
`https://api.dokkadoki.co.uk`. Its source and tests are in `signup-api/`.

The homepage requests six newest live listings from the API's cached
`GET /api/ebay-items` route. eBay credentials stay in the API environment and
are never exposed to GitHub Pages or browser JavaScript.

## Monthly newsletter

The newsletter uses the opted-in `launch_list` records already synced from the
membership system. It deliberately has three separate commands:

```bash
cd signup-api
npm run newsletter:draft
npm run newsletter:approve -- 2026-09 2026-09
npm run newsletter:send -- 2026-09 SEND-2026-09
```

Only `newsletter:draft` is safe to schedule monthly. It collects the latest
blog posts, six eBay listings, events in the next 30 days, and manga added since
the previous catalogue snapshot. It stores a database draft and writes a
private HTML preview for review. Drafting cannot send email.

Approval requires the exact edition ID. Sending requires both an approved
stored edition and the additional `SEND-YYYY-MM` confirmation. Every recipient
has a unique send-log row and Resend idempotency key, preventing duplicate
sends. Email unsubscribe links use encrypted tokens and require a confirmation
click before removing the address and revoking matching membership consent.

Required variable names and safe placeholders are documented in
`signup-api/.env.example`. Keep actual values only in the private runtime
environment. No recipient addresses, tokens, or provider credentials belong in
Git or preview output.
