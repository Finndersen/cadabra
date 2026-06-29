---
name: update-project
description: >-
  Apply a Cadabra runtime update to an existing project. Use when the user
  confirms they want to update after being told a newer runtime is available,
  or when a version mismatch has been detected and the user wants to proceed.
---

# Cadabra — update project runtime

This skill applies a pending runtime update to an existing Cadabra project.
Run it only after confirming with the user that they want to update.

`${CLAUDE_PLUGIN_ROOT}` is the Cadabra plugin root.

> **Sandbox:** `verify.mjs` launches a headless browser via Playwright. If it
> fails with a permission or operation-not-permitted error, re-run it with the
> Claude sandbox disabled.

## Step 1 — Check what will change

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade_runtime.mjs --dir <project-dir> --check
```

Read the output. It reports the current and target version and prints the
changelog for the gap. Determine whether this is a same-major or major upgrade.

## Step 2a — Same-major upgrade (patch or minor)

Safe to apply directly — no model.js changes required:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade_runtime.mjs --dir <project-dir>
```

The script copies the runtime files and prints the changelog. It never touches
`model.js` or `PROJECT.md`. Summarise what changed to the user, then verify:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs <project-dir>/index.html
```

Done. Tell the user what was updated.

## Step 2b — Major-version upgrade

**Do not run `--force-major` yet.** Major upgrades require manual migration steps
before the runtime files are copied. Follow these steps exactly:

1. **Apply every migration step** from the `--check` output above. These are
   concrete file operations (moving files, updating paths, renaming fields in
   `model.js`, etc.) — execute each one now, in order, before proceeding.

2. **Update `PROJECT.md`'s decision log** with a note: what changed and why.

3. **Copy the new runtime files:**
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/upgrade_runtime.mjs --dir <project-dir> --force-major
   ```

4. **Verify:**
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs <project-dir>/index.html
   ```

5. Tell the user what changed and confirm the app looks correct. Take a
   screenshot if there's any visual uncertainty.

## If verify fails

Check the browser console output reported by verify.mjs. Common causes:
- A field rename in model.js was missed — re-read the migration notes.
- A `build()` return shape changed — check the Part object contract in
  `${CLAUDE_PLUGIN_ROOT}/skills/setup-new-project/reference.md`.
- A `window.__app` method was called on the old API — check the hook section
  in the same reference doc.

Fix the issue and re-run verify before reporting success to the user.
