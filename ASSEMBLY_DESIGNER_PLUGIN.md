# Assembly Designer — Agent Plugin (Build Handoff Spec)

A spec, detailed enough to start building, for an **agent plugin** that turns the ad-hoc
"Claude + a hand-built interactive HTML modeller" workflow (used for the crystal sculpture)
into a reusable process: the agent interviews the user, researches real-world constraints,
and **scaffolds a bespoke parametric CAD app** in the working directory — tailored to the
specific design and its fabrication process.

> **Status:** design complete + working proof-of-concept (`kernel_poc.html`). This document
> is the handoff for building the plugin itself. Read §11 (Build plan) for where to start.

---

## 1. Vision

A **"dynamic, on-demand custom CAD app per project."** Two interaction modes by design:

- **Live user tweaking** — the generated HTML app exposes sliders/number inputs so the user
  adjusts dimensions themselves in real time, no agent involvement.
- **Agent-assisted design** — for major/topological changes the agent edits the model code,
  re-renders, **sees a screenshot**, self-reviews, and iterates conversationally.

This mirrors the reference article (*"I Taught Claude to Design 3D-Printable Parts"* — a
Claude skill that interviews → builds parametric CadQuery geometry → renders previews →
self-reviews → iterates, exporting STL) but **adds a live user-controlled viewer** and
**generalises beyond 3D printing** to multiple fabrication processes.

---

## 2. Core architecture decisions (with reasoning)

### 2.1 Three.js is the renderer — always
A CAD kernel produces *geometry* (mesh + normals); it renders nothing. "Three.js vs a CAD
kernel" is a false choice — three.js renders the kernel's output. The real question is which
**geometry engine** feeds it.

### 2.2 Two geometry tiers, chosen by a simple rule
- **Analytic tier** — plain JS vertex math. Instant (60 fps live drag), tiny, offline, and
  yields **exact planar panels** for laser/CNC cutting with clean per-panel DXF nesting.
- **Kernel tier** — real B-rep kernel (OpenCASCADE via **replicad**, WASM, in-browser) for
  **fillets, chamfers, shells, booleans, lofts/sweeps, STEP export, watertight guarantees**.

**Selection rule (deterministic, from the interview):**
> Is this a flat-panel / sheet-cut part (laser/CNC acrylic, ply — exact planar faces, DXF
> nesting)? → **analytic.** Otherwise → **kernel** (the default). Simple
> primitive/extrude/revolve parts can use analytic if instant + zero-dependency matters.

**Why not always-kernel** (despite being simpler): kernel re-solves in tens-to-hundreds of
ms (loses buttery live-drag); multi-MB WASM on every project (hurts offline/instant-share);
and for flat-panel cutting a B-rep must be *tessellated*, from which recovering exact flat
cut-panels is harder and less exact than computing them analytically. The cost of supporting
both is low because the runtime is **engine-agnostic** — `build()` returns a mesh either way.

### 2.3 The kernel runs in the browser (no Python server)
OpenCASCADE compiled to WASM means kernel + live viewer share one client-side app.
**Replicad** (CadQuery-style TS API over `opencascade.js`) gives fillet/shell/boolean/loft +
STEP/STL, fully in-browser. Trade-offs: multi-MB WASM (lazy-load only when a kernel part
exists), solves are tens-to-hundreds of ms (**run in a Web Worker** so the UI never blocks),
smaller community than CadQuery. Python only re-enters for heavy offline batch/mesh
processing or nesting — kept optional, not part of the core.

### 2.4 Rejected approaches
- **Streamlit / Gradio** — rerun-on-every-widget server roundtrip; laggy param→geometry
  updates, weak glass/transmission rendering. A regression from pure-client interactivity.
- **"Leave the browser for photorealistic CAD renders"** — the article's previews are
  flat-shaded `pyrender`, *not* photorealistic. Three.js `MeshPhysicalMaterial`
  (transmission/IOR + HDRI env) renders acrylic *better*, live. True photorealism is an
  offline Blender/path-trace step neither approach does in real time.

