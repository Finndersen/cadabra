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
