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

  function localBest() {
    return Number(localStorage.getItem("shibka_best") || 0);
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
      const label = document.createElement("span");
      label.className = "account-label";
      label.textContent = "Save your best score";
      const row = document.createElement("div");
      row.className = "account-actions";
      row.append(
        button("Log in", "btn-mini", () => openAuth("login")),
        button("Sign up", "btn-mini btn-ghost", () => openAuth("signup"))
      );
      accountEl.append(label, row);
    }
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
    // If a guest earned a higher best before logging in, push it up to the account.
    const lb = localBest();
    if (me && lb > me.best) {
      try {
        const { best } = await api("/score", { method: "POST", body: { score: lb } });
        me.best = best;
      } catch (_) {}
    }
    if (me) setGameBest(me.best); // reflect the account's best in the game header
    loadLeaderboard();
  }

  window.addEventListener("shibka:gameover", async (e) => {
    const score = e.detail && e.detail.score;
    if (!me || typeof score !== "number") return;
    try {
      const { best } = await api("/score", { method: "POST", body: { score } });
      me.best = best;
      setGameBest(best);
      loadLeaderboard();
    } catch (_) {
      // offline / not signed in — the localStorage best already holds it
    }
  });

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
  }

  boot();
})();
