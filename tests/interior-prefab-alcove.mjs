import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const base=JSON.parse(await readFile(new URL('assets/interiors/prefabs/starfleet-tng/assembly-library.json',root),'utf8'));
const spec=JSON.parse(await readFile(new URL('docs/interior-prefabs/corridor-style-spec.json',root),'utf8'));
const lib={...base,connectors:{...base.connectors,...spec.connectors},pieces:[...base.pieces,...spec.pieces]};
const mod=new vm.SourceTextModule(await readFile(new URL('scripts/interior-prefab-layout.js',root),'utf8'));await mod.link(()=>{});await mod.evaluate();
const {generatePuzzle,validatePuzzle,puzzleWalls,puzzlePorts,puzzlePoint}=mod.namespace;
const alcove=spec.pieces.find(p=>p.id==='J01-A'),floor=alcove.clearFloor;
assert.ok(Math.abs(floor[1][0]-floor[0][0]-2)<1e-9);assert.ok(Math.abs(floor[2][1]-floor[1][1]-2)<1e-9);
assert.equal(alcove.ports.length,1,'future service hatch is not an orphan walkable port');
assert.equal(alcove.serviceAccess.state,'closed');
let count=0,example;
for(let seed=0;seed<16;seed++)for(const cabins of [2,3,4,5,6])for(const shape of ['straight','bent']){
  const layout=generatePuzzle(base,{seed:`alcove-${seed}`,cabins,shape});
  const candidate=layout.placements.find(p=>p.piece==='H02-A'&&p.rotation===0);
  assert.ok(candidate);candidate.piece='H10-J';
  layout.placements.push({id:'jefferies-alcove',piece:'J01-A',at:puzzlePoint([.95,2.1],candidate),rotation:0});
  assert.deepEqual(JSON.parse(JSON.stringify(validatePuzzle(lib,layout.placements))),[]);
  const walls=puzzleWalls(lib,layout.placements),ports=puzzlePorts(lib,layout.placements);
  const mouth=ports.find(p=>p.owner==='jefferies-alcove');
  for(const w of walls){const d=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);assert.ok(Math.abs(d(w.a,mouth.at)+d(mouth.at,w.b)-d(w.a,w.b))>1e-6,'alcove mouth stays open');}
  assert.equal(walls.filter(w=>w.door).length,cabins*2+1,'alcove adds no false room/hatch door');
  if(!example)example=layout;count++;
}
if(process.argv.includes('--render')){
  const rect=(x,y,w,h,fill)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1250" viewBox="-1 -.9 6 6.25"><rect x="-1" y="-.9" width="6" height="6.25" fill="#151d25"/>
  <g font-family="sans-serif" fill="#e6edf3" text-anchor="middle"><text x="2" y="-.45" font-size=".17">JEFFERIES ACCESS — MEASURED GEOMETRY</text>
  <path d="M0 0H4V2.1H3.05V4.2H.95V2.1H0Z" fill="#595c66" stroke="#ccd5dd" stroke-width=".1"/>
  ${rect(0,.05,4,2,'#797c86')}${rect(1,2.15,2,2,'#516b7d')}
  <path d="M2 2.15V4.15M1 3.15H3" stroke="#b8c8d3" stroke-width=".012"/>
  <path d="M0 .05V2.05M4 .05V2.05M1 2.1H3" stroke="#151d25" stroke-width=".11"/>
  <path d="M1.6 4.2H2.4" stroke="#f7c86d" stroke-width=".09"/>
  <text x="2" y="1.1" font-size=".15">3 m clear corridor — no obstruction</text>
  <text x="2" y="2.6" font-size=".13">OPEN ALCOVE</text>
  <text x="2" y="3.7" font-size=".13">3 m × 3 m clear floor</text>
  <text x="2" y="4.65" font-size=".13">Rear hatch · closed until a route is connected</text>
  <text x="2" y="4.95" font-size=".12">One square = 1.5 m · same geometry for both styles</text></g></svg>`;
  // Keep font sizes in normal pixel units before applying the diagram scale;
  // fractional font metrics are unreliable in some SVG rasterizers.
  const readable=svg.replaceAll('font-family="sans-serif"','font-family="Arial"').replace(/<text x="([^"]+)" y="([^"]+)" font-size="([^"]+)"/g,(_m,x,y,size)=>`<text transform="scale(.005)" x="${Number(x)*200}" y="${Number(y)*200}" font-size="${Number(size)*200}"`);
  await writeFile(new URL('assets/interiors/prefabs/corridor-studies/alcove-geometry.svg',root),readable);
}
console.log(`PASS: 160 alcove insertions (${count}), exact 2 × 2 clear squares, open mouth, no overlaps, inboard placement, connected corridors and no orphan hatch door.`);
