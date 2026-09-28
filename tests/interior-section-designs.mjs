// node --experimental-vm-modules tests/interior-section-designs.mjs
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
const cache=new Map();
async function load(url) {
  if(!cache.has(url.href))cache.set(url.href,readFile(url,'utf8').then(s=>new vm.SourceTextModule(s,{identifier:url.href})));
  return cache.get(url.href);
}
const root=await load(new URL('../scripts/interior-art.js',import.meta.url));
await root.link((s,r)=>load(new URL(s,r.identifier)));await root.evaluate();
const geometry=(await load(new URL('../scripts/interior-layout.js',import.meta.url))).namespace;
const {generateInterior,validateInterior,interiorWallSegments}=geometry;
const {pointInInteriorPolygon}=(await load(new URL('../scripts/interior-brush.js',import.meta.url))).namespace;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a,b,p)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
const side=(a,b,p)=>{const v=cross(a,b,p)/distance(a,b);return Math.abs(v)<.0002?0:Math.sign(v);};
const cuts=(a,b,c,d)=>side(a,b,c)*side(a,b,d)<0&&side(c,d,a)*side(c,d,b)<0;
const contains=(x,y,poly)=>pointInInteriorPolygon(x,y,poly)||poly.some((a,i)=>{
  const b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,t=((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy);
  return t>=0&&t<=1&&Math.hypot(x-a.x-t*dx,y-a.y-t*dy)<.002;
});
let count=0;
for(const hullProfile of ['generic','galaxy','intrepid'])for(const size of ['small','medium','large'])for(const curved of [true,false])for(const junctions of ['none','tee','cross','mixed'])for(const cabinLayout of ['standard','officer']) {
  const layout=generateInterior({plan:'section',hullProfile,size,curved,junctions,cabinLayout,purpose:'habitat',seed:'section-design'});
  assert.deepEqual(validateInterior(layout),[]);
  assert.deepEqual(generateInterior(JSON.parse(JSON.stringify(layout.recipe))),layout);
  assert.ok(layout.edges.every(e=>e.rooms.length<=2),'No overlapping shared boundaries');
  for(let i=0;i<layout.rooms.length;i++)for(const other of layout.rooms.slice(i+1)) {
    const poly=layout.rooms[i].polygon;
    for(let j=0;j<poly.length;j++)for(let k=0;k<other.polygon.length;k++)assert.ok(!cuts(poly[j],poly[(j+1)%poly.length],other.polygon[k],other.polygon[(k+1)%other.polygon.length]),`Room boundaries cross: ${layout.rooms[i].name} / ${other.name}`);
  }
  const byId=new Map(layout.rooms.map(r=>[r.id,r]));
  for(const room of layout.rooms.filter(r=>r.junction)) {
    const neighbours=new Set(layout.edges.filter(e=>e.kind==='open'&&e.rooms.includes(room.id)).flatMap(e=>e.rooms).filter(id=>id!==room.id&&byId.get(id).kind==='corridor'));
    assert.equal(neighbours.size,room.junction,'Each intersection has its advertised number of open corridor arms');
  }
  if(junctions==='none')assert.ok(!layout.rooms.some(r=>r.junction));
  else assert.ok(layout.rooms.some(r=>r.junction));
  const alcove=layout.rooms.find(r=>r.alcove);
  assert.ok(alcove);
  const lengths=alcove.polygon.map((p,i)=>distance(p,alcove.polygon[(i+1)%4]));
  assert.ok(lengths.every((n,i)=>Math.abs(n-(i%2?1:2))<.0003),'Alcove is a true 2 by 1 rectangle');
  assert.ok(layout.edges.some(e=>e.rooms.includes(alcove.id)&&e.kind==='hatch'),'Alcove connects through a service hatch');
  assert.ok(layout.edges.some(e=>e.rooms.includes(alcove.id)&&e.kind==='open'),'Alcove mouth is open to passageway');
  for(const r of layout.rooms.filter(r=>r.kind==='quarters')) {
    assert.equal(r.architecture.arrangement,cabinLayout);
    assert.ok(r.architecture.furniture.some(f=>f.kind==='bed'));
    assert.ok(r.architecture.furniture.some(f=>f.kind==='desk'));
    for(const f of r.architecture.furniture)for(const dx of [0,.5,1])for(const dy of [0,.5,1])assert.ok(contains(f.x+f.w*dx,f.y+f.h*dy,r.architecture.livingPolygon),'Full-size furniture stays inside the living area and outside the head');
    if(cabinLayout==='standard')assert.equal(r.architecture.bathroom.tub,false);
    if(cabinLayout==='officer')assert.equal(r.architecture.bathroom.tub,true);
  }
  if(hullProfile!=='generic')assert.ok(layout.rooms.filter(r=>r.curveRadius).every(r=>r.curveRadius===(hullProfile==='galaxy'?96:52)));
  assert.ok(interiorWallSegments(layout).some(s=>s.hatch&&s.door));
  count++;
}
for(const hullProfile of ['galaxy','intrepid']) {
  const noService=generateInterior({hullProfile,jefferies:false});
  assert.ok(!noService.rooms.some(r=>r.kind==='jefferies'||r.alcove));
  const liftOnly=generateInterior({hullProfile,roomTypes:['lift']});
  assert.ok(!liftOnly.rooms.some(r=>r.kind==='jefferies'||r.alcove));
}
// Optional local design review uses procedural lines and existing furniture rendering only.
if(process.argv.includes('--review')) {
  const panels=[];
  for(const hullProfile of ['galaxy','intrepid'])for(const cabinLayout of ['standard','officer']) {
    const layout=generateInterior({plan:'section',hullProfile,cabinLayout,junctions:'mixed',size:'medium',roomTypes:['quarters','lift','lounge'],seed:'design-review',gridSize:70});
    panels.push(`<article><h2>${hullProfile} · ${cabinLayout} cabins</h2><p>Fixed passageway inner radius: ${hullProfile==='galaxy'?144:78} m. T and cross branches; 3 × 1.5 m access alcove.</p>${root.namespace.renderInteriorSVG(layout).replace(/width="\d+" height="\d+"/,'width="100%" height="auto"')}</article>`);
  }
  await writeFile(new URL('../docs/interior-previews/section-designs.html',import.meta.url),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Procedural deck layout studies</title><style>body{margin:24px;background:#111820;color:#e5edf5;font:16px system-ui}article{margin:32px 0;border:1px solid #526170;padding:20px}svg{max-height:850px}h1,h2{text-transform:capitalize}</style><h1>Procedural deck layout studies</h1><p>Geometry review, using existing procedural symbols. Original design presets; not canonical ship blueprints. One square = 1.5 m. Outer branches terminate at this section’s hull; inboard branches reach the maintenance access route.</p>${panels.join('')}</html>`);
}
console.log(`Verified ${count} section designs: fixed curves, open T/cross arms, exact alcoves, service hatches, cabin arrangements and recipe round trips.`);
