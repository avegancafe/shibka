// worker/db.js — Postgres access for the Worker, via Neon's HTTP driver.
//
// Replaces the old node-postgres pool (server/db.js). There are no long-lived
// sockets in a Worker, so there is no pool to keep: the HTTP driver is stateless
// and each query is one fetch to Neon's SQL-over-HTTP endpoint. TLS is handled by
// that fetch, so the old PGSSL / sslmode juggling is gone here (it survives in
// db/migrate.js, which still speaks the wire protocol from Node).
//
// query() returns `{ rows }` exactly like pg's did, so the route code ported over
// from Express unchanged.
import { neon } from "@neondatabase/serverless";

// NeonDbError carries the Postgres SQLSTATE on `.code`; some transport failures
// nest the original under `.sourceError`. Route code switches on err.code (e.g.
// "23505", the unique violation the signup handler turns into a 409), so make
// sure the code is visible on the error we rethrow either way.
function withPgCode(err) {
  const code = (err && err.code) || (err && err.sourceError && err.sourceError.code);
  if (!code || err.code === code) return err;
  try {
    err.code = code;
    if (err.code === code) return err;
  } catch {
    /* non-writable — fall through to a copy */
  }
  const copy = new Error((err && err.message) || String(err));
  copy.code = code;
  copy.cause = err;
  return copy;
}

export function createDb(env) {
  // Constructed lazily so a request that never touches the database (the common
  // GET /api/me with no session cookie) does no setup and needs no DATABASE_URL.
  let sql = null;

  return {
    async query(text, params) {
      if (!sql) {
        if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
        // fullResults so the result object looks like pg's ({ rows, rowCount, ... }).
        sql = neon(env.DATABASE_URL, { fullResults: true });
      }
      try {
        return await sql.query(text, params);
      } catch (err) {
        throw withPgCode(err);
      }
    },
  };
}
