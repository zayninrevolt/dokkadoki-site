#!/usr/bin/env python3
"""Small static guard for Dokkadoki's Hugo SEO head markup."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
base = (root / "layouts" / "_default" / "baseof.html").read_text()
partial_path = root / "layouts" / "partials" / "seo-schema.html"
workflow = (root / ".github" / "workflows" / "hugo.yaml").read_text()
config = (root / "hugo.toml").read_text()

errors = []

# The custom domain is served from the root, while GitHub Pages is only the
# deployment host. Building with the project subpath breaks every relURL asset
# and makes canonical/structured-data URLs incorrect.
if 'baseURL = "https://dokkadoki.co.uk/"' not in config:
    errors.append("Hugo config does not declare the custom-domain base URL")
if '--baseURL "https://dokkadoki.co.uk/"' not in workflow:
    errors.append("deployment does not build for the custom-domain root")
if 'zayninrevolt.github.io/dokkadoki-site' in workflow:
    errors.append("deployment still injects the GitHub Pages project path")
if '{{ partial "seo-schema.html" . }}' not in base:
    errors.append("base template does not include seo-schema.html")
if '<link rel="canonical" href="{{ .Permalink }}" />' not in base:
    errors.append("base template has no self-referencing canonical")
if not partial_path.is_file():
    errors.append("seo-schema.html partial is missing")
else:
    partial = partial_path.read_text()
    required = [
        '"@type": "Organization"',
        '"@type": "WebSite"',
        'eq .Section "blog"',
        '"@type": "BlogPosting"',
        'eq .Section "events"',
        '"@type": "Event"',
        '.Params.event_start',
        '.Params.event_end',
        '.Params.location',
    ]
    for item in required:
        if item not in partial:
            errors.append(f"SEO partial is missing: {item}")
    # jsonify returns valid JSON, but Hugo will escape it a second time in a
    # script template unless marked safe. That turns ISO dates and URLs into
    # literal quoted strings that Search Console rejects.
    if '| jsonify | safeJS' not in partial:
        errors.append("structured-data values are not protected from double serialization")

if errors:
    print("FAIL: " + "; ".join(errors))
    sys.exit(1)
print("PASS: SEO template guards")
