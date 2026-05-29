# Shibka — maintenance guide

Shibka is a **Suika / Watermelon merge game reskinned with dog breeds**. Drop
pups into the bin; two of the same breed merge into the next breed up. The goal
(the "watermelon") is the **Shiba Inu**.

- **Repo:** github.com/avegancafe/shibka (GitHub account `avegancafe`)
- **Live:** https://avegancafe.github.io/shibka/ (GitHub Pages, branch `main`, root)
- **Stack:** plain static site — **no build step, no npm, no framework.** HTML +
  CSS + vanilla JS + a vendored physics engine. Edit files and reload.

## Golden rules (don't break these)

1. **It must work fully offline / with no runtime network.** matter-js is vendored
   in `vendor/`, every dog is drawn **procedurally on canvas** (no image files for
   gameplay), and only the system font stack is used. Never add a runtime CDN/font/
   image dependency.
2. **Physics lives in fixed world units: `W=420 × H=640`.** Never tie gameplay to
   pixels. Only the *display* scales (see `fitCanvas`). `spawnAt`/pointer math all
   work in these world coords.
3. **Preserve the test hooks** on `window.__SHIBKA` (`score`, `best`, `gameOver`,
   `dogCount`, `levels`, `spawnAt`, `reset`, `LEVELS`) and the stable DOM ids
   below. The Playwright QA depends on them.
4. **Required DOM ids/classes:** `#game-canvas`, `#score`, `#best`, `#next-dog`,
   `#restart-button`, `#game-over`, `#final-score`, `#evolution-ring`, `#evo-tip`,
   `.dedication`.
5. **Keep the dedication banner.** `index.html` has `<header class="dedication">To
   the best fiancée in the world, Elise 💚</header>`. It's intentional — don't
   remove it. If you change its height, keep the CSS var `--ded-h` and the
   `fitCanvas` banner-offset in sync.
6. **Level 11 is the Shiba Inu** (black-and-tan) — the win goal. The app icons,
   favicon, and social card are all the Shiba face; if you restyle the Shiba,
   regenerate those (see the `regenerate-shibka-art` skill).

## File map

| File | Purpose |
|------|---------|
| `index.html` | Markup, stable DOM hooks, PWA `<meta>`/manifest links, SW registration, dedication banner. |
| `css/style.css` | Palette (CSS vars), layout. **Responsive:** mobile = stacked column; desktop (`min-width: 860px`) = 3 columns (stats left, board center, next/evolution right). |
| `js/dogs.js` | `LEVELS` breed data + the parametric `drawDogFace()` renderer + offscreen sprite cache (`getSprite`). Exposed as `window.SHIBKA_DOGS`. |
| `js/game.js` | matter-js engine, input, drop + merge logic, game-over, scoring, `fitCanvas` (responsive scaling), the evolution ring, and the `window.__SHIBKA` hooks. |
| `vendor/matter.min.js` | matter-js 0.20.0, vendored. Don't swap for a CDN. |
| `manifest.webmanifest` | PWA manifest (standalone, Shiba icons, theme colors). |
| `sw.js` | Service worker — network-first + offline precache (see PWA section). |
| `assets/` | Generated PNGs: `favicon.png`, `favicon-32.png`, `icon-192/512/512-maskable`, `apple-touch-icon`, `social-preview.png`. All are the Shiba face / brand card. |

## The dog roster

11 levels, smallest → largest. Only levels **1–5** are droppable (weighted toward
the smallest via `DROP_WEIGHTS = [1,1,1,2,2,3,4,5]`); everything bigger appears
only by merging.

1 Chihuahua · 2 Pomeranian · 3 Pug · 4 Corgi · 5 Beagle · 6 French Bulldog ·
7 Dalmatian · 8 Husky · 9 Jack Russell · 10 Samoyed · 11 **Shiba Inu** (goal).

### Editing / adding breeds

Each entry in `LEVELS` (in `js/dogs.js`) feeds the single parametric renderer
`drawDogFace(ctx, params, R)`. Fields:

- `level`, `name`, `radius` (px in world units — smooth increasing scale),
  `scoreValue` (points when this breed is *created* by a merge).
- `furColor`, `earColor`, `muzzleColor` (hex).
- `earStyle`: `pointy` | `floppy` | `floof` | `round`.
- `eyeStyle`: `round` | `happy` (closed arcs) | `sleepy` | `blue` (husky).
- `marking`: `none` | `mask` (dark goggles, drawn from `earColor`) | `patch`
  (asymmetric eye patch from `earColor`) | `spots` (dalmatian) | `eyebrows`
  (tan dots above eyes).
- Optional: `browColor` (color of the `eyebrows` dots), `eyeRing` (light halo
  behind the eyes — **required for dark-furred dogs** like the Shiba so the eyes
  read), `smile: true` (wide grin + little tongue).

Keep the 11 breeds visually distinct — vary fur color, ear style, eye style, and
markings (we previously had to differentiate a cluster of orange pointy-eared
breeds). White dogs read fine on the cream board thanks to the outline; dark dogs
need `eyeRing`.

