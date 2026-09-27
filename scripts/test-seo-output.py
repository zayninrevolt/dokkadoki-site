#!/usr/bin/env python3
"""Validate rendered Hugo SEO output using only the Python standard library."""
from __future__ import annotations

from datetime import datetime, timezone
from html.parser import HTMLParser
from html import unescape
import json
from pathlib import Path
import re
import sys

repo = Path(__file__).resolve().parents[1]
public = Path(sys.argv[1]) if len(sys.argv) > 1 else repo / "public"
errors: list[str] = []


class Document(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[dict[str, str]] = []
        self.meta: list[dict[str, str]] = []
        self.json_ld: list[dict] = []
        self._json_buffer: list[str] | None = None
        self.related_links = 0
        self._related_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        values = {key: value or "" for key, value in attrs}
        if tag == "link":
            self.links.append(values)
        elif tag == "meta":
            self.meta.append(values)
        elif tag == "script" and values.get("type") == "application/ld+json":
            self._json_buffer = []
        if values.get("data-related-events") is not None:
            self._related_depth = 1
        elif self._related_depth:
            self._related_depth += 1
            if tag == "a":
                self.related_links += 1

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._json_buffer is not None:
            raw = "".join(self._json_buffer).strip()
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    self.json_ld.append(parsed)
            except json.JSONDecodeError as exc:
                errors.append(f"invalid JSON-LD: {exc}")
            self._json_buffer = None
        if self._related_depth:
            self._related_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._json_buffer is not None:
            self._json_buffer.append(data)


def parse(relative: str) -> Document:
    path = public / relative
    if not path.is_file():
        errors.append(f"missing rendered page: {relative}")
        return Document()
    doc = Document()
    doc.feed(path.read_text(encoding="utf-8"))
    return doc


def meta_value(doc: Document, key: str) -> str | None:
    for item in doc.meta:
        if item.get("name") == key or item.get("property") == key:
            return item.get("content")
    return None


home = parse("index.html")
event = parse("events/rakucon-2026/index.html")
privacy = parse("privacy/index.html")

for label, doc, expected in [
    ("home", home, "https://dokkadoki.co.uk/"),
    ("event", event, "https://dokkadoki.co.uk/events/rakucon-2026/"),
    ("privacy", privacy, "https://dokkadoki.co.uk/privacy/"),
]:
    canonicals = [link.get("href") for link in doc.links if link.get("rel") == "canonical"]
    if canonicals != [expected]:
        errors.append(f"{label} canonical mismatch: {canonicals!r}")
    for key in ("twitter:title", "twitter:description", "twitter:image", "twitter:image:alt"):
        if not meta_value(doc, key):
            errors.append(f"{label} missing {key}")

orgs = [item for item in home.json_ld if item.get("@type") == "Organization"]
if len(orgs) != 1:
    errors.append(f"homepage expected one Organization object, got {len(orgs)}")
else:
    org = orgs[0]
    if not org.get("logo") or not org.get("image"):
        errors.append("Organization schema needs logo and image")
    expected_profiles = {
        "https://www.instagram.com/dokkadoki/",
        "https://www.tiktok.com/@dokkadoki",
        "https://discord.gg/zjutK2TTHv",
        "https://www.ebay.co.uk/usr/dokkadokiltd",
        "https://www.libib.com/u/dokkadoki",
    }
    if not expected_profiles.issubset(set(org.get("sameAs", []))):
        errors.append("Organization sameAs is missing an official profile")

events = [item for item in event.json_ld if item.get("@type") == "Event"]
if len(events) != 1:
    errors.append(f"event page expected one Event object, got {len(events)}")
else:
    item = events[0]
    for key in ("name", "description", "startDate", "endDate", "eventStatus", "eventAttendanceMode", "location", "url", "image"):
        if not item.get(key):
            errors.append(f"Event schema missing {key}")
    if item.get("url") != "https://dokkadoki.co.uk/events/rakucon-2026/":
        errors.append("Event schema URL is not on the canonical host")

og_image = meta_value(event, "og:image") or ""
if "rakucon-2026" not in og_image or not og_image.startswith("https://dokkadoki.co.uk/"):
    errors.append(f"event Open Graph image is not its page-bundle cover: {og_image!r}")

# Only require related upcoming links while the repository actually has other
# non-cancelled future events. This keeps the regression valid after a season ends.
future_events = 0
now = datetime.now(timezone.utc)
for source in (repo / "content" / "events").glob("*/index.md"):
    text = source.read_text(encoding="utf-8")
    if 'event_status: "https://schema.org/EventCancelled"' in text:
        continue
    for line in text.splitlines():
        if line.startswith("event_end:"):
            raw = line.split(":", 1)[1].strip().strip('"')
            try:
                value = datetime.fromisoformat(raw)
                if value.tzinfo is None:
                    value = value.replace(tzinfo=timezone.utc)
                if value >= now:
                    future_events += 1
            except ValueError:
                pass
            break
if future_events > 1 and event.related_links < 1:
    errors.append("event page has no server-rendered related upcoming-event links")

robots = public / "robots.txt"
if not robots.is_file():
    errors.append("robots.txt is missing")
else:
    robots_text = robots.read_text(encoding="utf-8")
    if "Allow: /" not in robots_text or "Sitemap: https://dokkadoki.co.uk/sitemap.xml" not in robots_text:
        errors.append("robots.txt does not allow crawling and advertise the canonical sitemap")

sitemap = public / "sitemap.xml"
if not sitemap.is_file():
    errors.append("sitemap.xml is missing")
else:
    # This is trusted, locally generated Hugo output. Extracting the simple
    # <loc> values avoids using a general XML parser for an unneeded task.
    locations = [unescape(value) for value in re.findall(r"<loc>(.*?)</loc>", sitemap.read_text(encoding="utf-8"))]
    if not locations or any(not url.startswith("https://dokkadoki.co.uk/") for url in locations):
        errors.append("sitemap contains a missing or non-canonical URL")

# Canonical, schema and sitemap checks above are intentionally scoped to SEO
# signals. Historical body copy may still mention the old staging address.
for label, doc in (("home", home), ("event", event), ("privacy", privacy)):
    seo_values = [link.get("href", "") for link in doc.links if link.get("rel") == "canonical"]
    seo_values.extend(json.dumps(item, ensure_ascii=False) for item in doc.json_ld)
    if any("zayninrevolt.github.io/dokkadoki-site" in value for value in seo_values):
        errors.append(f"GitHub Pages host leaked into {label} SEO signals")

if errors:
    print("FAIL: " + "; ".join(errors))
    sys.exit(1)
print("PASS: rendered SEO output")
