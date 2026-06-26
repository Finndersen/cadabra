# Parametric phone case

> **Cadabra living project document.** This example exists to verify the
> **kernel tier** (replicad / OpenCASCADE WASM) end-to-end over `file://`. It is
> also a worked example of how a PROJECT.md reads once a kernel project is going.

## 1. Intent & use case
A slim, parametric protective phone case sized to a phone body, 3D-printed in a
flexible-ish filament (PLA/PETG default for the demo). The phone drops into an
open-topped hollow shell; the back has a camera cutout. Every dimension is a
slider so it can be retargeted to any phone.

## 2. Reference material
- Generic candybar phone envelope. Defaults (W 72 × H 146 × depth 12 mm, corner
  radius 12 mm) are in the ballpark of a modern ~6.1" phone **plus case wall**;
  retarget per device by measuring body W×H×thickness and adding ~`wall` clearance.
- Camera cutout default 32 × 32 mm rounded square, offset to the upper-left of the
  back — re-measure per phone (square-island camera bumps vary widely).

## 3. Fabrication
- **Process:** `printed` — FDM. PLA default (ρ 1.24 g/cm³, $22/kg); PETG/ABS/resin
  selectable. Print back-face-down; the open top needs no supports.
- **Min wall:** default 2 mm (≥ ~2.5× a 0.4 mm nozzle). The `wall` slider drives
  both the shell thickness and the reported printed mass.

## 4. Dimensions & hard constraints
- Outer W 50–100, H 100–180, depth 7–20 mm. Corner radius 2–25 mm, edge fillet
  0–5 mm, wall 1–5 mm.
- The **inner cavity** = outer minus `2 × wall` on W/H and `wall` on the closed
  (back) face — that's the phone pocket. Add device thickness + a little slack when
  sizing depth.
- Camera cutout fully penetrates the back (cutter depth = `wall + 4`), so it always
  punches through regardless of wall thickness.

## 5. Aesthetic
Soft, hand-friendly: all outer edges filleted (`edgeR`), generously rounded
corners. Matte PLA finish by default.

## 6. Geometry / engine decisions (model.js)
- **KERNEL tier** — the part needs three things the analytic tier cannot do:
  1. **fillet** every edge of the extruded body,
  2. **shell** (hollow) the solid, opening only the top (+Z) face,
  3. a **boolean cut** for the camera cutout.
  So `engine:'kernel'`; the solve runs in `kernel.js`'s Blob-URL Web Worker via
  replicad (CDN ESM + CDN OpenCASCADE WASM — no server).
- **Single part** `case`, no dependencies. `build` is async (awaits
  `CADABRA_KERNEL.ready()` then `k.run(runInWorker, params)`).
- **`runInWorker` is serialised to the worker**, so it references only
  `(replicad, p)` — every value it needs is passed through `params`.
- **Exports:** `step` + `stl` (the kernel emits a watertight STEP and an STL).
- **Estimate** uses the returned `volume` (mm³) — for a shelled part this is the
  WALL volume, i.e. the printed mass.

## 7. Open questions / TODO
- Add side button cut-outs and a bottom port (speaker/USB-C) slot — more booleans.
- Optional lip over the screen edge (a small inward flange at the open top).
- Corner air-gap / drop-absorbing ribs.

## 8. Decision log (newest first)
- 2026-06-24 — Built as the kernel-tier verification fixture. Confirmed the
  replicad WASM path renders end-to-end over `file://`: fillet + shell + boolean
  solve in the worker, volume ≈ 38.8 cm³ at defaults, STEP + STL export. Fixed the
  kernel worker (classic Blob worker + dynamic import; native mesh, no
  three-helper) and made the runtime await async kernel builds.

---

## Working with this project
- **Open it:** double-click `index.html` (opens via `file://` — no server needed).
  First load shows a brief "solving…" badge while replicad + WASM boot in the
  worker; the case then appears.
- **Iterate:** edit `model.js`, then click the **Reload** button in the app.
- **Tweak live:** drag the sliders (each change re-solves in the worker).
- **Export:** STEP (watertight B-rep for CAD) / STL (for slicing).
