# Deploying Shibka (EC2 + Caddy + Neon + GitHub Actions)

Shibka is no longer a static GitHub Pages site. It's a small **Express + Postgres**
app: Node serves the static game **and** a JSON API (accounts, best-score sync,
global leaderboard). It runs as a **Docker container** on the existing EC2 box
(`avegancafe_bot_nemoclaw`, arm64), behind the shared **Caddy** reverse proxy
(automatic Let's Encrypt TLS), with data in **Neon Postgres**. It auto-deploys on
push to `main` via **GitHub Actions**.

```
GitHub push to main ─▶ Actions (SSH) ─▶ EC2: deploy/deploy.sh
                                          (git pull + docker compose build + up + /healthz)
Browser ─▶ Caddy :443 (TLS) ─▶ shibka:3000 (container, proxy_net) ─▶ Neon Postgres
```

This mirrors the existing **`schedule`** app: apps live in `~/apps/<app>/`, are
built natively on the arm64 box (no registry/QEMU), `expose` their port (not
publish), and join the externally-managed **`proxy_net`** network that Caddy
routes over by container name.

Box facts: instance `i-0cec00e5605d54aa2` · `54.82.52.150` · user `ec2-user` ·
Amazon Linux 2023 arm64 · Docker 25 + compose. Neon project `Shibka`
(`red-bread-86298984`, `aws-us-east-1`, org `org-billowing-wildflower-14648462`).

---

## 0. Local development

You don't need EC2 or Neon to develop locally — just Docker.

```bash
docker compose up -d db          # local Postgres
cd server && npm install
DATABASE_URL=postgres://shibka:shibka@localhost:5432/shibka \
  PGSSL=disable SESSION_SECRET=dev-secret npm run migrate
DATABASE_URL=postgres://shibka:shibka@localhost:5432/shibka \
  PGSSL=disable SESSION_SECRET=dev-secret npm run dev   # http://localhost:3000
# ...or the whole stack in Docker:  docker compose --profile full up
```

`PGSSL=disable` is only for the local non-TLS Postgres. Neon uses full-verify TLS.

---

## 1. One-time box setup

SSH in: `ssh -i ~/.ssh/avegancafe.pem ec2-user@54.82.52.150`

### a. Clone the repo
The `shibka` repo is public, so the box clones it over HTTPS (no key needed).
```bash
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/avegancafe/shibka.git
cd ~/apps/shibka
```

### b. Fill in the environment file
```bash
cp deploy/env.production.sample deploy/.env
# DATABASE_URL — pooled Neon string (run locally where neonctl is logged in):
#   npx neonctl connection-string --project-id red-bread-86298984 \
#     --org-id org-billowing-wildflower-14648462 --pooled
# SESSION_SECRET — generate on the box:
openssl rand -hex 32
# Edit deploy/.env with both values. (NODE_ENV/PORT are set in the compose file.)
chmod 600 deploy/.env
```
The Neon schema is already applied; `deploy.sh`/the container re-run the
idempotent migration on every deploy anyway.

### c. Route the subdomain via the shared proxy (avegancafe_lb)
The Caddy reverse proxy lives in its own repo, **avegancafe_lb**
(github.com/avegancafe/avegancafe_lb), cloned at `~/apps/lb`. Each app's site
block is one file under `sites/<domain>.caddy`. Shibka's
(`sites/shibka.kyleholzinger.dev.caddy`) mirrors this repo's `deploy/Caddyfile`
and is already in place. To re-apply or change routing:
```bash
cd ~/apps/lb && git pull && ./deploy.sh   # git pull + up -d + validate + graceful reload
```
To wire it from scratch: add `deploy/Caddyfile`'s contents to the lb repo as
`sites/shibka.kyleholzinger.dev.caddy`, push, then run the above on the box.

### d. DNS
Point `shibka.kyleholzinger.dev` at the box (same as `schedule`):
an **A record → 54.82.52.150**. Caddy issues the TLS cert on first request once
DNS resolves.

### e. First deploy
```bash
cd ~/apps/shibka && ./deploy/deploy.sh
```
Then check: `curl -fsS https://shibka.kyleholzinger.dev/healthz` → `{"ok":true}`.

---

## 2. GitHub Actions setup

The workflow (`.github/workflows/deploy.yml`) SSHes in on push to `main` and runs
`deploy/deploy.sh`. Add these repo secrets
(**Settings → Secrets and variables → Actions**):

| Secret | Value |
|--------|-------|
| `EC2_HOST` | `54.82.52.150` |
| `EC2_USER` | `ec2-user` |
| `EC2_SSH_KEY` | a private key whose public half is in `ec2-user`'s `~/.ssh/authorized_keys` on the box (you can reuse the `avegancafe` key, or add a dedicated CI key) |
| `EC2_PORT` | *(optional)* SSH port, defaults to 22 |

Push to `main` (or run the workflow manually). The job runs `deploy.sh` (git pull
+ build + up + `/healthz` gate) and fails if the app doesn't come up healthy.

---

## 3. Operations

```bash
docker ps --filter name=shibka
docker logs -f shibka                      # app logs (also journald tag "shibka")
docker compose -p shibka -f ~/apps/shibka/deploy/docker-compose.app.yml restart
curl -fsS https://shibka.kyleholzinger.dev/healthz
```

**Rollback:** `cd ~/apps/shibka && ./deploy/deploy.sh <previous-sha>`.

**The PWA stays always-fresh** (network-first service worker), so clients pick up
new deploys automatically; `/api/*` is never cached (see `sw.js`).

## 4. Old-domain score bridge (TEMPORARY)

The game used to live at `https://avegancafe.github.io/shibka/` (GitHub Pages,
since deleted). Browsers that played there still hold an **anonymous best** in
`localStorage["shibka_best"]` on that origin. The bridge recovers it.

**How it works (no CORS, no backend change):** a tiny static page redeployed at
the old origin reads `shibka_best` and redirects to
`https://shibka.kyleholzinger.dev/#import_best=<n>` — handing the score off in a
**URL fragment**, never a cross-origin request. The new site's inline reader (in
`index.html`, above `js/scores.js`) stashes it under `shibka_import_best`, and
`scores.js` folds it into the offline queue via `record()` (GREATEST-idempotent —
a lower import is dropped). It reaches the DB the same way any guest score does:
when the player signs in, `auth.js`'s `flushScores()` posts it. A guest whose best
was actually raised gets a one-time "claim it on the leaderboard" nudge.