### 2.5 Estimates are fabrication-aware
- `printed` (FDM/resin) → kernel/mesh **volume** × density → mass → filament/resin cost
  (solid volume = 100%-infill upper bound; real FDM ≈ walls + infill% × interior).
- `cut-sheet` (laser/CNC acrylic, ply) → **panel area / sheet usage** → cost, + panel count
  and largest-panel-fits-sheet checks.
- `milled` / `carpentry` (future) → stock size, board-feet, cut list, kerf/joinery.

The assembly view sums a **mixed bill of materials** across parts.

---

## 3. Flexibility philosophy — schema-first, evolve by editing the runtime

**This is the load-bearing design choice. Do NOT build a complex extension/hook framework.**

- The plugin ships a **canonical runtime + a declarative `SCHEMA` format** that is flexible
  enough to cover ~90% of projects **by editing the schema alone** (params, parts, render
  styles, fabrication type, exports).
- The runtime is **copied into each scaffolded project** (project-owned, not a shared
  dependency). For the ~10% of projects needing more, **the agent simply edits that
  project's own `runtime.js` / `index.html` / `theme.css`** to rework the framework as far as
  needed. It's just code, and the agent is good at editing code.
- So: a **common-sense, structured starting point that can be evolved per project** —
  instead of an elaborate bespoke-framework protocol with pre-built hooks trying to
  anticipate every customisation. Customisation = ordinary code editing of owned files, not a
  special API.

**Consequences:**
- No `customPanel`/`customLayout`/hook system. The escape hatch is "edit the file."
- Each project owns its runtime copy → divergence is fine and expected for bespoke projects.
- Improvements to the canonical runtime benefit **new** projects; existing projects can
  re-sync manually if they haven't diverged.
- **One convention must survive any customisation:** the `window.__app` agent hook (esp.
  `screenshot()`), so the agent keeps its "eyes" regardless of how the UI is reworked.

---

## 4. What to build (deliverables)

A Claude Code **plugin** = **skill(s) + MCP server + runtime template + resources**, using
the user's existing Claude subscription (Claude Code or Claude Desktop as the agent).

1. **Skill** `assembly-designer` — orchestrates interview → research → scaffold → build →
   iterate (§8). Encodes the tier-selection rule, the self-review checklist, and
   fabrication-specific design rules.
2. **MCP server** — the agent's senses & hands (§9): screenshot, geometry report, export,
   config memory, scaffold.
3. **Runtime template** — canonical `index.html` + `runtime.js` + `theme.css` + a `model.js`
   stub, copied into each project (§6, §7).
4. **Resources** — reusable build helpers (analytic + replicad recipes), fabrication
   profiles (densities, prices, min-wall/kerf/clearance), the Playwright screenshot driver.

---

## 5. Tech stack (with verified specifics)

| Layer | Choice | Notes / gotchas learned in the POC |
|---|---|---|
| Renderer | **three.js r0.160.0** (ESM via esm.sh + importmap) | `enableDamping=false` for CAD feel; `preserveDrawingBuffer:true` for screenshots; `ACESFilmicToneMapping` + `PMREMGenerator(RoomEnvironment)` for transmission/metal |
| three helpers/examples | esm.sh with **`?external=three`** | dedupes three so the helper + OrbitControls share one instance |
| Analytic geometry | plain JS | exact planar faces; Newell area; per-shape DXF nesting |
| Kernel geometry | **replicad 0.23.0** + **replicad-opencascadejs 0.23.0** + **replicad-threejs-helper 0.23.0** | see init snippet below; run in a **Web Worker** in production |
| Kernel WASM | `https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.23.0/src/replicad_single.wasm` | factory `export default Module`; `await opencascade({locateFile:()=>WASM})` then `setOC(OC)` |
| Volume/mass | replicad `measureVolume(shape)` → mm³ | exact, not mesh approximation |
| UI | schema-driven vanilla JS/CSS | accordion cards, slider+number controls, design tokens in `theme.css` |
| Persistence | localStorage + JSON config import/export | back-compatible with legacy `crystal_designer {p,b,v}` |
| Agent eyes | headless **Playwright** driving the real `index.html` | pixel-parity with the user's view; warm process keeps WASM loaded |
| Packaging | Claude Code skill + MCP (`.mcp.json`) | |

