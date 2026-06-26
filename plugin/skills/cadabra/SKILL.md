---
name: cadabra
description: >-
  Conjure a bespoke, live, parametric CAD app for a physical object the user
  wants to design and fabricate. Use when the user wants to design, model, or
  parametrically generate a 3D-printable, laser-cut, CNC, or wood/carpentry part
  or assembly — e.g. "design a phone stand", "model a bracket for X", "I want to
  laser-cut an enclosure", "make a parametric vase", "help me design a part to
  print". Produces a project folder with a file://-ready three.js viewer
  (sliders + exports), a living PROJECT.md, and an agent-authored model.js.
---

# Cadabra — bespoke parametric CAD apps

Cadabra turns "Claude + a hand-built interactive HTML modeller" into a repeatable
process. For each project you **interview the user, capture context into a living
`PROJECT.md`, scaffold a self-contained CAD app, author the geometry in
`model.js`, and iterate** — the user tweaks dimensions live with sliders; you make
topological/structural changes by editing code and reloading.

The generated app is **standalone and serverless**: the user double-clicks
`index.html` (`file://`), edits `model.js`, and clicks **Reload**. Heavy kernel
work (replicad WASM) runs from the CDN in a Blob-URL Web Worker — still no server.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's root. Scripts live at
`${CLAUDE_PLUGIN_ROOT}/scripts/`, the runtime template at
`${CLAUDE_PLUGIN_ROOT}/templates/runtime/`, and two worked references:
`${CLAUDE_PLUGIN_ROOT}/examples/crystal/` (**analytic** tier — flat acrylic panels
+ printed base) and `${CLAUDE_PLUGIN_ROOT}/examples/phone_case/` (**kernel** tier —
replicad fillet + shell + boolean, STEP/STL export).

## Two engine tiers (both first-class)

Every part picks one engine. Both run from `file://` with no server.

- **analytic** — exact planar / flat-panel parts (laser/CNC sheet): plain JS vertex
  math in `model.js`, instant, zero-dependency, clean DXF/SVG nesting. Returns
  `{ faces, ...published }`.
- **kernel** (replicad / OpenCASCADE WASM) — curved B-rep features: fillets,
  chamfers, shells/hollows, booleans, lofts/sweeps, STEP, watertight solids. The
  solve runs in a **Blob-URL Web Worker** (classic worker + dynamic `import()` of
  CDN ESM; OC WASM from CDN) so it never blocks the UI and needs no server. It
  **lazy-loads only when a kernel part is present** — analytic-only projects pay
  nothing. Returns `{ geometry, edges, volume, blobSTL, blobSTEP }`.

---

## The workflow (do these in order)

### Phase 0 — Resume or gather (ALWAYS start here)

**If the project already has a `PROJECT.md`, READ IT FIRST.** It is the durable
source of truth across sessions — conversation context does NOT carry over
between sessions. Then read `model.js` to see the current geometry. Pick up from
the decision log.

**If this is a new project, INTERVIEW the user before any geometry.** Gather:

1. **Use case & object** — what is it, who uses it, how, where?
2. **Reference material** — links, images, an existing object/standard it must
   match. Ask the user to share images or URLs. If they give a real object to fit
   (a phone, a PCB, a bottle), you'll research its exact dimensions in Phase 1.
3. **Fabrication process** — per part: 3D print (FDM/resin), laser/CNC sheet,
   milling, carpentry. This drives the engine tier and the exports.
4. **Material(s)** — density, cost, min wall / kerf / clearance, sheet/stock sizes.
5. **Dimensions & hard constraints** — size envelope, print-bed / sheet / stock
   limits, fit to an existing object, weight, budget, cavities/electronics.
6. **Aesthetic** — faceted vs smooth, rounded vs sharp, finish, palette.
7. **Export needs** — what files does the user need to send to fabrication? For
   cut-sheet: DXF per panel shape, SVG nesting layout, sheet size constraint. For
   printed: STL per segment or whole-part. For kernel: STEP or STL. Confirm whether
   individual piece files are needed (e.g. one DXF per unique face type for a laser
   cutter) vs. a single batch file.

