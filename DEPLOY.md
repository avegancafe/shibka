# Deploying Shibka (Cloudflare Workers + Neon + GitHub Actions)

Shibka runs as a single **Cloudflare Worker**: `worker/` serves the JSON API
and Cloudflare's static-asset store serves the game itself (see
`wrangler.jsonc`). Data lives in **Neon Postgres**, unchanged. It auto-deploys
on push to `main` via **GitHub Actions**.

```
GitHub push to main ─▶ Actions: npm ci, npm test, npm run migrate, wrangler deploy
Browser ─▶ Cloudflare edge (Worker + static assets, automatic TLS) ─▶ Neon Postgres
```

Neon project `Shibka` (`red-bread-86298984`, `aws-us-east-1`, org
`org-billowing-wildflower-14648462`) — same database this app has always used;
this migration changes nothing about the data or its connection details.

*(Shibka was previously a Docker container on an EC2 box behind a shared Caddy
proxy, and before that a static GitHub Pages site — see git history for those
runbooks.)*

---

## 1. One-time setup

1. **Cloudflare account.** Any account works to start — a Worker deploys to a
   free `*.workers.dev` subdomain before any custom domain is wired up (§3).
2. **Authenticate Wrangler**, either:
   - `npx wrangler login` (opens a browser, stores a local OAuth token), or
   - an API token — the same kind CI uses (§2). Export it locally as
     `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`) and Wrangler picks it
     up with no login step.
3. **Set the two Worker secrets** (per-environment, stored by Cloudflare — not
   in the repo):
   ```bash
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put DATABASE_URL
   ```
   - `SESSION_SECRET` **must be the same value the EC2/Express deployment
     used**, or every already-issued session cookie is invalidated and every
     signed-in player is logged out. Pull it from wherever it was recorded
     before that box gets decommissioned (§4).
   - `DATABASE_URL` is the **same Neon pooled connection string** the old
     deployment used — same database, same `users` table, **no data migration
     needed**. Regenerate it if needed with:
     ```bash
     npx neonctl connection-string --project-id red-bread-86298984 \
       --org-id org-billowing-wildflower-14648462 --pooled
     ```
4. **First deploy:** `npm run deploy` (runs `wrangler deploy`). This publishes
   the Worker + static assets to `https://shibka.<your-subdomain>.workers.dev`.
5. **Smoke test** on that `*.workers.dev` URL before touching the domain:
   ```bash
   curl -s https://shibka.<subdomain>.workers.dev/healthz   # -> {"ok":true}
   ```
   Then load the page and confirm signup/login work against the shared Neon
   database.

---

## 2. GitHub secrets for CI

`.github/workflows/deploy.yml` runs the test suite, applies the migration, and
deploys on every push to `main`. Add these repo secrets (**Settings → Secrets
and variables → Actions**):

| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | A token scoped to this account with **Workers Scripts:Edit** permission (dashboard → My Profile → API Tokens → Create Token). |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID that owns the Worker (dashboard sidebar, or `wrangler whoami`). |
| `DATABASE_URL` | The same Neon pooled connection string from §1 — used by `npm run migrate` in CI, immediately before the deploy step. |

The old `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`, `EC2_PORT` secrets are obsolete
— delete them once the Cloudflare deploy is confirmed working (§4).

---

## 3. Domain cutover (point kyleholzinger.dev at Cloudflare)

`kyleholzinger.dev` currently uses **NS1** nameservers
(`dns1-4.p08.nsone.net`). Cloudflare custom domains require the *zone* itself
to live on Cloudflare, so this is a nameserver migration, not just a DNS
record edit:

1. **Add the site** in the Cloudflare dashboard (Websites → Add a site — the
   free plan is enough). Let Cloudflare **import the existing DNS records**:
   this picks up the `A` record pointing `shibka.kyleholzinger.dev` at
   `54.82.52.150`, so **the EC2 box keeps serving the domain unchanged** while
   the rest of this move is in progress.
2. **Switch nameservers at the registrar** to the two Cloudflare-assigned
   ones, replacing the NS1 `dns1-4.p08.nsone.net` set.
3. **Wait for the zone to activate** (Cloudflare emails you, and the dashboard
   shows "Active" — usually minutes, occasionally longer for full DNS
   propagation).