**Replicad init (verified):**
```js
import opencascade from "https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.23.0/src/replicad_single.js";
import { setOC, /* drawRoundedRectangle, measureVolume, ... */ } from "https://esm.sh/replicad@0.23.0";
import { syncGeometries } from "https://esm.sh/replicad-threejs-helper@0.23.0?external=three";
const WASM = "https://cdn.jsdelivr.net/npm/replicad-opencascadejs@0.23.0/src/replicad_single.wasm";
const OC = await opencascade({ locateFile: () => WASM }); setOC(OC);
// mesh for three.js:
const meshed = [{ name:"p", faces: shape.mesh({tolerance:0.05, angularTolerance:30}),
                  edges: shape.meshEdges({keepMesh:true}) }];
const geoms = syncGeometries(meshed, []);   // → [{ faces:BufferGeometry, lines:BufferGeometry }]
// exports: shape.blobSTL(), shape.blobSTEP()
```

No build step for the viewer (import maps + CDN ESM). Versions above are pinned and confirmed
to resolve on jsDelivr/esm.sh.

---

## 6. Scaffolded project structure

```
<project>/
  index.html        # loads theme.css + runtime.js + model.js; provides #side and #view mounts
  runtime.js        # canonical engine (copied in, project-owned, editable)
  theme.css         # design tokens (dark panel palette, controls)
  model.js          # AGENT-AUTHORED: the SCHEMA (parts) + build()/estimate() functions
  config/
    default.json    # named design presets
  exports/          # generated part files (STL/STEP/DXF/SVG) + reference renders
  PROJECT.md        # the design: intent, constraints, researched dimensions + sources, usage
```

The agent edits **`model.js`** in the common case. For deeper customisation it also edits
`runtime.js` / `index.html` / `theme.css` (all project-owned copies).

---

## 7. The runtime ↔ model contract

### 7.1 `model.js` exports
```js
export const MODEL = {
  meta: { name, units:'mm', fabricationDefault:'printed' },
  parts: [ /* part objects, ordered; see 7.2 */ ],
};
```

### 7.2 Part object (the SCHEMA unit — one entry **per part**; an assembly is an array)
```js
{
  id, name,
  engine: 'analytic' | 'kernel',
  fab: 'printed' | 'cut-sheet' | 'milled' | 'carpentry',
  dependsOn: [ids],                 // ordered build; later parts read earlier outputs
  render: { styles:['acrylic','pla','clay','metal','wire'], default:'acrylic' },
  exports: ['stl','dxf','svg','step'],
  params: [
    { key, label, unit, min, max, step, default, group?, hardMin?, hardMax? }, // range
    { key, label, type:'choice', options:[[val,label],...], default },          // choice
  ],
  build(params, ctx) { return { faces, ...published }; },  // faces = array of 3D polygons;
                                                           // published merged into ctx[id]
  transform(params, ctx) { return { z }; },                // placement in the assembly
  estimate(out) { return { cost, rows:[[label,value],...] }; }, // fabrication-aware
}
```
- **`build` for analytic** returns `{ faces }` directly (+ any data later parts need, e.g.
  the crystal publishes `bottom`, `section`, `seatZ`).
- **`build` for kernel** builds a replicad shape, meshes it (`syncGeometries`) and returns
  `{ geometry, edges }` (BufferGeometries) plus measured props; the runtime renders either
  shape. (The POC implements the analytic path fully; the kernel path reuses the verified
  snippet in §5.)

