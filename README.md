# Shibka 🐾

![Shibka — all roads lead to Shiba](assets/social-preview.png)

> **All roads lead to Shiba.**

A cute, physics-based **merge puzzle** — a fan reskin of the Suika / Watermelon
game, but with **dog breeds** instead of fruit. Drop pups into the bin; when two
of the same breed touch, they merge into the next breed up. Work your way from a
tiny **Chihuahua** all the way to the smug, meme-worthy **Shiba Inu**.

## Run locally

The **game** is still a plain static site (vendored physics, procedural art, no
build step). The accounts + leaderboard are served by a small **Express +
Postgres** backend in `server/`. The easiest way to run the whole thing is Docker:

```bash
docker compose up -d db          # local Postgres
cd server && npm install
DATABASE_URL=postgres://shibka:shibka@localhost:5432/shibka \
  PGSSL=disable SESSION_SECRET=dev-secret npm run migrate
DATABASE_URL=postgres://shibka:shibka@localhost:5432/shibka \
  PGSSL=disable SESSION_SECRET=dev-secret npm run dev
# open http://localhost:3000
```

Or run the entire stack (Postgres + Node) in Docker: `docker compose --profile full up`.

The **gameplay itself runs fully offline** — `matter-js` is vendored in `vendor/`,
dog faces are drawn procedurally on a canvas, and only the system font stack is
used. The account/leaderboard layer is a progressive enhancement: when there's no
network (or no backend), you simply play as a guest with a `localStorage` best.

See **[DEPLOY.md](DEPLOY.md)** for the full local-dev and production (EC2 + Neon +
GitHub Actions) setup.

## Install it (offline-ready PWA)

Shibka is a Progressive Web App, so you can keep it on your phone and play with
no connection:

1. Open <https://avegancafe.github.io/shibka/> in your phone's browser.
2. **iOS (Safari):** Share → **Add to Home Screen**. **Android (Chrome):** menu →
   **Install app** / **Add to Home screen**.
3. Launch it from the home-screen icon — it opens full-screen (no browser chrome)
   and works **completely offline**.

A service worker (`sw.js`) precaches the whole app shell on first visit so it
works offline; the web app manifest (`manifest.webmanifest`) provides the Shiba
icon and standalone display.

The worker is **network-first**: whenever you're online it loads the latest
deployed build (the cache is only a fallback for when you're offline), and it
auto-updates itself on every visit — so the installed PWA always reflects the
newest version with no stale CSS/JS and no manual cache-busting.

## How to play

- **Move** your mouse / finger across the play area (or use **← →**) to aim the
  next pup along the top.
- **Drop** it with a **click**, **Space**, or **tap**. It falls under gravity.
- When two dogs of the **same breed** collide, they **merge** into the next
  breed and you score points.
- Only the five smallest breeds (Chihuahua → Beagle) ever drop in; everything
  bigger only appears through merging.
- A dashed **danger line** sits near the top. If a settled dog stays above it for
  ~2 seconds, it's **game over**.
- Merging two **Shiba Inus** (the biggest) pops them both for a big bonus.
- Your **best** score is saved in `localStorage`, and **synced to your account**
  (and the global leaderboard) when you're signed in.

## Accounts & leaderboard

Create an account (username + password) and pick a **display name** — that's what
shows on the global **leaderboard**. Your best score follows your account across
devices, and you can change your display name or password anytime from **Profile**.
It's optional: without an account you still play as a guest with a local best.

## Breed progression

Chihuahua → Pomeranian → Pug → Corgi → Beagle → French Bulldog → Dalmatian →
Husky → Jack Russell → Samoyed → **Shiba Inu** 🐕

## Project structure

```
index.html            markup + stable DOM hooks (game, account widget, leaderboard)
css/style.css          warm cream/biscuit palette + layout
js/dogs.js             breed data (LEVELS) + parametric drawDog / offscreen sprites
js/game.js             matter.js setup, input, drop & merge logic, scoring, test hooks
js/auth.js             account UI + best-score sync + leaderboard (progressive enhancement)
vendor/matter.min.js   matter-js 0.20.0 (vendored)
server/                Express + Postgres backend (auth, score, leaderboard) + schema/migrate
docker-compose.yml     local Postgres (+ optional full stack)
deploy/                systemd unit + nginx config for EC2
.github/workflows/     GitHub Actions deploy to EC2
DEPLOY.md              local-dev + production runbook
```

## Credits

Shibka is an unofficial **fan clone** of the Suika Game / Watermelon Game merge
mechanic. It is not affiliated with or endorsed by the original creators. Physics
by [matter-js](https://brm.io/matter-js/). All dog art is drawn procedurally in
canvas — no external image assets.
