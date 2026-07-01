# Cadabra plugin — developer guide

> **What this plugin does:** See [`README.md`](README.md) for the full overview.
> In short: Cadabra is a Claude Code plugin that generates a bespoke, live,
> parametric CAD app per project — a self-contained folder the user opens by
> double-clicking `index.html`. The agent interviews the user, writes `model.js`
> (the parametric geometry), and iterates. No server required.

This repo contains the runtime template, skill documentation, scaffold script, and
worked examples that agents use to build those apps. This CLAUDE.md is for agents
**developing the plugin itself** — not for agents building a Cadabra project.

## Repository layout

```
plugin/
  skills/
    setup-new-project/
      SKILL.md        — triggers on new design requests; full new-project workflow
      reference.md    — model.js contract and recipes (read by agents)
    update-project/
      SKILL.md        — applies runtime upgrades; activated from project CLAUDE.md
  templates/runtime/  — THE CANONICAL RUNTIME (copied into each project)
    runtime.js        — Cadabra engine: build pipeline, three.js, exports, __app hook
    kernel.js         — replicad/OpenCASCADE WASM tier (Blob-URL Web Worker)
    index.html        — shell: importmap + CDN three.js bootstrap
    theme.css         — design tokens
    model.js          — generic scaffold stub (copied once; never overwritten)
  examples/
    crystal/          — direct-engine reference (flat acrylic panels + printed base)
    phone_case/       — kernel-engine reference (fillet + shell + boolean, STEP/STL)
  scripts/
    scaffold_project.mjs  — stamps out a new project (also writes project CLAUDE.md)
    upgrade_runtime.mjs   — upgrades an existing project's runtime files
    verify.mjs             — smoke-test gates + on-demand screenshot, over file://
  RUNTIME_CHANGELOG.md    — version history (READ THIS before modifying runtime files)
```

## Skill architecture

**`setup-new-project`** — fires on new design requests ("design a X", "model a
bracket"). Handles interview → plan confirmation → scaffold → model.js authoring
→ self-review → iterate. Does not handle existing projects.

**`update-project`** — activated from a project's `CLAUDE.md` when the agent
detects a runtime version mismatch and the user agrees to update. Handles same-
major (copy runtime files) and major-version (read migration notes, update
model.js, then copy) upgrade paths.

**Project `CLAUDE.md`** — bootstrapped by `scaffold_project.mjs` into every new
project. Contains the session-start checklist: read PROJECT.md, read model.js,
check runtime version with `upgrade_runtime.mjs --check`. If a newer runtime is
available, the agent tells the user and activates `update-project` if they agree.

## Before making any change to the runtime

Read `plugin/RUNTIME_CHANGELOG.md` first. It records what has changed in every
version and the migration strategy for breaking changes. After making your change,
you must update it (see below).

## Runtime versioning rules

The runtime version lives in one place:
`plugin/templates/runtime/runtime.js` → `window.CADABRA = { boot, version: "X.Y.Z" }`.

Every change to any of the 4 runtime template files (`runtime.js`, `kernel.js`,
`index.html`, `theme.css`) requires a version bump and a changelog entry.

| Change type | Bump | Changelog entry |
|---|---|---|
| Bug fix, no model.js API change | **patch** (0.4.0 → 0.4.1) | Short description, note "Auto-upgrade safe: yes" |
| New feature, backward-compatible model.js API | **minor** (0.4.0 → 0.5.0) | Describe feature, note "Auto-upgrade safe: yes" |
| Breaking change to model.js API | **MAJOR** (0.4.0 → 1.0.0) | Full migration guide (see below) |

**Never** bump the version without adding a changelog entry, and vice versa.

## Writing a changelog entry

Copy this template into `RUNTIME_CHANGELOG.md` above the previous latest entry:

```md
## X.Y.Z — YYYY-MM-DD — patch|minor|MAJOR

**Type:** patch|minor|MAJOR
**Auto-upgrade safe:** yes | no — reason
**model.js compatibility:** Fully backward-compatible. | Breaking: <what changed>.

### Changes
- Bullet list of what changed and why.

### Migration (MAJOR only)
Step-by-step guide for an agent upgrading an existing project's model.js.
Be concrete: name the fields/functions/keys that changed, show before/after.
The agent will read this and apply the steps to the project's model.js before
copying the new runtime files.
```

## What counts as a breaking change (MAJOR)

- Renaming or removing a field in the `window.MODEL` part schema (`id`, `engine`,
  `fab`, `params`, `build`, `transform`, `estimate`, `exportPieces`, `dependsOn`,
  `render`, `exports`).
- Changing the signature of `build()`, `transform()`, `estimate()`, or `exportPieces()`.
- Changing the shape of `BuildCtx` (the `ctx` argument) in a way that breaks
  existing `build()` or `estimate()` implementations.
- Removing or renaming anything in `window.__app` (the agent hook).
- Changing the format of the saved config JSON (`_app`, `_v`, `state`, `view`).

Renaming internal runtime variables, adding new optional fields to the schema,
adding new `window.__app` methods, or changing visual appearance are **not**
breaking — use minor or patch.

## Testing changes

After editing any runtime template file, run the verify script against a
scaffolded project to confirm it boots without errors:

```
node plugin/scripts/verify.mjs path/to/project/index.html
```

For thorough coverage, test against one direct-engine project and one
kernel-engine project (kernel requires CDN access). The script exits 0 on pass.

## Skill and reference documentation

Changes to `SKILL.md` and `reference.md` do not require a version bump (they are
not copied into projects). Keep them in sync with the runtime behaviour — if you
change how something works in `runtime.js`, update the relevant docs in the same
commit/session.
