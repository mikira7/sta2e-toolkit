import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {roomCorridorModule,blankCorridorHalf,jefferiesCorridorHalf,assembleRoomCorridor} from '../scripts/interior-room-corridor-layout.js';
const kit=JSON.parse(await readFile(new URL('../docs/interior-prefabs/cabin-revisions/catalog.json',import.meta.url),'utf8'));
const modules=kit.pieces.map(p=>roomCorridorModule(kit,p));
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function distanceToWall(p,w){const d=w.b.map((v,i)=>v-w.a[i]),n=d[0]**2+d[1]**2,t=Math.max(0,Math.min(1,((p[0]-w.a[0])*d[0]+(p[1]-w.a[1])*d[1])/n));return dist(p,w.a.map((v,i)=>v+t*d[i]));}
for(const m of modules){
  const original=kit.pieces.find(p=>p.id===m.sourceRoom);
  assert.deepEqual(m.room,original,'approved room geometry remains unchanged');
  assert.equal(m.halfSpan,1.05);
  assert.equal(dist(m.clearCorridorFloor[1],m.clearCorridorFloor[2]),1);
  assert.equal(m.entrances.length,original.ports.length);
  assert.equal(m.walls.filter(w=>w.door).length,original.ports.length+original.partitions.filter(p=>p.door).length,'room/internal doors exported once');
  assert.ok(m.walls.every(w=>w.a[1]<=m.roomDepth&&w.b[1]<=m.roomDepth),'floor seam has no wall');
  assert.equal(dist(m.seams[0].a,m.seams[0].b),m.frontage);
  assert.ok(m.walls.every(w=>!w.window),'interior cabins have no window collision segments');
  assert.deepEqual(m.rearWallLayer.windows,[]);
  assert.equal(m.rearWallLayer.type,'solid');
  assert.equal(m.baseWalls.length+m.rearWallLayer.walls.length,m.walls.length);
}
const alcove=jefferiesCorridorHalf();
assert.ok(Math.abs(dist(alcove.alcoveClearFloor[0],alcove.alcoveClearFloor[1])-2)<1e-6);
assert.ok(Math.abs(dist(alcove.alcoveClearFloor[1],alcove.alcoveClearFloor[2])-1)<1e-6);
assert.equal(alcove.hatch.exportDoor,false);
assert.ok(alcove.walls.every(w=>!w.door));
assert.ok(alcove.walls.every(w=>distanceToWall([2,1.1],w)>.5),'alcove mouth admits a token');
assert.ok(alcove.walls.every(w=>distanceToWall([2,.55],w)>=.55-1e-6),'a one-square token fits entirely inside the shallow alcove');
let count=0;
for(const a of modules)for(const b of modules)for(const style of ['galaxy','intrepid'])for(const rotation of [0,90,180,270]){
  const south=[alcove,blankCorridorHalf(a.frontage+b.frontage-4)];
  const result=assembleRoomCorridor({north:[a,b],south,style,rotation,hullBank:null});
  assert.equal(result.clearCorridorWidth,2);
  assert.equal(result.walls.filter(w=>w.door).length,a.walls.filter(w=>w.door).length+b.walls.filter(w=>w.door).length);
  assert.ok(Math.abs(result.floorSeams.reduce((n,s)=>n+dist(s.a,s.b),0)-result.length)<1e-6,'centre seam has complete, single ownership');
  // A one-square token can traverse the full centreline; no phantom seam walls.
  for(let t=.6;t<result.length-.6;t+=.2){
    const p=result.centreLine.a.map((v,i)=>v+t/result.length*(result.centreLine.b[i]-v));
    assert.ok(result.walls.every(w=>distanceToWall(p,w)>=.55-1e-6),'corridor clear for full token');
  }
  count++;
}
const officer=modules.find(m=>m.sourceRoom==='Q03-R'),pair=modules.find(m=>m.sourceRoom==='Q04-P'),standard=modules.find(m=>m.sourceRoom==='Q02-R');
const opposed=assembleRoomCorridor({north:[officer,standard],south:[pair,alcove,blankCorridorHalf(1.5)],hullBank:null});
assert.equal(opposed.floorSeams.length,4,'different bank boundaries split floor intervals correctly');
assert.equal(opposed.walls.filter(w=>w.door).length,[officer,standard,pair].reduce((n,m)=>n+m.walls.filter(w=>w.door).length,0));
assert.throws(()=>assembleRoomCorridor({north:[officer],south:[pair]}),/unequal coverage/);
assert.throws(()=>assembleRoomCorridor({north:[alcove],south:[blankCorridorHalf(4)]}),/inboard/i);
assert.throws(()=>blankCorridorHalf(-1),/positive/);
assert.throws(()=>assembleRoomCorridor({north:[officer],south:[blankCorridorHalf(officer.frontage,.2)]}),/widths/);
const hullModules=kit.pieces.map(p=>roomCorridorModule(kit,p,{location:'hull'}));
let hullChecks=0;
for(const m of hullModules)for(const hullBank of ['north','south'])for(const rotation of [0,90,180,270]){
  const interior=modules.find(p=>p.sourceRoom===m.sourceRoom);
  assert.deepEqual(m.rearWallLayer.windows,m.room.windows);
  assert.ok(m.walls.some(w=>w.window));
  const geometry=walls=>walls.map(({key,...w})=>w);
  assert.deepEqual(geometry(m.baseWalls),geometry(interior.baseWalls),'rear wall layer is the only geometry difference');
  const result=assembleRoomCorridor({north:[hullBank==='north'?m:interior],south:[hullBank==='south'?m:interior],hullBank,rotation});
  assert.equal(result.walls.filter(w=>w.window).length,m.walls.filter(w=>w.window).length,'only the exposed bank has windows');
  for(const p of result.placements)for(const w of p.rearWallLayer.walls){
    assert.ok(result.walls.some(v=>dist(v.a,w.a)+dist(v.b,w.b)<1e-5||dist(v.a,w.b)+dist(v.b,w.a)<1e-5),'wall layer and collision align after rotation');
  }
  hullChecks++;
}
const hullOfficer=hullModules.find(m=>m.sourceRoom==='Q03-R');
assert.throws(()=>assembleRoomCorridor({north:[officer],south:[hullOfficer]}),/exposed hull/);
assert.throws(()=>assembleRoomCorridor({north:[hullOfficer],south:[officer],hullBank:null}),/exposed hull/);
assert.throws(()=>assembleRoomCorridor({north:[officer,standard],south:[blankCorridorHalf(officer.frontage+standard.frontage)]}),/matching cabin depths/);
console.log(`PASS: ${count} interior assemblies and ${hullChecks} hull variants; solid interior walls, exposed windows, aligned wall layers, 2×1 clear alcove, token routes and rejected hull mismatches.`);
