# Cadabra — model.js contract & recipes

`model.js` is the **only file you edit** in the common case. It's a **classic
script** (no `import`/`export`) so it loads over `file://` with no server. It sets:

```js
(function () {
"use strict";
// ... helpers ...
window.MODEL = { meta, MATERIALS, parts: [ /* ... */ ] };
})();
```

`runtime.js` reads `window.MODEL` and does everything else: the part-card
accordion, slider+number controls, the dependency-ordered build pipeline,
three.js rendering with the tuned orbit navigation, per-part + assembly estimates,
exports, config save/load, localStorage, the Reload button, and `window.__app`.

## Types

```
RangeParam
  { key:string, label:string, unit?:string,
    min:number, max:number, step:number, default:number,
    group?:string, hardMin?:number, hardMax?:number }
  Renders as slider + number input.
  group:         starts a new labelled section in the controls card.
  hardMin/Max:   let a typed value exceed the slider's soft range (slider pins).

ChoiceParam
  { key:string, label:string, type:'choice',
    options:[[value, displayLabel], ...], default:value, group?:string }
  Renders as segmented buttons.

Faces  →  Array<Array<[x:number, y:number, z:number]>>
  Array of 3D polygons. Each polygon is an array of [x,y,z] vertices wound so
  the outward normal faces away from the model interior.

BuildCtx
  { [partId]: buildOut, printMat:string,
    MATERIALS:{ [key]:{ rho:number, price:number } } }
  Shared build context passed to build/transform/estimate.
  ctx[id]       = build output of each already-built dependency (from dependsOn[]).
  ctx.printMat  = user-selected material key (e.g. 'pla').
  ctx.MATERIALS = material density/price table.
```

## MODEL shape

```js
window.MODEL = {
  meta: { name: "My Thing", units: "mm", fabricationDefault: "printed" },
  MATERIALS: { pla:{rho:1.24,price:22}, petg:{rho:1.27,price:25},
               abs:{rho:1.04,price:24}, resin:{rho:1.10,price:40} },
  parts: [ /* one PartDef per part; an assembly is an ordered array */ ],
};
```

## Part object

```js
{
  id:        string,
  name:      string,
  engine:    'analytic' | 'kernel',
  fab:       'printed' | 'cut-sheet' | 'milled' | 'carpentry',
  dependsOn: string[],   // ids of parts that must build before this one
  render:    { styles:string[], default:string },
  exports:   ('stl'|'dxf'|'svg'|'step')[],
  params:    (RangeParam | ChoiceParam)[],

  build(params:Object, ctx:BuildCtx)
    → { faces:Faces, ...published }                          // engine:'analytic'
    → Promise<{ geometry:BufferGeometry, edges:BufferGeometry,
                volume:number, blobSTL:Blob, blobSTEP:Blob }> // engine:'kernel'

  transform(params:Object, ctx:BuildCtx) → { z:number }

  estimate(out:buildOut, params:Object, ctx:BuildCtx)
    → { cost:number, rows:[[label:string, value:string|number], ...] }

  // OPTIONAL — drives the Export tab. If absent/null, auto-derived from fab type.
  exportPieces?(out:buildOut, params:Object, ctx:BuildCtx)
    → { mode:'sheet',
        pieces:[{ id:string, label:string, pts2d:[x,y][], qty:number,
                  dims:{w,h}, faceIndices?:number[] }] }
    | { mode:'solid',  pieces:[{ id, label, qty }] }
    | { mode:'board-list',
        pieces:[{ id, label, length, width, thickness, qty, grain?:string }] }
    | null
}
```

### exportPieces() — the Export tab

The Export tab (Design/Export toggle) shows fab-appropriate previews and download
buttons per part. It derives sub-pieces automatically from `out.faces` + `part.fab`
if `exportPieces` is absent or returns null:

- **`cut-sheet` / `milled`** → auto sig3d panel groups from `out.faces` (one group
  per unique shape, labelled A/B/C…). Each group shows a 2D polygon preview, qty,
  dimensions, a per-piece DXF button, and batch ZIP + SVG nesting actions.
- **`printed` / kernel** → whole-part solid mode: estimate rows + STL/STEP buttons.
- **`carpentry`** → treated as cut-sheet for now (board-list is future work).

Define `exportPieces()` when you want semantic labels, custom grouping that differs
from edge-signature matching, or a board-list for carpentry. Example (crystal):

```js
exportPieces(out, p, ctx) {
  // The faces array is already one face per panel; sig3d auto-groups them.
  // Return null to use the runtime's auto-grouping with "Panel A/B/C" labels.
  // Or return a spec with meaningful labels:
  return null;   // auto is fine for most analytic parts
}
```

Clicking a piece card in the Export tab **highlights** the corresponding faces in
the 3D view (yellow overlay), making it easy to identify which physical panel
corresponds to each shape group.

## build() — analytic tier

Return `{ faces, ...published }`. `faces` is an array of 3D polygons, each a list
of `[x,y,z]` points wound so the normal points OUTWARD. Published fields (e.g.
`vol`, `footprint`, `seatZ`, `section`, `bottom`) are merged into `ctx[id]` for
later parts and read by `estimate()` and the agent report.

```js
function buildBox(p) {
  const x=p.w/2, y=p.d/2, z=p.h;
  const v=[[-x,-y,0],[x,-y,0],[x,y,0],[-x,y,0],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]];
  const faces=[
    [v[0],v[3],v[2],v[1]],  // -Z   (wind for outward normal)
    [v[4],v[5],v[6],v[7]],  // +Z
    [v[0],v[1],v[5],v[4]],[v[1],v[2],v[6],v[5]],[v[2],v[3],v[7],v[6]],[v[3],v[0],v[4],v[7]],
  ];
  return { faces, vol:p.w*p.d*p.h, footprint:Math.max(p.w,p.d) };
}
```

