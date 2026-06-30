# Cadabra Runtime Changelog

This file is the authoritative record of runtime version history. It serves two
audiences: **agents developing the plugin** (to know what to record when they make
changes) and **project agents upgrading an existing project's runtime** (to know
whether a major-version migration is required and what to do).

---

## How to read this file

Each entry covers one released version. The key fields:

- **Type**: `patch` (bug fix, no API change), `minor` (new feature, backward-compat),
  or `MAJOR` (breaking change to the `model.js` API).
- **model.js compatibility**: what, if anything, must change in a project's `model.js`
  before or after the runtime is updated.
- **Auto-upgrade safe**: whether `upgrade_runtime.mjs` will copy the files without
  agent intervention (`yes` for patch/minor, `no` for MAJOR).

For MAJOR versions, the **Migration** section is the agent's step-by-step guide.

---

## 2.0.0 — 2026-06-30 — MAJOR

**Type:** MAJOR
**Auto-upgrade safe:** no — breaking model.js API change, manual migration required.
**model.js compatibility:** Breaking: `estimate()` replaced by `metrics()` +
optional `cost()`; the global print-material picker (`ctx.printMat`) is replaced
by a per-part `materials:[]` field.

### Changes
- **`estimate(out, params, ctx) → {cost, rows}` split into two part methods:**
  `metrics(out, params, ctx) → rows` (REQUIRED — arbitrary computed quantities,
  not just cost) and `cost(out, params, ctx) → number | {value, label} | null`
  (OPTIONAL — only define where fabrication cost is meaningful). When `cost()`
  is defined, its value is auto-appended as a row to the part's metrics card and
  rolled into the assembly "Bill of materials" total — no need to hand-duplicate
  the number inside `metrics()`.
- **Assembly "Bill of materials" row auto-hides** when no part in the schema
  defines `cost()` (or all return null for the current state).
- **Slider debounce is now engine-aware.** The 200ms debounce added in 0.4.0 to
  stop expensive WASM `kernel` solves from firing on every mouse-move pixel was
  being applied uniformly, including to `direct`-only schemas where a full
  rebuild is sub-millisecond — making slider drags feel laggy for no reason.
  Schemas with no `engine:'kernel'` parts now rebuild on every input event with
  no debounce at all (true real-time feedback); schemas containing kernel parts
  keep the original 200ms debounce unchanged.
- **Global `printMat` picker removed.** Parts that want a material picker now
  declare `materials:['pla','petg',...]` (keys into `MODEL.MATERIALS`) — the
  runtime auto-renders a per-part "Material" control (sugar for a synthetic
  `ChoiceParam`), and the selection is read as `params.material` in
  `build`/`metrics`/`cost`. This is genuinely per-part: different parts in the
  same assembly can take different materials, and parts that don't declare
  `materials` show no picker at all.
- **`BuildCtx.printMat` removed.** `BuildCtx` is now just `{ [partId]: buildOut,
  MATERIALS }`.
- **Config format**: the saved JSON no longer has a top-level `printMat` field —
  per-part material selection lives in `state[partId].material` like any other
  param, so it round-trips automatically.

### Migration

For each existing project's `model.js`:

1. For each part, split `estimate(out, params, ctx)` into:
   - `metrics(out, params, ctx)` returning the old `rows` array directly (drop
     the `{cost, rows}` wrapper — just return the array).
   - `cost(out, params, ctx)` returning the old `cost` number (or
     `{value, label}` to customize the row label), only if cost is actually
     meaningful for that part — otherwise omit `cost()` entirely.
   - If the old `rows` included a manually-duplicated cost line (e.g.
     `['Filament cost', '$'+cost.toFixed(2)]`), delete that line — the runtime
     now appends it automatically from `cost()`.
2. Anywhere `ctx.printMat` was read: add `materials:[...]` (the same keys that
   were valid before, e.g. `['pla','petg','abs']`) to that part's schema, and
   change the read from `ctx.printMat` to `params.material`.
3. Run `upgrade_runtime.mjs --dir . --force-major` to copy the new runtime files
   after the `model.js` edits above.

---

## 1.0.1 — 2026-06-29 — patch

**Type:** patch
**Auto-upgrade safe:** yes
**model.js compatibility:** Fully backward-compatible.

