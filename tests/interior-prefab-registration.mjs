// Regression checks for uniform art placement and independent shared door states.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fitRegistration,rasterPlacement,placePoint,doorSegments,renderDoorLayer,corridorFinishGeometry} from '../tools/interior-prefab-registration.mjs';
const root=new URL('../',import.meta.url),art=new URL('assets/interiors/prefabs/starfleet-tng/',root);
const read=async url=>JSON.parse(await readFile(url,'utf8'));
const kit=await read(new URL('docs/interior-prefabs/starter-kit.json',root));
const anchors=await read(new URL('registration-anchors.json',art));
const report=await read(new URL('registration-report.json',art));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} ~= ${b}`);
const fitted=fitRegistration([{units:[0,0],pixels:[30,50]},{units:[4,0],pixels:[830,50]},{units:[4,2],pixels:[830,450]}]);
close(fitted.pixelsPerUnit,200);close(fitted.origin[0],30);close(fitted.origin[1],50);close(fitted.maxResidualUnits,0);
const raster=rasterPlacement(fitted,[1000,800]);close(raster.width/raster.height,1.25);close(raster.x,-.15);close(raster.y,-.25);
assert.throws(()=>fitRegistration([{units:[0,0],pixels:[1,1]},{units:[0,0],pixels:[2,2]}]),/non-degenerate/);
assert.throws(()=>fitRegistration([{units:[0,0],pixels:[0,0]},{units:[1,1],pixels:[-1,-1]}]),/positive/);
assert.throws(()=>fitRegistration([{units:[0,0],pixels:[NaN,1]},{units:[1,1],pixels:[2,2]}]),/Invalid/);
const drift=fitRegistration([{units:[0,0],pixels:[0,0]},{units:[2,0],pixels:[400,0]},{units:[2,2],pixels:[400,440]},{units:[0,2],pixels:[0,440]}]);
assert.ok(drift.maxResidualUnits>.05,'Nonuniform artwork is reported as residual, not hidden by stretching.');
for(const piece of report.pieces){
  const spec=anchors.pieces.find(p=>p.id===piece.id),fit=fitRegistration(spec.anchors);
  assert.equal(spec.file,piece.file);close(fit.pixelsPerUnit,piece.registration.pixelsPerUnit);
  assert.ok(fit.maxResidualUnits<=.05,`${piece.id}: selected anchor residual <= 7.5 cm (proof tolerance, not production approval)`);
  const bytes=await readFile(new URL(piece.file,art));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),piece.sha256,`${piece.id}: report belongs to current image`);
  assert.equal(bytes.readUInt32BE(16),piece.canvas[0]);assert.equal(bytes.readUInt32BE(20),piece.canvas[1]);
  const placed=rasterPlacement(fit,piece.canvas);close(placed.width/placed.height,piece.canvas[0]/piece.canvas[1]);
}
const doors=doorSegments(kit);assert.equal(doors.length,5,'Three shared exterior doors and two bathroom doors.');
const expected=(await read(new URL('docs/interior-prefabs/starter-assembly-walls.json',root))).walls.filter(w=>w.door);
const key=p=>p.map(v=>Math.round(v*1e6)/1e6).join(',');
const segment=w=>[key(w.a),key(w.b)].sort().join('/');
assert.deepEqual(doors.map(segment).sort(),expected.map(segment).sort(),'Door artwork lies on the deduplicated native-wall proof.');
for(const rotation of [0,90,180,270]){
  const pose={at:[7,9],rotation};
  for(const door of doors){const a=placePoint(door.a,pose),b=placePoint(door.b,pose);close(Math.hypot(b[0]-a[0],b[1]-a[1]),1.2);}
}
assert.equal(renderDoorLayer(doors,{closed:false}),'','Open doors have no baked leaf.');
assert.equal((renderDoorLayer(doors,{closed:true}).match(/data-door=/g)??[]).length,5);
const finish=corridorFinishGeometry(kit);
assert.equal(finish.polygons.length,6,'Six corridor placements including reused end cap.');
// An internal corridor join must not be painted over with a wall strip.
assert.ok(!finish.walls.some(w=>Math.abs(w.a[0]-4)<1e-6&&Math.abs(w.b[0]-4)<1e-6&&Math.min(w.a[1],w.b[1])<1.05&&Math.max(w.a[1],w.b[1])>1.05));
for(const w of finish.walls)assert.ok(Math.hypot(w.a[0]-w.b[0],w.a[1]-w.b[1])>1e-6);
for(const name of ['registered-assembly.svg','registered-assembly-closed.svg']){
  const svg=await readFile(new URL(name,art),'utf8');
  assert.equal((svg.match(/data-piece=/g)??[]).length,10);assert.equal((svg.match(/clip-path=/g)??[]).length,10);
  assert.ok(svg.includes('mask="url(#corridor-finish)"'));
  assert.equal((svg.match(/data-door=/g)??[]).length,name.includes('closed')?5:0);
}
console.log('Verified nine revision-pinned registrations, uniform scales, reported distortion, 10 clipped placements, and five independent doors aligned with the wall proof in all four rotations.');
