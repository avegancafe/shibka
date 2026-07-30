// worker/index.js — Shibka's API, ported from the old Express server.
//
// The static game is served by Cloudflare's asset store (see wrangler.jsonc);
// only /api/* and /healthz are routed to this Worker. Every route keeps the exact
// method, path, status codes, JSON shape, and error strings the old server used,
// so js/auth.js and js/leaderboard.js needed no changes at all.
//
// Auth is still a stateless HMAC-signed session token in an httpOnly cookie and
// passwords are still Node-scrypt hashes — see worker/auth.js for why that
// matters (existing accounts and cookies keep working).
import { randomBytes } from "node:crypto";
import { createDb } from "./db.js";
import {
  SESSION_COOKIE,
  hashPassword,
  readCookie,
  sessionClearCookie,
  sessionSetCookie,
  verifyPassword,
  verifyToken,
} from "./auth.js";

// ---- security headers ------------------------------------------------------
// The old Express middleware set these on every response; the static side now
// gets them from `_headers`, and every Worker response gets them here. The game
// has inline <script> blocks (SW registration + the migration bridge) and sets
// inline canvas styles, so script-src/style-src need 'unsafe-inline'; everything
// is same-origin (no external origins).
const CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'";
const PERMISSIONS_POLICY = "geolocation=(), camera=(), microphone=(), payment=(), usb=()";

const BODY_LIMIT = 8 * 1024; // was express.json({ limit: "8kb" })

// ---- responses -------------------------------------------------------------
function json(body, status = 200, extra) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Security-Policy": CSP,
    "Permissions-Policy": PERMISSIONS_POLICY,
  });
  if (extra) for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(JSON.stringify(body), { status, headers });
}

// Thrown by readJson; caught in fetch() and answered 4xx, the way body-parser's
// errors were answered by the old error handler (never a 500, never a stack).
class HttpError extends Error {
  constructor(status, body) {
    super(body);
    this.status = status;
    this.body = body;
  }
}

async function readJson(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > BODY_LIMIT)
    throw new HttpError(413, "Request too large.");
  const raw = await request.text();
  // Bytes, not code units — matches how body-parser measured the limit.
  if (new TextEncoder().encode(raw).length > BODY_LIMIT)
    throw new HttpError(413, "Request too large.");
  if (!raw) return {}; // express.json() left an empty/absent body as {}
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Invalid request body.");
  }
  return parsed && typeof parsed === "object" ? parsed : {};
}

// ---- config ----------------------------------------------------------------
function sessionSecret(env) {
  const secret = env.SESSION_SECRET;
  // The old server exited at boot when this was missing; a Worker can't exit, so
  // fail the request loudly instead (500 + a log line).
  if (!secret || secret.length < 16)
    throw new Error("SESSION_SECRET must be set (>= 16 chars). Generate: openssl rand -hex 32");
  return secret;
}

// There is no NODE_ENV anymore, so the Secure attribute is derived from the
// request: everywhere except a local `wrangler dev` origin, which is plain HTTP.
function isSecureRequest(url) {
  const h = url.hostname;
  return !(h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1");
}

// ---- validation (verbatim from the old server) -----------------------------
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
function checkUsername(u) {
  if (typeof u !== "string" || !USERNAME_RE.test(u)) return "3–20 letters, numbers, or underscores.";
  return null;
}
function checkPassword(p) {
  if (typeof p !== "string" || p.length < 8) return "at least 8 characters.";
  if (p.length > 200) return "too long.";
  return null;
}
function cleanDisplayName(d) {
  if (typeof d !== "string") return "";
  return d.trim().replace(/\s+/g, " ");
}
function checkDisplayName(t) {
  if (!t) return "required.";
  if (t.length > 30) return "30 characters max.";
  if (/[\u0000-\u001f\u007f]/.test(t)) return "invalid characters.";
  return null;
}
function publicUser(u) {
  return { username: u.username, displayName: u.display_name, best: u.best_score };
}

// ---- rate limiting ---------------------------------------------------------
// Per-isolate, best-effort only: a Worker runs in many isolates across many
// colos, so this Map just slows a single hot isolate — it is NOT a real limit.
// Enforce login/signup abuse with a Cloudflare WAF rate-limiting rule instead.
const buckets = new Map();

function rateLimit(request, max, windowMs) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  // Lazy expiry sweep — Workers have no long-lived timers for a setInterval.
  if (buckets.size > 512) {
    for (const [key, rec] of buckets) if (rec.resetAt <= now) buckets.delete(key);
  }
  let rec = buckets.get(ip);
  if (!rec || rec.resetAt <= now) {
    rec = { count: 0, resetAt: now + windowMs };
    buckets.set(ip, rec);
  }
  rec.count++;
  if (rec.count > max) {
    const retry = Math.ceil((rec.resetAt - now) / 1000);
    return json({ error: `Too many attempts. Try again in ${retry}s.` }, 429, {
      "Retry-After": String(retry),
    });
  }
  return null;
}

