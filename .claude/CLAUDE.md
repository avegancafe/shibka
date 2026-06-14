# Shibka — maintenance guide

Shibka is a **Suika / Watermelon merge game reskinned with dog breeds**. Drop
pups into the bin; two of the same breed merge into the next breed up. The goal
(the "watermelon") is the **Shiba Inu**.

- **Repo:** github.com/avegancafe/shibka (GitHub account `avegancafe`)
- **Live:** https://shibka.kyleholzinger.dev — a **Docker container** on the
  shared EC2 box (`avegancafe_bot_nemoclaw`, arm64, `54.82.52.150`) behind a
  shared **Caddy** reverse proxy (auto Let's Encrypt TLS) on the `proxy_net`
  network. The proxy is its own repo, **avegancafe_lb** (`~/apps/lb` on the box);
  Shibka's site block is `sites/shibka.kyleholzinger.dev.caddy` there, mirroring
  `deploy/Caddyfile`. Auto-deploys on push to `main` via GitHub Actions → SSH →
  `deploy/deploy.sh`. *(Was GitHub Pages; see git history.)*
- **Stack:** the **game** is still vanilla — **no build step, no framework** for
  gameplay (HTML + CSS + vanilla JS + vendored physics; edit and reload). There is
  now a small **Express + Postgres** backend in `server/` for accounts, best-score
  sync, and the leaderboard (`npm` only for the server). Data lives in **Neon
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
| `server/` | Express + Postgres backend: `server.js` (routes, scrypt passwords, HMAC-signed cookie sessions), `db.js` (pg pool), `schema.sql` + `migrate.js`, `.env.example`, `package.json`. |
| `docker-compose.yml` | Local-dev Postgres (always-on `db` service) + an optional full-stack `app` service (`--profile full`). Prod uses `deploy/` instead. |
| `deploy/` | Production (EC2 box): `Dockerfile` (arm64 native build), `docker-compose.app.yml` (the `shibka` container on `proxy_net`), `Caddyfile` (the `shibka.kyleholzinger.dev` site block for the shared Caddy proxy), `deploy.sh` (git pull + build + up + `/healthz`), `env.production.sample`. Mirrors the box's existing `schedule` app. |
| `.github/workflows/deploy.yml` | CI deploy: on push to `main`, SSH to the box (`ec2-user@54.82.52.150`) → `~/apps/shibka/deploy/deploy.sh`. |
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
  cheap. (Currently `v12`.)
- `index.html` also carries `?v=N` on the css/js links as a belt-and-suspenders
  HTTP-cache bust; less critical now that the SW is network-first.
- **Home-screen icon caveat:** the OS snapshots the icon at install time. Updating
  the icon requires removing + re-adding the home-screen shortcut. Code/content
  update automatically.

## Backend, accounts & persistence

`server/` is an Express app that serves **both** the static game and a JSON API.
- **Auth:** username + password (case-insensitive unique username). Passwords are
  hashed with Node's built-in **scrypt** (no native deps). Session = an
  **HMAC-signed token in an httpOnly cookie** (`SESSION_SECRET`), 30-day TTL —
  stateless, no session table.
- **Endpoints:** `POST /api/signup|login|logout`, `GET /api/me` (200 `{user:null}`
  when signed out — *not* 401, so anonymous loads don't log a console error),
  `PATCH /api/profile` (display name and/or password — password change requires
  the current one), `POST /api/score` (best = `GREATEST`), `GET /api/leaderboard`
  (top-N + the caller's rank). `GET /healthz` checks DB connectivity.
- **DB:** one `users` table (`schema.sql`); best score lives on the user row, the
  leaderboard is an `ORDER BY best_score DESC`. **`pg` returns `BIGINT` ids as
  strings** — the session `uid` is coerced to a number (gotcha we hit).
- **Required env:** `DATABASE_URL` (Neon pooled string), `SESSION_SECRET`
  (`openssl rand -hex 32`), `NODE_ENV=production` (so cookies are `Secure`). See
  `server/.env.example`. **Never commit a real `.env`** (gitignored).
- **DB TLS (`db.js`):** defaults to **full certificate verification** (works with
  Neon's publicly-trusted cert). `PGSSL=disable` for local non-TLS Postgres,
  `PGSSL=no-verify` for self-signed. It strips `sslmode`/`channel_binding` from
  the URL so node-postgres doesn't emit its sslmode deprecation warning — TLS is
  governed by the `ssl` option, not the URL.

## Local development

The **game alone** can be served statically (`python3 -m http.server 8000`) if
you're only touching gameplay/CSS — the account UI just shows logged-out and the
leaderboard reads "unavailable". For anything touching the **backend** (accounts,
best-score sync, the leaderboard + its search/pagination) you need Postgres, and
the easiest way is **docker compose** (`docker-compose.yml` is local-dev only;
prod uses `deploy/` + Neon).

### Testing locally with docker compose

Two ways to bring up a local DB-backed stack:

```bash
# A) DB in Docker, Node on your host (fast iteration — recommended)
docker compose up -d db            # just Postgres: the always-on `db` service on :5432
cd server && npm install
export DATABASE_URL=postgres://shibka:shibka@localhost:5432/shibka PGSSL=disable SESSION_SECRET=dev-secret
npm run migrate && npm run dev     # serves the game + /api on http://localhost:3000

# B) whole stack in Docker (one command, no host Node)
docker compose --profile full up   # Postgres + the Node `app` service together
```

Confirm it's healthy: `curl -s localhost:3000/healthz` → `{"ok":true}`. Creds are
`shibka:shibka` / db `shibka` (see `docker-compose.yml`); `schema.sql` + `migrate.js`
are idempotent so re-running migrate is safe. Tear down with `docker compose down`
(add `-v` to also drop the `shibka_pgdata` volume for a clean DB).

> **DB-backed QA needs this.** The account widget, the best-score `POST`, and the
> whole leaderboard (top-5 strip, the desktop board, and the `/leaderboard`
> search/pagination) all hit `/api/*`, which requires Postgres. With no DB those
> endpoints `500`, so spin up the compose `db` before QA-ing those flows — and note
> `/api/me` only returns `200 {user:null}` when the backend is actually up. If
> Docker isn't available you can still QA the **layout/markup** statically, but
> verify the **data flow** against a real DB (compose locally, or against the
> deployed site).

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

For **account/leaderboard** changes, serve via the **Node server** (`:3000`, with
the docker-compose DB up) rather than `python http.server`, then exercise:
signup → the account widget flips to "Playing as …"; a real game-over `POST`s the
score and the leaderboard updates; login reconciles a higher local best up; the
profile modal renames/updates the password. The Playwright MCP needs Google Chrome
installed (`brew install --cask google-chrome`). Keep the **zero-console-errors**
bar — that's why `/api/me` returns `200 {user:null}` instead of 401.

## Deploying

Push to `main`; the **GitHub Actions** workflow SSHes into the box and runs
`deploy/deploy.sh`, which does `git pull` + `docker compose build` (native arm64)
+ `up -d` + a `/healthz` gate (the container also runs the idempotent
`migrate.js` on boot). Full one-time box setup (clone to `~/apps/shibka`, the
Caddy site wiring on `proxy_net`, `deploy/.env`, DNS, repo secrets) is in
**`DEPLOY.md`**. Schema changes ship by editing `server/schema.sql` (keep every
statement idempotent — it runs on every deploy). Then verify live:

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
