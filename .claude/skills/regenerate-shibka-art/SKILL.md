---
name: regenerate-shibka-art
description: Use when regenerating Shibka's generated PNG art — the social-preview card, the favicons, or the PWA home-screen icons — after changing the dog roster (LEVELS) or restyling a breed. The art is drawn by the live procedural renderer on a temp canvas and captured with Playwright.
---

# Regenerate Shibka art assets

All PNGs in `assets/` are produced by drawing with the game's own renderer
(`window.SHIBKA_DOGS`) on a temporary canvas in the live page, then screenshotting
that element. This keeps the art identical to the in-game dogs.

**When to regenerate:**
- Changed `LEVELS` (breeds/colors/order) → regenerate `social-preview.png` (its
  mini-row shows levels **1, 3, 5, 7, 9, 11**).
- Restyled the **Shiba (level 11)** → also regenerate `favicon.png`,
  `favicon-32.png`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`,
  `apple-touch-icon.png` (all are the Shiba face).
- After regenerating, **bump `VERSION` in `sw.js`** and commit the PNGs.

## Critical gotcha

Render **one temp canvas at a time.** All temp canvases are
`position:fixed; left:0; top:0`, so leftover canvases overlap and **bleed into
element screenshots** (we once shipped an icon with a second tiny dog in the
corner). Before each render: `document.querySelectorAll('.tmpcv').forEach(e => e.remove())`,
draw the single canvas, screenshot it, repeat.

## Setup

Serve locally (`python3 -m http.server 8731`), open it with Playwright, and resize
the window large enough for the target (e.g. 1360×760 for the 1280×640 card).
`const D = window.SHIBKA_DOGS;` — the Shiba is `D.LEVELS[10]`. `drawDogFace(ctx,
params, R)` draws centered at the current origin.

## Social preview card (1280×640)

Layout: warm vertical gradient bg (`#FDF6EA`→`#F3E1C9`); big Shiba face on the
right (`translate(960,322)`, soft accent radial glow, `drawDogFace(ctx, shiba,
218)`); "Shibka" title `#F2A03D` 138px at (92,282); tagline "All roads lead to
Shiba" `#6B5640` 700/56px at (96,392); mini progression row of levels
`[1,3,5,7,9,11]` along the bottom (`startX 116, y 522, gap 78`, each scaled to ~56
px, `›` separators in `#C2A684`). Screenshot the canvas → `assets/social-preview.png`.

## Icons (full-bleed cream `#FDF1DE`, Shiba face centered)

For each: fill the tile, `translate(size/2, size/2 + size*0.02)`, draw the Shiba.

- `icon-192.png` (192), `icon-512.png` (512): `drawDogFace(ctx, shiba, size*0.36)`.
- `icon-512-maskable.png` (512): smaller face for the safe zone, `size*0.30`.
- `apple-touch-icon.png` (180): rounded-corner cream tile (radius ~`size*0.22`),
  face `size*0.36`.
- `favicon.png` (128): rounded cream tile, face `size*0.40`.
- `favicon-32.png` (32): square cream tile, face `size*0.40` (fills more so it
  reads in a tiny tab).

## After regenerating

- `sips -g pixelWidth -g pixelHeight assets/<file>.png` to confirm sizes.
- Bump `VERSION` in `sw.js`; if you added/renamed a file, update the `ASSETS`
  precache list and the `<link>`s in `index.html`.
- Commit the PNGs (they're tracked; only `shibka-*.png` QA screenshots are
  gitignored).
