// node --experimental-vm-modules tests/interior-measured-cabins.mjs [--review]
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
const cache=new Map();
async function load(url){if(!cache.has(url.href))cache.set(url.href,readFile(url,'utf8').then(s=>new vm.SourceTextModule(s,{identifier:url.href})));return cache.get(url.href);}
const mod=await load(new URL('../scripts/interior-scene.js',import.meta.url));
await mod.link((s,r)=>load(new URL(s,r.identifier)));await mod.evaluate();
const ns=async path=>(await load(new URL(path,import.meta.url))).namespace;
const {generateInterior,validateInterior,interiorWallSegments}=await ns('../scripts/interior-layout.js');
const {renderInteriorSVG}=await ns('../scripts/interior-art.js');
const {cabinTransform}=await ns('../scripts/interior-measured-cabins.js');
const {CABIN_PLAN_CATALOG}=await ns('../scripts/interior-cabin-plans.js');
const approved=JSON.parse(await readFile(new URL('../docs/interior-prefabs/cabin-revisions/catalog.json',import.meta.url),'utf8'));
assert.deepEqual(CABIN_PLAN_CATALOG,approved,'Runtime data must exactly match the catalog used to draw the approved SVGs');
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const side=(a,b,p)=>{const v=((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x))/distance(a,b);return Math.abs(v)<.0004?0:Math.sign(v);};
const cuts=(a,b,c,d)=>side(a,b,c)*side(a,b,d)<0&&side(c,d,a)*side(c,d,b)<0;
let count=0;
for(const hullProfile of ['generic','galaxy','intrepid'])for(const cabinLayout of [...approved.pieces.map(p=>p.id),'svg-mixed'])for(const curved of [true,false])for(const jefferies of [true,false]) {
  const deck=generateInterior({hullProfile,cabinLayout,curved,jefferies,size:'medium',roomTypes:['quarters','lift','lounge'],seed:'approved-cabins'});
  assert.deepEqual(validateInterior(deck),[]);
  assert.deepEqual(generateInterior(JSON.parse(JSON.stringify(deck.recipe))),deck);
  for(let i=0;i<deck.rooms.length;i++)for(const other of deck.rooms.slice(i+1)) {
    const poly=deck.rooms[i].polygon;
    for(let j=0;j<poly.length;j++)for(let k=0;k<other.polygon.length;k++)assert.ok(!cuts(poly[j],poly[(j+1)%poly.length],other.polygon[k],other.polygon[(k+1)%other.polygon.length]),`${hullProfile}/${cabinLayout}: ${deck.rooms[i].name} crosses ${other.name}`);
  }
  const walls=interiorWallSegments(deck),svg=renderInteriorSVG(deck);
  assert.ok(!/NaN|Infinity/.test(svg));
  for(const room of deck.rooms.filter(r=>r.kind==='quarters')) {
    const plan=approved.pieces.find(p=>p.id===room.cabinPlan),world=cabinTransform(room),a=room.architecture;
    assert.ok(plan,'Every quarters compartment uses an approved measured plan');
    assert.equal(room.frame.w,Math.max(...plan.footprint.map(p=>p[0])));
    assert.equal(room.frame.h,Math.max(...plan.footprint.map(p=>p[1])));
    assert.deepEqual(a.fixtures,plan.fixtures);
    assert.deepEqual(a.bedrooms,plan.bedrooms??[]);
    assert.deepEqual(a.closet,plan.closet??null);
    assert.deepEqual(a.bathroom,plan.bathroom);
    const publicDoors=deck.edges.filter(e=>e.rooms.includes(room.id)&&e.exactDoor);
    assert.equal(publicDoors.length,plan.ports.length,'The junior pair retains TWO public entrances');
    for(const port of plan.ports)assert.ok(publicDoors.some(e=>distance({x:(e.a.x+e.b.x)/2,y:(e.a.y+e.b.y)/2},world(port.at))<.0003&&Math.abs(distance(e.a,e.b)-1.2)<.0003));
    const internal=a.walls.filter(w=>w.door);
    assert.equal(internal.length,plan.partitions.filter(p=>p.door).length);
    for(const partition of plan.partitions.filter(p=>p.door))assert.ok(internal.some(w=>distance({x:(w.a.x+w.b.x)/2,y:(w.a.y+w.b.y)/2},world(partition.door.at))<.0003));
    assert.equal(a.walls.filter(w=>w.serviceWall).length,plan.serviceWalls.length*4,'Replicator bulkheads export collision walls');
    assert.ok(svg.includes(`data-cabin-plan="${plan.id}"`));
    if(room.zone==='inboard')assert.ok(!deck.edges.some(e=>e.rooms.includes(room.id)&&e.window),'Interior cabins never gain hull windows');
    else if(deck.recipe.hullWindows)assert.equal(deck.edges.filter(e=>e.rooms.includes(room.id)&&e.window).length,plan.windows.length,'Only measured window apertures are used');
  }
  const scene=mod.namespace.interiorSceneData(deck,'test.webp');
  assert.equal(scene.walls.filter(w=>w.door===1).length,walls.filter(w=>w.door).length,'All public and internal doors reach scene export');
  count++;
}
const mixed=generateInterior({cabinLayout:'svg-mixed',roomTypes:['quarters'],size:'large',hullProfile:'intrepid',seed:'all-sizes'});
assert.deepEqual(new Set(mixed.rooms.filter(r=>r.cabinPlan).map(r=>r.cabinPlan)),new Set(approved.pieces.map(p=>p.id)));
for(const hullProfile of ['generic','galaxy','intrepid'])for(const cabinLayout of ['Q04-P','Q05-F3'])for(const seed of ['alpha','beta','gamma'])for(const size of ['small','large']) {
  assert.deepEqual(validateInterior(generateInterior({hullProfile,cabinLayout,seed,size,roomTypes:['quarters']})),[]);count++;
}
if(process.argv.includes('--review')) {
  const panels=[];
  for(const plan of approved.pieces) {
    const deck=generateInterior({cabinLayout:plan.id,hullProfile:'galaxy',roomTypes:['quarters','lift'],size:'small',seed:'cabin-review',jefferies:true});
    const cabin=deck.rooms.find(r=>r.cabinPlan),xs=cabin.polygon.map(p=>p.x),ys=cabin.polygon.map(p=>p.y);
    const box=[Math.min(...xs)-.6,Math.min(...ys)-.6,Math.max(...xs)-Math.min(...xs)+1.2,Math.max(...ys)-Math.min(...ys)+1.2];
    const detail=renderInteriorSVG({...deck,rooms:[cabin],edges:deck.edges.filter(e=>e.rooms.includes(cabin.id))}).replace(/viewBox="[^"]+"/,`viewBox="${box.join(' ')}"`).replace(/width="\d+" height="\d+"/,'width="100%" height="auto"');
    panels.push(`<article><h2>${plan.id} · ${plan.name}</h2><p>${plan.footprint[1][0]*1.5} m × ${plan.footprint[2][1]*1.5} m. Original SVG dimensions, partitions and fixture positions.</p>${detail}<details><summary>Show cabin placement on the deck</summary>${renderInteriorSVG(deck).replace(/width="\d+" height="\d+"/,'width="100%" height="auto"')}</details></article>`);
  }
  await writeFile(new URL('../docs/interior-previews/measured-cabin-layouts.html',import.meta.url),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Approved SVG cabins in procedural decks</title><style>body{background:#10171e;color:#e4ebf0;font:16px system-ui;margin:24px}article{border:1px solid #506070;padding:18px;margin:28px 0}svg{max-height:1000px}</style><h1>Approved SVG cabins in procedural decks</h1><p>Measured layouts reused at original scale. Straight cabin frontages join the curved deck; closets, shared heads, private bedrooms and service walls are native geometry. No new image assets.</p>${panels.join('')}</html>`);
}
console.log(`Verified ${count} measured cabin decks: source parity, dimensions, independent entrances, bedroom/closet doors, service-wall collisions, non-crossing rooms, windows, export and saved recipes.`);
