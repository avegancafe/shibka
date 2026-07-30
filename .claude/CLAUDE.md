# Shibka — maintenance guide

Shibka is a **Suika / Watermelon merge game reskinned with dog breeds**. Drop
pups into the bin; two of the same breed merge into the next breed up. The goal
(the "watermelon") is the **Shiba Inu**.

- **Repo:** github.com/avegancafe/shibka (GitHub account `avegancafe`)
- **Live:** https://shibka.kyleholzinger.dev — a **Cloudflare Worker** (`worker/`)
  serving the JSON API, with the game itself served as Cloudflare static assets
  (see `wrangler.jsonc`). Auto-deploys on push to `main` via GitHub Actions →
  `wrangler deploy`. *(Was GitHub Pages, then a Docker container on EC2 behind a
  shared Caddy proxy; see git history.)*
- **Stack:** the **game** is still vanilla — **no build step, no framework** for
  gameplay (HTML + CSS + vanilla JS + vendored physics; edit and reload). The
  backend is now a **Cloudflare Worker** in `worker/` for accounts, best-score
  sync, and the leaderboard, talking to Postgres via the **Neon serverless HTTP
  driver** (`npm` only for the worker + tooling). Data still lives in **Neon
  Postgres** (project `Shibka`, pooled connection). See `DEPLOY.md`.

## Issue tracking (beads)

Work here is tracked in **beads** (`bd`); issue IDs are prefixed `shibka-` (epics
like `shibka-3zu` with `.N` children). The embedded-Dolt workspace lives in `.beads/`
in the **main checkout** (untracked). Running `bd` from a Claude Code worktree
(`.claude/worktrees/<name>/`) just works — the path is nested under the repo root, so
`bd` resolves the same workspace; only a worktree *outside* the repo needs
`bd -C <main-checkout>`. See the **`shibka-beads`** skill for the full repo
conventions, the `shibka-`/`.N` ID structure, and the setup checks.

## Golden rules (don't break these)

