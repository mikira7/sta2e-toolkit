// Run: node --experimental-vm-modules tests/interior-queen-beds.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const cache=new Map();
async function load(url){if(!cache.has(url.href))cache.set(url.href,readFile(url,'utf8').then(s=>new vm.SourceTextModule(s,{identifier:url.href})));return cache.get(url.href);}
const mod=await load(new URL('../scripts/interior-scene.js',import.meta.url));
await mod.link((s,r)=>load(new URL(s,r.identifier)));await mod.evaluate();
const ns=async path=>(await load(new URL(path,import.meta.url))).namespace;
const geometry=await ns('../scripts/interior-layout.js'),assets=await ns('../scripts/interior-assets.js'),art=await ns('../scripts/interior-art.js');
const {pointInInteriorPolygon}=await ns('../scripts/interior-brush.js');
const {CABIN_PLAN_CATALOG}=await ns('../scripts/interior-cabin-plans.js');
const queen=r=>r.faction==='federation'&&r.era==='tng';
const overlap=(a,b)=>a.x<b.x+b.w-1e-5&&a.x+a.w>b.x+1e-5&&a.y<b.y+b.h-1e-5&&a.y+a.h>b.y+1e-5;
let count=0;
for(const plan of ['spine','ring','lattice','section','habitat'])for(const curved of [true,false])for(let seed=0;seed<12;seed++) {
  const layout=geometry.generateInterior({plan,curved,seed:`queen-${seed}`,roomTypes:['quarters'],era:'tng',faction:'federation'});
  for(const room of layout.rooms.filter(r=>r.kind==='quarters')) {
    const a=room.architecture,beds=a.furniture.filter(f=>f.kind==='bed');assert.ok(beds.length);
    for(const bed of beds) {
      assert.equal(bed.w,1.16);assert.equal(bed.h,1.55);
      if(a.type==='habitat-cabin') {
        const section=a.sections.find(s=>s.kind==='bed'&&bed.x>=s.x0&&bed.x+bed.w<=s.x1);
        assert.ok(section,'Queen bed remains in its own bedroom');
        assert.ok(bed.y+bed.h < (a.hall?a.h/2-1.1:a.h/2-1.6),'Queen bed clears the private hall and walk-through door line');
      } else for(const dx of [0,bed.w/2,bed.w])for(const dy of [0,bed.h/2,bed.h])
        assert.ok(pointInInteriorPolygon(bed.x+dx,bed.y+dy,a.livingPolygon),'Bed remains inside living space');
    }
    count+=beds.length;
  }
}
for(const cabinLayout of ['Q01-B','Q02-R','Q04-P','Q03-R','Q05-F2','Q05-F3']) {
  const layout=geometry.generateInterior({cabinLayout,roomTypes:['quarters'],era:'tng',seed:'queen-measured'});
  for(const room of layout.rooms.filter(r=>r.kind==='quarters'))for(const f of room.architecture.fixtures.filter(f=>f.kind==='bed')) {
    const [x,y,w,h]=f.rect;assert.equal(w,1.16);assert.equal(h,1.55);assert.equal(f.size,'queen');
    assert.ok(x>=.1&&y>=.1&&x+w<=room.frame.w-.1&&y+h<=room.frame.h-.1,'Bed fits the measured cabin');
    for(const other of room.architecture.fixtures.filter(other=>other!==f)) {
      const [ox,oy,ow,oh]=other.rect;
      assert.ok(!overlap({x,y,w,h},{x:ox,y:oy,w:ow,h:oh}),`${cabinLayout}: bed does not overlap ${other.kind}`);
    }
    count++;
  }
  const older=geometry.generateInterior({cabinLayout,roomTypes:['quarters'],era:'tos',seed:'queen-measured'});
  for(const room of older.rooms.filter(r=>r.kind==='quarters'))assert.deepEqual(room.architecture.fixtures,CABIN_PLAN_CATALOG.pieces.find(p=>p.id===room.cabinPlan).fixtures,'Earlier-era measured fixtures keep their original sizes');
}
assert.ok(assets.interiorAssetPaths({faction:'federation',era:'tng'}).bed.endsWith('bed-officer.png'));
for(const era of ['ent','tos','movies','picard'])assert.ok(assets.interiorAssetPaths({faction:'federation',era}).bed.endsWith('/bed.png'));
assert.ok(assets.interiorAssetPaths({faction:'klingon',era:'tng'}).bed.endsWith('/bed.png'));
const custom='worlds/test/my-bed.png';assert.equal(assets.interiorAssetPaths({faction:'federation',era:'tng',assets:{bed:custom}}).bed,custom);
const layout=geometry.generateInterior({era:'tng',roomTypes:['quarters'],assets:{bed:'drawn'}}),svg=art.renderInteriorSVG(layout);
assert.ok(svg.includes('data-bed-size="queen"'));
assert.ok(!/NaN|Infinity|\b(?:width|height)="-/.test(svg));
console.log(`Verified ${count} queen beds across procedural and measured cabins, bedroom/door clearance, furniture collisions, era defaults, and explicit asset selection.`);
