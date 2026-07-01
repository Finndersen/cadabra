/* ============================================================================
   runtime.js — the canonical Cadabra engine (project-owned, editable copy).

   CLASSIC SCRIPT (no import/export) so it loads over file:// with no server.
   It attaches window.CADABRA; index.html's inline module imports three.js from
   the CDN and calls CADABRA.boot({THREE, OrbitControls, RoomEnvironment}).

   Reads window.MODEL (from model.js, also a classic script) and: builds the
   part-card accordion (Design tab), the dependency-ordered build pipeline,
   three.js rendering with custom orbit navigation, per-part estimates + the
   assembly mixed-BOM, an Export tab (per-part panel previews, fab-typed export
   actions), config save/load (+ legacy import), localStorage, the Reload button,
   and the window.__app agent hook.

   THE ONE INVARIANT through any customisation: keep window.__app (esp.
   screenshot()) intact, so the agent keeps its "eyes".
   ============================================================================ */
(function () {
"use strict";

/* ============================================================ generic math == */
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const unit=a=>{const l=len(a)||1;return [a[0]/l,a[1]/l,a[2]/l];};
function triangulate(faces){ const t=[];
  for(const f of faces) for(let k=1;k<f.length-1;k++) t.push([f[0],f[k],f[k+1]]); return t; }

/* ============================================ panel-flatten / DXF / zip (export) */
function flatten(t){
  const o=t[0], u=unit(sub(t[1],o));
  const nrm=unit(cross(sub(t[1],o),sub(t[2],o)));
  const v=cross(nrm,u);
  let pts=t.map(p=>[dot(sub(p,o),u), dot(sub(p,o),v)]);
  const mnx=Math.min(...pts.map(p=>p[0])), mny=Math.min(...pts.map(p=>p[1]));
  return pts.map(p=>[p[0]-mnx, p[1]-mny]);
}
function polyEdges(f){ const e=[];
  for(let k=0;k<f.length;k++) e.push(len(sub(f[k],f[(k+1)%f.length]))); return e; }
function edgeMapper(faces){
  const all=[]; for(const f of faces) for(const e of polyEdges(f)) all.push(e);
  const sorted=[...all].sort((a,b)=>a-b), tol=2, centers=[];
  for(const x of sorted) if(!centers.length||x-centers[centers.length-1]>tol) centers.push(x);
  return x=>{ let best=centers[0], bd=1e9;
    for(const c of centers){ const dd=Math.abs(c-x); if(dd<bd){bd=dd;best=c;} } return Math.round(best); };
}
const sig3d=(f,map)=>polyEdges(f).map(map).sort((a,b)=>a-b).join(',');
function crc32(bytes){ let crc=0xFFFFFFFF;
  for(let i=0;i<bytes.length;i++){ let c=(crc^bytes[i])&0xFF;
    for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); crc=(crc>>>8)^c; }
  return (crc^0xFFFFFFFF)>>>0; }
function buildZip(files){
  const u16=v=>[v&255,(v>>8)&255], u32=v=>[v&255,(v>>8)&255,(v>>16)&255,(v>>24)&255];
  const chunks=[], central=[]; let offset=0;
  for(const f of files){ const crc=crc32(f.data), sz=f.data.length;
    const name=Array.from(new TextEncoder().encode(f.name));
    const lh=[].concat(u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(sz),u32(sz),u16(name.length),u16(0),name);
    chunks.push(new Uint8Array(lh), f.data);
    central.push(new Uint8Array([].concat(u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(sz),u32(sz),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name)));
    offset+=lh.length+sz; }
  let cdSize=0; central.forEach(c=>cdSize+=c.length);
  const end=new Uint8Array([].concat(u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(cdSize),u32(offset),u16(0)));
  const all=[...chunks,...central,end]; let total=0; all.forEach(a=>total+=a.length);
  const out=new Uint8Array(total); let p=0; for(const a of all){ out.set(a,p); p+=a.length; }
  return out;
}
function panelDXF(pts,label){
  let s='0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n';
  s+='0\nLWPOLYLINE\n8\nCUT\n90\n'+pts.length+'\n70\n1\n43\n0\n';
  for(const p of pts) s+='10\n'+p[0].toFixed(3)+'\n20\n'+p[1].toFixed(3)+'\n';
  const cx=pts.reduce((a,p)=>a+p[0],0)/pts.length, cy=pts.reduce((a,p)=>a+p[1],0)/pts.length;
  s+='0\nTEXT\n8\nLABEL\n10\n'+cx.toFixed(2)+'\n20\n'+cy.toFixed(2)+'\n40\n14\n1\n'+label+'\n0\nENDSEC\n0\nEOF\n';
  return s;
}
function facesToSTL(faces,name){
  let s=`solid ${name}\n`;
  for(const t of triangulate(faces)){
    const nrm=unit(cross(sub(t[1],t[0]),sub(t[2],t[0])));
    s+=`facet normal ${nrm[0]} ${nrm[1]} ${nrm[2]}\nouter loop\n`;
    for(const p of t) s+=`vertex ${p[0]} ${p[1]} ${p[2]}\n`;
    s+='endloop\nendfacet\n'; }
  return s+`endsolid ${name}\n`;
}
function dl(name,data,mime){
  const b=new Blob([data],{type:mime||'text/plain'});
  const u=URL.createObjectURL(b), a=document.createElement('a');
  a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
}

/* ============================================================================
   boot(libs) — called by index.html's inline module after three.js loads.
   Everything that touches THREE lives here.
   ============================================================================ */
function boot(libs){
  const THREE = libs.THREE, OrbitControls = libs.OrbitControls, RoomEnvironment = libs.RoomEnvironment;
  window.__THREE = THREE;          // kernel.js (optional kernel tier) reads this to build BufferGeometries

  const MODEL = window.MODEL;
  if(!MODEL || !MODEL.parts || !MODEL.parts.length){
    throw new Error("window.MODEL is missing or has no parts — check model.js");
  }
  const SCHEMA = MODEL.parts;
  const MATERIALS = MODEL.MATERIALS || { pla:{rho:1.24,price:22}, petg:{rho:1.27,price:25},
                                         resin:{rho:1.10,price:40}, abs:{rho:1.04,price:24} };

  // part.materials:string[] (keys into MATERIALS) is sugar for a per-part material
  // picker: it's prepended as a synthetic ChoiceParam so it rides the existing
  // param state/save-load/UI machinery for free — no separate global needed.
  function materialLabel(key){ const m=MATERIALS[key]; if(!m) return key;
    return key.toUpperCase()+' · '+m.rho+' g/cm³ · $'+m.price+'/kg'; }
  function partParamsWithMaterial(part){
    if(!part.materials||!part.materials.length) return part.params;
    return [{ key:'material', label:'Material', type:'choice', group:'Material',
      options:part.materials.map(k=>[k,materialLabel(k)]), default:part.materials[0] }, ...part.params];
  }

  /* ============================================================ state ========= */
  const LS_KEY='cadabra_'+(MODEL.meta&&MODEL.meta.name?MODEL.meta.name.replace(/\W+/g,'_'):'app')+'_v1';
  const state={};                  // state[partId] = { key: value }
  const view={ vis:{}, styles:{}, collapsed:{}, active:SCHEMA[0].id };
  let explode=0;
  function initState(){
    for(const part of SCHEMA){
      state[part.id]={}; for(const d of partParamsWithMaterial(part)) state[part.id][d.key]=d.default;
      view.vis[part.id]=true; view.styles[part.id]=part.render.default; view.collapsed[part.id]=false;
    }
  }
  function saveState(){ try{ localStorage.setItem(LS_KEY,JSON.stringify({state,view,explode})); }catch(e){} }
  function loadState(){ try{ const s=localStorage.getItem(LS_KEY); if(!s) return; const o=JSON.parse(s);
    for(const part of SCHEMA){ if(o.state&&o.state[part.id]) Object.assign(state[part.id],o.state[part.id]); }
    if(o.view){ Object.assign(view.vis,o.view.vis||{}); Object.assign(view.styles,o.view.styles||{});
      Object.assign(view.collapsed,o.view.collapsed||{}); }
    if(typeof o.explode==='number') explode=o.explode;
  } catch(e){} }
  const orderedParts=()=>{           // topological-ish: deps before dependents
    const done=new Set(), out=[]; let guard=0;
    while(out.length<SCHEMA.length && guard++<50)
      for(const p of SCHEMA) if(!done.has(p.id) && (p.dependsOn||[]).every(d=>done.has(d))){ out.push(p); done.add(p.id); }
    return out;
  };

  /* ============================================================ three.js ====== */
  const viewEl=document.getElementById('view');
  const scene=new THREE.Scene(); scene.background=new THREE.Color(0x0c0f14);
  const camera=new THREE.PerspectiveCamera(45,1,1,100000); camera.up.set(0,0,1);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  viewEl.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=false;                          // CAD-style direct orbit
  controls.enableRotate=false;                           // rotation is custom (pivot = model centre)
  controls.enablePan=true;                               // pan with right-drag (mouse) or two-finger scroll (trackpad)
  controls.zoomToCursor=true;                            // zoom toward the pointer
  controls.zoomSpeed=10;
  scene.add(new THREE.AmbientLight(0xffffff,0.6));
  const d1=new THREE.DirectionalLight(0xffffff,0.85); d1.position.set(1,-1,1.6); scene.add(d1);
  const d2=new THREE.DirectionalLight(0x88e0ff,0.35); d2.position.set(-1,1,0.4); scene.add(d2);
  const pmrem=new THREE.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(new RoomEnvironment(),0.04).texture;

  function makeMats(){ return {
    acrylic:new THREE.MeshPhysicalMaterial({color:0x9fe8ef,metalness:0,roughness:0.12,
      transmission:0.92,ior:1.3,thickness:6,transparent:true,opacity:0.92,
      side:THREE.FrontSide,attenuationColor:0x9fe8ef,attenuationDistance:600}),
    pla:    new THREE.MeshStandardMaterial({color:0x7c8794,metalness:0.08,roughness:0.7,side:THREE.DoubleSide}),
    clay:   new THREE.MeshStandardMaterial({color:0xd9d2c8,metalness:0,roughness:0.95,side:THREE.DoubleSide}),
    metal:  new THREE.MeshStandardMaterial({color:0xc2cad2,metalness:0.92,roughness:0.28,side:THREE.DoubleSide}),
    wire:   new THREE.MeshBasicMaterial({color:0x9af0f5,wireframe:true}),
  }; }
  const MATS=makeMats();
  const world=new THREE.Group(); scene.add(world);
  const partGroups={}, partMeshes={};
  for(const part of SCHEMA){ const g=new THREE.Group(); world.add(g); partGroups[part.id]=g; }
  // Camera navigation: OrbitControls handles PAN (right-drag) and ZOOM-TO-CURSOR (scroll). ROTATION
  // is custom so its pivot stays tied to the MODEL CENTRE (world origin) regardless of pan/zoom.
  const PIVOT=new THREE.Vector3(0,0,0);   // model centre — recenter() keeps it at the world origin
  const _UP=new THREE.Vector3(0,0,1);
  let _rot=false,_px=0,_py=0;
  // per-drag state: offsets of camera & target from the pivot, plus a tracked azimuth so the
  // pitch axis never has to be re-derived from (degenerate-at-the-pole) camera vectors.
  const _dO=new THREE.Vector3(), _dT=new THREE.Vector3(); let _theta=0;
  renderer.domElement.addEventListener('pointerdown',e=>{
    if(e.button!==0) return;
    _rot=true; _px=e.clientX; _py=e.clientY;
    _dO.subVectors(camera.position, PIVOT); _dT.subVectors(controls.target, PIVOT);
    _theta=Math.atan2(_dO.x, _dO.y);          // azimuth of the camera about the pivot
  });
  window.addEventListener('pointerup',()=>{ _rot=false; });
  window.addEventListener('pointermove',e=>{
    if(!_rot) return;
    const dx=e.clientX-_px, dy=e.clientY-_py; _px=e.clientX; _py=e.clientY;
    orbitAboutPivot(-dx*0.01, -dy*0.01);
  });
  function orbitAboutPivot(az, el){
    // yaw about world Z (model central axis) — rotate both offsets, advance the azimuth scalar
    _theta += az;
    const qAz=new THREE.Quaternion().setFromAxisAngle(_UP, az);
    _dO.applyQuaternion(qAz); _dT.applyQuaternion(qAz);
    // pitch about the horizontal right axis derived from the TRACKED azimuth (never degenerates)
    const right=new THREE.Vector3(Math.cos(_theta), -Math.sin(_theta), 0);
    const r=_dO.length()||1;
    const elev=Math.asin(Math.max(-1,Math.min(1,_dO.z/r)));
    const maxE=1.518;                                                    // ~87° — eases to a stop
    const el2=Math.max(-maxE,Math.min(maxE,elev+el))-elev;
    const qEl=new THREE.Quaternion().setFromAxisAngle(right, el2);
    _dO.applyQuaternion(qEl); _dT.applyQuaternion(qEl);
    camera.position.copy(PIVOT).add(_dO);
    controls.target.copy(PIVOT).add(_dT);
    controls.update();
  }

  // ---- corner axis gizmo (orientation indicator) ----
  const gizmoScene=new THREE.Scene();
  const gizmoCam=new THREE.OrthographicCamera(-1.8,1.8,1.8,-1.8,0.1,10);
  gizmoScene.add(new THREE.AxesHelper(1));               // X red · Y green · Z blue
  function axisLabel(text,color,p){
    const c=document.createElement('canvas'); c.width=c.height=64;
    const x=c.getContext('2d'); x.fillStyle=color; x.font='bold 48px sans-serif';
    x.textAlign='center'; x.textBaseline='middle'; x.fillText(text,32,34);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),
      depthTest:false, transparent:true}));
    sp.position.set(p[0],p[1],p[2]); sp.scale.setScalar(0.62); return sp;
  }
  gizmoScene.add(axisLabel('X','#ff6b6b',[1.28,0,0]));
  gizmoScene.add(axisLabel('Y','#51cf66',[0,1.28,0]));
  gizmoScene.add(axisLabel('Z','#4dabf7',[0,0,1.28]));
  function renderGizmo(){
    const dir=new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    gizmoCam.position.copy(dir).multiplyScalar(4); gizmoCam.up.copy(camera.up); gizmoCam.lookAt(0,0,0);
    const W=viewEl.clientWidth, H=viewEl.clientHeight, S=92, M=12;
    renderer.autoClear=false; renderer.clearDepth();
    renderer.setViewport(W-S-M,M,S,S); renderer.setScissor(W-S-M,M,S,S); renderer.setScissorTest(true);
    renderer.render(gizmoScene, gizmoCam);
    renderer.setScissorTest(false); renderer.setViewport(0,0,W,H); renderer.autoClear=true;
  }

  // ---- preset views ----
  const VIEWS={ front:[0,-1,0], back:[0,1,0], left:[-1,0,0], right:[1,0,0],
    top:[0,-0.0015,1], bottom:[0,-0.0015,-1], iso:[1,-1,0.8] };
  let _anim=null;
  function setView(d){
    const b=recenter(), D=Math.max(b.zhi-b.zlo,2*b.rad)*1.5;
    animateCamera(new THREE.Vector3(d[0],d[1],d[2]).normalize().multiplyScalar(D), new THREE.Vector3(0,0,0));
  }
  function animateCamera(toPos, toTgt, dur=460){
    camera.up.set(0,0,1);
    if(_anim){ cancelAnimationFrame(_anim); _anim=null; }
    const fromTgt=controls.target.clone();
    const fromOff=camera.position.clone().sub(fromTgt), toOff=toPos.clone().sub(toTgt);
    const fromLen=fromOff.length()||1, toLen=toOff.length()||1;
    const fromDir=fromOff.clone().normalize(), toDir=toOff.clone().normalize();
    const qTo=new THREE.Quaternion().setFromUnitVectors(fromDir, toDir);
    const t0=performance.now();
    (function step(){
      const t=Math.min(1,(performance.now()-t0)/dur);
      const e=t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;                 // easeInOutQuad
      const dir=fromDir.clone().applyQuaternion(new THREE.Quaternion().slerp(qTo,e));
      const tgt=fromTgt.clone().lerp(toTgt,e);
      camera.position.copy(tgt).add(dir.multiplyScalar(fromLen+(toLen-fromLen)*e));
      controls.target.copy(tgt); controls.update();
      _anim = t<1 ? requestAnimationFrame(step) : null;
    })();
  }
  document.querySelectorAll('#views button').forEach(btn=>
    btn.addEventListener('click',()=>setView(VIEWS[btn.dataset.v])));
  renderer.domElement.addEventListener('pointerdown',()=>{ if(_anim){ cancelAnimationFrame(_anim); _anim=null; } });
  // Trackpad: two-finger scroll → pan; pinch (ctrlKey on Mac) → zoom via OrbitControls.
  // Capture phase so this runs before OrbitControls' bubble-phase wheel handler.
  renderer.domElement.addEventListener('wheel', e => {
    if (_anim) { cancelAnimationFrame(_anim); _anim = null; }
    if (e.ctrlKey) return; // pinch gesture → fall through to OrbitControls zoom
    e.preventDefault();
    e.stopImmediatePropagation();
    const dScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 300 : 1;
    const dist = camera.position.distanceTo(controls.target);
    const scale = dist * 0.002;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up    = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    const offset = right.multiplyScalar(-e.deltaX * dScale * scale)
                        .add(up.multiplyScalar(e.deltaY * dScale * scale));
    camera.position.add(offset);
    controls.target.add(offset);
    controls.update();
  }, { capture: true, passive: false });

  const lineMat=new THREE.LineBasicMaterial({color:0x9af0f5});
  const baseLineMat=new THREE.LineBasicMaterial({color:0x2c353f});

  let lastOuts={}, lastExportSpecs={}, _hlMesh=null;

  function renderPartMesh(part,out){
    const g=partGroups[part.id];
    while(g.children.length){ const c=g.children.pop(); if(c.geometry) c.geometry.dispose(); }
    if(out.geometry){
      const mesh=new THREE.Mesh(out.geometry, MATS[view.styles[part.id]]);
      g.add(mesh); partMeshes[part.id]=mesh;
      if(out.edges){ const edges=new THREE.LineSegments(out.edges, part.fab==='printed'?baseLineMat:lineMat);
        edges.name='edges'; g.add(edges); }
      return;
    }
    const meshFaces=out.renderFaces||out.faces, edgeFaces=out.edgeFaces||meshFaces;
    const verts=[];
    for(const t of triangulate(meshFaces)) for(const v of t) verts.push(v[0],v[1],v[2]);
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
    geo.computeVertexNormals();
    const mesh=new THREE.Mesh(geo,MATS[view.styles[part.id]]);
    g.add(mesh); partMeshes[part.id]=mesh;
    const lp=[];
    for(const f of edgeFaces) for(let k=0;k<f.length;k++){ const a=f[k], b=f[(k+1)%f.length];
      lp.push(a[0],a[1],a[2],b[0],b[1],b[2]); }
    const lg=new THREE.BufferGeometry(); lg.setAttribute('position',new THREE.Float32BufferAttribute(lp,3));
    const edges=new THREE.LineSegments(lg, part.fab==='printed'?baseLineMat:lineMat);
    edges.name='edges'; g.add(edges);
  }
  function applyVisAndStyle(){
    for(const part of SCHEMA){
      const g=partGroups[part.id];
      g.visible=view.vis[part.id];
      const mesh=partMeshes[part.id]; if(mesh) mesh.material=MATS[view.styles[part.id]];
      const edges=g.getObjectByName('edges');
      if(edges) edges.visible = view.styles[part.id]!=='wire';
    }
  }
  function eachVertex(out, dz, cb){
    if(out.faces && out.faces.length){
      for(const f of out.faces) for(const v of f) cb(v[0], v[1], v[2]+dz);
      return;
    }
    const pos=out.geometry && out.geometry.getAttribute && out.geometry.getAttribute('position');
    if(pos){ for(let i=0;i<pos.count;i++) cb(pos.getX(i), pos.getY(i), pos.getZ(i)+dz); }
  }
  function recenter(){
    let zlo=Infinity,zhi=-Infinity,rad=40;
    for(const part of SCHEMA){ if(!view.vis[part.id]) continue; const out=lastOuts[part.id]; if(!out) continue;
      const dz=partGroups[part.id].position.z;
      eachVertex(out,dz,(x,y,z)=>{ zlo=Math.min(zlo,z); zhi=Math.max(zhi,z); rad=Math.max(rad,Math.hypot(x,y)); }); }
    if(!isFinite(zlo)){ zlo=0; zhi=100; }
    world.position.z=-(zlo+zhi)/2;
    return {zlo,zhi,rad};
  }
  function fitCamera(){ const b=recenter(); const d=Math.max(b.zhi-b.zlo,2*b.rad)*1.5;
    camera.position.set(d*0.55,-d*0.78,d*0.42); controls.target.set(0,0,0); controls.update(); }
  function resize(){ const w=viewEl.clientWidth,h=viewEl.clientHeight;
    renderer.setSize(w,h); renderer.setPixelRatio(window.devicePixelRatio||1);
    camera.aspect=w/h; camera.updateProjectionMatrix(); }
  window.addEventListener('resize',resize);
  let spin=false;
  function frame(){ requestAnimationFrame(frame); if(spin) world.rotation.z+=0.005;
    controls.update(); renderer.render(scene,camera); renderGizmo(); }

  /* ============================================================ rebuild ======= */
  function buildCtx(){ return { MATERIALS }; }
  // Slider debounce exists to stop the expensive WASM `kernel` engine from
  // re-solving on every mouse-move pixel. `direct` engines are plain JS vertex
  // math — a full rebuild is sub-millisecond — so schemas with no kernel parts
  // skip the wait entirely and rebuild on every input event for true live feedback.
  const HAS_KERNEL_PARTS = SCHEMA.some(p=>p.engine==='kernel');
  const SLIDER_DEBOUNCE_MS = HAS_KERNEL_PARTS ? 200 : 0;
  let _rebuildSeq=0, _solveCount=0, _didFirstFit=false, _debTimer;
  const _paramHashes={}, _kernelOuts={};
  async function rebuild(){
    const myseq=++_rebuildSeq;
    const ctx=buildCtx(), outs={};
    const hasKernel=SCHEMA.some(p=>p.engine==='kernel');
    if(window.__app) window.__app.solving=true;
    if(hasKernel) setBadge('solving…');
    try{
      for(const part of orderedParts()){
        if(part.engine==='kernel'){
          const depState=(part.dependsOn||[]).map(id=>state[id]||{});
          const h=JSON.stringify(state[part.id])+'|'+JSON.stringify(depState);
          if(_paramHashes[part.id]===h && _kernelOuts[part.id]){
            outs[part.id]=_kernelOuts[part.id]; ctx[part.id]=outs[part.id]; continue;
          }
          _paramHashes[part.id]=h;
        }
        let out=part.build(state[part.id],ctx);
        if(out && typeof out.then==='function') out=await out;
        if(myseq!==_rebuildSeq) return;
        outs[part.id]=out; ctx[part.id]=out;
        if(part.engine==='kernel') _kernelOuts[part.id]=out;
      }
    }catch(err){
      console.error('build failed:',err); setBadge('build error — see console');
      // Scene keeps whatever rendered on the last successful build (lastOuts isn't
      // reassigned below), so screenshot() would otherwise still return a "valid"
      // but stale PNG. lastError lets a headless driver detect that.
      if(window.__app){ window.__app.solving=false; window.__app.lastError=String(err&&err.message||err); }
      return;
    }
    if(myseq!==_rebuildSeq) return;
    clearHighlight();
    lastOuts=outs;
    // Derive export specs while ctx still has all parts' outputs.
    lastExportSpecs={};
    for(const part of SCHEMA){
      if(outs[part.id]) lastExportSpecs[part.id]=deriveExportSpec(part,outs[part.id],state[part.id],ctx);
    }
    for(let i=0;i<SCHEMA.length;i++){ const part=SCHEMA[i];
      const tz=part.transform?part.transform(state[part.id],ctx).z:0;
      const exOff=(SCHEMA.length-1-i)*explode;
      partGroups[part.id].position.z=tz+exOff;
      renderPartMesh(part,outs[part.id]); }
    applyVisAndStyle(); recenter(); updateEstimates(outs); buildExportPanel(); saveState();
    setBadge();
    if(!_didFirstFit){ _didFirstFit=true; fitCamera(); }
    _solveCount++;
    if(window.__app){ window.__app.solveCount=_solveCount; window.__app.solving=false; window.__app.lastError=null; }
  }
  function setBadge(txt){ const b=document.getElementById('badge'); if(b) b.textContent=txt||(MODEL.meta&&MODEL.meta.name?MODEL.meta.name:'ready'); }
  // metrics() is required (arbitrary computed quantities for the part's card).
  // cost() is optional — only parts where fabrication cost is meaningful define
  // it; when present, its value is auto-appended as a row here (single source of
  // truth, no manual duplication in metrics()) and rolled into the assembly BOM.
  function partEstimate(part, out, params, ctx){
    const rows=(part.metrics(out,params,ctx)||[]).slice();
    let cost;
    if(typeof part.cost==='function'){
      const c=part.cost(out,params,ctx);
      if(c!=null){ const o=(typeof c==='object')?c:{value:c}; cost=o.value;
        rows.push([o.label||'Cost', '$'+o.value.toFixed(2)]); }
    }
    return { rows, cost };
  }
  function updateEstimates(outs){
    const ctx=buildCtx();
    let totalCost=0; const costRows=[];
    for(const part of SCHEMA){ const e=partEstimate(part, outs[part.id], state[part.id], ctx);
      const box=document.getElementById('est_'+part.id);
      if(box) box.innerHTML=e.rows.map(r=>`<div class="row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
      if(e.cost!=null){ totalCost+=e.cost; costRows.push(`${part.name} $${e.cost.toFixed(2)}`); } }
    let h=0;
    for(const part of SCHEMA){ const out=outs[part.id]; if(!out) continue;
      const dz=part.transform?part.transform(state[part.id],ctx).z:0;
      eachVertex(out,dz,(x,y,z)=>{ h=Math.max(h,z); }); }
    const fpPart=SCHEMA.find(p=>outs[p.id]&&outs[p.id].footprint!=null);
    document.getElementById('aParts').textContent=SCHEMA.length;
    document.getElementById('aH').textContent=Math.round(h)+' mm';
    document.getElementById('aFP').textContent=fpPart?Math.round(outs[fpPart.id].footprint)+' mm':'—';
    const costRow=document.getElementById('aCostRow');
    if(costRow) costRow.hidden=(costRows.length===0);
    document.getElementById('aCost').textContent='$'+totalCost.toFixed(2);
    document.getElementById('aCost').title=costRows.join('  ·  ');
  }

  /* ============================================================ design tab UI == */
  const decimals=step=>{ const s=String(step); return s.includes('.')?s.split('.')[1].length:0; };
  const fmtVal=(v,step)=>Number(v).toFixed(decimals(step));
  function makeRange(partId,d){
    const row=document.createElement('div'); row.className='prow';
    row.innerHTML=`<label>${d.label} <span class="u">${d.unit||''}</span></label>
      <div class="pin"><input type="range"><input type="number" class="num"></div>`;
    const rng=row.querySelector('input[type=range]'), num=row.querySelector('input.num');
    rng.min=d.min; rng.max=d.max; rng.step=d.step;
    num.step=d.step; if(d.hardMin!=null) num.min=d.hardMin; if(d.hardMax!=null) num.max=d.hardMax;
    const set=v=>{ state[partId][d.key]=v; rng.value=Math.min(d.max,Math.max(d.min,v)); num.value=fmtVal(v,d.step); };
    set(state[partId][d.key]);
    rng.addEventListener('input',()=>{ set(parseFloat(rng.value)); scheduleRebuild(); });
    num.addEventListener('input',()=>{ const v=parseFloat(num.value); if(!isNaN(v)){ state[partId][d.key]=v;
      rng.value=Math.min(d.max,Math.max(d.min,v)); scheduleRebuild(); } });
    return row;
  }
  function scheduleRebuild(){
    clearTimeout(_debTimer);
    if(SLIDER_DEBOUNCE_MS>0) _debTimer=setTimeout(rebuild,SLIDER_DEBOUNCE_MS); else rebuild();
  }
  function makeChoice(partId,d){
    const row=document.createElement('div'); row.className='prow';
    row.innerHTML=`<label>${d.label}</label><div class="seg"></div>`;
    const seg=row.querySelector('.seg');
    for(const [val,lab] of d.options){ const b=document.createElement('button'); b.textContent=lab;
      b.classList.toggle('on', state[partId][d.key]===val);
      b.addEventListener('click',()=>{ state[partId][d.key]=val;
        seg.querySelectorAll('button').forEach(x=>x.classList.remove('on')); b.classList.add('on'); rebuild(); });
      seg.appendChild(b); }
    return row;
  }
  function buildPartCards(){
    const host=document.getElementById('parts'); host.innerHTML='';
    for(const part of SCHEMA){
      const card=document.createElement('div'); card.className='card'+(view.active===part.id?' active':'');
      card.dataset.part=part.id;
      const head=document.createElement('div'); head.className='card-h';
      head.innerHTML=`<span class="dot"></span><span class="nm">${part.name}</span>
        <span class="fab">${part.fab}</span><span class="sp"></span>
        <button class="icon solo" title="Solo">◎</button>
        <input type="checkbox" class="vis" title="Visible" ${view.vis[part.id]?'checked':''}>
        <button class="icon col" title="Collapse">${view.collapsed[part.id]?'▸':'⌄'}</button>`;
      const body=document.createElement('div'); body.className='card-b'+(view.collapsed[part.id]?' collapsed':'');

      let curGroup=null, first=true;
      for(const d of partParamsWithMaterial(part)){
        if(d.group && d.group!==curGroup){ curGroup=d.group;
          const g=document.createElement('div'); g.className='grp'+(first?' first':''); g.textContent=d.group; body.appendChild(g); }
        first=false;
        body.appendChild(d.type==='choice'?makeChoice(part.id,d):makeRange(part.id,d));
      }
      // render style
      const sr=document.createElement('div'); sr.className='selrow';
      sr.innerHTML=`<label>Render style</label><select></select>`;
      const sel=sr.querySelector('select');
      const styleNames={acrylic:'Translucent acrylic',pla:'Matte (PLA)',clay:'Clay',metal:'Brushed metal',wire:'Wireframe'};
      for(const s of part.render.styles){ const o=document.createElement('option'); o.value=s; o.textContent=styleNames[s]||s;
        if(view.styles[part.id]===s) o.selected=true; sel.appendChild(o); }
      sel.addEventListener('change',()=>{ view.styles[part.id]=sel.value; applyVisAndStyle(); saveState(); });
      body.appendChild(sr);
      // per-part estimate
      const est=document.createElement('div'); est.className='pest'; est.id='est_'+part.id; body.appendChild(est);

      head.addEventListener('click',e=>{ if(e.target.closest('.vis')||e.target.closest('.solo')) return;
        if(e.target.closest('.col')){ view.collapsed[part.id]=!view.collapsed[part.id];
          body.classList.toggle('collapsed'); head.querySelector('.col').textContent=view.collapsed[part.id]?'▸':'⌄'; saveState(); return; }
        view.active=part.id; document.querySelectorAll('.card').forEach(c=>c.classList.toggle('active',c.dataset.part===part.id)); });
      head.querySelector('.vis').addEventListener('change',e=>{ view.vis[part.id]=e.target.checked;
        applyVisAndStyle(); recenter(); saveState(); });
      head.querySelector('.solo').addEventListener('click',()=>{ const onlyMe=Object.keys(view.vis).every(id=>view.vis[id]===(id===part.id));
        for(const id of Object.keys(view.vis)) view.vis[id]= onlyMe ? true : (id===part.id);
        document.querySelectorAll('.vis').forEach(cb=>{ const pid=cb.closest('.card').dataset.part; cb.checked=view.vis[pid]; });
        applyVisAndStyle(); recenter(); saveState(); });

      card.appendChild(head); card.appendChild(body); host.appendChild(card);
    }
  }

  /* ============================================================ export tab ====== */
  // Derive a structured export spec for a part from its build output.
  // Calls part.exportPieces() if defined; falls back to fab-typed auto-derivation.
  function deriveExportSpec(part, out, params, ctx){
    if(typeof part.exportPieces==='function'){
      const spec=part.exportPieces(out,params,ctx);
      if(spec) return spec;
    }
    const fab=part.fab;
    if((fab==='cut-sheet'||fab==='milled') && out.faces && out.faces.length){
      const faces=out.faces, map=edgeMapper(faces), groupMap={}; let gi=0;
      faces.forEach((f,fi)=>{
        const s=sig3d(f,map);
        if(!(s in groupMap)){
          const pts2d=flatten(f);
          const w=Math.max(...pts2d.map(p=>p[0])), h=Math.max(...pts2d.map(p=>p[1]));
          const lbl=String.fromCharCode(65+gi++);
          groupMap[s]={ id:'P'+lbl, label:'Panel '+lbl, pts2d, dims:{w:Math.round(w),h:Math.round(h)}, qty:0, faceIndices:[] };
        }
        groupMap[s].qty++; groupMap[s].faceIndices.push(fi);
      });
      return { mode:'sheet', pieces:Object.values(groupMap) };
    }
    // solid (printed / kernel / milled-solid / carpentry): whole part, no sub-pieces
    return { mode:'solid', pieces:[{ id:part.id, label:part.name, qty:1 }] };
  }

  // Tiny inline SVG preview of a flattened panel shape.
  function pieceSVG(pts2d, sz){
    const w=Math.max(...pts2d.map(p=>p[0]))||1, h=Math.max(...pts2d.map(p=>p[1]))||1;
    const sc=Math.min((sz-8)/w,(sz-8)/h);
    const tx=(sz-w*sc)/2, ty=(sz-h*sc)/2;
    const pts=pts2d.map(p=>`${(p[0]*sc+tx).toFixed(1)},${((h-p[1])*sc+ty).toFixed(1)}`).join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}"><polygon points="${pts}" fill="rgba(57,208,216,.12)" stroke="#39d0d8" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }

  // Highlight a set of faces in the 3D view by adding a temporary overlay mesh.
  function highlightFaces(partId, faceIndices){
    clearHighlight();
    const out=lastOuts[partId]; if(!out||!out.faces||!faceIndices||!faceIndices.length) return;
    const faces=faceIndices.map(i=>out.faces[i]);
    const verts=[]; for(const t of triangulate(faces)) for(const v of t) verts.push(v[0],v[1],v[2]);
    if(!verts.length) return;
    const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
    _hlMesh=new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color:0xffe666,transparent:true,opacity:0.72,depthTest:false,side:THREE.DoubleSide}));
    _hlMesh.name='_hl'; _hlMesh.renderOrder=1;
    partGroups[partId].add(_hlMesh);
  }
  function clearHighlight(){
    if(_hlMesh){ _hlMesh.parent&&_hlMesh.parent.remove(_hlMesh); if(_hlMesh.geometry) _hlMesh.geometry.dispose(); _hlMesh=null; }
  }

  // Build (or rebuild) the Export tab content from current lastOuts + lastExportSpecs.
  function buildExportPanel(){
    const host=document.getElementById('export'); if(!host) return;
    host.innerHTML='';
    const ctx=buildCtx(); for(const part of SCHEMA) if(lastOuts[part.id]) ctx[part.id]=lastOuts[part.id];
    let hasAny=false;
    for(const part of SCHEMA){
      if(!part.exports||!part.exports.length) continue;
      const out=lastOuts[part.id]; if(!out) continue;
      hasAny=true;
      const spec=lastExportSpecs[part.id]||{ mode:'solid', pieces:[] };
      const e=partEstimate(part,out,state[part.id],ctx);

      const sec=document.createElement('div'); sec.className='exp-section';

      // section header
      const head=document.createElement('div'); head.className='exp-sec-h';
      let sumHtml='';
      if(spec.mode==='sheet'){
        const totalQty=spec.pieces.reduce((a,p)=>a+p.qty,0);
        const areaRow=e.rows.find(r=>String(r[0]).toLowerCase().includes('area'));
        const costRow=e.rows.find(r=>String(r[0]).toLowerCase().includes('cost')||String(r[0]).toLowerCase().includes('est'));
        const parts=[totalQty+' panels', areaRow?areaRow[1]:null,
          costRow?String(costRow[1]):(e.cost!=null?'$'+e.cost.toFixed(2):null)].filter(Boolean);
        sumHtml=`<span class="exp-sum">${parts.join(' · ')}</span>`;
      }
      head.innerHTML=`<span class="nm">${part.name}</span><span class="fab">${part.fab}</span><span class="sp"></span>${sumHtml}`;
      sec.appendChild(head);

      const body=document.createElement('div'); body.className='exp-sec-b';

      if(spec.mode==='sheet'){
        // piece-type grid
        const piecesEl=document.createElement('div'); piecesEl.className='exp-pieces';
        for(const piece of spec.pieces){
          const card=document.createElement('div'); card.className='piece-card';
          card.dataset.part=part.id; card.dataset.piece=piece.id;
          const svgEl=document.createElement('div'); svgEl.className='piece-svg';
          if(piece.pts2d) svgEl.innerHTML=pieceSVG(piece.pts2d,60);
          const info=document.createElement('div'); info.className='piece-info';
          const dimsStr=piece.dims?piece.dims.w+' × '+piece.dims.h+' mm':'';
          info.innerHTML=`<div class="piece-label">${piece.label||piece.id}</div><div class="piece-qty">×${piece.qty}</div><div class="piece-dims">${dimsStr}</div>`;
          if(piece.pts2d && part.exports.includes('dxf')){
            const btn=document.createElement('button'); btn.textContent='DXF';
            btn.addEventListener('click',ev=>{ ev.stopPropagation(); exportPiece(part,piece); });
            info.appendChild(btn);
          }
          card.appendChild(svgEl); card.appendChild(info);
          // click = highlight faces in 3D view
          if(piece.faceIndices){
            card.addEventListener('click',()=>{
              const nowActive=!card.classList.contains('active');
              piecesEl.querySelectorAll('.piece-card').forEach(c=>c.classList.remove('active'));
              if(nowActive){ card.classList.add('active'); highlightFaces(part.id,piece.faceIndices); }
              else clearHighlight();
            });
          }
          piecesEl.appendChild(card);
        }
        body.appendChild(piecesEl);
        // batch actions
        const actions=document.createElement('div'); actions.className='exp-actions';
        if(part.exports.includes('dxf')){ const b=document.createElement('button'); b.textContent='Export all (ZIP of DXFs)'; b.addEventListener('click',()=>doExport(part,'dxf')); actions.appendChild(b); }
        if(part.exports.includes('svg')){ const b=document.createElement('button'); b.textContent='Nesting layout (SVG)'; b.addEventListener('click',()=>doExport(part,'svg')); actions.appendChild(b); }
        if(part.exports.includes('stl')){ const b=document.createElement('button'); b.textContent='Export STL'; b.addEventListener('click',()=>doExport(part,'stl')); actions.appendChild(b); }
        body.appendChild(actions);
      } else {
        // solid / board-list: estimate rows + export buttons
        const solidDiv=document.createElement('div'); solidDiv.className='exp-solid';
        solidDiv.innerHTML=e.rows.map(r=>`<div class="row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');
        body.appendChild(solidDiv);
        const actions=document.createElement('div'); actions.className='exp-actions';
        for(const fmt of part.exports){
          const b=document.createElement('button'); b.textContent=fmt.toUpperCase();
          b.addEventListener('click',()=>doExport(part,fmt)); actions.appendChild(b);
        }
        body.appendChild(actions);
      }

      sec.appendChild(body); host.appendChild(sec);
    }
    if(!hasAny) host.innerHTML='<div class="exp-empty">No exports defined. Add <code>exports:[\'stl\',\'dxf\',...]</code> to a part in model.js.</div>';
  }

  // Export a single piece type as its own DXF.
  function exportPiece(part, piece){
    if(!piece.pts2d) return;
    dl(`${part.id}_${piece.id}.dxf`, new TextEncoder().encode(panelDXF(piece.pts2d, piece.id)));
  }

  /* ============================================================ doExport ======= */
  function doExport(part,fmt){
    const out=lastOuts[part.id];
    if(fmt==='step' && out.blobSTEP){ dl(part.id+'.step', out.blobSTEP()); return; }
    if(fmt==='stl' && out.blobSTL){ dl(part.id+'.stl', out.blobSTL()); return; }
    if(fmt==='stl'){ dl(part.id+'.stl', facesToSTL(out.faces, part.id)); return; }
    if(fmt==='dxf'){                         // one DXF per unique panel shape + cutlist (zip)
      const faces=out.faces, map=edgeMapper(faces), groups={}; let gi=0;
      faces.forEach(t=>{ const s=sig3d(t,map);
        if(!(s in groups)) groups[s]={label:String.fromCharCode(65+gi++),pts:flatten(t),count:0}; groups[s].count++; });
      const enc=new TextEncoder(), files=[];
      let cut='Panels — cut list\n==========================\n'+`${part.name}\n\n`;
      for(const k in groups){ const g=groups[k];
        files.push({name:`panel_P${g.label}_x${g.count}.dxf`, data:enc.encode(panelDXF(g.pts,'P'+g.label))});
        const w=Math.max(...g.pts.map(p=>p[0])), h=Math.max(...g.pts.map(p=>p[1]));
        cut+=`P${g.label}:  qty ${g.count}   (${Math.round(w)} x ${Math.round(h)} mm)\n`; }
      files.push({name:'cutlist.txt', data:enc.encode(cut)});
      dl(part.id+'_panels_dxf.zip', buildZip(files), 'application/zip'); return;
    }
    if(fmt==='svg'){
      const faces=out.faces, map=edgeMapper(faces), groups={}; let gi=0, gap=25, maxW=1250;
      let x=0,y=0,rowH=0; const placed=[];
      faces.forEach(t=>{ const f=flatten(t), s=sig3d(t,map);
        if(!(s in groups)) groups[s]=String.fromCharCode(65+(gi++));
        const w=Math.max(...f.map(p=>p[0])), h=Math.max(...f.map(p=>p[1]));
        if(x+w>maxW){ x=0; y+=rowH+gap; rowH=0; }
        placed.push({pts:f.map(p=>[p[0]+x,p[1]+y]),label:'P'+groups[s]}); x+=w+gap; rowH=Math.max(rowH,h); });
      const W=Math.max(...placed.map(p=>Math.max(...p.pts.map(q=>q[0]))))+gap;
      const Ht=Math.max(...placed.map(p=>Math.max(...p.pts.map(q=>q[1]))))+gap;
      let s=`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(1)}mm" height="${Ht.toFixed(1)}mm" viewBox="0 0 ${W.toFixed(1)} ${Ht.toFixed(1)}">`;
      for(const pan of placed){ const dpts=pan.pts.map(p=>`${p[0].toFixed(2)},${(Ht-p[1]).toFixed(2)}`).join(' ');
        s+=`<polygon points="${dpts}" fill="none" stroke="#0a5b66" stroke-width="0.4"/>`;
        const cx=pan.pts.reduce((a,p)=>a+p[0],0)/pan.pts.length, cy=pan.pts.reduce((a,p)=>a+p[1],0)/pan.pts.length;
        s+=`<text x="${cx.toFixed(1)}" y="${(Ht-cy).toFixed(1)}" font-size="14" fill="#0a5b66" text-anchor="middle">${pan.label}</text>`; }
      s+='</svg>'; dl(part.id+'_panels.svg', s, 'image/svg+xml'); return;
    }
  }

  /* ============================================================ config I/O ==== */
  const knownKeys=part=>new Set(partParamsWithMaterial(part).map(d=>d.key));
  function filterKeys(part,obj){ const k=knownKeys(part), o={}; for(const key in obj) if(k.has(key)) o[key]=obj[key]; return o; }
  function refreshAfterLoad(){
    document.getElementById('explode').value=explode;
    document.getElementById('vEx').textContent=Math.round(explode);
    buildPartCards(); rebuild(); fitCamera();
  }
  function exportConfig(){
    const out={ _app:'cadabra', _v:1, state, view:{vis:view.vis,styles:view.styles}, explode };
    dl('assembly_design.json', JSON.stringify(out,null,2), 'application/json');
  }
  function importConfig(obj){
    if(obj.state){
      for(const part of SCHEMA){ if(obj.state[part.id]) Object.assign(state[part.id], filterKeys(part,obj.state[part.id])); }
      if(obj.view){ Object.assign(view.vis,obj.view.vis||{}); Object.assign(view.styles,obj.view.styles||{}); }
      if(typeof obj.explode==='number') explode=obj.explode;
    } else if(obj.p||obj.b){                          // legacy crystal_designer { p, b, v }
      if(obj.p && state.crystal) Object.assign(state.crystal, filterKeys(SCHEMA[0],obj.p));
      if(obj.b && state.base)    Object.assign(state.base,    filterKeys(SCHEMA[1]||SCHEMA[0],obj.b));
      if(obj.v){ if('showCrystal' in obj.v) view.vis.crystal=!!obj.v.showCrystal;
                 if('showBase'    in obj.v) view.vis.base   =!!obj.v.showBase; }
    } else { Object.assign(state[SCHEMA[0].id], filterKeys(SCHEMA[0],obj)); }
    refreshAfterLoad();
  }
  document.getElementById('cfgSave').addEventListener('click',exportConfig);
  document.getElementById('cfgLoad').addEventListener('click',()=>document.getElementById('cfgFile').click());
  document.getElementById('cfgFile').addEventListener('change',e=>{
    const file=e.target.files[0]; if(!file) return; const r=new FileReader();
    r.onload=()=>{ try{ importConfig(JSON.parse(r.result)); }
      catch(err){ alert('Could not read config: '+err.message); } };
    r.readAsText(file); e.target.value='';
  });

  /* ============================================================ controls ====== */
  document.getElementById('explode').addEventListener('input',e=>{ explode=parseFloat(e.target.value);
    document.getElementById('vEx').textContent=Math.round(explode); rebuild(); });
  document.getElementById('resetAll').addEventListener('click',()=>{
    initState(); explode=0;
    document.getElementById('explode').value=0;
    document.getElementById('vEx').textContent='0';
    buildPartCards(); rebuild(); fitCamera(); });
  const reloadBtn=document.getElementById('reload');
  if(reloadBtn) reloadBtn.addEventListener('click',()=>location.reload());

  // Design / Export tab toggle
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const tab=btn.dataset.tab;
      const partsEl=document.getElementById('parts'), exportEl=document.getElementById('export');
      if(partsEl) partsEl.hidden=(tab!=='design');
      if(exportEl) exportEl.hidden=(tab!=='export');
      if(tab==='export') buildExportPanel();   // refresh in case outs changed while hidden
      if(tab==='design') clearHighlight();     // clear panel highlights when leaving export tab
    });
  });

  /* ============================================================ agent hook ==== */
  function bboxOf(out, dz){
    let lo=[Infinity,Infinity,Infinity], hi=[-Infinity,-Infinity,-Infinity];
    eachVertex(out, dz||0, (x,y,z)=>{ const c=[x,y,z];
      for(let k=0;k<3;k++){ lo[k]=Math.min(lo[k],c[k]); hi[k]=Math.max(hi[k],c[k]); } });
    if(!isFinite(lo[0])) return null;
    return { min:lo, max:hi, size:[hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]] };
  }
  function geometryReport(){
    const ctx=buildCtx(); const report={ parts:{}, assembly:{} };
    for(const part of SCHEMA){
      const out=lastOuts[part.id]; if(!out) continue;
      const dz=part.transform?part.transform(state[part.id],ctx).z:0;
      const e=partEstimate(part,out,state[part.id],ctx);
      const published={}; for(const k of ['vol','volume','footprint','cavityW','cavityH','fits','seatZ','maxEdge','panelThk'])
        if(out[k]!=null) published[k]=out[k];
      const triCount=out.geometry&&out.geometry.index?out.geometry.index.count/3:null;
      report.parts[part.id]={
        name:part.name, engine:part.engine, fab:part.fab,
        faceCount:(out.faces||[]).length, triangleCount:triCount,
        bbox:bboxOf(out,dz), placementZ:dz,
        estimate:{ cost:e.cost, rows:e.rows },
        published,
      };
    }
    report.assembly={
      parts:SCHEMA.length, height:document.getElementById('aH').textContent,
      footprint:document.getElementById('aFP').textContent,
      bom:document.getElementById('aCost').textContent,
    };
    return report;
  }
  window.__app={
    setParams(partId,obj){ Object.assign(state[partId],obj); buildPartCards(); rebuild(); return true; },
    getState(){ return JSON.parse(JSON.stringify({state,view,explode})); },
    loadConfig(obj){ importConfig(obj); return true; },
    setVisible(partId,v){ view.vis[partId]=v; applyVisAndStyle(); recenter(); },
    setStyle(partId,s){ view.styles[partId]=s; applyVisAndStyle(); },
    setView(name){ if(VIEWS[name]) setView(VIEWS[name]); },
    report(){ return geometryReport(); },
    parts(){ return SCHEMA.map(p=>({ id:p.id, name:p.name, fab:p.fab, exports:p.exports||[] })); },
    render(){ renderer.render(scene,camera); },
    screenshot(){ renderer.render(scene,camera); return renderer.domElement.toDataURL('image/png'); },
    ready:true,
    solving:false,
    solveCount:0,
    lastError:null,
  };

  /* ============================================================ run =========== */
  const appTitle=document.getElementById('appTitle');
  if(appTitle && MODEL.meta && MODEL.meta.name) appTitle.textContent=MODEL.meta.name;
  const appSub=document.getElementById('appSub');
  if(appSub && MODEL.meta && MODEL.meta.name) appSub.textContent=MODEL.meta.name+' · edit model.js, then Reload.';
  initState(); loadState();
  document.getElementById('explode').value=explode; document.getElementById('vEx').textContent=Math.round(explode);
  buildPartCards(); resize(); fitCamera(); frame();
  if(SCHEMA.some(p=>p.engine==='kernel')) window.CADABRA_KERNEL.ready().catch(()=>{});
  rebuild();
}

window.CADABRA = { boot, version: "2.1.0" };
})();
