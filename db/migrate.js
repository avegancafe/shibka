// db/migrate.js — apply db/schema.sql. Idempotent (every statement is
// CREATE ... IF NOT EXISTS), so it's safe to run on every deploy.
//
// Node-only: this speaks the Postgres wire protocol via `pg` and never runs
// inside the Worker (the Worker talks to Neon over HTTP and never migrates).
// Run with: npm run migrate
//
// TLS, carried over from the old server/db.js:
//   PGSSL unset      -> TLS with full certificate verification (correct for Neon;
//                       Neon serves a publicly-trusted cert). Most secure.
//   PGSSL=no-verify  -> TLS but don't verify the cert (self-signed servers).
//   PGSSL=disable    -> no TLS at all (local non-TLS Postgres / dev container).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error("FATAL: DATABASE_URL is not set. See .dev.vars.example.");
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
} catch {
  /* leave as-is */
}

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = readFileSync(path.join(here, "schema.sql"), "utf8");
  const client = new pg.Client({ connectionString, ssl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Shibka schema applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