**If you change `LEVELS`:** regenerate `assets/social-preview.png` (its mini-row
shows levels 1,3,5,7,9,11). If you change the Shiba (level 11), also regenerate
the icons + favicon. Then bump `VERSION` in `sw.js`. Use the
`regenerate-shibka-art` skill.

## Rendering model (`fitCanvas` in `game.js`)

- World is `420×640`. `fitCanvas()` computes a display size that fills the
  viewport while preserving that aspect, sets the canvas CSS size + backing
  store, and sets a context transform so drawing in world coords maps to the
  display. It runs on load and on `resize`.
- `spriteRatio` = device px per world unit (quantized, capped at 3). Dog sprites
  are pre-rendered offscreen at this ratio so they stay crisp at any board size.
  `drawSprite` uses `spriteRatio`; the evolution-ring/next-preview use plain `dpr`.
- Wide screens (`innerWidth >= 860`): board fills available height between the
  side panels. Narrow: board fills width (page scrolls for the panels).

## Game mechanics

- **Queue:** `heldLevel` (the dog you aim with, at the top) + `nextLevel` (the
  on-deck dog shown in "Next up"). Dropping advances the queue.
- **Merge:** two dogs of the same level → one of `level+1` at the midpoint, plus
  score. Driven by matter's `collisionStart` **and** a per-frame `sweepResting()`
  that catches same-level dogs that come to rest already touching (a real bug we
  fixed). A `merging` flag prevents double-merges. Two level-11 Shibas pop for a
  big bonus (no new dog).
- **Game over:** a dog whose top edge sits above the danger line (`DANGER_Y`) for
  `GAMEOVER_GRACE` (2s) ends the game. Fast-falling dogs mid-drop are ignored.
- **Score** persists best in `localStorage` (`shibka_best`).
- Tuning constants live at the top of `game.js` (`DROP_Y`, `DANGER_Y`,
  `DROP_COOLDOWN`, physics restitution/friction/etc.).

## PWA & caching (important)

The installed app is meant to be a **live copy of the latest deploy**.

- `sw.js` is **network-first for every request**: online → always the newest file
  (asset fetches use `no-cache` to beat the CDN `max-age`); the cache is only an
  **offline fallback** (the last build you loaded). The full shell is precached on
  install.
- It **auto-updates**: registered with `updateViaCache:"none"` + `update()` on
  every load, `skipWaiting` + `clients.claim()`, and the page reloads once when a
  new worker takes control.
- **`VERSION` in `sw.js`** names the offline-snapshot cache. **Bump it whenever you
  change the `ASSETS` precache list or want to force every client to evict old
  caches.** Day-to-day content changes propagate automatically via network-first —
  you do *not* need to bump for every edit, but bumping on a release is safe and
  cheap. (Currently `v10`.)
- `index.html` also carries `?v=N` on the css/js links as a belt-and-suspenders
  HTTP-cache bust; less critical now that the SW is network-first.
- **Home-screen icon caveat:** the OS snapshots the icon at install time. Updating
  the icon requires removing + re-adding the home-screen shortcut. Code/content
  update automatically.

## Local development

```bash
python3 -m http.server 8000   # from the repo root
# open http://localhost:8000  (must be served over http, not file://, for SW + localStorage)
```

Service workers also run on `localhost` (a secure context). **Gotcha:** when
iterating, an old SW can serve a stale cached file. If a change isn't showing,
clear it in the test browser:

```js
navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
```

then hard-reload. (Network-first largely prevents this while online, but the SW
*logic* itself updates one navigation later.)

## Validating changes

Use the **`qa-shibka`** skill. In short: serve locally, drive it with Playwright,
and assert via `window.__SHIBKA` (deterministic merge test, game-over, restart),
plus screenshots and a console-error check. Always verify both the wide and narrow
layouts when touching CSS/`fitCanvas`.

## Deploying

Push to `main`; GitHub Pages auto-builds (~1 min). Then verify live:

```bash
# wait for the deploy to serve your change, e.g.:
until curl -s "https://avegancafe.github.io/shibka/?cb=$(date +%s)" | grep -q "SOMETHING_YOU_CHANGED"; do sleep 5; done
```

The **repo social-preview image** (shown when sharing the github.com link) is set
manually in **Settings → General → Social preview** — there is no API; upload
`assets/social-preview.png`. The **site** link preview updates automatically from
the `og:`/`twitter:` meta in `index.html`.

## Gotchas we hit (so you don't repeat them)

- **Temporal dead zone:** declare `const`s before first use. A `const DROP_WEIGHTS`
  referenced above its declaration crashed init once.
- **Dark dogs need `eyeRing`** or their dark eyes vanish into dark fur.
- **Regenerating art:** the dog PNGs are produced by drawing on a temp canvas in
  the live page and screenshotting it. Render **one** temp canvas at a time —
  overlapping fixed-position canvases bleed into element screenshots. See the
  `regenerate-shibka-art` skill.
- **Stale SW** serving old CSS during iteration (see Local development).
- `.gitignore` excludes `.playwright-mcp/` and local QA screenshots (`shibka-*.png`).
  The `assets/*.png` are committed on purpose — don't name generated game art
  `shibka-*.png` or it won't be tracked.
