-- Shibka schema. Every statement is idempotent so migrate.js can run it on
-- every deploy. One row per account; the player's all-time best lives on the
-- user row (the leaderboard is just an ORDER BY over it).

CREATE TABLE IF NOT EXISTS users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username      TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,
  display_name  TEXT        NOT NULL,
  best_score    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive unique usernames without needing the citext extension.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (lower(username));

-- Leaderboard reads scan highest scores first.
CREATE INDEX IF NOT EXISTS users_best_score_idx ON users (best_score DESC);
