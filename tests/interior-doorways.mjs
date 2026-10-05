// Run: node --experimental-vm-modules tests/interior-doorways.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
const cache=new Map(),pending=new Map();
async function load(url) {
  if(!pending.has(url.href))pending.set(url.href,readFile(url,"utf8").then(source=>{
    const mod=new vm.SourceTextModule(source,{identifier:url.href});cache.set(url.href,mod);return mod;
  }));
  return pending.get(url.href);
}
const mod=await load(new URL("../scripts/interior-scene.js",import.meta.url));
await mod.link((spec,ref)=>load(new URL(spec,ref.identifier)));await mod.evaluate();
const geometry=cache.get(new URL("../scripts/interior-layout.js",import.meta.url).href).namespace;
const art=cache.get(new URL("../scripts/interior-art.js",import.meta.url).href).namespace;
for(const plan of ["spine","ring","section","habitat","jefferies"])for(const gridSize of [70,100,140]) {
  const layout=geometry.generateInterior({plan,gridSize,seed:"doorframes",faction:"federation"});
  const segments=geometry.interiorWallSegments(layout),doors=segments.filter(w=>w.door);
  const svg=art.renderInteriorSVG(layout),data=mod.namespace.interiorSceneData(layout,"test.webp");
  assert.equal((svg.match(/data-doorway=/g)??[]).length,doors.length,"Every native door has one frame");
  assert.equal((svg.match(/data-service-hatch=/g)??[]).length,doors.filter(w=>w.hatch).length);
  for(const [i,w]of segments.entries()) {
    assert.deepEqual(data.walls[i].c,[w.a.x,w.a.y,w.b.x,w.b.y].map(v=>Math.round(v*gridSize)),"Door art and movement share geometry");
    assert.equal(Boolean(data.walls[i].animation),Boolean(w.door&&!w.hatch));
    if(data.walls[i].animation) {
      assert.equal(data.walls[i].animation.double,true);
      assert.equal(data.walls[i].animation.type,"slide");
      assert.equal(data.walls[i].flags.core.textureGridSize,200);
      await readFile(new URL(`../${data.walls[i].animation.texture.replace("modules/sta2e-toolkit/","")}`,import.meta.url));
    }
  }
  const legacy=mod.namespace.interiorSceneData(layout,"test.webp",{generation:13});
  assert.ok(legacy.walls.every(w=>!w.animation&&!w.flags?.core));
  assert.equal(art.renderInteriorSVG(layout),svg,"Door artwork is deterministic");
}
for(const faction of ["klingon","romulan","cardassian","borg"]) {
  const layout=geometry.generateInterior({faction,seed:"doorframes"});
  assert.ok(mod.namespace.interiorSceneData(layout,"test.webp").walls.every(w=>!w.animation),"Alien doors do not receive Starfleet leaves");
}
for(const era of ["ent","tos","movies","tng","picard"]) {
  const layout=geometry.generateInterior({era,seed:"eras"});
  const svg=art.renderInteriorSVG(layout);
  assert.ok(svg.includes(`data-doorway-era="${era}"`));
  assert.ok(!/\b(?:width|height)="-/.test(svg),"All frame/control dimensions are positive");
}
const custom=geometry.generateInterior({assets:{threshold:"worlds/test/custom-sill.svg"}});
const customSVG=art.renderInteriorSVG(custom,{assets:{threshold:"data:image/svg+xml;base64,PHN2Zy8+"}});
assert.ok(customSVG.includes('href="#asset-threshold"'),"Explicit sill artwork is preserved inside the frame");
const auto=art.renderInteriorSVG(geometry.generateInterior({}),{assets:{threshold:"data:image/svg+xml;base64,PHN2Zy8+"}});
assert.ok(!auto.includes('href="#asset-threshold"'),"The default sill does not cover the new jambs");
console.log("Verified doorway frames, hatch styling, era controls, native sliding leaves, custom sills, all grid sizes, five plans, and v13 compatibility.");
