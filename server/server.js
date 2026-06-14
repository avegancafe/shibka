// server.js — Shibka backend.
//
// Serves the static game (repo root) AND a small JSON API for accounts,
// best-score persistence, and a global leaderboard. Auth is a stateless,
// HMAC-signed session token in an httpOnly cookie; passwords are hashed with
// Node's built-in scrypt (no native build deps). Sits behind Caddy, which
// terminates TLS and proxies to PORT.
"use strict";

const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const express = require("express");
const db = require("./db");

const scrypt = promisify(crypto.scrypt);

// ---- config ---------------------------------------------------------------
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, ".."); // repo root holds index.html, css/, js/, ...
const PROD = process.env.NODE_ENV === "production";
const COOKIE = "shibka_session";
const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 days

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 16) {
  console.error("FATAL: SESSION_SECRET must be set (>= 16 chars). Generate: openssl rand -hex 32");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // we run behind Caddy; trust X-Forwarded-* for req.ip / secure
app.use(express.json({ limit: "8kb" }));

// ---- security headers ------------------------------------------------------
// CSP + Permissions-Policy on every response. The game has two inline <script>
// blocks (SW registration + the migration bridge) and sets inline canvas styles,
// so script-src/style-src need 'unsafe-inline'; everything is same-origin (no
// external origins). We intentionally do NOT set HSTS / X-Frame-Options /
// X-Content-Type-Options / Referrer-Policy here — the production Caddy edge
// already sets those, and duplicating them risks conflicts.
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
  );
  res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=(), usb=()");
  next();
});

// ---- passwords (scrypt) ---------------------------------------------------
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}
async function verifyPassword(pw, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const key = Buffer.from(parts[2], "hex");
  let test;
  try {
    test = await scrypt(pw, salt, key.length);
  } catch {
    return false;
  }
  return key.length === test.length && crypto.timingSafeEqual(key, test);
}

// Constant-time login: when the username doesn't exist we still run a scrypt
// verification against this dummy hash so response timing can't reveal whether
// a username is registered. Seeded with a valid scrypt$salt$key shape, then
// replaced by a real hash once startup hashing finishes.
let DUMMY_HASH = `scrypt$${crypto.randomBytes(16).toString("hex")}$${crypto.randomBytes(64).toString("hex")}`;
hashPassword(crypto.randomBytes(18).toString("hex")).then((h) => { DUMMY_HASH = h; }).catch(() => {});

// ---- session token (HMAC-signed cookie) -----------------------------------
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let obj;
  try {
    obj = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!obj || typeof obj.uid !== "number" || typeof obj.exp !== "number") return null;
  if (obj.exp * 1000 < Date.now()) return null;
  return obj;
}
function setSession(res, uid) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  // node-postgres returns BIGINT columns as strings; the token (and verifier)
  // use a numeric uid, so coerce here. Safe for ids below 2^53.
  res.cookie(COOKIE, signToken({ uid: Number(uid), exp }), {
    httpOnly: true,
    secure: PROD, // requires HTTPS in production (Caddy terminates TLS)
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_S * 1000,
  });
}
function clearSession(res) {
  res.clearCookie(COOKIE, { httpOnly: true, secure: PROD, sameSite: "lax", path: "/" });
}
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

async function currentUser(req) {
  const session = verifyToken(readCookie(req, COOKIE));
  if (!session) return null;
  const { rows } = await db.query(
    "SELECT id, username, display_name, best_score FROM users WHERE id = $1",
    [session.uid]
  );
  return rows[0] || null;
}
function requireAuth(req, res, next) {
  currentUser(req)
    .then((user) => {
      if (!user) return res.status(401).json({ error: "Please sign in." });
      req.user = user;
      next();
    })
    .catch(next);
}

// ---- validation -----------------------------------------------------------
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

// ---- tiny in-memory rate limiter (per IP) ---------------------------------
const buckets = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    let rec = buckets.get(ip);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, rec);
    }
    rec.count++;
    if (rec.count > max) {
      const retry = Math.ceil((rec.resetAt - now) / 1000);
      res.set("Retry-After", String(retry));
      return res.status(429).json({ error: `Too many attempts. Try again in ${retry}s.` });
    }
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of buckets) if (rec.resetAt <= now) buckets.delete(ip);
}, 60_000).unref();

// ---- API ------------------------------------------------------------------
const api = express.Router();

api.post("/signup", rateLimit(10, 15 * 60 * 1000), async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const displayName = cleanDisplayName((req.body || {}).displayName);
    let e;
    if ((e = checkUsername(username))) return res.status(400).json({ error: "Username: " + e });
    if ((e = checkPassword(password))) return res.status(400).json({ error: "Password: " + e });
    if ((e = checkDisplayName(displayName)))
      return res.status(400).json({ error: "Display name: " + e });

    const hash = await hashPassword(password);
    const { rows } = await db.query(
      `INSERT INTO users (username, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, username, display_name, best_score`,
      [username, hash, displayName]
    );
    setSession(res, rows[0].id);
    res.status(201).json({ user: publicUser(rows[0]) });
  } catch (err) {
    if (err && err.code === "23505") return res.status(409).json({ error: "That username is taken." });
    next(err);
  }
});