### 7.3 Runtime responsibilities (what `runtime.js` does, generically)
Reads `MODEL` at load and: builds the **accordion of part cards** (header = active-dot · name
· fab badge · **solo** · **visibility** · collapse; body = grouped params, render-style
select, per-part estimate, export buttons); generates **slider+number** controls (soft range
= min/max; `hardMin/hardMax` lets typed values exceed the slider while it pins) and **choice**
segmented buttons; runs the **dependency-ordered build pipeline** passing a shared `ctx`;
renders per-part three.js meshes + edges; applies **per-part visibility & render style**;
computes **per-part estimates + the assembly mixed-BOM**; provides the **assembly summary
card** (parts, height, footprint, BOM total, print-material select, **exploded** slider);
**config save/load** (+ legacy import); localStorage persistence; and the **agent hook**.

### 7.4 The agent hook (must survive any customisation)
```js
window.__app = {
  setParams(partId, obj),  getState(),  loadConfig(obj),
  setVisible(partId, bool), setStyle(partId, name),
  render(),  screenshot() /* → PNG dataURL; renderer uses preserveDrawingBuffer */
};
```

---

## 8. The skill workflow

### Phase 0 — Discover (interview)
Structured questions before any geometry: **use case & object**; **fabrication process(es)**
(3D print FDM/resin, laser/CNC sheet, milling, carpentry — per part); **material**
(density/cost/min-wall/kerf); **hard constraints** (size envelope, print-bed/sheet/stock
limits, fit to an existing object, weight/budget, electronics/cavities); **aesthetic**
(faceted vs smooth, rounded vs sharp, finish). Use the agent's structured-question UI.

### Phase 1 — Research (ground the constraints)
When dimensions depend on the real world, **look them up** — exact phone body/button/camera
geometry for a case; standard mounts (VESA, tripod); connector footprints; lumber
nominal-vs-actual; material density/price. Record sources in `PROJECT.md`.

### Phase 2 — Scaffold
Run the scaffold (MCP tool / script, §9): copy `runtime.js`/`theme.css`/`index.html`, write a
`model.js` stub + `PROJECT.md`, create `config/` and `exports/`. Pick `engine` per part via
the §2.2 rule.

### Phase 3 — Build geometry & self-review (visual loop)
Three checkpoints (base shape → features → cleanup). At each, render via the screenshot hook,
**review against a checklist** (proportions, manifoldness, min wall, feature placement, fit),
fix, re-render before showing the user.

### Phase 4 — Iterate
User drives sliders for dimensional tweaks (no agent). Major changes → agent edits `model.js`
(or `runtime.js` for deep UI rework), re-renders, self-reviews, presents. Outputs, pricing,
and recommendations track the fabrication choice (e.g. acrylic→PLA flips exports from DXF
nest to STL and re-prices).

---

## 9. MCP server tools

Expose what the agent **can't** do by editing files — perceive the live model, measure real
geometry, run real exporters, persist state, scaffold. (Editing the model/runtime stays
ordinary file editing.)

- **`render_view(params?, camera?)`** → PNG (or 4-up montage). Headless Playwright against the
  project `index.html`; persistent process keeps the WASM kernel **warm**. Returns the image
  inline.
- **`get_geometry_report(params)`** → structured measurements you can't eyeball: bounding box,
  **exact volume**, mass/cost, **min wall thickness**, watertight/manifold flag, solid/face
  counts, **"did the boolean actually remove material?"**, + project validations (largest
  panel fits sheet, segment fits bed, cavity fits controller). Catches silent kernel failures.
- **`export_part(format, params)`** → runs the real exporter (STL/STEP/DXF/SVG) into
  `exports/`, returns path + summary.
