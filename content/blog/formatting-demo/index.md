---
title: "Formatting demo — everything you can do in a post 🖋️"
slug: formatting-demo
date: 2026-07-10T16:45:00+01:00
description: "A reference post showing every bit of markdown formatting: images, headings, lists, tables, quotes and more. Delete me before launch!"
---

This post is a living cheat-sheet — open `content/blog/formatting-demo/index.md`
side-by-side with this page to see how each bit is written. Delete the whole
folder when you don't need it any more.

## Images

This post is a **folder** (`formatting-demo/`) containing `index.md` plus any
images. Reference them by filename:

![Two café cats sharing a coffee](cats.png)

That was written as: `![Two café cats sharing a coffee](cats.png)` — the text
in square brackets is the alt text for screen readers and Google.

## Headings

The `##` line above makes a section heading; `###` makes a smaller one:

### Like this little one

## Text styling

Make things **bold** with double asterisks, *italic* with single ones, or
***both***. `Backticks` give you inline code style, and ~~tildes~~ strike
things out.

## Links

Plain link: [our eBay store](https://www.ebay.co.uk/usr/dokkadoki). Links to
your own pages work with just the path: [the blog](/blog/).

## Lists

Bullets with dashes:

- Speciality coffee
- Japanese sodas
  - Ramune, of course
- Matcha

Numbered with `1.`:

1. Pick a manga off the wall
2. Order a drink
3. Get comfy

## Quotes

> Put a `>` before a line for a pull-quote. Lovely for reviews or
> customer comments.

## Tables

| Drink | Price | Cosy rating |
|-------|------:|:-----------:|
| Flat white | £3.20 | 🌸🌸🌸 |
| Matcha latte | £3.80 | 🌸🌸🌸🌸 |
| Ramune | £2.50 | 🌸🌸🌸🌸🌸 |

Columns are separated with `|`; the `---` row divides the header from the body.

## Dividers

Three dashes on their own line make a soft divider:

---

## Raw HTML (when markdown isn't enough)

Markdown isn't HTML, but you can drop HTML straight in and it just works —
handy for embeds like YouTube iframes or centring something:

<p style="text-align:center">🌸 Like this centred line 🌸</p>

That's everything you'll realistically need. New post = new folder in
`content/blog/`, an `index.md` with the `title`/`date`/`description` block at
the top, then write away.