api.post("/login", rateLimit(20, 15 * 60 * 1000), async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== "string" || typeof password !== "string")
      return res.status(400).json({ error: "Username and password are required." });
    const { rows } = await db.query(
      "SELECT id, username, password_hash, display_name, best_score FROM users WHERE lower(username) = lower($1)",
      [username]
    );
    const user = rows[0];
    const ok = (await verifyPassword(password, user ? user.password_hash : DUMMY_HASH)) && Boolean(user);
    if (!ok) return res.status(401).json({ error: "Wrong username or password." });
    setSession(res, user.id);
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

api.post("/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

// "Who am I" status probe — always 200 so an anonymous page load doesn't log a
// console error. user is null when signed out. (Protected endpoints still 401.)
api.get("/me", async (req, res, next) => {
  try {
    const user = await currentUser(req);
    res.json({ user: user ? publicUser(user) : null });
  } catch (err) {
    next(err);
  }
});

api.patch("/profile", requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const sets = [];
    const params = [];
    let i = 1;

    if (body.displayName !== undefined) {
      const dn = cleanDisplayName(body.displayName);
      const e = checkDisplayName(dn);
      if (e) return res.status(400).json({ error: "Display name: " + e });
      sets.push(`display_name = $${i++}`);
      params.push(dn);
    }

    if (body.newPassword !== undefined) {
      const e = checkPassword(body.newPassword);
      if (e) return res.status(400).json({ error: "Password: " + e });
      const { rows } = await db.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
      const ok = rows[0] && (await verifyPassword(String(body.currentPassword || ""), rows[0].password_hash));
      if (!ok) return res.status(403).json({ error: "Current password is incorrect." });
      sets.push(`password_hash = $${i++}`);
      params.push(await hashPassword(body.newPassword));
    }

    if (!sets.length) return res.status(400).json({ error: "Nothing to update." });
    sets.push("updated_at = now()");
    params.push(req.user.id);
    const { rows } = await db.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${i} RETURNING username, display_name, best_score`,
      params
    );
    res.json({ user: publicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

api.post("/score", requireAuth, async (req, res, next) => {
  try {
    const score = Math.floor(Number((req.body || {}).score));
    if (!Number.isFinite(score) || score < 0 || score > 100_000_000)
      return res.status(400).json({ error: "Invalid score." });
    const { rows } = await db.query(
      `UPDATE users SET best_score = GREATEST(best_score, $1), updated_at = now()
       WHERE id = $2 RETURNING best_score`,
      [score, req.user.id]
    );
    res.json({ best: rows[0].best_score });
  } catch (err) {
    next(err);
  }
});

api.get("/leaderboard", async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const { rows } = await db.query(
      `SELECT display_name, best_score FROM users
       WHERE best_score > 0
       ORDER BY best_score DESC, updated_at ASC
       LIMIT $1`,
      [limit]
    );
    const leaderboard = rows.map((r, idx) => ({
      rank: idx + 1,
      displayName: r.display_name,
      best: r.best_score,
    }));

    // If signed in, also report this player's standing (handy when they're not
    // in the visible top-N).
    let me = null;
    const user = await currentUser(req);
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

    res.json({ leaderboard, me });
  } catch (err) {
    next(err);
  }
});

app.use("/api", api);

// ---- health (used by the deploy workflow to confirm a good boot) ----------
app.get("/healthz", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

// ---- static game ----------------------------------------------------------
// Never expose the backend source as static files.
app.use((req, res, next) => {
  if (req.path === "/server" || req.path.startsWith("/server/")) return res.status(404).end();
  next();
});
app.use(
  express.static(ROOT, {
    extensions: ["html"],
    setHeaders(res, filePath) {
      // The service worker must always revalidate so updates propagate.
      if (filePath.endsWith("sw.js")) res.setHeader("Cache-Control", "no-cache");
    },
  })
);
// Single-page fallback for any non-API route.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(ROOT, "index.html"));
});

// ---- error handler --------------------------------------------------------
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Client errors (malformed JSON / over-limit body from body-parser carry a 4xx
  // status) are the caller's fault — answer 4xx, don't 500 or log a stack trace.
  const status = err && (err.status || err.statusCode);
  if (status && status >= 400 && status < 500) {
    const msg = err.type === "entity.too.large" ? "Request too large." : "Invalid request body.";
    return res.status(status).json({ error: msg });
  }
  console.error("Unhandled error:", err && err.stack ? err.stack : err);
  res.status(500).json({ error: "Something went wrong." });
});

app.listen(PORT, () => console.log(`Shibka listening on :${PORT} (production=${PROD})`));
