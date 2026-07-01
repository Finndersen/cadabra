/* ============================================================================
   kernel.js — the Cadabra KERNEL TIER (replicad / OpenCASCADE WASM). First-class,
   fully supported, and verified end-to-end over file://. Use it for any part that
   needs fillets, chamfers, shells/hollows, booleans, lofts/sweeps, STEP export, or
   a watertight guarantee. CLASSIC SCRIPT — attaches window.CADABRA_KERNEL.

   Two-tier engine:
     ANALYTIC  → flat-panel / sheet-cut parts (exact planar faces, instant, zero
                 deps; DXF/SVG nesting). Plain JS vertex math in model.js.
     KERNEL    → curved B-rep features (fillet/chamfer/shell/boolean/loft/sweep),
                 STEP, watertight solids. replicad + OpenCASCADE WASM, this file.
   The kernel is LAZY: nothing loads until a kernel part calls ready(). The worked
   example examples/phone_case/ exercises fillet + shell + boolean and is the
   verification fixture for this path.

   HOW IT WORKS OVER file:// (NO server, verified):
   - replicad's ESM + the OpenCASCADE WASM both load from the CDN over https,
     which works from a file:// page.
   - The solve runs in a Web Worker so it never blocks the UI. A plain
     `new Worker('worker.js')` is blocked over file://, AND a Blob-URL *module*
     worker fails to instantiate over file:// (its module graph is fetched against
     an opaque blob origin). So we spawn a *CLASSIC* Blob-URL worker and use
     dynamic import() inside it — classic Blob workers spawn fine from file:// and
     still allow dynamic import() of CDN ESM. (This was the key fix; see
     workerSource() / spawnWorker().)
   - The worker meshes via replicad's native shape.mesh()/meshEdges() (plain
     arrays — no replicad-threejs-helper, whose bare `three` import can't resolve
     inside a worker) and ships those arrays back; the main thread rebuilds THREE
     BufferGeometries.
   - STL/STEP are NOT generated on every solve — OCC's STEP writer in particular
     is expensive, and most solves are just for the live preview, never exported.
     The worker instead caches the solved `shape` (keyed by request id, bounded
     LRU-ish eviction — see SHAPE_CACHE_LIMIT) and only writes STL/STEP when
     out.blobSTL()/out.blobSTEP() is actually called (i.e. on export-button
     click). Those calls round-trip to the worker again to regenerate from the
     cached shape; if it's been evicted (many solves since, or the worker
     restarted), they reject — the caller should nudge a param to rebuild, then
     retry the export.

   USAGE (from your model.js — a kernel part: engine:'kernel', async build):
     async build(p, ctx) {
       const k = await window.CADABRA_KERNEL.ready();           // boots once, cached
       const out = await k.run((replicad, p) => {
         // runs INSIDE the worker — may reference ONLY (replicad, p), no closure.
         return replicad.drawRoundedRectangle(p.w, p.d).sketchOnPlane()
                  .extrude(p.h).fillet(p.r);                    // return a replicad Shape
       }, p);
       return out;   // { geometry, edges, volume, blobSTL, blobSTEP }
     }
   The runtime renders { geometry, edges } directly (see renderPartMesh) and wires
   blobSTL/blobSTEP (both () => Promise<Blob> — async, since they may trigger a
   fresh worker round-trip) into the part's export buttons.
   ============================================================================ */
