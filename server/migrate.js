// migrate.js — apply schema.sql. Idempotent (all CREATE ... IF NOT EXISTS), so
// it's safe to run on every deploy. Run with: npm run migrate
"use strict";

const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("Shibka schema applied.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
