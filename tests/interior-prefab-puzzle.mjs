import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),cache=new Map();
async function load(url){if(!cache.has(url.href))cache.set(url.href,new vm.SourceTextModule(await readFile(url,'utf8'),{identifier:url.href}));return cache.get(url.href);}
const mod=await load(new URL('scripts/interior-prefab-puzzle.js',root));await mod.link((p,m)=>load(new URL(p,m.identifier)));await mod.evaluate();
const api=mod.namespace,geo=cache.get(new URL('scripts/interior-prefab-layout.js',root).href).namespace,scene=cache.get(new URL('scripts/interior-prefab-scene.js',root).href).namespace;
const art=new URL('assets/interiors/prefabs/starfleet-tng/',root),library=JSON.parse(await readFile(new URL('assembly-library.json',art),'utf8'));
const plain=v=>JSON.parse(JSON.stringify(v));
let total=0;const varied=new Set();
for(let seed=0;seed<12;seed++)for(const cabins of [2,3,4,5,6])for(const mix of ['mixed','standard','officer'])for(const shape of ['straight','bent']){
  const recipe={seed:`deck-${seed}`,cabins,mix,shape},layout=api.generatePuzzle(library,recipe);total++;
  assert.deepEqual(plain(layout),plain(api.generatePuzzle(library,recipe)),'deterministic geometry');
  assert.equal(layout.walls.filter(w=>w.door).length,cabins*2+1);assert.equal(layout.walls.filter(w=>w.window).length,cabins);
  assert.equal(layout.placements.filter(p=>p.piece==='T01-A').length,1);
  assert.equal(layout.placements.filter(p=>p.piece==='H07-A').length,2);
  assert.equal(layout.placements.filter(p=>p.piece==='Q03-L').length,layout.placements.filter(p=>p.piece==='F01-A').length);
  if(mix==='mixed')for(const type of ['Q01-A','Q03-L'])assert.ok(layout.placements.some(p=>p.piece===type));
  assert.equal(geo.validatePuzzle(library,layout.placements).length,0);
  const ports=geo.puzzlePorts(library,layout.placements);
  for(const port of ports)assert.equal(ports.filter(p=>p.owner!==port.owner&&p.type===port.type&&Math.hypot(p.at[0]-port.at[0],p.at[1]-port.at[1])<1e-6).length,1);
  for(const w of layout.walls)for(const p of [w.a,w.b])assert.ok(p[0]>=0&&p[1]>=0&&p[0]<=layout.width&&p[1]<=layout.height);
  // No window midpoint may also be covered by a movement/sight-blocking solid edge.
  for(const win of layout.walls.filter(w=>w.window)){
    const mid=win.a.map((v,i)=>(v+win.b[i])/2),dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
    assert.ok(!layout.walls.some(w=>!w.window&&Math.abs(dist(w.a,mid)+dist(mid,w.b)-dist(w.a,w.b))<1e-6));
  }
  if(cabins===3&&mix==='mixed'&&shape==='bent')varied.add(JSON.stringify(layout.placements));
}
assert.ok(varied.size>=10,'seeds must produce different arrangements');
const base=api.generatePuzzle(library,{seed:'aurora',cabins:3});
for(const rotation of [0,90,180,270])for(const gridSize of [70,100,140])for(const generation of [13,14]){
  const recipe={...base.recipe,rotation,gridSize},data=scene.prefabLayoutSceneData(base,recipe,'map.webp',{generation});
  assert.equal(data.width,(rotation%180?base.height:base.width)*gridSize);
  assert.equal(data.height,(rotation%180?base.width:base.height)*gridSize);
  for(let i=0;i<base.walls.length;i++)assert.deepEqual(plain(data.walls[i].c),base.walls[i].a.concat(base.walls[i].b).reduce((acc,_v,j,arr)=>j%2?acc:[...acc,...scene.rotatePrefabPoint([arr[j],arr[j+1]],rotation,base.width,base.height).map(v=>Math.round(v*gridSize+1e-8))],[]));
  assert.equal(data.tiles.length,generation===14?0:7);
  assert.deepEqual(plain(data.flags['sta2e-toolkit'].prefabInterior.placements),plain(base.placements));
}
for(const invalid of [{cabins:1},{cabins:7},{cabins:2.5},{mix:'bridge'},{shape:'circle'},{rotation:45}])assert.throws(()=>api.generatePuzzle(library,invalid));
const missing=structuredClone(library);missing.pieces=missing.pieces.filter(p=>p.id!=='H07-A');assert.throws(()=>api.generatePuzzle(missing),/Missing required piece/);
const overlap=structuredClone(base.placements);overlap.push({...overlap[0],id:'collision'});assert.ok(geo.validatePuzzle(library,overlap).some(e=>e.includes('overlap')));
const orphan=base.placements.filter(p=>p.piece!=='H07-A');assert.ok(geo.validatePuzzle(library,orphan).some(e=>e.includes('Unmatched')));
const badLift=structuredClone(base.placements);badLift.find(p=>p.piece==='T01-A').at[1]=0;assert.ok(geo.validatePuzzle(library,badLift).some(e=>e.includes('inboard')));
// Exact concave overlap: infill belongs in the L-shaped notch, never the living space.
const L=library.pieces.find(p=>p.id==='Q03-L').footprint;
assert.equal(geo.puzzleOverlap(L,[[4,0],[6,0],[6,2],[4,2]]),false);
assert.equal(geo.puzzleOverlap(L,[[3.9,0],[6,0],[6,2],[3.9,2]]),true);
const sources={};for(const p of library.pieces){const bytes=await readFile(new URL(p.art.file,art));assert.equal(createHash('sha256').update(bytes).digest('hex'),p.art.sha256);sources[p.id]=`data:image/png;base64,${bytes.toString('base64')}`;}
const carpet=await readFile(new URL(library.corridorFinish.file,art));assert.equal(createHash('sha256').update(carpet).digest('hex'),library.corridorFinish.sha256);sources.carpet=`data:image/png;base64,${carpet.toString('base64')}`;
const svg=api.puzzleSVG(base,library,sources);assert.equal((svg.match(/data-piece=/g)??[]).length,base.placements.length);assert.ok(!svg.includes('undefined'));
if(process.argv.includes('--render')){
  await writeFile(new URL('automatic-assembly.svg',art),svg);
  await writeFile(new URL('automatic-assembly-layout.json',art),JSON.stringify(base,null,2)+'\n');
  const second=api.generatePuzzle(library,{seed:'voyager',cabins:4,mix:'mixed',shape:'straight',rotation:90});
  await writeFile(new URL('automatic-assembly-rotated.svg',art),api.puzzleSVG(second,library,sources));
}
console.log(`PASS: ${total} deterministic puzzle layouts, exact ports, connectivity, overlap rejection, inboard lift, outboard windows, native export in 24 variants, artwork integrity and bounded invalid requests.`);