(function () {
"use strict";

const REPLICAD_VER = "0.23.0";
const URLS = {
  ocSingle: `https://cdn.jsdelivr.net/npm/replicad-opencascadejs@${REPLICAD_VER}/src/replicad_single.js`,
  wasm:     `https://cdn.jsdelivr.net/npm/replicad-opencascadejs@${REPLICAD_VER}/src/replicad_single.wasm`,
  replicad: `https://esm.sh/replicad@${REPLICAD_VER}`,
};

/* The worker body. It's a CLASSIC worker (NOT type:"module") because a Blob-URL
   MODULE worker fails to instantiate over file:// in Chromium (its module graph
   is fetched against an opaque blob origin and blocked). Classic workers, by
   contrast, spawn fine from a Blob URL over file:// AND still allow dynamic
   import() of CDN ESM — which is exactly what we use to load replicad + the OC
   WASM glue. Communicates via postMessage: { id, fnSource, params } in →
   { id, ok, result|error } out. replicad's native shape.mesh()/meshEdges()
   return plain arrays (vertices/triangles/normals, lines); we ship those and
   rebuild BufferGeometry on the main thread (no replicad-threejs-helper needed,
   which avoids its bare `three` import that can't resolve inside a worker). */
function workerSource(urls) {
  return `
// Surface any otherwise-opaque worker errors back to the main thread as text.
self.onerror = (msg, src, line, col, err) => {
  try { self.postMessage({ fatal: String((err && (err.stack || err)) || msg) }); } catch(_){}
  return true;
};
self.addEventListener("unhandledrejection", (e) => {
  try { self.postMessage({ fatal: "unhandledrejection: " + String((e.reason && (e.reason.stack || e.reason)) || e.reason) }); } catch(_){}
});

const WASM = ${JSON.stringify(urls.wasm)};
const OC_URL = ${JSON.stringify(urls.ocSingle)};
const REPLICAD_URL = ${JSON.stringify(urls.replicad)};

let replicad = null;
let bootPromise = null;
function ensure(){
  if(bootPromise) return bootPromise;
  bootPromise = (async () => {
    // Dynamic import (inside try/catch) so CDN/import failures are reportable
    // rather than killing the worker with an opaque error event.
    const ocMod = await import(OC_URL);
    const opencascade = ocMod.default || ocMod;
    replicad = await import(REPLICAD_URL);
    const OC = await opencascade({ locateFile: () => WASM });
    replicad.setOC(OC);
  })();
  return bootPromise;
}

// Solved shapes are kept around (keyed by the solve request's id) so an
// export click can regenerate STL/STEP later without re-solving. FIFO
// eviction bounds this — only recent solves are ever realistically exported.
const _shapes = new Map();
const SHAPE_CACHE_LIMIT = 16;
function cacheShape(id, shape){
  _shapes.set(id, shape);
  if (_shapes.size > SHAPE_CACHE_LIMIT) _shapes.delete(_shapes.keys().next().value);
}

self.onmessage = async (e) => {
  const { id, fnSource, params, exportShapeId, format } = e.data || {};
  if (id == null) return;

  if (exportShapeId != null) {                // on-demand export of a cached shape
    try {
      const shape = _shapes.get(exportShapeId);
      if (!shape) throw new Error("shape no longer cached — nudge a param to rebuild, then retry export");
      const blob = format === "stl" ? await shape.blobSTL() : await shape.blobSTEP();
      const data = await blob.arrayBuffer();
      self.postMessage({ id, ok: true, result: { data } }, [data]);
    } catch (err) {
      self.postMessage({ id, ok: false, error: String((err && (err.stack || err)) || err) });
    }
    return;
  }

  try {
    await ensure();
    const fn = (0, eval)("(" + fnSource + ")");
    const shape = await fn(replicad, params);
    // replicad native meshing → { triangles, vertices, normals }, { lines }
    const m = shape.mesh({ tolerance: 0.05, angularTolerance: 30 });
    const ed = shape.meshEdges();
    const faces = { vertices: m.vertices, normals: m.normals, triangles: m.triangles };
    const lines = { lines: ed.lines };
    // measureVolume can legitimately fail on a valid shape without the overall
    // solve being wrong — don't let it swallow the whole result, but don't
    // swallow the failure silently either. warnings rides back to the main
    // thread, which is where it gets logged (console.* inside a dedicated
    // worker isn't reliably visible to a headless driver watching the page).
    const warnings = [];
    let volume = null;
    try { volume = replicad.measureVolume ? replicad.measureVolume(shape) : null; }
    catch (e) { warnings.push('measureVolume failed: ' + ((e && e.message) || e)); }
    cacheShape(id, shape);
    self.postMessage({ id, ok: true, result: { faces, lines, volume, warnings } });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && (err.stack || err)) || err) });
  }
};
self.postMessage({ ready: true });
`;
}

let _worker = null, _readyPromise = null, _seq = 0;
const _pending = new Map();

let _fatal = null;
function spawnWorker() {
  const blob = new Blob([workerSource(URLS)], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const w = new Worker(url);   // CLASSIC worker — a module worker can't instantiate from a Blob over file://
  URL.revokeObjectURL(url);
  w.onmessage = (e) => {
    const d = e.data;
    if (!d) return;
    if (d.ready) return;                       // boot ping
    if (d.fatal) {                             // worker-level error (e.g. CDN import failed)
      _fatal = d.fatal;
      for (const p of _pending.values()) p.reject(new Error("kernel worker fatal: " + d.fatal));
      _pending.clear();
      return;
    }
    const p = _pending.get(d.id);
    if (!p) return;
    _pending.delete(d.id);
    if (d.ok) p.resolve(d.result); else p.reject(new Error(d.error));
  };
  w.onerror = (e) => {
    const msg = (e && (e.message || (e.filename ? e.filename + ":" + e.lineno : ""))) || "worker error (opaque)";
    _fatal = msg;
    for (const p of _pending.values()) p.reject(new Error("kernel worker error: " + msg));
    _pending.clear();
  };
  return w;
}

// Requests STL/STEP for a previously-solved (still-cached) shape from the
// worker. Rejects if that shape has since been evicted from the worker's
// cache — the caller (doExport in runtime.js) should surface that to the user.
async function exportBlob(shapeId, format, mime) {
  const id = ++_seq;
  const result = await new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    _worker.postMessage({ id, exportShapeId: shapeId, format });
  });
  return new Blob([result.data], { type: mime });
}

async function ready() {
  if (_readyPromise) return _readyPromise;
  _readyPromise = (async () => {
    _worker = spawnWorker();
    // helper to turn meshed arrays into THREE BufferGeometries on the main thread
    const THREE = window.__THREE;             // runtime stashes three here for the kernel tier
    const { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } =
      THREE || {};
    return {
      async run(fn, params) {
        const id = ++_seq;
        const result = await new Promise((resolve, reject) => {
          _pending.set(id, { resolve, reject });
          _worker.postMessage({ id, fnSource: fn.toString(), params });
        });
        const out = { volume: result.volume };
        if (THREE) {
          out.geometry = meshToGeometry(THREE, result.faces);
          out.edges = edgesToGeometry(THREE, result.lines);
        } else {
          out.faces = result.faces; out.lines = result.lines;
        }
        // Lazy — only actually round-trips to the worker (re-running OCC's STL/
        // STEP writers against the cached shape) when an export button is clicked.
        out.blobSTL  = () => exportBlob(id, "stl", "model/stl");
        out.blobSTEP = () => exportBlob(id, "step", "application/step");
        if (result.warnings && result.warnings.length) {
          out.warnings = result.warnings;
          for (const w of result.warnings) console.error("kernel: " + w);
        }
        return out;
      },
    };
  })();
  return _readyPromise;
}

// `faces` from replicad-threejs-helper.syncGeometries: { vertices, normals, triangles }
function meshToGeometry(THREE, mesh) {
  const g = new THREE.BufferGeometry();
  if (!mesh || !mesh.vertices) return g;
  g.setAttribute("position", new THREE.Float32BufferAttribute(mesh.vertices, 3));
  if (mesh.triangles) g.setIndex(Array.from(mesh.triangles));
  if (mesh.normals && mesh.normals.length) g.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
  else g.computeVertexNormals();
  return g;
}
// `lines` from syncGeometries: { lines } (flat [x,y,z, x,y,z, ...] segment pairs)
function edgesToGeometry(THREE, lines) {
  const g = new THREE.BufferGeometry();
  if (!lines || !lines.lines) return g;
  g.setAttribute("position", new THREE.Float32BufferAttribute(lines.lines, 3));
  return g;
}

window.CADABRA_KERNEL = { ready, URLS, version: REPLICAD_VER };
})();
