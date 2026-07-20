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
