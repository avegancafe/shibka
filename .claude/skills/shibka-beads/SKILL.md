---
name: shibka-beads
description: Use whenever working with beads / bd in the Shibka repo — any mention of "bd", "beads", "what's next", adding a task/epic, or issue tracking here. Explains this repo's beads setup (embedded Dolt in the main checkout), the shibka- ticket ID structure (epics + .N children), how to run bd from a git worktree, and what to check to confirm the workspace is wired up. Complements the global Beads Issue Tracking skill with repo-specific facts.
---

# Beads in the Shibka repo

This repo tracks all non-trivial work in **beads** (`bd`). Follow the global
*Beads Issue Tracking* workflow for the session loop (`bd prime`, `bd ready`,
create/claim/close, the push-to-remote completion flow); the facts below are the
**Shibka-specific** bits that workflow doesn't know.

## First: confirm beads is wired up here

Run these (read-only) before relying on the tracker:

```bash
bd version                      # CLI present (a Homebrew build is fine)
bd stats                        # totals — proves the DB resolves and has issues
bd config get export.auto       # expect: true   (auto-export to issues.jsonl)
bd config get export.interval   # e.g. 5s
ls .beads                       # embeddeddolt/  issues.jsonl  config.yaml  ...
```

If `.beads/` is **missing**, beads isn't initialized in this checkout — initialize
it from the **main checkout** (`bd init --prefix shibka`), not from a worktree
(see below).

## Storage & the `shibka-` ID structure

- The backend is **embedded Dolt**; the entire workspace lives in **`.beads/` at the
  repo root of the *main* checkout**. `.beads/` is **untracked** (git-ignored via its
  own `.beads/.gitignore`). The only human/`bv`-readable artifact is
  `.beads/issues.jsonl`, refreshed automatically (`export.auto=true`, ~5s).
- **Issue IDs are prefixed `shibka-`.** A new epic or standalone issue gets a random
  base id, e.g. `shibka-3zu`. **Child tasks created with `--parent <epic>` are
  numbered beneath it**: `shibka-3zu.1`, `shibka-3zu.2`, … — so a `.N` suffix always
  means "child of that epic". Typical epic + children:

  ```bash
  # epic (note: epics need a "## Success Criteria" section in --description)
  bd create --type epic -p 1 --title "…" \
    --description $'…\n\n## Success Criteria\n- …'
  # children (note: tasks need --acceptance so `bd lint -s all` stays green)
  bd create --parent shibka-3zu --type task -p 1 --title "…" --acceptance "…"
  bd dep add shibka-3zu.2 shibka-3zu.1   # sequence: .2 waits on .1
  ```

- Keep it lint-clean: every **task** needs `--acceptance`; every **epic** needs a
  `## Success Criteria` section. Verify with `bd lint -s all`.

## Using beads from a git worktree (important)

Claude Code creates worktrees **under `.claude/worktrees/<name>/`** — i.e. *nested
inside the main checkout*. Two consequences:

1. The `.beads/` DB exists **only in the main checkout**. It's untracked, so a fresh
   worktree branch does **not** carry its own copy, and
   `git rev-parse --show-toplevel` from the worktree returns the *worktree* path.
2. **Plain `bd …` still works from inside the worktree** anyway, because the worktree
   path is nested under the repo root, so `bd` walks up and resolves the one shared
   workspace. (Verified: `bd ready` run from `.claude/worktrees/<name>/` lists the
   same issues as from the main checkout.)

Practical rules:

- **Normally just run `bd …`** from wherever you are — including a worktree. It
  targets the single shared workspace in the main checkout.
- If you ever run `bd` from a worktree that is **not** nested under the main checkout
  (unusual with this harness), target it explicitly with `-C` (like `git -C`):

  ```bash
  bd -C /Users/kyle/workspace/shibka ready
  ```

- **Never `bd init` inside a worktree** — it would create a second, empty workspace
  and split the issue history.
- Beads state belongs to the **main checkout**, not your feature branch: don't commit
  `.beads/` churn onto a worktree branch. Let auto-export run, and before declaring
  work done force a fresh export so `bv` isn't stale:

  ```bash
  bd export -o .beads/issues.jsonl
  ```

## Day-to-day quick reference

```bash
bd ready --pretty                 # what's next (unblocked)
bd update <id> -s in_progress     # claim when you start
bd close <id> --reason "…"        # close when done (multiple ids ok)
bd dep add <issue> <depends-on>   # sequence work (issue waits on depends-on)
bd lint -s all                    # convention check before finishing
```