1. **Gameplay must work fully offline / with no runtime network.** matter-js is
   vendored in `vendor/`, every dog is drawn **procedurally on canvas** (no image
   files for gameplay), and only the system font stack is used. Never add a runtime
   CDN/font/image dependency to the *game*. The accounts/leaderboard layer
   (`js/auth.js` → `/api/*`) is a **progressive enhancement**: it must degrade
   gracefully (play as a guest with a `localStorage` best) when the API is
   unreachable. Never make core gameplay depend on the backend.
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
| `index.html` | Markup, stable DOM hooks, PWA `<meta>`/manifest links, SW registration, dedication banner. Also the `#account` widget + `#leaderboard` containers (filled by `auth.js`). Loads `js/scores.js` **before** `js/game.js` (game seeds its best from the queue) and `js/auth.js`. |
| `css/style.css` | Palette (CSS vars), layout. **Responsive:** mobile = stacked column; desktop (`min-width: 860px`) = 3 columns (stats **+ account** left, board center, next/**leaderboard**/evolution right). `.topbar-row` wraps logo+stats so the account widget can stack beneath. Also the account, leaderboard, and auth-modal styles. |
| `js/dogs.js` | `LEVELS` breed data + the parametric `drawDogFace()` renderer + offscreen sprite cache (`getSprite`). Exposed as `window.SHIBKA_DOGS`. |
| `js/scores.js` | **Offline score queue** (`window.SHIBKA_SCORES`) — the *local source of truth* for the best score. A durable `localStorage` array (`shibka_scores`) of completed runs (`{score, at, synced}`), kept compacted to ≤2 entries. A guest's displayed best is `best()` (max over the queue, even offline); `pendingMax()` is the highest run not yet accepted by the server. One-time migration folds the legacy `shibka_best` value in as an unsynced run, then deletes that key. Local-only (never touches the network) — flushing is `auth.js`'s job. Must load before `game.js`. |
| `js/game.js` | matter-js engine, input, drop + merge logic, game-over, scoring, `fitCanvas` (responsive scaling), the evolution ring, and the `window.__SHIBKA` hooks. Seeds its displayed `best` from `SHIBKA_SCORES.best()` and records new highs via `SHIBKA_SCORES.record()` (no more bare `shibka_best`). On game over it dispatches a `shibka:gameover` CustomEvent (`{score, best}`); `__SHIBKA.setBest(n)` raises the displayed best and pins it in the queue (`adoptServerBest`, used by the account sync). |
| `js/auth.js` | **Account layer** (progressive enhancement). Account widget (login/signup/profile/logout), the leaderboard, and `flushScores()` — drains the offline queue (`POST /api/score` with the highest pending run; server does `GREATEST`) on `shibka:gameover`, the `online` event, login (`onAuthenticated`), and boot. All `/api` calls degrade gracefully offline; unsent runs stay queued and retry. |
| `vendor/matter.min.js` | matter-js 0.20.0, vendored. Don't swap for a CDN. |
| `manifest.webmanifest` | PWA manifest (standalone, Shiba icons, theme colors). |
| `sw.js` | Service worker — network-first + offline precache. **Skips `/api/*` + `/healthz`** (never cached — a stale `/api/me` would show the wrong login state). |
| `worker/` | The Cloudflare Worker (API): `index.js` (router — all `/api/*` + `/healthz`, plus `HTML_ALIASES`, which serves `/index.html` + `/leaderboard.html` as 200s instead of the asset router's 307s, because `sw.js` precaches those exact URLs), `auth.js` (scrypt passwords, HMAC-signed session tokens), `db.js` (wraps `@neondatabase/serverless`, returns `{rows}` like `pg` did). |
| `db/` | `schema.sql` (idempotent, same `users` table as before) + `migrate.js` (Node-only script, speaks the Postgres wire protocol via `pg`; runs in CI before every deploy, and locally against a Neon dev branch). |
| `wrangler.jsonc` | Worker config: entrypoint, `nodejs_compat` (for `node:crypto`), the `assets` binding (repo root, `run_worker_first` limited to `/api/*`, `/healthz`, and the two `HTML_ALIASES` paths), and the commented-out custom-domain `routes` block (see `DEPLOY.md`). |
| `_headers` | Security headers (CSP, Permissions-Policy, etc.) applied to static-asset responses by Cloudflare's asset router — mirrors what `worker/index.js` sets on every `/api` response. Consumed by Wrangler at upload time, not served itself. |
| `.assetsignore` | Trims the uploaded static-asset set down to just the game (`worker/`, `db/`, `test/`, docs, tooling, etc. are excluded). |
| `test/` | Vitest suite (`worker.spec.js`) that runs inside `workerd` via `@cloudflare/vitest-pool-workers` — asserts the ported scrypt/session code stays byte-compatible with the old Express server. `npm test` is the CI gate. |
| `.github/workflows/deploy.yml` | CI deploy: on push to `main`, `npm ci` → `npm test` → `npm run migrate` (against Neon) → `wrangler deploy`. |
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
- **Score** persists best via the **offline score queue** (`js/scores.js`,
  `localStorage` key `shibka_scores`) — the local source of truth. `addScore`
  records each new personal best into it; the displayed best is derived from it
  (so it survives reloads offline). `auth.js` flushes the queue to the server when
  signed in + online. The legacy `shibka_best` key is migrated in once, then
  deleted — don't reintroduce it.
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
  cheap. (Currently `v17`.)
- `index.html` also carries `?v=N` on the css/js links as a belt-and-suspenders
  HTTP-cache bust; less critical now that the SW is network-first.
- **Home-screen icon caveat:** the OS snapshots the icon at install time. Updating
  the icon requires removing + re-adding the home-screen shortcut. Code/content
  update automatically.

## Backend, accounts & persistence

`worker/index.js` is a Cloudflare Worker that serves the JSON API (the static
game is served separately by Cloudflare's asset store — see `wrangler.jsonc`).
- **Auth:** username + password (case-insensitive unique username). Passwords are
  hashed with Node's built-in **scrypt** (`node:crypto` under `nodejs_compat` —
  no native deps). Session = an **HMAC-signed token in an httpOnly cookie**
  (`SESSION_SECRET`), 30-day TTL — stateless, no session table.
- **Endpoints:** `POST /api/signup|login|logout`, `GET /api/me` (200 `{user:null}`
  when signed out — *not* 401, so anonymous loads don't log a console error),
  `PATCH /api/profile` (display name and/or password — password change requires
  the current one), `POST /api/score` (best = `GREATEST`), `GET /api/leaderboard`
  (top-N + the caller's rank). `GET /healthz` checks DB connectivity.
- **DB:** one `users` table (`db/schema.sql`); best score lives on the user row,
  the leaderboard is an `ORDER BY best_score DESC`. Queries go through
  `worker/db.js`, a thin wrapper over **`@neondatabase/serverless`** (Neon's
  SQL-over-HTTP driver — no long-lived pool in a Worker) that returns `{rows}`
  just like `pg` did. **Ids still come back as strings** (the same
  `BIGINT`-as-string gotcha as before) — the session `uid` is coerced to a
  number (`Number(uid)`).
- **Required env:** `DATABASE_URL` (Neon pooled string) and `SESSION_SECRET`
  (`openssl rand -hex 32`) as **Wrangler secrets** in production
  (`wrangler secret put ...`, see `DEPLOY.md`) and in a local `.dev.vars` file
  (copy `.dev.vars.example`, gitignored) for `wrangler dev`. There's no
  `NODE_ENV` anymore — the session cookie's `Secure` attribute is derived from
  the request hostname instead (off for `localhost`/`127.0.0.1`, on everywhere
  else). **Never commit a real `.dev.vars`.**
- **DB TLS:** the Worker itself has no TLS knobs — `@neondatabase/serverless`
  talks HTTPS to Neon's SQL-over-HTTP endpoint and handles that internally. The
  old `PGSSL`/`sslmode` handling survives only in `db/migrate.js`, which still
  speaks the raw Postgres wire protocol via `pg` (defaults to full certificate
  verification; `PGSSL=disable`/`no-verify` for local/self-signed Postgres) and
  strips `sslmode`/`channel_binding` from the URL so `pg` doesn't emit its
  deprecation warning.

## Local development

The **game alone** can be served statically (`python3 -m http.server 8000`) if
you're only touching gameplay/CSS — the account UI just shows logged-out and the
leaderboard reads "unavailable". For anything touching the **backend** (accounts,
best-score sync, the leaderboard + its search/pagination) you need Postgres, and
the easiest way is a **Neon dev branch** + `wrangler dev`.

### Testing locally with wrangler dev

```bash
npm install
cp .dev.vars.example .dev.vars   # gitignored — never commit the real one
# Edit .dev.vars: DATABASE_URL -> a Neon DEV BRANCH (Neon console -> Branches ->
# New branch off the Shibka project). A branch is an instant copy of prod's
# schema/data, scale-to-zero, free tier. SESSION_SECRET can be anything locally.
npm run migrate   # applies db/schema.sql to that branch (idempotent)
npm run dev       # wrangler dev -- serves the game + /api on http://localhost:8787
```

Confirm it's healthy: `curl -s localhost:8787/healthz` → `{"ok":true}`.
`db/schema.sql` + `db/migrate.js` are idempotent, so re-running migrate is safe.

> **Why `npm run dev` passes `--persist-to`:** Wrangler's asset watcher watches
> `assets.directory` (here the repo root) *without* honoring `.assetsignore`, so
> its own `.wrangler/state` writes retrigger a reload forever and the server
> never answers a single request (measured: 600+ reloads, zero responses). The
> `dev` script therefore keeps local state in `$TMPDIR/shibka-wrangler-state`,
> outside the watched tree. If you run `wrangler dev` by hand, pass
> `--persist-to <a directory outside the repo>` yourself. (`node_modules/` is
> watched too, so an in-repo persist dir doesn't work either. Unavoidable
> leftover: git operations and `.wrangler/tmp` writes still each trigger one
> harmless reload.)

> **DB-backed QA needs this.** The account widget, the best-score `POST`, and the
> whole leaderboard (top-5 strip, the desktop board, and the `/leaderboard`
> search/pagination) all hit `/api/*`, which requires Postgres. With no
> `DATABASE_URL` those endpoints `500`, so point `.dev.vars` at a real (dev-branch)
> database before QA-ing those flows — and note `/api/me` only returns
> `200 {user:null}` when the backend is actually reachable. You can still QA the
> **layout/markup** statically with no database, but verify the **data flow**
> against a real DB (a dev branch locally, or the deployed site).

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

For **account/leaderboard** changes, serve via **`wrangler dev`** (`:8787`, with
`.dev.vars` pointed at a Neon dev branch) rather than `python http.server`, then
exercise:
signup → the account widget flips to "Playing as …"; a real game-over `POST`s the
score and the leaderboard updates; login reconciles a higher local best up; the
profile modal renames/updates the password. The Playwright MCP needs Google Chrome
installed (`brew install --cask google-chrome`). Keep the **zero-console-errors**
bar — that's why `/api/me` returns `200 {user:null}` instead of 401.

## Deploying

Push to `main`; the **GitHub Actions** workflow runs the test suite
(`npm test`), applies the Neon migration (`npm run migrate`), then deploys with
`wrangler deploy` (via `cloudflare/wrangler-action`). One-time Cloudflare setup
(secrets, the `*.workers.dev` smoke test, the custom-domain cutover, repo
secrets) is in **`DEPLOY.md`**. Schema changes ship by editing `db/schema.sql`
(keep every statement idempotent — it runs on every deploy). Then verify live:

```bash
until curl -s "https://shibka.kyleholzinger.dev/?cb=$(date +%s)" | grep -q "SOMETHING_YOU_CHANGED"; do sleep 5; done
curl -s https://shibka.kyleholzinger.dev/healthz   # -> {"ok":true}
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
