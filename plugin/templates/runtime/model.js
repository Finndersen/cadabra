/* ============================================================================
   model.js — THE AGENT-AUTHORED FILE.

   CLASSIC SCRIPT (no import/export): attaches window.MODEL, read by runtime.js.
   Works over file:// with no server. Edit params + geometry here; the runtime
   does everything else (controls, rendering, estimates, exports, config, Reload).

   TYPE REFERENCE
   ─────────────────────────────────────────────────────────────────────────────
   RangeParam
     { key:string, label:string, unit?:string,
       min:number, max:number, step:number, default:number,
       group?:string, hardMin?:number, hardMax?:number }
     Renders as slider + number input.
     group:    starts a new labelled section in the controls card.
     hardMin/hardMax: let a typed value exceed the slider's soft range while
                      the slider pins at its end.

   ChoiceParam
     { key:string, label:string, type:'choice',
       options:[[value, displayLabel], ...], default:value, group?:string }
     Renders as segmented buttons.

   Faces  →  Array<Array<[x:number, y:number, z:number]>>
     Array of 3D polygons. Each polygon is a list of [x,y,z] vertices wound so
     the outward normal faces away from the model interior.

   BuildCtx
     { [partId]: buildOut, printMat:string,
       MATERIALS:{ [key]:{ rho:number, price:number } } }
     Shared build context. ctx[id] = the build output of each already-built
     dependency (declared in dependsOn[]). Read in later parts and in estimate().
     ctx.printMat is the user-selected material key. ctx.MATERIALS is the table.

   ─────────────────────────────────────────────────────────────────────────────
   PART METHOD SIGNATURES
   ─────────────────────────────────────────────────────────────────────────────

   build(params:Object, ctx:BuildCtx)
     → { faces:Faces, ...published }                          engine:'analytic'
     → Promise<{ geometry:BufferGeometry, edges:BufferGeometry,
                 volume:number, blobSTL:Blob, blobSTEP:Blob }> engine:'kernel'

     analytic: published fields (e.g. vol, seatZ, section) are merged into
       ctx[partId] so later parts and estimate() can read them.
       Optional renderFaces/edgeFaces: thick-panel display (see examples/crystal).
     kernel:   fn passed to k.run() is serialised (fn.toString()) and eval'd in
       the worker — it must be self-contained, no closures over model.js scope.

   transform(params:Object, ctx:BuildCtx)
     → { z:number }
     Z offset of this part in the assembly view.

   estimate(out:buildOut, params:Object, ctx:BuildCtx)
     → { cost:number, rows:[[label:string, value:string|number], ...] }
     out is the object returned by build(). cost feeds the assembly BOM total.

   exportPieces?(out:buildOut, params:Object, ctx:BuildCtx)        OPTIONAL
     → { mode:'sheet',
         pieces:[{ id, label, pts2d:[x,y][], qty:number,
                   dims:{w,h}, faceIndices?:number[] }] }
     | { mode:'solid',  pieces:[{ id, label, qty }] }
     | { mode:'board-list',
         pieces:[{ id, label, length, width, thickness, qty, grain? }] }
     | null
     Drives the Export tab: piece previews, per-piece DXF, batch actions.
     If absent/null, auto-derived: cut-sheet/milled → sig3d panel groups;
     printed/kernel → whole-part solid mode.

   ─────────────────────────────────────────────────────────────────────────────
   See examples/crystal/model.js  — analytic tier, multi-part (crystal + base)
       examples/phone_case/model.js — kernel tier, fillet + shell + boolean
   ============================================================================ */
(function () {
"use strict";

/* ---- fabrication profiles (densities g/cm³, price $/kg). Edit per project. ---- */
const MATERIALS = {
  pla:   { rho: 1.24, price: 22 },
  petg:  { rho: 1.27, price: 25 },
  abs:   { rho: 1.04, price: 24 },
  resin: { rho: 1.10, price: 40 },
};

/* ---- geometry helper: axis-aligned box centred on X/Y, sitting on z=0 ---- */
function buildBox(p) {
  const x = p.w / 2, y = p.d / 2, z = p.h;
  const v = [
    [-x,-y,0],[x,-y,0],[x,y,0],[-x,y,0],  // bottom ring
    [-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z],  // top ring
  ];
  // faces wound so each outward normal faces away from centre
  const faces = [
    [v[0],v[3],v[2],v[1]],  // −Z
    [v[4],v[5],v[6],v[7]],  // +Z
    [v[0],v[1],v[5],v[4]],  // −Y
    [v[1],v[2],v[6],v[5]],  // +X
    [v[2],v[3],v[7],v[6]],  // +Y
    [v[3],v[0],v[4],v[7]],  // −X
  ];
  const vol = p.w * p.d * p.h;  // mm³ — published for estimate + ctx
  return { faces, vol, footprint: Math.max(p.w, p.d) };
}

function estimatePrinted(out, params, ctx) {
  const m = (ctx.MATERIALS || MATERIALS)[ctx.printMat] || MATERIALS.pla;
  const cm3 = out.vol / 1000;
  const grams = cm3 * m.rho;
  const cost = grams / 1000 * m.price;
  return { cost, rows: [
    ["Volume (solid)", cm3.toFixed(1) + " cm³"],
    ["Mass",           grams.toFixed(0) + " g"],
    ["Filament cost",  "$" + cost.toFixed(2)],
  ]};
}

/* ---- MODEL ---- */
window.MODEL = {
  meta: { name: "Example part", units: "mm", fabricationDefault: "printed" },
  MATERIALS,
  parts: [
    {
      id:        "part",
      name:      "Example box",
      engine:    "analytic",   // 'analytic' | 'kernel'
      fab:       "printed",    // 'printed' | 'cut-sheet' | 'milled' | 'carpentry'
      dependsOn: [],
      render:    { styles: ["pla", "clay", "metal", "wire"], default: "pla" },
      exports:   ["stl"],      // 'stl' | 'dxf' | 'svg' | 'step'
      params: [
        { key:"w", label:"Width",  unit:"mm", min:10, max:300, step:1, default:80, group:"Size" },
        { key:"d", label:"Depth",  unit:"mm", min:10, max:300, step:1, default:60 },
        { key:"h", label:"Height", unit:"mm", min:5,  max:300, step:1, default:40 },
      ],
      build:     (p, ctx) => buildBox(p),
      transform: (p, ctx) => ({ z: 0 }),
      estimate:  (out, p, ctx) => estimatePrinted(out, p, ctx),
    },
  ],
};
})();
