// leaderboard.js — the dedicated /leaderboard page: search + pagination over the
// global ranking. Vanilla, no build. Talks to GET /api/leaderboard (which returns
// {leaderboard, total, page, limit, me}); every row carries its true GLOBAL rank,
// so searching/paging still shows real standings. Degrades gracefully offline.
(function () {
  "use strict";

  const listEl = document.getElementById("lbpage-list");
  const searchEl = document.getElementById("lb-search");
  const formEl = document.getElementById("lb-search-form");
  const pagerEl = document.getElementById("lb-pager");
  const prevEl = document.getElementById("lb-prev");
  const nextEl = document.getElementById("lb-next");
  const statusEl = document.getElementById("lb-status");

  const LIMIT = 25;
  let page = 1;
  let q = "";
  let loading = false;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  async function load() {
    if (loading) return;
    loading = true;
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (q) params.set("q", q);
      const res = await fetch("/api/leaderboard?" + params.toString(), { credentials: "same-origin" });
      if (!res.ok) throw new Error("status " + res.status);
      render(await res.json());
    } catch (_) {
      listEl.innerHTML = '<li class="lb-empty">Leaderboard unavailable right now.</li>';
      pagerEl.hidden = true;
    } finally {
      loading = false;
    }
  }

  function render(data) {
    const rows = (data && data.leaderboard) || [];
    const total = (data && data.total) || 0;
    const me = data && data.me;

    if (!rows.length) {
      listEl.innerHTML = q
        ? '<li class="lb-empty">No players match “' + esc(q) + '”.</li>'
        : '<li class="lb-empty">No scores yet — be the first!</li>';
    } else {
      listEl.innerHTML = rows
        .map((r) => {
          const mine = me && me.rank === r.rank && me.displayName === r.displayName;
          return (
            '<li class="lb-row' + (mine ? " lb-mine" : "") + '">' +
            '<span class="lb-rank">' + r.rank + "</span>" +
            '<span class="lb-name">' + esc(r.displayName) + "</span>" +
            '<span class="lb-score">' + Number(r.best).toLocaleString() + "</span></li>"
          );
        })
        .join("");
    }

    const pages = Math.max(1, Math.ceil(total / LIMIT));
    if (total > LIMIT || page > 1) {
      pagerEl.hidden = false;
      prevEl.disabled = page <= 1;
      nextEl.disabled = page >= pages;
      const start = total ? (page - 1) * LIMIT + 1 : 0;
      const end = Math.min(page * LIMIT, total);
      statusEl.textContent = total ? start + "–" + end + " of " + total.toLocaleString() : "";
    } else {
      pagerEl.hidden = true;
    }
  }

  let debounce = null;
  searchEl.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const v = searchEl.value.trim();
      if (v === q) return;
      q = v;
      page = 1;
      load();
    }, 300);
  });
  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    clearTimeout(debounce);
    q = searchEl.value.trim();
    page = 1;
    load();
  });
  prevEl.addEventListener("click", () => {
    if (page > 1) {
      page--;
      load();
      window.scrollTo(0, 0);
    }
  });
  nextEl.addEventListener("click", () => {
    page++;
    load();
    window.scrollTo(0, 0);
  });

  load();
})();