// ---- constant-time login ---------------------------------------------------
// When the username doesn't exist we still run a scrypt verification against this
// dummy hash so response timing can't reveal whether a username is registered.
// Computed once per isolate, on first use (no top-level await).
let dummyHashPromise = null;
function dummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(randomBytes(18).toString("hex")).catch(
      // Fall back to a valid scrypt$salt$key *shape* so verifyPassword still
      // burns the same work and returns false.
      () => `scrypt$${randomBytes(16).toString("hex")}$${randomBytes(64).toString("hex")}`
    );
  }
  return dummyHashPromise;
}

// ---- session ---------------------------------------------------------------
async function currentUser(request, env, db) {
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw) return null; // no cookie: never look at the secret or the database
  const session = verifyToken(raw, sessionSecret(env));
  if (!session) return null;
  const { rows } = await db.query(
    "SELECT id, username, display_name, best_score FROM users WHERE id = $1",
    [session.uid]
  );
  return rows[0] || null;
}

// ---- routes ----------------------------------------------------------------
async function postSignup(request, env, url, db) {
  const limited = rateLimit(request, 10, 15 * 60 * 1000);
  if (limited) return limited;

  const body = await readJson(request);
  const { username, password } = body;
  const displayName = cleanDisplayName(body.displayName);
  let e;
  if ((e = checkUsername(username))) return json({ error: "Username: " + e }, 400);
  if ((e = checkPassword(password))) return json({ error: "Password: " + e }, 400);
  if ((e = checkDisplayName(displayName))) return json({ error: "Display name: " + e }, 400);

  const hash = await hashPassword(password);
  let rows;
  try {
    ({ rows } = await db.query(
      `INSERT INTO users (username, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, username, display_name, best_score`,
      [username, hash, displayName]
    ));
  } catch (err) {
    if (err && err.code === "23505") return json({ error: "That username is taken." }, 409);
    throw err;
  }
  return json({ user: publicUser(rows[0]) }, 201, {
    "Set-Cookie": sessionSetCookie(rows[0].id, sessionSecret(env), isSecureRequest(url)),
  });
}

async function postLogin(request, env, url, db) {
  const limited = rateLimit(request, 20, 15 * 60 * 1000);
  if (limited) return limited;

  const { username, password } = await readJson(request);
  if (typeof username !== "string" || typeof password !== "string")
    return json({ error: "Username and password are required." }, 400);
  const { rows } = await db.query(
    "SELECT id, username, password_hash, display_name, best_score FROM users WHERE lower(username) = lower($1)",
    [username]
  );
  const user = rows[0];
  const ok =
    (await verifyPassword(password, user ? user.password_hash : await dummyHash())) && Boolean(user);
  if (!ok) return json({ error: "Wrong username or password." }, 401);
  return json({ user: publicUser(user) }, 200, {
    "Set-Cookie": sessionSetCookie(user.id, sessionSecret(env), isSecureRequest(url)),
  });
}

function postLogout(url) {
  return json({ ok: true }, 200, { "Set-Cookie": sessionClearCookie(isSecureRequest(url)) });
}

// "Who am I" status probe — always 200 so an anonymous page load doesn't log a
// console error. user is null when signed out. (Protected endpoints still 401.)
async function getMe(request, env, db) {
  const user = await currentUser(request, env, db);
  return json({ user: user ? publicUser(user) : null });
}

