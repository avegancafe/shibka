// scores.js — Shibka's offline-first score queue (window.SHIBKA_SCORES).
//
// A durable, offline-capable store of completed-game results that haven't yet
// been confirmed by the server. It is the *local source of truth* for the
// player's best score: with no account or no connection a guest's displayed best
// is just the max over this queue, and the moment they're signed in and online
// the account layer (auth.js) flushes the queue to POST /api/score (which the
// server folds in with GREATEST). This replaces the old bare `shibka_best`
// localStorage key — that value is migrated into the queue on first load and the
// key is then deleted (one-time, see migrate()).
//
// Like everything in the game, this is offline-first and must never depend on the
// backend: it just accumulates locally and drains opportunistically.
//
// Persisted as one JSON array under localStorage "shibka_scores":
//   [ { score:Number, at:Number, synced:Boolean }, ... ]
// Invariants (kept by every mutator, which then compacts):
//   * best()       = max score over all entries  (display source; never drops)
//   * pendingMax() = max score over synced:false entries, or 0  (what we owe)
// The array is kept tiny: at most one synced "high-water" entry (so the displayed
// best survives a flush + reload with an empty pending queue) plus the highest
// unsynced run waiting to go up. Only the maximum can ever move the server's
// GREATEST, so lower unsynced runs are redundant and collapse away on write.
(function () {
  "use strict";

  const KEY = "shibka_scores";
  const LEGACY_KEY = "shibka_best";
  // TEMPORARY (old-origin migration bridge): the inline reader in index.html
  // stashes a best handed off from avegancafe.github.io under this key. Remove
  // this + the inline reader when the bridge is retired — see DEPLOY.md.
  const IMPORT_KEY = "shibka_import_best";

  function load() {
    let arr = [];
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          arr = parsed
            .filter((e) => e && typeof e.score === "number" && isFinite(e.score) && e.score >= 0)
            .map((e) => ({ score: Math.floor(e.score), at: Number(e.at) || 0, synced: !!e.synced }));
        }
      }
    } catch (_) {
      // corrupt/blocked storage — start clean rather than throw on boot
    }
    return migrate(arr);
  }

  // One-time migration: fold a legacy `shibka_best` into the queue as an *unsynced*
  // run (so it publishes on the next online + signed-in flush, exactly like a fresh
  // result), then delete the legacy key. After this the queue is the only store.
  function migrate(arr) {
    let legacy = 0;
    try {
      legacy = Math.floor(Number(localStorage.getItem(LEGACY_KEY)) || 0);
    } catch (_) {}
    if (legacy > 0) arr.push({ score: legacy, at: Date.now(), synced: false });
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch (_) {}
    return arr;
  }

  function save(arr) {
    try {
      localStorage.setItem(KEY, JSON.stringify(arr));
    } catch (_) {
      // storage full / disabled — degrade to in-memory only (still works this session)
    }
  }

  // Keep the array minimal: the single highest synced entry (the displayed-best
  // high-water) plus the single highest unsynced entry. If the synced high-water
  // already covers the pending run, the pending run can't change anything on the
  // server, so drop it.
  function compact(arr) {
    let synced = null;
    let unsynced = null;
    for (const e of arr) {
      if (e.synced) {
        if (!synced || e.score > synced.score) synced = e;
      } else if (!unsynced || e.score > unsynced.score) {
        unsynced = e;
      }
    }
    if (synced && unsynced && unsynced.score <= synced.score) unsynced = null;
    const out = [];
    if (synced) out.push(synced);
    if (unsynced) out.push(unsynced);
    return out;
  }

  let state = compact(load());
  save(state);

  // One-time handoff from the old GitHub Pages origin (avegancafe.github.io).
  // TEMPORARY bridge code — remove when that bridge is retired (see DEPLOY.md).
  // The inline reader in index.html stashes the incoming best under IMPORT_KEY
  // (kept separate from the shibka_best/migrate path on purpose, so it can't
  // clobber a user's own legacy value). We consume it here, right after migrate(),
  // so game.js seeds the correct header best on first paint, and record() folds it
  // into the queue (GREATEST-idempotent — a lower import is dropped). `lastImport`
  // lets the account layer decide whether to surface a "claim it" nudge.
  let lastImport = null;
  (function consumeImport() {
    let n = 0;
    try {
      n = Math.floor(Number(localStorage.getItem(IMPORT_KEY)) || 0);
    } catch (_) {}
    try {
      localStorage.removeItem(IMPORT_KEY);
    } catch (_) {}
    if (n > 0 && n <= 100000000) {
      const before = best();
      record(n);
      lastImport = { value: n, raisedBest: best() > before };
    }
  })();

  function best() {
    let m = 0;
    for (const e of state) if (e.score > m) m = e.score;
    return m;
  }
  function pendingMax() {
    let m = 0;
    for (const e of state) if (!e.synced && e.score > m) m = e.score;
    return m;
  }

  // Record a completed run. Only a new local best can ever change the leaderboard,
  // so runs that don't beat best() are dropped. Local only — never touches the
  // network (flushing is the account layer's job).
  function record(score) {
    score = Math.floor(Number(score) || 0);
    if (score <= 0 || score <= best()) return best();
    state.push({ score: score, at: Date.now(), synced: false });
    state = compact(state);
    save(state);
    return best();
  }

  // The server accepted everything up to `submitted` and reports `serverBest`
  // (GREATEST of our submit and whatever the account already held). Mark the
  // pending runs synced and pin the server best as the synced high-water so the
  // displayed best survives a reload even though the pending queue is now empty.
  function markSynced(submitted, serverBest) {
    submitted = Math.floor(Number(submitted) || 0);
    serverBest = Math.floor(Number(serverBest) || 0);
    for (const e of state) if (!e.synced && e.score <= submitted) e.synced = true;
    const hw = Math.max(serverBest, submitted);
    if (hw > 0) state.push({ score: hw, at: Date.now(), synced: true });
    state = compact(state);
    save(state);
    return best();
  }

  // Adopt a server-known best (e.g. logging in on a fresh device, where the
  // account's best is higher than anything local) as a synced high-water so it
  // shows immediately and is never needlessly re-submitted. Never lowers anything.
  function adoptServerBest(b) {
    b = Math.floor(Number(b) || 0);
    if (b > 0) {
      state.push({ score: b, at: Date.now(), synced: true });
      state = compact(state);
      save(state);
    }
    return best();
  }

  window.SHIBKA_SCORES = {
    best: best,
    pendingMax: pendingMax,
    hasPending: function () {
      return pendingMax() > 0;
    },
    record: record,
    markSynced: markSynced,
    adoptServerBest: adoptServerBest,
    // One-shot info about a score handed off from the old origin this load, or
    // null. { value, raisedBest } — raisedBest is whether it actually beat the
    // local best. TEMPORARY (migration bridge).
    importInfo: function () {
      return lastImport;
    },
    // Inspection hook (handy in the console / QA).
    all: function () {
      return state.slice();
    },
  };
})();