- **`save_config` / `load_config` / `list_configs`** → named presets shared by agent & user.
- **`scaffold_project(spec)`** → stamps out §6 structure (deterministic; don't spend agent
  tokens on boilerplate).

**Principle — one geometry source, three consumers:** MCP server, headless renderer, and live
viewer all use the *same* `model.js`. Then "what the agent measures," "what it sees," and
"what the user drags" are the same object.

---

## 10. Multi-part assemblies
Ordered list of parts; each `build(params, ctx)` receives prior parts' published outputs
(dependency order via `dependsOn`). Per-part params/style/visibility/fab/transform/exports.
Unified view with per-part visibility (eye), **solo**, and an **exploded** slider. Assembly
card rolls up a **mixed BOM** (e.g. cut-acrylic crystal + printed-PLA base).

---

## 11. Build plan (for the implementing agent)

Suggested order; each milestone is independently testable.

1. **Extract the runtime from the POC.** Split `kernel_poc.html` into `index.html` +
   `runtime.js` + `theme.css` + `model.js` (crystal + base as the first `MODEL`). Verify
   parity with the current single-file POC. *(This is the canonical template.)*
2. **CLI screenshot script.** Node + Playwright: load `index.html`, optional `setParams`,
   call `window.__app.screenshot()`, write PNG. Proves the agent loop end-to-end with zero
   MCP infrastructure.
3. **Kernel tier in a Web Worker.** Validate replicad in-browser (port the phone-case POC),
   move solves off the main thread; confirm fillet/shell/boolean/STEP + `measureVolume`.
4. **MCP server.** Wrap the screenshot driver as `render_view` (warm browser, inline image);
   add `get_geometry_report`, `export_part`, config tools, `scaffold_project`.
5. **The skill.** Author the interview/research/scaffold/iterate workflow, the tier rule, the
   self-review checklist, and fabrication profiles.
6. **Package** as a Claude Code plugin (skill + `.mcp.json` + template resources).

**Verification gates:** every generated `index.html` must (a) render without console errors,
(b) keep the `window.__app` hook, (c) round-trip a config save/load. The implementing agent
cannot assume browser execution from its shell — drive Playwright (milestone 2) to verify.

---

## 12. Reference assets in this repo
- **`kernel_poc.html`** — working schema-driven runtime POC with crystal + base ported on:
  accordion part cards, slider+number controls, per-part render styles (translucent acrylic /
  matte PLA / clay / metal / wire), explode/solo, fabrication-aware estimates, config
  save/load (incl. legacy import), agent screenshot hook. Analytic tier fully implemented;
  kernel-tier integration verified separately (the earlier phone-case version + §5 snippet).
- **`crystal_designer.html`** — the original single-purpose app being generalised. Source of
  the verified crystal + base analytic geometry.
- **`PROJECT_STATE.md`** — the crystal sculpture project (origin/domain context).

---

## 13. Open questions / TODO
1. Web Worker message protocol for kernel parts (params in → meshed geometry + measured props
   out); debounce/cancel semantics for rapid slider moves.
2. MCP transport/packaging for Claude Code; whether the optional Python toolkit ships.
3. Fabrication profiles for carpentry/CNC (kerf, joinery, board sizing, grain).
4. Engrave panel labels + match-marks; account for material thickness / joint type on cut
   files (carried from the crystal TODO).
5. Per-segment STL export for printed parts (split at seam lines for the bed).
6. Canonical-runtime re-sync strategy for non-diverged projects.

---

## 14. Reference
Inspiration: *"I Taught Claude to Design 3D-Printable Parts: Here's How"* — CadQuery
(OpenCASCADE) + a Claude skill + trimesh/pyrender previews, exporting STL. We adopt the
interview/visual-review loop and extend it with a live user-controlled viewer, a two-tier
(analytic + in-browser-kernel) engine, fabrication-aware outputs, and the schema-first /
edit-the-runtime-to-evolve flexibility model.