Ask these as a structured set; don't interrogate one question at a time if the
user clearly wants to move fast, but don't skip fabrication + constraints.

### Phase 1 — Research (ground the constraints)

When a dimension depends on the real world, **look it up** rather than guessing:
exact phone body/button/camera geometry, standard mounts (VESA, tripod 1/4-20),
connector footprints, lumber nominal-vs-actual, material density/price. **Record
every researched number with its source in PROJECT.md.**

### Phase 2 — Write/update PROJECT.md (the living document)

Scaffold the project (Phase 3 below also stamps a `PROJECT.md` template), then
fill it in from the interview + research. This document must let a FUTURE session
rebuild full context with no chat history. Keep these sections current:
intent, reference material, fabrication (incl. **export format needs per part**,
sheet/bed size constraints, DXF label conventions, file delivery format),
dimensions & constraints (with sources), aesthetic, geometry/engine decisions,
open questions, and a **decision log** (date — decision — why).
**Update it whenever a requirement or decision changes.**

### Phase 3 — Scaffold

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold_project.mjs --dir <project-dir> \
     --name "<Object name>" --fab <printed|cut-sheet|milled|carpentry>
```

This copies the runtime (`index.html`, `runtime.js`, `theme.css`, `kernel.js`), a
**generic stub** `model.js`, a `PROJECT.md` template, and `config/` + `exports/`.
It does NOT overwrite an existing `model.js`/`PROJECT.md` (your work persists).

### Phase 4 — Author model.js (the schema + geometry)

`model.js` is a **classic script** (no import/export) that sets `window.MODEL =
{ meta, MATERIALS, parts:[...] }`. Edit ONLY this file in the common case. See
[reference.md](reference.md) for the full contract and recipes, and the crystal
example for a real multi-part assembly.

**Pick the engine tier per part (deterministic rule):**

> Is this a flat-panel / sheet-cut part (laser/CNC acrylic, ply — exact planar
> faces, DXF nesting)? → **`analytic`** (plain JS vertex math; instant; exact flat
> panels). Otherwise → **`kernel`** (replicad WASM; fillets, chamfers, shells,
> booleans, lofts/sweeps, STEP, watertight). Simple primitive/extrude/revolve
> parts may use `analytic` when instant + zero-dependency matters.

Build the geometry in checkpoints: **base shape → features → cleanup.**

**Kernel-part recipe** (see `examples/phone_case/model.js` for the full pattern):

```js
function runInWorker(replicad, p){            // serialised to the worker — may
  let s = replicad.drawRoundedRectangle(p.w,p.h).sketchOnPlane().extrude(p.d);
  s = s.fillet(p.r);                          // reference ONLY (replicad, p)
  s = s.shell(p.wall, f => f.inPlane("XY", p.d));        // open the top face
  return s.cut(cutterShape);                  // return a replicad Shape
}
async build(p, ctx){
  const k = await window.CADABRA_KERNEL.ready();         // boots once, cached
  return await k.run(runInWorker, { /* plain params */ });   // {geometry,edges,volume,blobSTL,blobSTEP}
}
```

The function you pass to `k.run()` runs **inside the Web Worker**, so it must be
self-contained — it can only touch its `(replicad, p)` args, never `model.js`
scope. Export `step`/`stl` from a kernel part (the runtime wires `blobSTEP`/
`blobSTL` into the export buttons). Kernel builds are async; the runtime awaits
them and shows a "solving…" badge.

### Phase 5 — Self-review (visual loop, occasional screenshots)

You usually understand the design from the `model.js` code itself. When you DO
need to look — a specific visual concern, or the user asks you to view something —
capture a screenshot over `file://` (no server):

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/screenshot.mjs --html <project>/index.html \
     --out shot.png [--view iso|front|top|...] [--set 'partId:{"H":1400}']
