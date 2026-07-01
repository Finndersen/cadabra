---
name: setup-new-project
description: >-
  Set up a new Cadabra parametric CAD project for a physical object the user
  wants to design and fabricate. Use when the user wants to create, design, or
  model something — e.g. "design a phone stand", "model a bracket for X", "I
  want to laser-cut an enclosure", "make a parametric vase", "help me design a
  part to print". Do NOT use for an existing project the user already has —
  those projects have a CLAUDE.md that guides the session.
---

# Cadabra — set up a new parametric CAD project

Cadabra generates a bespoke, live, parametric CAD app per project: interview the
user, plan the design, scaffold a self-contained 3D viewer, write the geometry in
`model.js`, and iterate. The user tweaks dimensions with sliders; you make
structural changes by editing code and reloading.

The generated app is **standalone and serverless**: the user double-clicks
`index.html` (`file://`) and clicks **Reload** after edits. The kernel tier
(replicad WASM) runs from the CDN in a Blob-URL Web Worker — still no server.

`${CLAUDE_PLUGIN_ROOT}` is this plugin's root. Scripts live at
`${CLAUDE_PLUGIN_ROOT}/scripts/`, the runtime template at
`${CLAUDE_PLUGIN_ROOT}/templates/runtime/`, and two worked references:
`${CLAUDE_PLUGIN_ROOT}/examples/crystal/` (**direct** tier — flat acrylic panels
+ printed base) and `${CLAUDE_PLUGIN_ROOT}/examples/phone_case/` (**kernel** tier —
replicad fillet + shell + boolean, STEP/STL export).

## Two engine tiers (both first-class)

Every part picks one engine. Both run from `file://` with no server.

- **direct** — plain JS vertex math in `model.js`: instant, zero-dependency, DXF/
  SVG nesting, STL via face triangulation. For flat-panel (laser/CNC sheet) and
  simple printed shapes (prisms, cylinders, boxes). Returns `{ faces, ...published }`.
  (`engine:'analytic'` is a legacy alias.)
- **kernel** (replicad / OpenCASCADE WASM) — curved B-rep features: fillets,
  chamfers, shells, booleans, lofts/sweeps, STEP, watertight solids. Runs in a
  Blob-URL Web Worker; lazy-loads only when a kernel part is present — direct-only
  projects pay nothing. Returns `{ geometry, edges, volume, blobSTL, blobSTEP }`.

---

## The workflow (do these in order)

### Phase 0 — Gather

Interview the user before writing any files. Gather:

1. **Use case & object** — what is it, who uses it, how, where?
2. **Reference material** — links, images, an existing object/standard it must
   match. Ask the user to share images or URLs. If they give a real object to fit
   (a phone, a PCB, a bottle), you'll research its exact dimensions in Phase 1.
3. **Fabrication process** — per part: 3D print (FDM/resin), laser/CNC sheet,
   milling, carpentry. This drives the engine tier and the exports.
4. **Material(s)** — density, cost, min wall / kerf / clearance, sheet/stock sizes.
   If a part should let the user pick among materials at runtime (e.g. PLA vs
   PETG), note which — this becomes a `materials:[]` field on that part, and is
   per-part (different parts in the same assembly can take different materials).
