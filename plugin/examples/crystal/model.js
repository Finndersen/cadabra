/* ============================================================================
   model.js — Crystal sculpture + printed base assembly (the Cadabra reference
   example). Analytic tier; ported verbatim from kernel_poc.html.

   CLASSIC SCRIPT (no import/export) so it loads over file:// with no server.
   Attaches window.MODEL = { meta, MATERIALS, parts:[...] }; runtime.js reads it.

   This file exists to VERIFY the generic runtime against a real, non-trivial
   multi-part design. The shipped template model.js is a generic stub instead.
   ============================================================================ */
(function () {
"use strict";

/* ---- analytic geometry math (model-specific) ---- */
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const unit=a=>{const l=len(a)||1;return [a[0]/l,a[1]/l,a[2]/l];};
const sub2=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const norm2=a=>{const l=Math.hypot(a[0],a[1])||1;return [a[0]/l,a[1]/l];};
function offsetPoly(poly,d){            // offset convex CCW polygon outward by d (mm)
  const n=poly.length, out=[];
  for(let i=0;i<n;i++){
    const p0=poly[(i-1+n)%n], p1=poly[i], p2=poly[(i+1)%n];
    const e1=norm2(sub2(p1,p0)), e2=norm2(sub2(p2,p1));
    const n1=[e1[1],-e1[0]], n2=[e2[1],-e2[0]];
    let k=1+(n1[0]*n2[0]+n1[1]*n2[1]); if(Math.abs(k)<1e-6) k=1;
    out.push([p1[0]+d*(n1[0]+n2[0])/k, p1[1]+d*(n1[1]+n2[1])/k]);
  } return out;
}
const lift=(poly,z)=>poly.map(p=>[p[0],p[1],z]);
function ringFaces(a,b){ const f=[], n=a.length;
  for(let i=0;i<n;i++){ const j=(i+1)%n; f.push([a[i],a[j],b[j],b[i]]); } return f; }
function polyArea(poly){ let a=0; const n=poly.length;
  for(let i=0;i<n;i++){ const p=poly[i], q=poly[(i+1)%n]; a+=p[0]*q[1]-q[0]*p[1]; }
  return Math.abs(a)/2; }
const midPoly=(a,b)=>a.map((p,i)=>[(p[0]+b[i][0])/2,(p[1]+b[i][1])/2]);
const prismatoid=(aBot,aMid,aTop,h)=>h/6*(aBot+4*aMid+aTop);
const maxR=poly=>Math.max(...poly.map(p=>Math.hypot(p[0],p[1])));
const minR=poly=>Math.min(...poly.map(p=>Math.hypot(p[0],p[1])));
function segBBox(rOut,rIn,s){
  if(s<=1) return [2*rOut,2*rOut];
  const half=Math.PI/s;
  const h=half>=Math.PI/2?2*rOut:2*rOut*Math.sin(half);
  const w=rOut-rIn*Math.cos(half);
  return [w,h];
}
function polyArea3D(f){                 // area of a 3D planar polygon (Newell)
  let nx=0,ny=0,nz=0;
  for(let i=0;i<f.length;i++){ const a=f[i], b=f[(i+1)%f.length];
    nx+=(a[1]-b[1])*(a[2]+b[2]); ny+=(a[2]-b[2])*(a[0]+b[0]); nz+=(a[0]-b[0])*(a[1]+b[1]); }
  return Math.hypot(nx,ny,nz)/2;
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

/* ============================================================ part geometry === */
// Panels are real sheets of thickness `thk`, butt-jointed on their INNER edges (= the
// zero-thickness core). Material therefore extrudes `thk` OUTWARD along each face normal;
// adjacent outer edges don't meet → V-gaps at the edges. Returns slab faces (for the mesh)
// and just the outer polygons (for clean edge lines).
function thickenPanels(faces, thk){
  let cx=0,cy=0,cz=0,nv=0;
  for(const f of faces) for(const v of f){ cx+=v[0]; cy+=v[1]; cz+=v[2]; nv++; }
  const C=[cx/nv,cy/nv,cz/nv];
  const slab=[], outer=[];
  for(const f of faces){
    let n=unit(cross(sub(f[1],f[0]),sub(f[2],f[0])));
    const fc=[0,0,0]; for(const v of f){ fc[0]+=v[0]; fc[1]+=v[1]; fc[2]+=v[2]; }
    fc[0]/=f.length; fc[1]/=f.length; fc[2]/=f.length;
    if(dot(n,sub(fc,C))<0) n=[-n[0],-n[1],-n[2]];      // point away from centroid
    const inner=f, outF=f.map(v=>[v[0]+n[0]*thk, v[1]+n[1]*thk, v[2]+n[2]*thk]);
    outer.push(outF);
    slab.push(outF);                                    // outer surface
    slab.push([...inner].reverse());                    // inner surface
    for(let k=0;k<f.length;k++){                         // edge wall (the 3mm rim)
      const a=inner[k], b=inner[(k+1)%f.length], a2=outF[k], b2=outF[(k+1)%f.length];
      slab.push([a,b,b2,a2]);
    }
  }
  return { slab, outer };
}
function buildCrystal(p){
  const n=p.n, H=p.H;
  const zg=(p.ratio/(p.ratio+1))*H;
  const midR=p.midW/2, baseR=p.botW/2;
  const faces=[]; let bottom=[]; let cols=[];
  if(p.mode==='tri'){
    const zamp=(p.zz/100)*H; const base=[], gird=[];
    for(let i=0;i<n;i++){ const a=(i/n)*Math.PI*2;
      base.push([baseR*Math.cos(a),baseR*Math.sin(a),0]);
      gird.push([midR*Math.cos(a),midR*Math.sin(a),zg+(i%2===0?zamp:-zamp)]); }
    const apex=[0,0,H];
    for(let i=0;i<n;i++){ const j=(i+1)%n;
      faces.push([base[i],base[j],gird[i]]); faces.push([gird[i],base[j],gird[j]]); }
    for(let i=0;i<n;i++){ const j=(i+1)%n; faces.push([gird[i],gird[j],apex]); }
    bottom=base.map(pt=>[pt[0],pt[1]]); cols=base.map((pt,i)=>[pt,gird[i]]);
  } else {
    const m=Math.max(2,Math.round(n/2)); const R=midR, ra=baseR;
    const rL=R*Math.min(0.97,Math.max(0.55,0.5+(p.zz/14)*0.45));
    const zL=H+(zg-H)*rL/(R*Math.cos(Math.PI/m));
    const A=[], Bb=[];
    for(let k=0;k<m;k++){ const aa=2*Math.PI*k/m, ab=aa+Math.PI/m;
      A.push([R*Math.cos(aa),R*Math.sin(aa),zg]); Bb.push([rL*Math.cos(ab),rL*Math.sin(ab),zL]); }
    const apex=[0,0,H], ba0=[ra,0,0];
    const nrm=cross(sub(Bb[0],A[0]),sub(ba0,A[0]));
    const dirB=[Math.cos(Math.PI/m),Math.sin(Math.PI/m),0];
    const rb=dot(nrm,A[0])/dot(nrm,dirB);
    const baseA=[], baseB=[];
    for(let k=0;k<m;k++){ const aa=2*Math.PI*k/m, ab=aa+Math.PI/m;
      baseA.push([ra*Math.cos(aa),ra*Math.sin(aa),0]); baseB.push([rb*Math.cos(ab),rb*Math.sin(ab),0]); }
    for(let k=0;k<m;k++){ bottom.push([baseA[k][0],baseA[k][1]]); bottom.push([baseB[k][0],baseB[k][1]]);
      cols.push([baseA[k],A[k]]); cols.push([baseB[k],Bb[k]]); }
    for(let k=0;k<m;k++) faces.push([apex,A[k],Bb[k],A[(k+1)%m]]);
    for(let k=0;k<m;k++){ faces.push([baseA[k],A[k],Bb[k],baseB[k]]);
      faces.push([baseB[k],Bb[k],A[(k+1)%m],baseA[(k+1)%m]]); }
  }
  faces.push(bottom.map(pt=>[pt[0],pt[1],0]));
  const section=h=>cols.map(([p0,p1])=>{
    const t=p1[2]>1e-9?Math.max(0,Math.min(1,h/p1[2])):0;
    return [p0[0]+(p1[0]-p0[0])*t, p0[1]+(p1[1]-p0[1])*t]; });
  let maxEdge=0;
  for(const f of faces) for(let k=0;k<f.length;k++){ const a=f[k], b=f[(k+1)%f.length];
    maxEdge=Math.max(maxEdge,Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])); }
  // `faces` (core) drives exports + cut outlines + base section; thick slabs are display-only
  const thk=p.sheetThk||0;
  let renderFaces=faces, edgeFaces=faces;
  if(thk>0){ const t=thickenPanels(faces,thk); renderFaces=t.slab; edgeFaces=t.outer; }
  return { faces, maxEdge, zg, bottom, section, panelThk:thk, renderFaces, edgeFaces };
}
// Hollow pedestal = a crystal-hugging COLLAR cup dropping into a flared SKIRT.
//   footTop = baseH - collarHeight   -- skirt <-> collar junction
//   seatZ   = footTop - ledgeDepth   -- collar FLOOR (recessed seat); crystal rests here
function buildBaseGeom(b,ctx){
  const G=ctx.crystal; const C=G.bottom;
  const {wall, socketDepth:sd, ledgeW, ledgeThk, flare, clear, baseH, ledgeDepth:ld}=b;
  const thk=G.panelThk||0, cl=clear+thk;          // collar hugs the crystal's OUTER (core+panel) surface
  const footTop=Math.max(ledgeThk+2, baseH-sd);   // skirt <-> collar junction
  const seatZ  =Math.max(ledgeThk+2, footTop-ld); // collar floor (recessed seat)
  const collarH=baseH-footTop, recess=footTop-seatZ;
  const sTop =G.section(baseH-seatZ);             // crystal @ top rim
  const sFoot=G.section(recess);                  // crystal @ skirt junction
  // COLLAR — thin tube hugging the crystal (inner offset cl, wall thick)
  const Is=offsetPoly(C,cl),      Os=offsetPoly(C,cl+wall);          // seat / floor
  const Ifn=offsetPoly(sFoot,cl), Ofn=offsetPoly(sFoot,cl+wall);     // skirt junction
  const It=offsetPoly(sTop,cl),   Ot=offsetPoly(sTop,cl+wall);       // top rim
  // SKIRT — flared shell, inner flush with the collar outer at footTop
  const fi=z=>cl+wall+flare*(footTop-z)/footTop;                      // skirt inner offset (flares down)
  const SiG=offsetPoly(sFoot,fi(0)), SoG=offsetPoly(sFoot,fi(0)+wall);// ground (widest)
  const SoT=offsetPoly(sFoot,cl+2*wall);                              // footTop outer
  let faces=[].concat(
    ringFaces(lift(It,baseH),   lift(Ifn,footTop)), ringFaces(lift(Ifn,footTop), lift(Is,seatZ)),  // collar inner
    ringFaces(lift(Os,seatZ),   lift(Ofn,footTop)), ringFaces(lift(Ofn,footTop), lift(Ot,baseH)),  // collar outer
    ringFaces(lift(Ot,baseH),   lift(It,baseH)),                                                    // top rim
    ringFaces(lift(SoG,0),      lift(SoT,footTop)),                   // skirt outer
    ringFaces(lift(Ofn,footTop),lift(SiG,0)),                         // skirt inner (from collar outer @ footTop)
    ringFaces(lift(SoT,footTop),lift(Ofn,footTop)),                   // skirt top rim (joins collar outer)
    ringFaces(lift(SiG,0),      lift(SoG,0)));                        // skirt bottom rim (open centre = cavity)
  // collar floor = the ledge; crystal bottom panel rests on top, wiring hole in the middle
  const Lin=offsetPoly(C,-ledgeW);
  const ftO=lift(Os,seatZ),          ftI=lift(Lin,seatZ),
        fbO=lift(Os,seatZ-ledgeThk), fbI=lift(Lin,seatZ-ledgeThk);
  faces=faces.concat(ringFaces(ftO,ftI),ringFaces(fbI,fbO),ringFaces(ftI,fbI),ringFaces(fbO,ftO));
  const tube=(P0,P1,h)=>prismatoid(polyArea(P0),polyArea(midPoly(P0,P1)),polyArea(P1),h);
  const collar=(tube(Os,Ofn,recess)+tube(Ofn,Ot,collarH))-(tube(Is,Ifn,recess)+tube(Ifn,It,collarH));
  const skirt =tube(SoG,SoT,footTop)-tube(SiG,Ofn,footTop);
  const vFloor=ledgeThk*Math.max(0,polyArea(Os)-polyArea(Lin));
  const vol=Math.max(0,collar+skirt+vFloor);
  const cavityW=2*minR(offsetPoly(sFoot, fi(seatZ-ledgeThk))), cavityH=seatZ-ledgeThk;
  const fits=cavityW>=60&&cavityH>=30;
  const rOut=Math.max(maxR(SoG),maxR(Ot)), rIn=Math.min(minR(SiG),minR(Lin));
  return { faces, vol, footprint:2*rOut, cavityW, cavityH, fits, seatZ,
           seg:segBBox(rOut,rIn,b.segments), loops:{oB:SoG,oT:Ot} };
}

/* ============================================================ estimates ===== */
const MATERIALS={ pla:{rho:1.24,price:22}, petg:{rho:1.27,price:25},
                  resin:{rho:1.10,price:40}, abs:{rho:1.04,price:24} };
const ACRYLIC_DENSITY=1.18;       // g/cm³ (cast acrylic / PMMA)
const ACRYLIC_RATE_PER_MM=85;     // ~$ per m² per mm of sheet thickness (incl. cutting)
function crystalEstimate(out,p){
  const faces=out.faces, map=edgeMapper(faces);
  const uniq=new Set(faces.map(f=>sig3d(f,map))).size;
  let area=0; for(const f of faces) area+=polyArea3D(f);
  const thk=p.sheetThk||3, m2=area/1e6;
  const cost=m2*ACRYLIC_RATE_PER_MM*thk;
  const grams=(area*thk/1000)*ACRYLIC_DENSITY;     // mm³ → cm³ × ρ
  return { cost, rows:[
    ['Panels (total)', faces.length],
    ['Unique shapes', uniq],
    ['Largest edge', Math.round(out.maxEdge)+' mm'],
    ['Sheet area', m2.toFixed(2)+' m²'],
    ['Sheet thickness', thk+' mm'],
    ['Acrylic mass', grams.toFixed(0)+' g'],
    ['Est. acrylic', '$'+cost.toFixed(2)] ] };
}
function baseEstimate(out,p,ctx){
  const mats=ctx.MATERIALS||MATERIALS, m=mats[ctx.printMat]||mats.pla;
  const cm3=out.vol/1000, grams=cm3*m.rho, cost=grams/1000*m.price;
  return { cost, rows:[
    ['Volume (solid)', cm3.toFixed(0)+' cm³'],
    ['Mass', grams.toFixed(0)+' g'],
    ['Filament cost', '$'+cost.toFixed(2)],
    ['Largest segment', Math.round(out.seg[0])+' × '+Math.round(out.seg[1])+' mm'],
    ['Interior cavity', Math.round(out.cavityW)+' × '+Math.round(out.cavityH)+' mm'],
    ['Fits controller', out.fits?'yes':'tight'] ] };
}

/* ============================================================ MODEL ========= */
window.MODEL = {
  meta: { name:'Crystal sculpture + base', units:'mm', fabricationDefault:'cut-sheet' },
  MATERIALS,
  parts: [
    { id:'crystal', name:'Crystal', engine:'analytic', fab:'cut-sheet', dependsOn:[],
      render:{ styles:['acrylic','pla','clay','wire'], default:'acrylic' },
      exports:['stl','dxf','svg'],
      params:[
        { key:'H',    label:'Total height',      unit:'mm', min:300, max:1800, step:10,  default:1000, group:'Size' },
        { key:'ratio',label:'Bottom : Top ratio',unit:': 1',min:1,   max:3,    step:0.01,default:3 },
        { key:'midW', label:'Mid (widest) width',unit:'mm', min:150, max:700,  step:5,   default:420,  group:'Profile' },
        { key:'botW', label:'Bottom width',      unit:'mm', min:60,  max:700,  step:5,   default:200 },
        { key:'zz',   label:'Facet depth',       unit:'%',  min:0,   max:14,   step:0.5, default:8 },
        { key:'mode', label:'Faceting', type:'choice', default:'diamond', group:'Faceting',
          options:[['diamond','Diamonds'],['tri','Triangles']] },
        { key:'n',    label:'Sides', type:'choice', default:6, options:[[4,'4'],[6,'6'],[8,'8']] },
        { key:'sheetThk', label:'Acrylic sheet', unit:'mm', min:2, max:10, step:0.5, default:3, group:'Material' },
      ],
      build:(p,ctx)=>buildCrystal(p),
      transform:(p,ctx)=>({ z: ctx.base ? ctx.base.seatZ : 0 }),
      estimate:(out,p,ctx)=>crystalEstimate(out,p) },

    { id:'base', name:'Base (pedestal)', engine:'analytic', fab:'printed', dependsOn:['crystal'],
      render:{ styles:['pla','clay','metal','wire'], default:'pla' },
      exports:['stl'],
      params:[
        { key:'baseH',      label:'Base height',     unit:'mm', min:30, max:350, step:5, default:70, group:'Shell' },
        { key:'wall',       label:'Wall thickness',  unit:'mm', min:2,  max:20,  step:1, default:5 },
        { key:'socketDepth',label:'Collar height',   unit:'mm', min:0,  max:150, step:5, default:25 },
        { key:'ledgeDepth', label:'Ledge depth (recess)', unit:'mm', min:0, max:120, step:5, default:20 },
        { key:'flare',      label:'Base flare',      unit:'mm', min:0,  max:200, step:5, default:40 },
        { key:'clear',      label:'Socket clearance',unit:'mm', min:0,  max:2,   step:0.1,default:0.1 },
        { key:'ledgeW',     label:'Ledge width',     unit:'mm', min:3,  max:40,  step:1, default:30, group:'Support lip' },
        { key:'ledgeThk',   label:'Ledge thickness', unit:'mm', min:3,  max:15,  step:1, default:6 },
        { key:'segments',   label:'Print segments', type:'choice', default:3, group:'Printing',
          options:[[1,'1'],[2,'2'],[3,'3'],[4,'4']] },
      ],
      build:(p,ctx)=>buildBaseGeom(p,ctx),
      transform:(p,ctx)=>({ z:0 }),
      estimate:(out,p,ctx)=>baseEstimate(out,p,ctx) },
  ],
};
})();
