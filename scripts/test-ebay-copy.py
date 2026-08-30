#!/usr/bin/env python3
"""Guard public eBay copy against claiming Dokkadoki sells manga."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
paths = [
    root / "content" / "visit.md",
    root / "layouts" / "home.html",
    root / "content" / "blog" / "hello-from-dokkadoki.md",
]
errors = []
legacy_claims = [
    "for manga and related finds",
    "manga, figures and collectible finds",
    "all our manga, figures and finds",
]
for path in paths:
    text = path.read_text().lower()
    if any(claim in text for claim in legacy_claims):
        errors.append(f"legacy manga-sales claim remains: {path.relative_to(root)}")
    if "anime figures, blind box toys and fan collectibles" not in text:
        errors.append(f"missing approved eBay summary: {path.relative_to(root)}")

if errors:
    print("FAIL: " + "; ".join(errors))
    sys.exit(1)
print("PASS: public eBay copy is accurate")
