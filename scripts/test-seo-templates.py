#!/usr/bin/env python3
"""Small static guard for Dokkadoki's Hugo SEO head markup."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
base = (root / "layouts" / "_default" / "baseof.html").read_text()
partial_path = root / "layouts" / "partials" / "seo-schema.html"

errors = []
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

if errors:
    print("FAIL: " + "; ".join(errors))
    sys.exit(1)
print("PASS: SEO template guards")
