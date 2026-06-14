// auth.js — accounts, best-score sync, and the global leaderboard.
//
// This is a *progressive enhancement* over the game: the game itself stays
// fully client-side and offline-capable (golden rule #1). Every network call
// here degrades gracefully — if the API is unreachable (offline, or running the
// static files with no backend) you simply play as a guest with a localStorage
// best, exactly like before.
(function () {
  "use strict";

  // ---- API helper ----------------------------------------------------------
  async function api(path, opts) {
    opts = opts || {};
    const res = await fetch("/api" + path, {
      method: opts.method || "GET",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {}
    if (!res.ok) throw new Error((data && data.error) || "Request failed (" + res.status + ").");
    return data;
  }

  // ---- state ---------------------------------------------------------------
  let me = null; // { username, displayName, best } when signed in
  const accountEl = document.getElementById("account");
  const lbListEl = document.getElementById("leaderboard-list");
  const lbMeEl = document.getElementById("leaderboard-me");

  // TEMPORARY (migration bridge): when a score handed off from the old origin
  // actually raised a *guest's* best, we highlight the account widget to invite
  // them to claim it on the leaderboard. Persistent + dismissible (not a toast).
  let importNudgeActive = false;
  let importNudgeDismissed = false;

  // The offline score queue (scores.js) is the local source of truth for scores:
  // it holds the player's best plus any runs not yet accepted by the server.
  const SCORES = window.SHIBKA_SCORES;

  // Drain the queue to the server. Only signed-in users have a destination, and
  // only the highest pending run matters (the server folds it in with GREATEST),
  // so one POST clears the queue. On failure it stays queued — retried on the
  // `online` event, the next game over, and the next boot. A guard prevents the
  // overlapping triggers from double-submitting.
  let flushing = false;
  async function flushScores() {
    if (flushing || !me || !SCORES) return;
    const pending = SCORES.pendingMax();
    if (!pending) return;
    flushing = true;
    try {
      const { best } = await api("/score", { method: "POST", body: { score: pending } });
      SCORES.markSynced(pending, best);
      me.best = best;
      setGameBest(best);
      loadLeaderboard();
    } catch (_) {
      // offline / server unreachable — the run stays queued for a later retry
    } finally {
      flushing = false;
    }
  }

  function setGameBest(n) {
    if (window.__SHIBKA && typeof window.__SHIBKA.setBest === "function") {
      window.__SHIBKA.setBest(n);
    }
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  // ---- account widget ------------------------------------------------------
  function renderAccount() {
    if (!accountEl) return;
    accountEl.innerHTML = "";
    if (me) {
      const who = document.createElement("div");
      who.className = "account-who";
      who.innerHTML =
        '<span class="account-label">Playing as</span>' +
        '<span class="account-name">' +
        esc(me.displayName) +
        "</span>";
      const row = document.createElement("div");
      row.className = "account-actions";
      const profile = button("Profile", "btn-mini", openProfile);
      const logout = button("Log out", "btn-mini btn-ghost", doLogout);
      row.append(profile, logout);
      accountEl.append(who, row);
    } else {
      const nudging = importNudgeActive && !importNudgeDismissed;
      accountEl.classList.toggle("account-import", nudging);
      const label = document.createElement("span");
      label.className = "account-label";
      if (nudging) {
        // Quote the LIVE best (never the raw imported value) so the number is
        // always the one actually showing in the header.
        const b = SCORES ? SCORES.best() : 0;
        label.innerHTML =
          "🐾 Your best of <strong>" +
          b.toLocaleString() +
          "</strong> came over from the old site — create an account to claim your spot on the leaderboard.";
      } else {
        label.textContent = "Save your best score";
      }
      const row = document.createElement("div");
      row.className = "account-actions";
      row.append(
        button("Log in", "btn-mini", () => openAuth("login")),
        button("Sign up", "btn-mini btn-ghost", () => openAuth("signup"))
      );
      accountEl.append(label, row);
      if (nudging) {
        accountEl.append(
          button("Maybe later", "linklike account-import-dismiss", () => {
            importNudgeDismissed = true;
            renderAccount();
          })
        );
      }
    }
  }

  // TEMPORARY (migration bridge): surface the imported score once auth state is
  // known. Only when the import actually raised the best — a lower import that
  // record() dropped changes nothing, so we say nothing. Signed-in users already
  // had it flushed to their account in onAuthenticated(), so stay quiet for them;
  // only guests get the persistent claim nudge.
  function maybeImportNudge() {
    const info = SCORES && SCORES.importInfo && SCORES.importInfo();
    if (!info || !info.raisedBest) return;
    if (me) return; // already flushed to the account; header + leaderboard reflect it
    importNudgeActive = true;
    renderAccount();
  }

  function button(text, cls, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  // ---- modal plumbing ------------------------------------------------------
  let modalRoot = null;
  function ensureModalRoot() {
    if (modalRoot) return modalRoot;
    modalRoot = document.createElement("div");
    modalRoot.className = "auth-overlay hidden";
    modalRoot.addEventListener("mousedown", (e) => {
      if (e.target === modalRoot) closeModal();
    });
    document.body.appendChild(modalRoot);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
    return modalRoot;
  }
  function openModal(node) {
    closeMenu(); // never stack the dropdown behind the auth/profile modal
    const root = ensureModalRoot();
    root.innerHTML = "";
    root.appendChild(node);
    root.classList.remove("hidden");
    const first = node.querySelector("input");
    if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() {
    if (modalRoot) modalRoot.classList.add("hidden");
  }

  function card(title) {
    const c = document.createElement("div");
    c.className = "auth-card";
    const h = document.createElement("h2");
    h.textContent = title;
    c.appendChild(h);
    return c;
  }
  function field(labelText, type, name, attrs) {
    const wrap = document.createElement("label");
    wrap.className = "auth-field";
    const span = document.createElement("span");
    span.textContent = labelText;
    const input = document.createElement("input");
    input.type = type;
    input.name = name;
    Object.assign(input, attrs || {});
    wrap.append(span, input);
    return { wrap, input };
  }
  function errorLine() {
    const e = document.createElement("p");
    e.className = "auth-error";
    return e;
  }

  // ---- login / signup modal ------------------------------------------------
  function openAuth(mode) {
    const c = card(mode === "signup" ? "Create your account" : "Welcome back");
    const form = document.createElement("form");
    const err = errorLine();

    const username = field("Username", "text", "username", {
      autocomplete: "username",
      maxLength: 20,
      required: true,
    });
    const display =
      mode === "signup"
        ? field("Display name", "text", "displayName", { maxLength: 30, required: true })
        : null;
    const password = field("Password", "password", "password", {
      autocomplete: mode === "signup" ? "new-password" : "current-password",
      required: true,
    });

    form.appendChild(username.wrap);
    if (display) form.appendChild(display.wrap);
    form.appendChild(password.wrap);
    if (mode === "signup") {
      const hint = document.createElement("p");
      hint.className = "auth-hint";
      hint.textContent = "Your display name is what shows on the leaderboard. Password: 8+ characters.";
      form.appendChild(hint);
    }
    form.appendChild(err);

    const submit = button(mode === "signup" ? "Create account" : "Log in", "btn auth-submit", () => {});
    submit.type = "submit";
    form.appendChild(submit);

    const toggle = document.createElement("p");
    toggle.className = "auth-toggle";
    if (mode === "signup") {
      toggle.innerHTML = "Already have an account? ";
      toggle.appendChild(button("Log in", "linklike", () => openAuth("login")));
    } else {
      toggle.innerHTML = "New here? ";
      toggle.appendChild(button("Create an account", "linklike", () => openAuth("signup")));
    }
    form.appendChild(toggle);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = "";
      submit.disabled = true;
      try {
        const body = {
          username: username.input.value.trim(),
          password: password.input.value,
        };
        if (mode === "signup") body.displayName = display.input.value;
        const { user } = await api(mode === "signup" ? "/signup" : "/login", {
          method: "POST",
          body,
        });
        me = user;
        closeModal();
        await onAuthenticated();
      } catch (ex) {
        err.textContent = ex.message;
        submit.disabled = false;
      }
    });

    c.appendChild(form);
    openModal(c);
  }

  // ---- profile modal -------------------------------------------------------
  function openProfile() {
    if (!me) return;
    const c = card("Your profile");

    // Display name
    const dnForm = document.createElement("form");
    const dnErr = errorLine();
    const dnOk = okLine();
    const dn = field("Display name", "text", "displayName", { maxLength: 30, required: true });
    dn.input.value = me.displayName;
    const dnSave = button("Save name", "btn auth-submit", () => {});
    dnSave.type = "submit";
    dnForm.append(dn.wrap, dnErr, dnOk, dnSave);
    dnForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      dnErr.textContent = "";
      dnOk.textContent = "";
      dnSave.disabled = true;
      try {
        const { user } = await api("/profile", { method: "PATCH", body: { displayName: dn.input.value } });
        me = user;
        dnOk.textContent = "Saved.";
        renderAccount();
        loadLeaderboard();
      } catch (ex) {
        dnErr.textContent = ex.message;
      } finally {
        dnSave.disabled = false;
      }
    });

    // Password change
    const pwForm = document.createElement("form");
    const pwErr = errorLine();
    const pwOk = okLine();
    const cur = field("Current password", "password", "currentPassword", { autocomplete: "current-password" });
    const next = field("New password", "password", "newPassword", { autocomplete: "new-password" });
    const pwSave = button("Change password", "btn btn-ghost auth-submit", () => {});
    pwSave.type = "submit";
    pwForm.append(cur.wrap, next.wrap, pwErr, pwOk, pwSave);
    pwForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      pwErr.textContent = "";
      pwOk.textContent = "";
      pwSave.disabled = true;
      try {
        await api("/profile", {
          method: "PATCH",
          body: { currentPassword: cur.input.value, newPassword: next.input.value },
        });
        pwOk.textContent = "Password changed.";
        cur.input.value = "";
        next.input.value = "";
      } catch (ex) {
        pwErr.textContent = ex.message;
      } finally {
        pwSave.disabled = false;
      }
    });

    const sep = document.createElement("hr");
    sep.className = "auth-sep";
    const sub = document.createElement("p");
    sub.className = "auth-hint";
    sub.textContent = "Change your password";

    const close = button("Done", "linklike auth-close", closeModal);

    c.append(dnForm, sep, sub, pwForm, close);
    openModal(c);
  }

  function okLine() {
    const e = document.createElement("p");
    e.className = "auth-ok";
    return e;
  }

  async function doLogout() {
    try {
      await api("/logout", { method: "POST" });
    } catch (_) {}
    me = null;
    renderAccount();
    loadLeaderboard();
  }

  // ---- leaderboard ---------------------------------------------------------
  async function loadLeaderboard() {
    if (!lbListEl) return;
    try {
      const { leaderboard, me: standing } = await api("/leaderboard");
      renderLeaderboard(leaderboard, standing);
    } catch (_) {
      lbListEl.innerHTML = '<li class="lb-empty">Leaderboard unavailable offline.</li>';
      if (lbMeEl) lbMeEl.textContent = "";
    }
  }
  function renderLeaderboard(rows, standing) {
    lbListEl.innerHTML = "";
    if (!rows || !rows.length) {
      lbListEl.innerHTML = '<li class="lb-empty">No scores yet — be the first!</li>';
    } else {
      const mineName = me && me.displayName;
      for (const r of rows) {
        const li = document.createElement("li");
        li.className = "lb-row";
        if (mineName && r.displayName === mineName && standing && r.rank === standing.rank) {
          li.classList.add("lb-mine");
        }
        li.innerHTML =
          '<span class="lb-rank">' +
          r.rank +
          '</span><span class="lb-name">' +
          esc(r.displayName) +
          '</span><span class="lb-score">' +
          r.best.toLocaleString() +
          "</span>";
        lbListEl.appendChild(li);
      }
    }
    if (lbMeEl) {
      if (standing && standing.rank && !inTop(rows, standing.rank)) {
        lbMeEl.textContent = "You: #" + standing.rank + " · " + standing.best.toLocaleString();
      } else {
        lbMeEl.textContent = "";
      }
    }
  }
  function inTop(rows, rank) {
    return rows.some((r) => r.rank === rank);
  }

  // ---- reconcile on auth + sync on game over -------------------------------
  async function onAuthenticated() {
    renderAccount();
    // Reflect the account's best in the game header (raises display + pins it in
    // the queue as a synced high-water; never lowers a higher locally-earned one).
    if (me) setGameBest(me.best);
    // Push any queued runs the guest earned before signing in up to the account.
    await flushScores();
    loadLeaderboard();
  }

  window.addEventListener("shibka:gameover", (e) => {
    const score = e.detail && e.detail.score;
    // Always record the run locally first (durable even as a guest / offline);
    // game.js already records new bests live, so this is idempotent. Then try to
    // publish right away if we're signed in and online.
    if (typeof score === "number" && SCORES) SCORES.record(score);
    flushScores();
  });

  // When connectivity returns, drain anything that piled up while offline.
  window.addEventListener("online", flushScores);

  // ---- menu-bar dropdown (mobile) -----------------------------------------
  // On narrow screens the account widget + leaderboard live behind a hamburger
  // in the menu bar; on wide screens they stay in their rails (the desktop
  // layout is unchanged). We relocate the SAME nodes — ids preserved, so every
  // render/sync path above is unaffected — between #menu-panel and their home
  // positions as the viewport crosses the 860px breakpoint.
  const menuToggle = document.getElementById("menu-toggle");
  const menuPanel = document.getElementById("menu-panel");
  const lbSection = document.getElementById("leaderboard");
  const mobileMQ = window.matchMedia("(max-width: 859.98px)");

  function homeOf(el) {
    return el ? { parent: el.parentNode, next: el.nextSibling } : null;
  }
  const accountHome = homeOf(accountEl);
  const lbHome = homeOf(lbSection);

  // Move the widgets into the dropdown on mobile; restore them to their rail
  // homes on desktop. Idempotent — safe to call on every breakpoint change.
  function placeWidgets(isMobile) {
    if (!menuPanel) return;
    if (isMobile) {
      if (accountEl) menuPanel.appendChild(accountEl);
      if (lbSection) menuPanel.appendChild(lbSection);
    } else {
      if (accountEl && accountHome) accountHome.parent.insertBefore(accountEl, accountHome.next);
      if (lbSection && lbHome) lbHome.parent.insertBefore(lbSection, lbHome.next);
      closeMenu();
    }
  }

  let menuOpen = false;
  function openMenu() {
    if (!menuPanel || menuOpen) return;
    menuOpen = true;
    menuPanel.classList.remove("hidden");
    if (menuToggle) menuToggle.setAttribute("aria-expanded", "true");
    loadLeaderboard(); // refresh the board each time it is revealed
    document.addEventListener("mousedown", onOutsideDown, true);
  }
  function closeMenu() {
    if (!menuPanel || !menuOpen) return;
    menuOpen = false;
    menuPanel.classList.add("hidden");
    if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onOutsideDown, true);
  }
  function onOutsideDown(e) {
    if (menuPanel.contains(e.target) || (menuToggle && menuToggle.contains(e.target))) return;
    closeMenu();
  }

  function setupMenu() {
    if (!menuToggle || !menuPanel) return;
    placeWidgets(mobileMQ.matches);
    const onMQ = (e) => placeWidgets(e.matches);
    if (mobileMQ.addEventListener) mobileMQ.addEventListener("change", onMQ);
    else if (mobileMQ.addListener) mobileMQ.addListener(onMQ); // older Safari
    menuToggle.addEventListener("click", () => (menuOpen ? closeMenu() : openMenu()));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });
  }

  // ---- boot ----------------------------------------------------------------
  async function boot() {
    renderAccount(); // show the logged-out widget immediately (works offline)
    loadLeaderboard(); // best-effort
    try {
      const { user } = await api("/me"); // 200 with user=null when signed out
      if (user) {
        me = user;
        await onAuthenticated();
      }
    } catch (_) {
      // offline / no backend — stay a guest
      me = null;
      renderAccount();
    }
    maybeImportNudge(); // after `me` is resolved (migration bridge)
  }

  setupMenu();
  boot();
})();