Bridge source lives at **`deploy/ghpages-bridge/index.html`** (it ships **no**
service worker, and clears only Shibka's own SW/caches — scope `/shibka`, cache
prefix `shibka-` — so it can't disturb other projects on the shared `github.io`
origin). It **never deletes** `shibka_best`: there's no cross-origin ack that the
handoff landed, and re-handing-off the same value is idempotent.

**Deploy — ORDER MATTERS:**
1. Ship the new-site half first: merge this work to `main` so the inline reader +
   `scores.js` consumer are live on `shibka.kyleholzinger.dev` (normal EC2 deploy).
2. Publish the bridge to a **`gh-pages` branch** (orphan; root = the bridge
   `index.html`). Push `gh-pages` **before** touching repo Settings.
3. In repo **Settings → Pages → Source = "Deploy from a branch", Branch =
   `gh-pages` / `(root)`**, HTTPS enforced. (Flipping the toggle *before* the
   branch exists silently won't build.) Keep Pages on "Deploy from a branch" so it
   can't drift to an Actions workflow that runs on `main`.
   *(The `gh-pages` branch never triggers the EC2 deploy — that's `push: [main]`.)*

Verify: visit `https://avegancafe.github.io/shibka/` with a seeded `shibka_best`;
it should land on the new site with the score in the header.

**Teardown (~6–12 months out, when the long tail dries up):** delete the
`gh-pages` branch + set Settings → Pages → Source = **None**, then remove the
new-site import code (the inline reader in `index.html`, the `IMPORT_KEY`
consumer + `importInfo()` in `js/scores.js`, the import nudge in `js/auth.js`, and
the `.account-import` CSS). All of it is commented **TEMPORARY**. Owner: Kyle.