```

Then **review against the checklist** below, fix, and re-render before presenting.

### Phase 6 — Iterate

The user drives sliders for dimensional tweaks (no agent needed). For structural/
topological changes you edit `model.js` (or, for deep UI rework, the project's own
`runtime.js`/`index.html`/`theme.css` — all project-owned copies), then the user
clicks **Reload**. When fabrication choice changes (e.g. acrylic → PLA), flip the
part's `fab`/`exports`/`engine` and re-price. Update PROJECT.md's decision log.

**Export tab** — the app has a **Design / Export** tab toggle in the sidebar. The
Export tab shows a fab-appropriate preview per part:
- **cut-sheet / milled**: panel-type grid (2D polygon preview, qty, dimensions).
  Clicking a panel card highlights those faces in the 3D view. Per-piece DXF and
  batch ZIP/SVG nesting actions.
- **printed / kernel**: estimate rows (volume, mass, cost) + STL/STEP download.

The runtime auto-derives the panel breakdown from `out.faces` for cut-sheet parts —
no `exportPieces()` needed unless the model wants semantic labels or custom grouping.
Set `exports:['dxf','svg','stl']` etc. on each part to control which export formats
appear. Parts with no `exports:[]` defined do not appear in the Export tab.

---

## Self-review checklist (before showing the user)

- **Proportions** match the intent and reference (eyeball the screenshot).
- **Fit** — does it actually fit the object/envelope/cavity it must? (Use the
  geometry report: `window.__app.report()` returns bbox, volume, cavity, fits.)
- **Min wall / kerf / clearance** respected for the chosen material.
- **Manifold / watertight** for printed parts (kernel parts: check the solve
  succeeded and `measureVolume` is sane — a boolean that removed nothing is a
  silent failure).
- **Cut-sheet parts**: largest panel fits the sheet; panel count reasonable;
  unique-shape count sane for nesting.
- **Print parts**: largest segment fits the bed; overhangs/supports considered.
- **Placement** — parts seat/stack correctly (check `transform` + dependencies).

---

## Fabrication profiles (starting points — confirm per project)

| Process | Engine | Material defaults | Key checks |
|---|---|---|---|
| `printed` (FDM) | kernel (or analytic for prisms) | PLA 1.24 g/cm³ $22/kg · PETG 1.27 $25 · ABS 1.04 $24 | min wall ≥ 2× nozzle (~0.8 mm); fits print bed; overhang ≤ 45° or support |
| `printed` (resin) | kernel | Resin ~1.10 g/cm³ $40/kg | min wall ~1 mm; drain holes for cups; supports |
| `cut-sheet` (laser/CNC acrylic) | analytic | Cast acrylic 1.18 g/cm³ ~$85/m²/mm | exact planar panels; kerf ~0.1–0.2 mm; largest panel ≤ sheet; account for material thickness at joints |
| `cut-sheet` (ply) | analytic | Birch ply ~680 kg/m³ | kerf ~0.2 mm; grain direction; finger-joint allowances |
| `milled` (CNC) | kernel | per stock | tool-radius internal corners; fixturing; stock size |
| `carpentry` | analytic/kernel | lumber nominal≠actual (2×4 = 38×89 mm) | board-feet; joinery; grain; kerf |

Cost model: printed = volume × density → mass × $/kg (solid = 100%-infill upper
bound). cut-sheet = panel area / sheet usage → cost + panel-fit checks. The
assembly card sums a **mixed bill of materials** across parts.

---

## Verification gates (every generated project must pass)

Render without console errors · keep the `window.__app` hook · round-trip a
config save/load. Verify over `file://` (no server):

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs <project>/index.html
```

---

## The one invariant

Through ANY customisation (even rewriting `runtime.js`), the **`window.__app`**
hook must survive — it's the agent's eyes & hands on the live model
(`setParams/getState/loadConfig/setVisible/setStyle/setView/report/render/
screenshot`). `screenshot()` returns a PNG dataURL.