The runtime triangulates polygons (fan from vertex 0), computes vertex normals,
and draws clean edge lines from the polygon edges. For **cut-sheet** parts the
core (zero-thickness) `faces` drive DXF/SVG nesting; if you want a real sheet
thickness in the display, extrude OUTWARD along each face normal and return the
thick slabs as `renderFaces` (+ outer polygons as `edgeFaces`) while keeping the
core `faces` for export. See `examples/crystal/model.js` `thickenPanels()`.

## build() — kernel tier (replicad WASM, in a Blob-URL Web Worker)

For curved B-rep features (fillet, chamfer, shell, boolean, loft, sweep, STEP,
watertight). First-class and **verified end-to-end over file://** — the kernel
loads replicad ESM + OpenCASCADE WASM from the CDN and runs in a Web Worker (no
server, no main-thread blocking). It lives in `kernel.js` (`window.CADABRA_KERNEL`)
and **lazy-loads only when a kernel part calls `ready()`**. A kernel part sets
`engine:'kernel'` and an **async** `build`:

```js
function runInWorker(replicad, p) {            // runs INSIDE the worker
  let s = replicad.drawRoundedRectangle(p.w, p.h)
            .sketchOnPlane().extrude(p.depth)
            .fillet(p.edgeR);                  // fillet all edges
  s = s.shell(p.wall, f => f.inPlane("XY", p.depth));   // hollow, open top face
  const cam = replicad.drawRoundedRectangle(p.camW, p.camH, p.camR)
                .sketchOnPlane("XY", -1).extrude(p.wall + 4)
                .translate(p.camX, p.camY, 0);
  return s.cut(cam);                           // boolean — return a replicad Shape
}
async build(p, ctx) {
  const k = await window.CADABRA_KERNEL.ready();        // boots once, cached
  return await k.run(runInWorker, { /* plain params */ });
  // → { geometry, edges, volume, blobSTL, blobSTEP } — the runtime renders
  //   { geometry, edges } directly; export buttons use blobSTL/blobSTEP.
}
```

**The `k.run(fn, params)` function is serialised (`fn.toString()`) and `eval`'d in
the worker**, so it must be self-contained: it may reference ONLY its `(replicad,
p)` arguments — no closure over `model.js`. Pass everything it needs via `params`.

For a kernel part, `estimate()` uses the returned `volume` (mm³) directly — note a
shelled part's volume is the WALL volume, which is what you print. The runtime
shows a "solving…" badge while async builds are in flight and refits the camera on
the first solve. Pin to replicad 0.23.0 (the URLs in `kernel.js`). Full worked
example: `examples/phone_case/`.

## transform() and dependencies

`transform(params, ctx) → { z }` places the part along Z in the assembly. Parts
build in dependency order; a dependent reads its dependency's published output:

```js
// crystal publishes section(h)/bottom/panelThk; base reads them and seats the
// crystal at base.seatZ:
transform: (p, ctx) => ({ z: ctx.base ? ctx.base.seatZ : 0 }),
```

## estimate() — fabrication-aware

```js
function estimatePrinted(out, params, ctx) {
  const m = (ctx.MATERIALS || MATERIALS)[ctx.printMat] || MATERIALS.pla;
  const cm3 = out.vol/1000, grams = cm3*m.rho, cost = grams/1000*m.price;
  return { cost, rows:[
    ['Volume (solid)', cm3.toFixed(1)+' cm³'],
    ['Mass', grams.toFixed(0)+' g'],
    ['Filament cost', '$'+cost.toFixed(2)],
  ]};
}
```

`ctx.printMat` is the user-selected print material; `ctx.MATERIALS` is the table.
Return `cost` (number) and `rows` (label/value pairs shown in the card). The
runtime sums `cost` across parts into the assembly BOM.

## The window.__app hook (must always survive)

```js
window.__app = {
  setParams(partId, obj), getState(), loadConfig(obj),
  setVisible(partId, bool), setStyle(partId, name), setView(name),
  report(),                 // bbox/volume/cavity/fits per part + assembly roll-up
  parts(),                  // [{id,name,fab,exports}]
  render(), screenshot(),   // screenshot() → PNG dataURL (preserveDrawingBuffer)
  ready,                    // true once booted
  solving, solveCount,      // async-build state: wait for solveCount>0 && !solving
};
```

For kernel parts (async builds), a headless driver should wait for
`__app.solveCount > 0 && !__app.solving` before screenshotting — the geometry
lands a few seconds after `ready` while replicad + WASM boot. `verify.mjs` and
`screenshot.mjs` already do this.

Use `report()` for measurements you can't eyeball (did the boolean remove
material? does the cavity fit? largest panel/segment?). Use `screenshot()` (via
the CLI script) only when you actually need to look.

## Deeper customisation

The runtime is **copied into each project** (project-owned). For the ~10% of
projects that need more than the schema, edit that project's own `runtime.js` /
`index.html` / `theme.css` — ordinary code editing, not a hook API. The only
invariant: keep `window.__app`.

## Config format

Saved configs are JSON: `{ _app:'cadabra', _v:1, state, view:{vis,styles},
printMat, explode }`. The runtime also imports the legacy `crystal_designer
{p,b,v}` format and bare param objects for part 0.
