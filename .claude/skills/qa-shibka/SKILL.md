---
name: qa-shibka
description: Use when validating or QA-ing the Shibka dog-merge game after a change — serves it locally and drives it with Playwright, asserting via the window.__SHIBKA test hooks (deterministic merge test, game-over, restart), checking both responsive layouts, and confirming zero console errors.
---

# QA the Shibka game

Validate gameplay + layout after any change. Shibka exposes `window.__SHIBKA`
hooks specifically so this is deterministic.

## 1. Serve locally

```bash
python3 -m http.server 8731   # from the repo root (run in background)
```

Open `http://localhost:8731/` with Playwright. **If a change doesn't appear**, an
old service worker is serving a cached file — clear it and reload:

```js
await navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister())));
await caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k))));
```

## 2. Hooks + deterministic merge test

`spawnAt(level, x, y)` uses **world coords** (the world is 420×640, 1:1 with the
canvas coordinate space). Two same-level dogs spawned close enough fall, touch,
and merge.

```js
const S = window.__SHIBKA;
S.reset();
const cx = 210;
S.spawnAt(3, cx - 30, 160);
S.spawnAt(3, cx + 30, 160);
await new Promise(r => setTimeout(r, 1700));
// expect: S.levels includes 4, S.score increased (e.g. 12), S.dogCount === 1
```

Other checks: `S.LEVELS.length === 11`, `S.LEVELS[10].name === "Shiba Inu"`,
restart via `#restart-button` resets score/dogCount/gameOver and hides
`#game-over`.

## 3. Responsive layout (when CSS / fitCanvas changed)

Check both breakpoints:

- **Wide** (e.g. resize to 1100×1240): `getComputedStyle('.app').flexDirection`
  should be `row`; the board should be large and centered with side panels.
- **Narrow** (e.g. 820×1000): `flexDirection` `column`, board fills the width,
  centered.

Confirm the board fits below the dedication banner (no unexpected vertical
overflow) and the canvas CSS size scaled up from 420×640.

## 4. Visual + console

- Screenshot `#game-canvas` after spawning specific breeds to eyeball new art
  (e.g. spawn a single level-11 to inspect the Shiba). Spawn neighbors to confirm
  breeds stay visually distinct.
- Hover a dog in the evolution ring (`#evolution-ring`) → `#evo-tip` should show
  "N. Breed".
- Assert **zero console errors**.

## 5. After local QA passes

Push, then verify on the live deploy (https://avegancafe.github.io/shibka/) the
same way — repeat the merge test against the deployed URL, and confirm the service
worker registers (`navigator.serviceWorker.ready`) and the cache is populated.
