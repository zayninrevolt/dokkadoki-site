# Dokkadoki — Coming Soon Site 🌸

A single-page "coming soon" landing site for **Dokkadoki**, a manga café & reading library opening in **Bury, UK**.

- **Live concept:** part café, part borrowing library, all cosy.
- **Brand:** pastel blue + sakura pink, cherry-blossom motif.
- **Stack:** one self-contained `index.html` — no build step, no framework. Animated falling-petals canvas, launch-list email capture, fully responsive.

## Run locally

Just open `index.html`, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy (GitHub Pages)

1. Settings → Pages → Source: `main` / root.
2. (Optional) add a `CNAME` file with `dokkadoki.co.uk` and point DNS at GitHub Pages.

## Launch-list note

The email form currently validates and stores addresses in the visitor's
`localStorage` only — there is **no backend yet**, so nothing is sent anywhere.
To actually collect sign-ups, wire the form to a service (Formspree, Buttondown,
Mailchimp embed, or a small endpoint on Odysseus) — swap the `submit` handler in
`index.html`.

## Design notes

- Fonts: Zen Maru Gothic + Zen Kaku Gothic New (Google Fonts) with system fallbacks.
- Respects `prefers-reduced-motion` (petals disabled).
- No external assets beyond the fonts — emoji used for imagery so it stays light.
