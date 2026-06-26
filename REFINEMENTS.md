# Cadabra — Refinements v2 (READ FIRST, overrides where in conflict)

A previous session produced a partial implementation under `plugin/` (runtime template,
scaffold/screenshot/serve/verify scripts, an MCP driver, example screenshots). **Review that
work and REFACTOR it to match the refinements below — don't start from scratch, but don't
preserve choices these refinements override.** Read `AGENT_BRIEF.md` and
`ASSEMBLY_DESIGNER_PLUGIN.md` for the rest; this file takes precedence on conflicts.

## R1 — Workflow starts with requirements gathering → a LIVING project document
The skill workflow must begin by **interviewing the user for all project context**: source/
reference material, links, images, intended use case, material(s), dimensions, fabrication
process, constraints, aesthetic. Capture it into a **living `PROJECT.md`** inside the
generated project. This document is the durable source of truth **across multiple agent
sessions** — assume a project spans many sessions and you cannot rely on conversation context
carrying over. It must be **updated whenever requirements/decisions evolve**. Order:
**gather requirements → write/update PROJECT.md → develop the initial `model.js` schema →
interactive iteration.**

## R2 — The plugin is GENERIC scaffolding; no project-specific config in it
The shipped plugin must contain **no crystal/project-specific configuration**. The scaffold
template `model.js` is a **generic, minimal stub** (a tiny example part + heavily-commented
guidance) that the agent fills in/extends per project. Move the **crystal + base** model to a
separate **`examples/crystal/`** (reference + for verifying the runtime), NOT the default
template. Runtime/theme are generic; only `model.js` is authored per project.

## R3 — Ship as a proper Claude Code plugin WITH a marketplace
Structure it as an installable Claude Code plugin: the plugin manifest + a
`.claude-plugin/marketplace.json` (marketplace) so it can be added/installed the standard way.
Include the skill(s), scaffold script, and runtime template as plugin resources. Verify the
manifest/marketplace JSON is well-formed.

## R4 — NO server by default — standalone local HTML file + Reload button
Remove the mandatory node server. The default experience: the agent scaffolds, the user
**double-clicks the HTML file** (`file://`) and the CAD UI appears; they edit `model.js` and
click a **Reload button** (`location.reload()`) to see changes. Make this work from `file://`:
- Load `runtime.js` + `model.js` as **classic scripts** (attach globals, e.g. `window.MODEL`,
  `window.CADABRA`), NOT local ES modules (Chrome blocks local module imports over file://).
- Load three.js / libs from **CDN over https** (works from file://).
- **Kernel tier**: lazy-load replicad via dynamic `import()` of its CDN URL; load its WASM
  from the **CDN** (works from file://); run the kernel in a **Blob-URL Web Worker** (plain
  `new Worker('file.js')` is blocked from file://, but Blob/data-URL workers are allowed) so
  solves don't block the UI.
- A server is genuinely **not required** even for heavy kernel work (CDN wasm + Blob worker
  cover it). Keep at most an optional `npx serve` note in docs as a fallback; nothing depends
  on it. Delete/quarantine the bespoke `serve.mjs` from the default path.
Prioritise a streamlined ideation→UI path: scaffold → open file → edit `model.js` → Reload.

## R5 — Screenshots are occasional, not central
In practice the agent understands the design well from the geometry code itself. Screenshots
are only needed to resolve specific visual issues or when the user wants the agent to view/
comment on a particular view. So:
- Keep a **lightweight on-demand** screenshot path (the `window.__app.screenshot()` hook plus
  a simple Playwright-against-`file://` capture script the agent runs only when needed).
- **Do not** build the workflow or tooling around screenshots. Drop the persistent MCP server
  as a requirement (its main justification — a warm kernel for frequent screenshots — is gone
  with no-server + occasional screenshots). Prefer simple CLI scripts over an MCP server; MCP
  is optional, not core.

## Net effect on deliverables (priority order)
1. **Generic runtime template** (file://-ready: classic scripts + globals + Reload button),
   with the crystal+base moved to `examples/crystal/` and a generic stub `model.js` template.
2. **Scaffold script** that stamps out a new project (runtime + theme + stub model.js +
   `PROJECT.md` template + `exports/`).
3. **The skill** implementing R1's gather→PROJECT.md→schema→iterate workflow, the tier rule,
   the self-review checklist, and fabrication profiles.
4. **Claude Code plugin + marketplace** packaging (R3) with a clear README.
5. **Lightweight on-demand screenshot script** (R5). MCP optional.

## Verify
Use the on-demand Playwright `file://` script to confirm the **generic stub** project and the
**examples/crystal** project both render without console errors, keep `window.__app`, and
round-trip a config save/load. Be honest about what's verified vs. stubbed in your final
report. Remember: Write/Edit/Read tools work for this directory; Bash that WRITES here needs
`dangerouslyDisableSandbox: true`.
