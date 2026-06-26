# Cadabra — Build Brief (supplement to ASSEMBLY_DESIGNER_PLUGIN.md)

**Project name:** Cadabra (CAD + abracadabra — an AI agent that conjures a bespoke, live
parametric CAD app per project).

You are implementing this plugin. Read these in order:
1. **`ASSEMBLY_DESIGNER_PLUGIN.md`** — the full build-ready spec (architecture, tech stack,
   runtime↔model contract, skill workflow, MCP tools, build plan §11). This is your primary
   source of truth.
2. **`kernel_poc.html`** — the working, heavily-iterated proof-of-concept: the schema-driven
   runtime with the crystal + base assembly. Treat it as the reference implementation to
   **extract the runtime from** (spec §11, milestone 1).
3. **Reference article** (the inspiration): *"I Taught Claude to Design 3D-Printable Parts:
   Here's How"* — https://pub.towardsai.net/i-taught-claude-to-design-3d-printable-parts-heres-how-675f644af78a
   We adopt its interview → build → render-and-self-review → iterate loop and its
   Claude-skill packaging, and extend it with a **live user-controlled viewer**, a **two-tier
   (analytic + in-browser-kernel) engine**, and **fabrication-aware outputs**.

## Refinements in the POC that post-date / sharpen the spec — preserve these
The POC was debugged extensively; carry these behaviours into the extracted runtime verbatim
where possible (don't naively rewrite them):

- **Camera/navigation (carefully tuned — do not regress):**
  - Rotation pivots on the **model centre** (world origin) regardless of pan/zoom. It's a
    custom orbit: yaw about world Z (the crystal's central axis), pitch about a horizontal
    axis derived from a **tracked azimuth scalar** (NOT recomputed from camera vectors — that
    caused a pole singularity/glitch when looking down the model's axis). Elevation eases to a
    stop at ~87°.
  - **Pan** (right-drag) and **zoom-to-cursor** (scroll) handled by OrbitControls;
    `enableRotate=false` (we do rotation ourselves), `enablePan=true`, `zoomToCursor=true`.
  - **Animated preset views** (Iso/Front/Back/Left/Right/Top/Bottom) that slerp the camera
    direction + ease distance/target; cancelled by any drag/zoom.
  - A **corner axis gizmo** (X/Y/Z triad) showing orientation.
- **Real 3 mm panel thickness:** crystal panels are extruded **outward along each face
  normal** (butt-jointed on inner edges → V-gaps at outer edges). The **core faces** drive
  exports / cut outlines / base section; the thick slabs are display + base-fit only. The
  base socket clears the crystal's *outer* surface (`cl = clear + panelThk`).
- **Base = collar + skirt** with `socketDepth` (collar height) and `ledgeDepth` (recess) —
  the collar hugs the crystal from a recessed seat up to the rim; the skirt flares to ground.
- **Fabrication-aware estimates:** crystal = `cut-sheet` (panels, sheet area, acrylic mass &
  cost via thickness × density); base = `printed` (volume → mass → filament cost). Assembly
  card sums a mixed bill of materials.
- **Config save/load** (JSON), back-compatible with the legacy `crystal_designer {p,b,v}`.
- **Agent screenshot hook** `window.__app` (`setParams/getState/loadConfig/setVisible/setStyle/
  render/screenshot`) — `screenshot()` returns a PNG dataURL (renderer uses
  `preserveDrawingBuffer`). This hook MUST survive any runtime customisation.

## Flexibility philosophy (spec §3) — do NOT build a hook framework
Ship a canonical runtime + declarative `SCHEMA` that covers ~90% of projects by editing the
schema alone. The runtime is **copied into each scaffolded project** (project-owned). For
deeper needs, the agent edits that project's own `runtime.js`/`index.html`/`theme.css` — i.e.
ordinary code editing, not a pre-built extension API. The one invariant to preserve through
any rework is the `window.__app` screenshot hook.

## What "done" looks like for this pass
Per spec §11, prioritise:
1. **Extract the runtime** from `kernel_poc.html` into the canonical template:
   `index.html` + `runtime.js` + `theme.css` + `model.js` (crystal + base as the first
   `MODEL`). Verify parity with the single-file POC (same geometry, navigation, estimates,
   exports, config I/O).
2. **CLI screenshot script** (Node + Playwright): load `index.html`, optional `setParams`,
   call `window.__app.screenshot()`, write a PNG. Proves the agent loop with zero MCP.
3. **The skill** (`assembly-designer` / cadabra): the interview → research → scaffold →
   build → iterate workflow, the tier-selection rule, the self-review checklist, and
   fabrication profiles.
4. **MCP server** design + a working `render_view` (headless Playwright on the real
   `index.html`, warm process, returns image), then `get_geometry_report`, `export_part`,
   config tools, `scaffold_project`.
5. **Package** as a Claude Code plugin (skill + `.mcp.json` + template resources) with a
   clear README explaining how a user invokes it and what it generates.

Keep the viewer dependency-light (import maps + CDN ESM, pinned versions from the spec §5).
The kernel tier (replicad/OpenCASCADE WASM) should lazy-load only when a part needs it, and
should run in a **Web Worker** in the real runtime so solves don't block the UI.

## Verification gates
Every generated `index.html` must: render without console errors, keep the `window.__app`
hook, and round-trip a config save/load. You cannot assume browser execution from your shell
— drive the Playwright CLI (deliverable 2) to verify, and capture a screenshot or two.
