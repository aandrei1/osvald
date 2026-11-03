---
name: logical-commits
description: Split the current uncommitted changes into small, logical commits, each with its own message, then commit them. Use when the user invokes /logical-commits or asks to break the working tree into separate commits.
---

# Logical commits

Turn the working tree (staged, unstaged and untracked changes) into a sequence of small, self-contained commits and create them.

## 1. Inspect

Run in parallel:

- `git status --porcelain=v1 -uall`
- `git diff` and `git diff --cached`
- `git log --oneline -15` (to match the repo's message style)

Read every untracked file before committing it. Never commit secrets (`.env`, keys, credentials) or build output; if something looks like it should not be committed, leave it out and say so.

If there is something already staged, treat it as a hint about the user's intended grouping, not as a fixed commit.

## 2. Group

One commit = one reason to change. Group by intent, not by folder:

- A feature that spans `packages/shared` → backend → frontend can be one commit, or one per layer if each layer is meaningful on its own. Prefer per-layer when the diff is large.
- Keep together what must land together: a schema change with its Drizzle migration (`drizzle/*.sql` + `drizzle/meta/*`), code with its tests, a new export with its first consumer.
- Separate refactors, fixes, chores (config, deps, tooling) and docs from feature work.
- Order commits so each one typechecks on its own where reasonably possible: shared before backend/frontend, new modules before the code that imports them.

A single file may be split across commits when its hunks serve different purposes. Do it with a patch, never interactive mode (`-i`/`-p` are unavailable):

```sh
git diff -- path/to/file > "$SCRATCH/full.patch"
# write a patch with only the wanted hunks to "$SCRATCH/part.patch"
git apply --cached --check "$SCRATCH/part.patch" && git apply --cached "$SCRATCH/part.patch"
```

Use the session scratchpad for patch files. Only split a file when the hunks are genuinely unrelated; otherwise keep the file whole.

## 3. Messages

Conventional Commits, in English, matching the existing log:

```
<type>(<scope>): <imperative summary, lowercase, no period, ≤ 72 chars>

<optional body: why, not what; wrap at 72>

<attribution trailer from the system reminder, if any>
```

- `type`: feat, fix, refactor, test, docs, chore, perf, build, ci.
- `scope`: package or area (`shared`, `backend`, `frontend`, `db`, `make`, …); omit when it spans everything.
- Add a body only when the reason is not obvious from the summary.

## 4. Commit

Show the plan briefly (one line per commit: message + files), then commit right away; the invocation is the approval.

For each commit:

1. `git reset -q` to clear the index (only before the first commit if the index held something you regrouped).
2. `git add -- <files>` (or `git apply --cached` for partial files).
3. `git diff --cached --stat` to confirm exactly what is staged.
4. `git commit -F "$SCRATCH/msg.txt"` (write the message to a file to keep formatting intact).

Rules:

- Never use `--no-verify`, `--amend` on existing commits, or force operations. If a hook fails, fix the cause or report it and stop.
- Never push.
- On `main`, commit directly unless the user asked for a branch.

## 5. Report

Finish with `git log --oneline -<n>` for the new commits and `git status --short`. Mention anything left uncommitted and why.