4. **Only once the zone is active**, uncomment the `routes` block in
   `wrangler.jsonc`:
   ```jsonc
   "routes": [{ "pattern": "shibka.kyleholzinger.dev", "custom_domain": true }]
   ```
   and redeploy (`npm run deploy`, or just push to `main`). Cloudflare now
   takes over `shibka.kyleholzinger.dev` directly, with automatic TLS — no
   Caddy, no Let's Encrypt renewal to manage.

**Rollback:** comment the `routes` block back out and redeploy. The zone's `A`
record still points `shibka.kyleholzinger.dev` at the EC2 box (imported in
step 1 and never removed), so traffic falls straight back to the old
container with no further DNS changes needed.

---

## 4. Decommission checklist (once the Cloudflare cutover is verified stable)

- Remove the `shibka` site block (`sites/shibka.kyleholzinger.dev.caddy`) from
  the **avegancafe_lb** repo (the shared Caddy proxy config, `~/apps/lb` on
  the box), then `git pull && ./deploy.sh` there so Caddy stops routing the
  domain.
- On the EC2 box, stop and remove the old `shibka` compose project (the
  compose file and the rest of `deploy/` no longer exist in *this* repo as of
  the Cloudflare migration — use whatever copy is still checked out on the
  box, e.g. `docker compose -p shibka -f ~/apps/shibka/deploy/docker-compose.app.yml down`,
  or `docker rm -f shibka` if that file is already gone).
- Delete the obsolete GitHub secrets: `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`,
  `EC2_PORT`.

### Old-domain score bridge (TEMPORARY — separate, later teardown)

Unrelated to the EC2 box: the old **GitHub Pages** origin
(`https://avegancafe.github.io/shibka/`) still serves a tiny bridge page (the
**`gh-pages`** branch — its source left this repo when `deploy/` was deleted in
the Cloudflare migration; see `deploy/ghpages-bridge/index.html` in git
history). It hands a returning browser's anonymous `shibka_best` to
`shibka.kyleholzinger.dev` via a `#import_best=<n>` URL fragment, which the
inline reader in `index.html` (marked `TEMPORARY`) stashes for `js/scores.js`.
The Cloudflare move doesn't change any of this — it's origin-to-origin, no
backend involved.

**Teardown (~6–12 months after the Pages→EC2 move, when the long tail dries
up):** delete the `gh-pages` branch + set repo **Settings → Pages → Source =
None**, then remove the new-site import code — the inline reader in
`index.html`, the `IMPORT_KEY` consumer + `importInfo()` in `js/scores.js`, the
import nudge in `js/auth.js`, and the `.account-import` CSS. All of it is
commented **TEMPORARY**. Owner: Kyle.

---

## 5. Operations

- **Migrations run in CI now**, right before every deploy (`npm run migrate`
  against `secrets.DATABASE_URL` — see `.github/workflows/deploy.yml`).
  `db/schema.sql` must stay idempotent (every statement `IF NOT EXISTS`),
  since it reapplies on every push to `main`.
- **Logs:** `npx wrangler tail` streams live requests and `console.error`
  output from the deployed Worker.
- **Bad deploy:** `npx wrangler rollback` reverts to the previous deployed
  version instantly (`wrangler deployments list` to pick a specific one, then
  `wrangler rollback <id>`).
- **CPU limit / scrypt:** password hashing (scrypt) is CPU-heavy — roughly
  50–100ms per hash — and every signup, login (even a *failed* one; the dummy
  hash keeps timing constant), and password change pays that cost. The
  **Workers Free plan caps CPU time at 10ms per request**, which a single
  scrypt call blows past on its own, so `/api/login` and `/api/signup` can get
  killed mid-request under load. The **Workers Paid plan ($5/mo, covers every
  Worker on the account)** raises the CPU limit and is recommended before
  relying on this in production.
- **Rate limiting:** the in-worker limiter (`worker/index.js`) is per-isolate
  and best-effort only — it slows down a single hot isolate, **not** a real
  defense against abuse. Add a **Cloudflare WAF rate-limiting rule** for
  `/api/login` and `/api/signup` (Security → WAF → Rate limiting rules) for
  actual protection.
