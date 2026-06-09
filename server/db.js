// db.js — a single shared node-postgres connection pool.
//
// DATABASE_URL points at Neon (use the *pooled* `-pooler` endpoint). TLS is
// configured via the `ssl` option below, NOT via the URL's `sslmode` (which
// node-postgres now warns is being reinterpreted as verify-full). We strip those
// libpq params from the URL so the driver doesn't emit that deprecation warning.
//
//   PGSSL unset      -> TLS with full certificate verification (correct for Neon;
//                       Neon serves a publicly-trusted cert). Most secure.
//   PGSSL=no-verify  -> TLS but don't verify the cert (self-signed servers).
//   PGSSL=disable    -> no TLS at all (local non-TLS Postgres / dev container).
"use strict";

const { Pool } = require("pg");

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error("FATAL: DATABASE_URL is not set. See server/.env.example.");
  process.exit(1);
}

let ssl;
if (process.env.PGSSL === "disable") ssl = false;
else if (process.env.PGSSL === "no-verify") ssl = { rejectUnauthorized: false };
else ssl = { rejectUnauthorized: true };

// Drop libpq SSL params so node-postgres' connection-string parser doesn't warn;
// TLS is fully governed by `ssl` above. (Falls back to the raw string if the URL
// can't be parsed, e.g. a non-URL DSN.)
let connectionString = raw;
try {
  const u = new URL(raw);
  u.searchParams.delete("sslmode");
  u.searchParams.delete("channel_binding");
  connectionString = u.toString();
} catch (_) {
  /* leave as-is */
}

const pool = new Pool({
  connectionString,
  ssl,
  max: Number(process.env.PG_POOL_MAX || 5),
  // Neon can idle a connection away; keep the pool from holding dead sockets.
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// A pool error on an *idle* client would otherwise crash the process.
pool.on("error", (err) => console.error("Unexpected idle Postgres client error:", err.message));

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
