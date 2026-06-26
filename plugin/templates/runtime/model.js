/* ============================================================================
   model.js — THE AGENT-AUTHORED FILE. This is the file you edit per project.

   CLASSIC SCRIPT (no import/export) so it loads over file:// with no server.
   It attaches a global: window.MODEL = { meta, parts:[...] }.
   runtime.js (also a classic script) reads window.MODEL and renders it.

   ----------------------------------------------------------------------------
   THIS IS A GENERIC STUB: one rounded-corner box, analytic engine. Replace the
   geometry and params with your project's design. See examples/crystal for a
   richer multi-part assembly, and PROJECT.md for the design contract.

   THE CONTRACT (per part):
     build(params, ctx)   → analytic: { faces, ...published }   faces = array of
                              3D polygons ([[x,y,z],...]); published fields (vol,
                              footprint, etc.) are merged into ctx[partId] for
                              later parts and read by estimate()/the agent report.
                            → kernel:  { geometry, edges, ...measured }  (Buffer-
                              Geometries from a replicad Web Worker; see kernel/).
     transform(params,ctx)→ { z }  placement of this part in the assembly.
     estimate(out,params,ctx) → { cost, rows:[[label,value],...] }  fabrication-
                              aware (ctx.printMat selects the print material;
                              ctx.MATERIALS has densities/prices).
   Parts build in dependency order (dependsOn:[ids]); later parts read ctx[id].
   ============================================================================ */
(function () {
"use strict";

/* ---- tiny geometry helper: an axis-aligned box centred on X/Y, sitting on z=0 ---- */
function buildBox(p) {
  const x = p.w / 2, y = p.d / 2, z = p.h;
  const v = [
    [-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0],   // bottom ring
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],   // top ring
  ];
  // Each face is a polygon wound so its normal points outward.
  const faces = [
    [v[0], v[3], v[2], v[1]],   // bottom (−Z)
    [v[4], v[5], v[6], v[7]],   // top (+Z)
    [v[0], v[1], v[5], v[4]],   // −Y
    [v[1], v[2], v[6], v[5]],   // +X
    [v[2], v[3], v[7], v[6]],   // +Y
    [v[3], v[0], v[4], v[7]],   // −X
  ];
  const vol = p.w * p.d * p.h;                 // mm³ (published for estimate + agent report)
  return { faces, vol, footprint: Math.max(p.w, p.d) };
}

/* ---- fabrication profiles (densities g/cm³, price $/kg). Edit per project. ---- */
const MATERIALS = {
  pla:   { rho: 1.24, price: 22 },
  petg:  { rho: 1.27, price: 25 },
  abs:   { rho: 1.04, price: 24 },
  resin: { rho: 1.10, price: 40 },
};

function estimatePrinted(out, params, ctx) {
  const m = (ctx.MATERIALS || MATERIALS)[ctx.printMat] || MATERIALS.pla;
  const cm3 = out.vol / 1000;                  // mm³ → cm³
  const grams = cm3 * m.rho;
  const cost = grams / 1000 * m.price;         // solid-volume upper bound (100% infill)
  return { cost, rows: [
    ["Volume (solid)", cm3.toFixed(1) + " cm³"],
    ["Mass", grams.toFixed(0) + " g"],
    ["Filament cost", "$" + cost.toFixed(2)],
  ] };
}

/* ---- THE MODEL ---- */
window.MODEL = {
  meta: { name: "Example part", units: "mm", fabricationDefault: "printed" },
  MATERIALS,
  parts: [
    {
      id: "part",
      name: "Example box",
      engine: "analytic",            // 'analytic' (instant vertex math) | 'kernel' (replicad WASM)
      fab: "printed",                // 'printed' | 'cut-sheet' | 'milled' | 'carpentry'
      dependsOn: [],
      render: { styles: ["pla", "clay", "metal", "wire"], default: "pla" },
      exports: ["stl"],              // 'stl' | 'dxf' | 'svg' | 'step'
      params: [
        { key: "w", label: "Width",  unit: "mm", min: 10, max: 300, step: 1, default: 80, group: "Size" },
        { key: "d", label: "Depth",  unit: "mm", min: 10, max: 300, step: 1, default: 60 },
        { key: "h", label: "Height", unit: "mm", min: 5,  max: 300, step: 1, default: 40 },
      ],
      build: (p, ctx) => buildBox(p),
      transform: (p, ctx) => ({ z: 0 }),
      estimate: (out, p, ctx) => estimatePrinted(out, p, ctx),
    },
  ],
};
})();
