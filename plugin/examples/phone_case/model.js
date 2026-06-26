/* ============================================================================
   model.js — Parametric phone case (the Cadabra KERNEL-TIER reference example).

   CLASSIC SCRIPT (no import/export) so it loads over file:// with no server.
   Attaches window.MODEL = { meta, MATERIALS, parts:[...] }; runtime.js reads it.

   This example exists to VERIFY the kernel tier end-to-end. The geometry needs
   real B-rep features — fillets, a shell/hollow, and a boolean cut — none of
   which the analytic tier can do, so the part runs on the replicad/OpenCASCADE
   WASM kernel (kernel.js → Blob-URL Web Worker, CDN libs + CDN wasm, no server).

   Kernel-part contract:
     engine:'kernel', build:async (p,ctx) => {
       const k = await window.CADABRA_KERNEL.ready();          // boots once, cached
       const out = await k.run((replicad, p) => <return a Shape>, p);
       return out;   // { geometry, edges, volume, blobSTL, blobSTEP }
     }
   The function passed to k.run() is serialised and runs INSIDE the worker, so it
   may ONLY reference its two args (replicad, p) — no closure over this file.
   ============================================================================ */
(function () {
"use strict";

/* ---- fabrication profiles (densities g/cm³, price $/kg) ---- */
const MATERIALS = {
  pla:   { rho: 1.24, price: 22 },
  petg:  { rho: 1.27, price: 25 },
  abs:   { rho: 1.04, price: 24 },
  resin: { rho: 1.10, price: 40 },
};

/* ---- the kernel build: runs the replicad solve in the Web Worker ----
   NOTE: runInWorker is serialised to the worker as a string, so it must be
   self-contained (reference ONLY `replicad` + `p`, never this file's scope). */
function runInWorker(replicad, p) {
  const { drawRoundedRectangle } = replicad;
  // 1. Outer solid — fillet first, while the solid is closed (works reliably).
  let outer = drawRoundedRectangle(p.w, p.h, p.cornerR)
    .sketchOnPlane("XY")
    .extrude(p.depth);
  if (p.edgeR > 0) outer = outer.fillet(p.edgeR);

  // 2. Inner pocket cutter — inset by wall on all sides, starting at the back wall
  //    (z = wall) and extending above the top to guarantee a clean boolean cut.
  //    Avoids shell() — which can't be filleted after because OCC chokes on the
  //    inner rim edges of an open shell.
  const iw  = p.w - 2 * p.wall;
  const ih  = p.h - 2 * p.wall;
  const icR = Math.max(0, p.cornerR - p.wall);
  const inner = drawRoundedRectangle(iw, ih, icR)
    .sketchOnPlane("XY", p.wall)
    .extrude(p.depth - p.wall + 2);   // +2 so it clears the filleted top face
  let body = outer.cut(inner);

  // 3. Camera cutout — punches through the back face (z = 0 → wall).
  const cam = drawRoundedRectangle(p.camW, p.camH, p.camR)
    .sketchOnPlane("XY", -1)
    .extrude(p.wall + 4)
    .translate(p.camX, p.camY, 0);
  body = body.cut(cam);
  return body;
}

async function buildCase(p, ctx) {
  const k = await window.CADABRA_KERNEL.ready();
  const out = await k.run(runInWorker, {
    w: p.w, h: p.h, depth: p.depth, cornerR: p.cornerR, edgeR: p.edgeR, wall: p.wall,
    camW: p.camW, camH: p.camH, camR: p.camR, camX: p.camX, camY: p.camY,
  });
  return out;   // { geometry, edges, volume, blobSTL, blobSTEP }
}

function caseEstimate(out, p, ctx) {
  const mats = ctx.MATERIALS || MATERIALS, m = mats[ctx.printMat] || mats.pla;
  const cm3 = (out.volume || 0) / 1000;         // mm³ → cm³ (this is the WALL volume — it's shelled)
  const grams = cm3 * m.rho;
  const cost = grams / 1000 * m.price;
  return { cost, rows: [
    ["Wall volume", cm3.toFixed(1) + " cm³"],
    ["Mass", grams.toFixed(0) + " g"],
    ["Filament cost", "$" + cost.toFixed(2)],
    ["Outer size", `${p.w} × ${p.h} × ${p.depth} mm`],
    ["Wall", p.wall + " mm"],
  ] };
}

/* ============================================================ MODEL ========= */
window.MODEL = {
  meta: { name: "Phone case", units: "mm", fabricationDefault: "printed" },
  MATERIALS,
  parts: [
    {
      id: "case",
      name: "Phone case",
      engine: "kernel",              // replicad / OpenCASCADE WASM (fillet + shell + boolean)
      fab: "printed",
      dependsOn: [],
      render: { styles: ["pla", "clay", "metal", "wire"], default: "pla" },
      exports: ["step", "stl"],      // kernel parts emit watertight STEP + STL
      params: [
        { key: "w",       label: "Width",          unit: "mm", min: 50,  max: 100, step: 0.5,  default: 72,  group: "Body" },
        { key: "h",       label: "Height",         unit: "mm", min: 100, max: 180, step: 0.5,  default: 146 },
        { key: "depth",   label: "Depth",          unit: "mm", min: 7,   max: 20,  step: 0.5,  default: 12 },
        { key: "cornerR", label: "Corner radius",  unit: "mm", min: 2,   max: 25,  step: 0.5,  default: 12 },
        { key: "edgeR",   label: "Edge fillet",    unit: "mm", min: 0,   max: 5,   step: 0.25, default: 2.5 },
        { key: "wall",    label: "Wall thickness", unit: "mm", min: 1,   max: 5,   step: 0.25, default: 2,   group: "Shell" },
        { key: "camW",    label: "Cutout width",   unit: "mm", min: 8,   max: 60,  step: 0.5,  default: 32,  group: "Camera cutout" },
        { key: "camH",    label: "Cutout height",  unit: "mm", min: 8,   max: 60,  step: 0.5,  default: 32 },
        { key: "camR",    label: "Cutout radius",  unit: "mm", min: 0,   max: 20,  step: 0.5,  default: 6 },
        { key: "camX",    label: "Cutout X offset",unit: "mm", min: -40, max: 40,  step: 0.5,  default: -16 },
        { key: "camY",    label: "Cutout Y offset",unit: "mm", min: -60, max: 60,  step: 0.5,  default: 50 },
      ],
      build: (p, ctx) => buildCase(p, ctx),
      transform: (p, ctx) => ({ z: 0 }),
      estimate: (out, p, ctx) => caseEstimate(out, p, ctx),
    },
  ],
};
})();
