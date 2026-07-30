// worker/auth.js — passwords + session tokens.
//
// Ported byte-for-byte from the old Express server so the migration is invisible
// to existing accounts: scrypt hashes stored before the move still verify, and
// session cookies issued before the move stay valid (same SESSION_SECRET).
//
//   password hash: scrypt$<salt hex 32>$<key hex 128>   (Node scrypt defaults:
//                  N=16384, r=8, p=1; keylen 64)
//   session token: base64url(JSON body) "." base64url(HMAC-SHA256(body, secret))
//
// The secret is a PARAMETER rather than a module global (the old server read it
// from process.env at import time) — in a Worker it lives on `env`, and taking it
// per call keeps these helpers pure and directly testable.
import { createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

export const SESSION_COOKIE = "shibka_session";
export const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 days

// Promisified node:crypto scrypt (the old server used util.promisify).
function scrypt(pw, salt, keylen) {
  return new Promise((resolve, reject) => {
    nodeScrypt(pw, salt, keylen, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

// ---- passwords (scrypt) ---------------------------------------------------
export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(pw, stored) {
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
  return key.length === test.length && timingSafeEqual(key, test);
}

// ---- session token (HMAC-signed cookie) -----------------------------------
export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
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

// ---- cookies ---------------------------------------------------------------
export function readCookie(request, name) {
  const raw = request.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// Mirrors what express' res.cookie() emitted (it sends both Max-Age and the
// derived Expires); attribute names/values are what the browser already has.
export function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path || "/"}`];
  if (opts.maxAge !== undefined) {
    parts.push(`Max-Age=${opts.maxAge}`);
    parts.push(`Expires=${new Date(Date.now() + opts.maxAge * 1000).toUTCString()}`);
  }
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  return parts.join("; ");
}

export function sessionSetCookie(uid, secret, secure) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  // Postgres returns BIGINT columns as strings; the token (and verifier) use a
  // numeric uid, so coerce here. Safe for ids below 2^53.
  const token = signToken({ uid: Number(uid), exp }, secret);
  return serializeCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
}

export function sessionClearCookie(secure) {
  return serializeCookie(SESSION_COOKIE, "", {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    expires: new Date(1),
  });
}