async function patchProfile(request, env, db) {
  // Body first, then auth: express parsed the body in middleware, so a malformed
  // body answered 400 before requireAuth could answer 401.
  const body = await readJson(request);
  const user = await currentUser(request, env, db);
  if (!user) return json({ error: "Please sign in." }, 401);

  const sets = [];
  const params = [];
  let i = 1;

  if (body.displayName !== undefined) {
    const dn = cleanDisplayName(body.displayName);
    const e = checkDisplayName(dn);
    if (e) return json({ error: "Display name: " + e }, 400);
    sets.push(`display_name = $${i++}`);
    params.push(dn);
  }

  if (body.newPassword !== undefined) {
    const e = checkPassword(body.newPassword);
    if (e) return json({ error: "Password: " + e }, 400);
    const { rows } = await db.query("SELECT password_hash FROM users WHERE id = $1", [user.id]);
    const ok =
      rows[0] && (await verifyPassword(String(body.currentPassword || ""), rows[0].password_hash));
    if (!ok) return json({ error: "Current password is incorrect." }, 403);
    sets.push(`password_hash = $${i++}`);
    params.push(await hashPassword(body.newPassword));
  }

  if (!sets.length) return json({ error: "Nothing to update." }, 400);
  sets.push("updated_at = now()");
  params.push(user.id);
  const { rows } = await db.query(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${i} RETURNING username, display_name, best_score`,
    params
  );
  return json({ user: publicUser(rows[0]) });
}

async function postScore(request, env, db) {
  const body = await readJson(request);
  const user = await currentUser(request, env, db);
  if (!user) return json({ error: "Please sign in." }, 401);

  const score = Math.floor(Number(body.score));
  if (!Number.isFinite(score) || score < 0 || score > 100_000_000)
    return json({ error: "Invalid score." }, 400);
  const { rows } = await db.query(
    `UPDATE users SET best_score = GREATEST(best_score, $1), updated_at = now()
       WHERE id = $2 RETURNING best_score`,
    [score, user.id]
  );
  return json({ best: rows[0].best_score });
}

async function getLeaderboard(request, env, url, db) {
  const params = url.searchParams;
  const limit = Math.min(50, Math.max(1, parseInt(params.get("limit"), 10) || 20));
  const page = Math.min(1_000_000, Math.max(1, parseInt(params.get("page"), 10) || 1));
  const offset = (page - 1) * limit;
  // Literal substring search on display name. We escape the ILIKE wildcards
  // (% _ \) so a user typing them gets a literal match instead of wildcard
  // behavior — the value is still BOUND ($1), so this is only about match
  // semantics, never SQL injection.
  const qParam = params.get("q");
  const rawQ = typeof qParam === "string" ? qParam.trim().slice(0, 50) : "";
  const q = rawQ.replace(/([\\%_])/g, "\\$1");

  // rank() over the whole field gives a GLOBAL competition rank (ties share a
  // rank), so a searched/paginated row still shows its true standing. The outer
  // ORDER BY adds updated_at as a stable tiebreaker for display only.
  const { rows } = await db.query(
    `SELECT display_name, best_score, rank FROM (
         SELECT display_name, best_score, updated_at,
                rank() OVER (ORDER BY best_score DESC) AS rank
         FROM users WHERE best_score > 0
       ) ranked
       WHERE ($1 = '' OR display_name ILIKE '%' || $1 || '%' ESCAPE '\\')
       ORDER BY best_score DESC, updated_at ASC
       LIMIT $2 OFFSET $3`,
    [q, limit, offset]
  );
  const { rows: cnt } = await db.query(
    `SELECT count(*)::int AS total FROM users
       WHERE best_score > 0 AND ($1 = '' OR display_name ILIKE '%' || $1 || '%' ESCAPE '\\')`,
    [q]
  );
  const total = cnt[0] ? cnt[0].total : 0;
  const leaderboard = rows.map((r) => ({
    rank: Number(r.rank),
    displayName: r.display_name,
    best: r.best_score,
  }));

  // If signed in, also report this player's standing (handy when they're not
  // on the visible page).
  let me = null;
  const user = await currentUser(request, env, db);
  if (user) {
    let rank = null;
    if (user.best_score > 0) {
      const { rows: rr } = await db.query(
        "SELECT count(*) + 1 AS rank FROM users WHERE best_score > $1",
        [user.best_score]
      );
      rank = Number(rr[0].rank);
    }
    me = { displayName: user.display_name, best: user.best_score, rank };
  }

  return json({ leaderboard, total, page, limit, me });
}

// ---- health (used by the deploy check to confirm a good release) ------------
// Must never throw and must never hang, so the DB probe is capped.
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function getHealthz(db) {
  try {
    await withTimeout(db.query("SELECT 1"), 5000);
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
}

// ---- router ----------------------------------------------------------------
async function route(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const db = createDb(env);

  if (path === "/healthz") {
    if (method !== "GET" && method !== "HEAD") return json({ error: "Not found." }, 404);
    return getHealthz(db);
  }

  if (method === "POST" && path === "/api/signup") return postSignup(request, env, url, db);
  if (method === "POST" && path === "/api/login") return postLogin(request, env, url, db);
  if (method === "POST" && path === "/api/logout") return postLogout(url);
  if (method === "GET" && path === "/api/me") return getMe(request, env, db);
  if (method === "PATCH" && path === "/api/profile") return patchProfile(request, env, db);
  if (method === "POST" && path === "/api/score") return postScore(request, env, db);
  if (method === "GET" && path === "/api/leaderboard") return getLeaderboard(request, env, url, db);

  // Unknown /api route or wrong method — the old express Router fell through to
  // a 404 here too.
  return json({ error: "Not found." }, 404);
}

// `html_handling: "auto-trailing-slash"` 307-redirects these two paths to their
// canonical form, but express.static served both 200 — and sw.js precaches these
// exact URLs. A redirected response in the offline cache makes a cold offline
// navigation fail ("a redirected response was used for a request whose redirect
// mode is not 'follow'"), so serve the canonical asset directly instead. Both
// paths are listed in `run_worker_first` so they actually reach this Worker.
const HTML_ALIASES = { "/index.html": "/", "/leaderboard.html": "/leaderboard" };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const isApi = path === "/healthz" || path === "/api" || path.startsWith("/api/");

    const alias = HTML_ALIASES[path];
    if (alias) return env.ASSETS.fetch(new Request(new URL(alias, url), request));

    // wrangler.jsonc routes only /api/*, /healthz, and the aliases above through
    // the Worker, so this is a defensive fallback: hand anything else to the
    // static asset store.
    if (!isApi) return env.ASSETS.fetch(request);

    try {
      return await route(request, env, url);
    } catch (err) {
      // Client errors (malformed / over-limit body) are the caller's fault —
      // answer 4xx, don't 500 or log a stack trace.
      if (err instanceof HttpError) return json({ error: err.body }, err.status);
      console.error("Unhandled error:", err && err.stack ? err.stack : err);
      return json({ error: "Something went wrong." }, 500);
    }
  },
};