5. **Metrics** — what computed quantities matter to see live per part, beyond
   cost: lengths, clearances, counts, fit checks. Fabrication cost is optional
   per part (only define it where it's actually meaningful) — don't assume every
   part needs a price tag.
6. **Dimensions & hard constraints** — size envelope, print-bed / sheet / stock
   limits, fit to an existing object, weight, budget, cavities/electronics.
7. **Aesthetic** — faceted vs smooth, rounded vs sharp, finish, palette.
8. **Export needs** — DXF per panel shape? SVG nesting? STL per segment? STEP?
   Individual piece files vs. single batch?

Ask only the genuinely blocking questions upfront; state assumptions for the rest.
**Blocking:** (1) fabrication process per part, (2) hard dimensional constraints,
(3) anything where a wrong assumption requires a full redesign. Everything else
can be assumed and corrected via sliders later.

### Phase 1 — Research

When a dimension depends on the real world, **look it up** rather than guessing:
exact phone body/button/camera geometry, standard mounts (VESA, tripod 1/4-20),
connector footprints, lumber nominal-vs-actual, material density/price. **Record
every researched number with its source** — you'll write it into PROJECT.md next.

### Phase 2 — Present plan and confirm

Before writing any files, present a concise project brief and get explicit
confirmation:

> **Parts:** [list each part — name, fab process, engine, export formats]
> **Key parameters:** [the main controllable dimensions and their expected ranges]
> **Engine rationale:** [why direct vs kernel for each part]
> **Open assumptions:** [things assumed that the user can correct]
>
> Does this match your vision? Any corrections before I proceed?

Only scaffold once the user confirms (or after incorporating corrections). This
prevents wasted work when the user has a different mental model.

### Phase 3 — Scaffold and document

Run the scaffold script to create the project files. `<project-dir>` defaults to
a new subdirectory of the **current working directory** (e.g.
`./<kebab-case-name>`) — not a sibling directory or anywhere else — unless the
user has specified a different location:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold_project.mjs --dir <project-dir> \
     --name "<Object name>" --fab <printed|cut-sheet|milled|carpentry>
```

This copies the runtime (`index.html`, `runtime.js`, `theme.css`, `kernel.js`),
a stub `model.js`, a `PROJECT.md` template, a `CLAUDE.md`, and `config/` +
`exports/`. It never overwrites an existing `model.js` or `PROJECT.md`.

Then fill in `PROJECT.md` from the interview + research. It must let a future
session rebuild full context with no chat history. Keep these sections current:
intent, reference material, fabrication (export needs, sheet/bed constraints),
dimensions & constraints (with sources), aesthetic, geometry/engine decisions,
open questions, and a **decision log** (date — decision — why).

### Phase 4 — Author model.js

`model.js` is a **classic script** (no import/export) that sets `window.MODEL =
{ meta, MATERIALS, parts:[...] }`. Edit ONLY this file in the common case. See
[reference.md](reference.md) for the full contract and recipes.

**Pick the engine tier per part:**

> Flat-panel (laser/CNC) or simple printed shape (prism, cylinder, box, stepped
> extrusion, shape with recesses)? → **`direct`** (instant; zero CDN cost;
> `exports:['stl']` works — runtime triangulates `out.faces` to ASCII STL).
> Otherwise → **`kernel`** (fillets, chamfers, shells, booleans, lofts, STEP,
> watertight). **Try `direct` first for any printed part** — slots, holes, and
> cavities do not require kernel, just omit those faces or add wall faces.
>
> **Kernel cost:** `direct` = zero, synchronous, offline. `kernel` = 3–9s CDN
> load + WASM compile on first visit, then 0.5–3s per rebuild.

**Physical relationships — never duplicate dimensions:**

> If part A mates with part B, A must `dependsOn:['B']` and read B's geometry
> from `ctx.B.*`. Never add a param to A for a dimension defined by B — it drifts
> the moment B changes. Publish every dimension downstream parts will need from
> `build()`. A part with `dependsOn:['B']` that reads nothing from `ctx.B` is a
> signal the dependency is unmodelled.

Build the geometry in checkpoints: **base shape → features → cleanup.**

**Kernel-part recipe** (see `examples/phone_case/model.js` for the full pattern):

```js
function runInWorker(replicad, p){
  let s = replicad.drawRoundedRectangle(p.w,p.h).sketchOnPlane().extrude(p.d);
  s = s.fillet(p.r);
  s = s.shell(p.wall, f => f.inPlane("XY", p.d));
  return s.cut(cutterShape);
}
async build(p, ctx){
  const k = await window.CADABRA_KERNEL.ready();
  return await k.run(runInWorker, { /* plain params only */ });
}
```

The function passed to `k.run()` is serialised and eval'd in the worker — it must
be self-contained: only its `(replicad, p)` args, never `model.js` scope.

> **STL for `direct` parts:** `exports:['stl']` works on any direct-engine part —
> the runtime triangulates `out.faces` to ASCII STL. Only use kernel for STEP,
> watertight guarantee, or genuinely non-prismatic geometry.

### Phase 5 — Self-review

You usually understand the design from the code. When you need to look —
a specific visual concern, or the user asks — capture a screenshot:

> **Sandbox:** `verify.mjs` launches a headless browser via Playwright. If it
> fails with a permission or operation-not-permitted error, re-run it with the
> Claude sandbox disabled.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs <project>/index.html \
     --out /tmp/cadabra_shot.png [--view iso|front|top|...] [--set 'partId:{"H":1400}']
```

Then `Read /tmp/cadabra_shot.png` to view the image. This also runs the same
gates as [Verification](#verification-every-project-must-pass) below, so a
self-review screenshot doubles as a check that nothing broke. `verify.mjs`
also takes `--config`, `--dump`, `--part`, `--width`/`--height`, and `--wait`
— see [reference.md](reference.md#cli-scripts-reference) for the full flag list.

Review against the checklist below, fix, and re-render before presenting.

### Phase 6 — Iterate

User drives sliders for dimensional tweaks. For structural/topological changes,
edit `model.js` (or, for deep UI rework, the project's own `runtime.js` /
`index.html` / `theme.css` — all project-owned copies), then user clicks Reload.
When fabrication choice changes, flip `fab`/`exports`/`engine` and re-price.
Update PROJECT.md's decision log.

**Export tab** — Design / Export toggle in the sidebar:
- **cut-sheet / milled**: panel-type grid (2D preview, qty, dims). Click a panel
  card to highlight those faces in the 3D view. Per-piece DXF + batch ZIP/SVG.
- **printed / kernel**: estimate rows (volume, mass, cost) + STL/STEP buttons.

Set `exports:['dxf','svg','stl']` etc. on each part. Parts with no `exports:[]`
do not appear in the Export tab.

---

## Self-review checklist

- **Proportions** match the intent and reference (eyeball the screenshot).
- **Fit** — does it fit the object/cavity it must? (`window.__app.report()` returns
  bbox, volume, cavity, fits.)
- **Min wall / kerf / clearance** respected for the chosen material.
- **Manifold / watertight** for printed parts (kernel: check solve succeeded and
  `measureVolume` is sane — a boolean that removed nothing is a silent failure).
- **Cut-sheet**: largest panel fits the sheet; unique-shape count sane for nesting.
- **Print**: largest segment fits the bed; overhangs/supports considered.
- **Placement** — parts seat/stack correctly (check `transform` + dependencies).

---

## Fabrication profiles

| Process | Engine | Material defaults | Key checks |
|---|---|---|---|
| `printed` (FDM) | **direct** by default (prisms, cylinders, boxes with recesses). `kernel` only for fillets / chamfers / shells / lofts / STEP. | PLA 1.24 g/cm³ $22/kg · PETG 1.27 $25 · ABS 1.04 $24 | min wall ≥ 2× nozzle; fits bed; overhang ≤ 45°. |
| `printed` (resin) | kernel | Resin ~1.10 g/cm³ $40/kg | min wall ~1 mm; drain holes; supports |
| `cut-sheet` (laser/CNC acrylic) | direct | Cast acrylic 1.18 g/cm³ ~$85/m²/mm | kerf ~0.1–0.2 mm; largest panel ≤ sheet |
| `cut-sheet` (ply) | direct | Birch ply ~680 kg/m³ | kerf ~0.2 mm; grain direction |
| `milled` (CNC) | kernel | per stock | tool-radius corners; fixturing; stock size |
| `carpentry` | direct/kernel | lumber nominal≠actual (2×4 = 38×89 mm) | board-feet; joinery; grain |

Cost model (opt-in per part via `cost()` — skip it where cost isn't meaningful):
printed = volume × density × $/kg. cut-sheet = panel area / sheet → cost.
Assembly card sums the BOM across whichever parts define `cost()`, and hides
itself entirely if none do. Printed parts that should let the user choose
material at runtime declare `materials:[...]` for a per-part picker (see
reference.md "Materials & cost").

---

## Verification (every project must pass)

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs <project>/index.html
```

Render without console errors · `window.__app` hook intact · config save/load round-trips.
If a gate fails with a bare timeout (especially a kernel part), re-run with
`--verbose` to stream every console/pageerror message live — a worker build
error (e.g. an OCC fillet/boolean failure) logs as `console.error` inside the
worker and otherwise only surfaces after the gate's timeout, not before it:
`node ${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs --verbose <project>/index.html`

`verify.mjs` also takes `--out <file>` (save the screenshot gate's PNG —
omitted by default) and `--json` (dump the full `report()`) — see
[reference.md](reference.md#cli-scripts-reference) for the full flag list.

---

## The one invariant

Through ANY customisation, **`window.__app`** must survive — it's the agent's eyes
and hands on the live model (`setParams/getState/screenshot/report/…`).