### Changes
- **Pinch zoom speed increased:** `zoomSpeed` raised from 2 → 10 for more
  responsive pinch-to-zoom on trackpads.

---

## 1.0.0 — 2026-06-29 — MAJOR

**Type:** MAJOR
**Auto-upgrade safe:** no — project file layout changed; manual migration required before running upgrade_runtime.mjs.
**model.js compatibility:** Fully backward-compatible. No changes to model.js API.

### Changes
- **Runtime files moved to `runtime/` subdir:** `runtime.js`, `kernel.js`, and
  `theme.css` now live in `project/runtime/` instead of the project root.
  `index.html` remains at the project root and references them via `./runtime/`.
- **Trackpad navigation:** two-finger scroll now pans the camera (deltaX + deltaY
  translated to a right/up camera offset scaled by distance). Pinch gesture
  (Mac `ctrlKey` + wheel) zooms via OrbitControls. `zoomSpeed` bumped to 2 for
  more responsive pinch-to-zoom. Mouse right-drag pan still works.
- **Hint text updated:** sidebar hint now reads
  `left-drag = orbit · two-finger scroll = pan · pinch = zoom`.

### Migration

For each existing project, before running `upgrade_runtime.mjs --force-major`:

1. Create a `runtime/` subdirectory in the project root:
   ```
   mkdir runtime
   ```
2. Move the three engine files into it:
   ```
   mv runtime.js kernel.js theme.css runtime/
   ```
3. Update `index.html` — change the three `<script src>` and `<link>` paths:
   - `<link rel="stylesheet" href="./theme.css">` → `href="./runtime/theme.css"`
   - `<script src="./kernel.js">` → `src="./runtime/kernel.js"`
   - `<script src="./runtime.js">` → `src="./runtime/runtime.js"`
4. Run `upgrade_runtime.mjs --dir . --force-major` to copy the new runtime files.

---

## 0.4.0 — 2026-06-26 — minor

**Type:** minor  
**Auto-upgrade safe:** yes — copy runtime files, no model.js changes required.  
**model.js compatibility:** Fully backward-compatible.

### Changes
- **Slider debounce (200 ms):** slider and number-input events now wait 200 ms after
  the last change before triggering `rebuild()`, eliminating the continuous-solve
  problem when dragging sliders over kernel parts.
- **WASM pre-warm at boot:** if the schema contains any `engine:'kernel'` parts,
  `CADABRA_KERNEL.ready()` is called immediately at boot so the WASM loads in the
  background while the user reads the UI.
- **Kernel param-hash caching:** before each kernel solve, the runtime hashes
  `state[partId]` + all dependency part states. If unchanged since the last solve,
  the cached geometry is reused and the WASM solve is skipped.
- **Geometry helpers in scaffold `model.js`:** `cross3`, `dot3`, `sub3`, `norm3`,
  `flattenFace`, `poly2dArea`, `thickenFace`, `nGonRing`, `ringFaces` added to the
  scaffold template. Available in all new projects automatically.
- **Engine renamed `analytic` → `direct`:** the term `direct` better reflects
  intent. `engine:'analytic'` is accepted as a legacy alias — no model.js changes
  required in existing projects.
- **Documentation updates:** `SKILL.md` and `reference.md` updated with `direct`
  nomenclature, `dependsOn` physical coupling rule, STL-for-direct note, kernel
  cost note, faceIndices stride docs, and analytic-first-for-printed guidance.

---

## 0.3.0 — 2026-06-26 — initial

**Type:** initial release  
**Auto-upgrade safe:** n/a  
**model.js compatibility:** n/a

### Changes
- Initial Cadabra plugin release: parametric CAD scaffold for Claude Code.
- Two engine tiers: `direct` (plain JS vertex math) and `kernel` (replicad WASM in
  a Blob-URL Web Worker).
- Part-card accordion (Design tab), dependency-ordered build pipeline, three.js
  rendering with custom orbit navigation, per-part estimates, mixed BOM, Export tab
  (panel previews, DXF/SVG/STL/STEP), config save/load, localStorage.
- `window.__app` agent hook (`setParams`, `getState`, `screenshot`, `report`, …).
