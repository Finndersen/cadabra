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
     { [partId]: buildOut, MATERIALS:{ [key]:{ rho:number, price:number } } }
     Shared build context. ctx[id] = the build output of each already-built
     dependency (declared in dependsOn[]). Read in later parts and in
     metrics()/cost(). ctx.MATERIALS is the shared density/price table.

   ─────────────────────────────────────────────────────────────────────────────
   PART METHOD SIGNATURES
   ─────────────────────────────────────────────────────────────────────────────

   build(params:Object, ctx:BuildCtx)
     → { faces:Faces, ...published }                          engine:'direct'
     → Promise<{ geometry:BufferGeometry, edges:BufferGeometry,
                 volume:number, blobSTL:Blob, blobSTEP:Blob }> engine:'kernel'

     direct: published fields (e.g. vol, seatZ, section) are merged into
       ctx[partId] so later parts and metrics()/cost() can read them.
       Optional renderFaces/edgeFaces: thick-panel display (see examples/crystal).
     kernel:   fn passed to k.run() is serialised (fn.toString()) and eval'd in
       the worker — it must be self-contained, no closures over model.js scope.

   transform(params:Object, ctx:BuildCtx)
     → { z:number }
     Z offset of this part in the assembly view.

   materials?: string[]                                        OPTIONAL
     Keys into MODEL.MATERIALS this part can be made from. If present, the
     runtime auto-renders a per-part "Material" picker (it's sugar for a
     synthetic ChoiceParam, so the selection lives at params.material like any
     other param — no separate global, persists/saves like everything else).

   metrics(out:buildOut, params:Object, ctx:BuildCtx)
     → [[label:string, value:string|number], ...]
     REQUIRED. Arbitrary computed quantities shown in the part's live card —
     not just cost: lengths, clearances, counts, fit checks, anything useful.

   cost(out:buildOut, params:Object, ctx:BuildCtx)                OPTIONAL
     → number | { value:number, label?:string } | null | undefined
     Only define this if the part's fabrication cost is meaningful/knowable.
     Omit entirely to opt the part out of the assembly "Bill of materials" row
     (which itself hides if NO part defines cost()). Return null/undefined to
     skip a given rebuild (e.g. cost depends on a param not yet set). When
     defined, the value is auto-appended as a row to the part's metrics card
     (labelled "Cost", or your custom label) — compute it once here, don't
     also hand-write it into metrics().

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
   See examples/crystal/model.js  — direct tier, multi-part (crystal + base)
       examples/phone_case/model.js — kernel tier, fillet + shell + boolean
   ============================================================================ */
(function () {
"use strict";

/* ── geometry helpers ────────────────────────────────────────────────────────────
   Pure functions for flat-panel and direct-geometry parts.                       */
function cross3(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dot3(a,b)  { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function sub3(a,b)  { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function norm3(v)   { const l=Math.sqrt(dot3(v,v)); return l<1e-12?[0,0,1]:[v[0]/l,v[1]/l,v[2]/l]; }
// Project 3D polygon onto its own plane → [[x,y],...] (for DXF export / area)
function flattenFace(verts){ const A=verts[0], u=norm3(sub3(verts[1],A));
  const n=norm3(cross3(u,sub3(verts[verts.length-1],A))), v=cross3(n,u);
  return verts.map(p=>{ const d=sub3(p,A); return [dot3(d,u),dot3(d,v)]; }); }
// 2D polygon area (shoelace)
function poly2dArea(pts){ let s=0,n=pts.length; for(let i=0;i<n;i++){ const j=(i+1)%n; s+=pts[i][0]*pts[j][1]-pts[j][0]*pts[i][1]; } return Math.abs(s)/2; }
// Extrude face outward by t → [front, back, ...side quads] for a thick-panel display
function thickenFace(verts,t){ const nm=norm3(cross3(sub3(verts[1],verts[0]),sub3(verts[verts.length-1],verts[0])));
  const o=verts.map(v=>[v[0]+nm[0]*t,v[1]+nm[1]*t,v[2]+nm[2]*t]);
  const N=verts.length, s=[[...o],[...verts].reverse()];
  for(let i=0;i<N;i++){ const j=(i+1)%N; s.push([verts[i],verts[j],o[j],o[i]]); } return s; }
// Regular N-gon ring at radius R, height Z
function nGonRing(R,Z,N=6){ return Array.from({length:N},(_,i)=>{ const a=i*2*Math.PI/N; return [R*Math.cos(a),R*Math.sin(a),Z]; }); }
// Quad faces connecting two coplanar vertex rings (same N, corresponding indices)
function ringFaces(bot,top){ return bot.map((_,i)=>{ const j=(i+1)%bot.length; return [bot[i],bot[j],top[j],top[i]]; }); }
/* ─────────────────────────────────────────────────────────────────────────────── */

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

function materialFor(params, ctx) {
  return (ctx.MATERIALS || MATERIALS)[params.material] || MATERIALS.pla;
}

function partMetrics(out, params, ctx) {
  const m = materialFor(params, ctx);
  const cm3 = out.vol / 1000;
  const grams = cm3 * m.rho;
  return [
    ["Volume (solid)", cm3.toFixed(1) + " cm³"],
    ["Mass",           grams.toFixed(0) + " g"],
  ];
}

function partCost(out, params, ctx) {
  const m = materialFor(params, ctx);
  const grams = (out.vol / 1000) * m.rho;
  return { value: grams / 1000 * m.price, label: "Filament cost" };
}

/* ---- MODEL ---- */
window.MODEL = {
  meta: { name: "Example part", units: "mm", fabricationDefault: "printed", currency: "$" },
  MATERIALS,
  parts: [
    {
      id:        "part",
      name:      "Example box",
      engine:    "direct",      // 'direct' | 'kernel'  ('analytic' accepted as alias for 'direct')
      fab:       "printed",    // 'printed' | 'cut-sheet' | 'milled' | 'carpentry'
      dependsOn: [],
      render:    { styles: ["pla", "clay", "metal", "wire"], default: "pla" },
      exports:   ["stl"],      // 'stl' | 'dxf' | 'svg' | 'step'
      materials: ["pla", "petg", "abs"],   // per-part material picker (sugar for a ChoiceParam)
      params: [
        { key:"w", label:"Width",  unit:"mm", min:10, max:300, step:1, default:80, group:"Size" },
        { key:"d", label:"Depth",  unit:"mm", min:10, max:300, step:1, default:60 },
        { key:"h", label:"Height", unit:"mm", min:5,  max:300, step:1, default:40 },
      ],
      build:     (p, ctx) => buildBox(p),
      transform: (p, ctx) => ({ z: 0 }),
      metrics:   (out, p, ctx) => partMetrics(out, p, ctx),
      cost:      (out, p, ctx) => partCost(out, p, ctx),
    },
  ],
};
})();
