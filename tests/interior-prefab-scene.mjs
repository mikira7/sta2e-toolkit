import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),art=new URL('assets/interiors/prefabs/starfleet-tng/',root);
const kit=JSON.parse(await readFile(new URL('starter-scene.json',art),'utf8'));
const bytes=await readFile(new URL('registered-assembly.png',art));
assert.equal(createHash('sha256').update(bytes).digest('hex'),kit.background.sha256);
for(const [key,path]of [['geometry','docs/interior-prefabs/starter-kit.json'],['walls','docs/interior-prefabs/starter-assembly-walls.json']])
  assert.equal(createHash('sha256').update(await readFile(new URL(path,root))).digest('hex'),kit.sourceHashes[key]);
const plain=value=>JSON.parse(JSON.stringify(value));
const hooks=new Map(),events=[];let failure=null,lastData,contextDraw,revoked=0,allocated=0;
const fakeContext={save(){},restore(){},translate(...v){this.offset=v;},rotate(v){this.angle=v;},drawImage(_im,...v){contextDraw={offset:this.offset,angle:this.angle,rect:v};}};
const sandbox={console,Blob,File,Uint8Array,crypto:webcrypto,URL:{createObjectURL(){allocated++;return'blob:test';},revokeObjectURL(){revoked++;}},
  Image:class{naturalWidth=2000;naturalHeight=1300;async decode(){if(failure==='decode')throw new Error('decode failed');}},
  document:{createElement(){return {getContext:()=>fakeContext,toBlob:callback=>callback(failure==='encode'?null:new Blob(['webp'],{type:'image/webp'}))};}},
  fetch:async url=>{events.push('fetch');return{ok:failure!=='fetch',json:async()=>structuredClone(kit),arrayBuffer:async()=>failure==='hash'?new ArrayBuffer(1):bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};},
  game:{user:{isGM:true},world:{id:'test-world'},release:{generation:14}},
  ui:{notifications:{info(){},warn(){}}},
  foundry:{utils:{randomID:()=> 'test1234'},applications:{apps:{FilePicker:{implementation:{
    createDirectory:async()=>{events.push('directory');},upload:async()=>{events.push('upload');if(failure==='upload')return{};return{path:'worlds/test-world/sta2e-interiors/test.webp'};}
  }}}}},
  Scene:class{constructor(data,options){events.push('validate');assert.equal(options.strict,true);if(failure==='schema')throw new Error('schema failed');}
    static async create(data){events.push('create');lastData=data;return{name:data.name,view:async()=>{events.push('view');}};}},
  Hooks:{on:(name,fn)=>{const list=hooks.get(name)??[];list.push(fn);hooks.set(name,list);}},
};
const context=vm.createContext(sandbox),mod=new vm.SourceTextModule(await readFile(new URL('scripts/interior-prefab-scene.js',root),'utf8'),{context});
await mod.link(()=>{throw new Error('Unexpected runtime dependency');});await mod.evaluate();
const api=mod.namespace;
assert.deepEqual(plain(api.normalizePrefabRecipe()),{kit:'habitation-starter-v1',rotation:0,gridSize:100});
for(const recipe of [{rotation:45},{gridSize:200},{kit:'anything'},{rotation:NaN}])assert.throws(()=>api.normalizePrefabRecipe(recipe));
for(const corrupt of [k=>k.walls.pop(),k=>k.walls[0].a[0]=-1,k=>k.background.file='registered-assembly-closed.png',k=>k.lights[0].radius=-1]){
  const bad=structuredClone(kit);corrupt(bad);assert.throws(()=>api.validatePrefabManifest(bad));
}
const length=w=>Math.hypot(w.b[0]-w.a[0],w.b[1]-w.a[1]);
const original=JSON.parse(await readFile(new URL('docs/interior-prefabs/starter-assembly-walls.json',root),'utf8')).walls;
assert.ok(Math.abs(original.reduce((n,w)=>n+length(w),0)-kit.walls.reduce((n,w)=>n+length(w),0))<1e-6,'splitting windows preserves all wall coverage');
const windowWalls=kit.walls.filter(w=>w.window);assert.equal(windowWalls.length,2);
for(const win of windowWalls){
  const mid=win.a.map((v,i)=>(v+win.b[i])/2);
  for(const wall of kit.walls.filter(w=>!w.window)){
    const cross=(mid[0]-wall.a[0])*(wall.b[1]-wall.a[1])-(mid[1]-wall.a[1])*(wall.b[0]-wall.a[0]);
    const on=Math.abs(cross)<1e-6&&Math.abs(Math.hypot(mid[0]-wall.a[0],mid[1]-wall.a[1])+Math.hypot(mid[0]-wall.b[0],mid[1]-wall.b[1])-length(wall))<1e-6;
    assert.equal(on,false,'window has no overlapping opaque wall');
  }
}
// Separate formulas deliberately compare raster transform with every native endpoint.
for(const rotation of [0,90,180,270])for(const gridSize of [70,100,140])for(const generation of [13,14]){
  const recipe={rotation,gridSize},data=api.prefabSceneData(kit,recipe,'test.webp',{generation});
  const rot=p=>{const angle=rotation*Math.PI/180,offset={0:[0,0],90:[13,0],180:[20,13],270:[0,20]}[rotation];return[
    Math.round((offset[0]+p[0]*Math.cos(angle)-p[1]*Math.sin(angle))*gridSize+1e-8),
    Math.round((offset[1]+p[0]*Math.sin(angle)+p[1]*Math.cos(angle))*gridSize+1e-8)];};
  assert.equal(data.width,(rotation%180?13:20)*gridSize);assert.equal(data.height,(rotation%180?20:13)*gridSize);
  assert.equal(data.walls.length,69);assert.equal(data.tiles.length,generation>=14?0:5);assert.equal(data.active,false);assert.equal(data.grid.distance,1.5);
  for(const wall of data.walls){
    if(generation>=14&&wall.door){assert.equal(wall.animation.type,'slide');assert.equal(wall.animation.double,true);assert.equal(wall.animation.strength,1);assert.equal(wall.animation.duration,750);assert.equal(wall.flags.core.textureGridSize,200);assert.ok(wall.animation.texture.endsWith('/door-panel.svg'));}
    else assert.equal(wall.animation,undefined);
  }
  data.walls.forEach((w,i)=>{assert.deepEqual(plain(w.c),[...rot(kit.walls[i].a),...rot(kit.walls[i].b)]);assert.equal(w.sight,kit.walls[i].window?0:20);assert.equal(w.move,20);});
  data.tiles.forEach(tile=>{
    const wall=data.walls.find(w=>w.flags['sta2e-toolkit'].prefabDoorKey===tile.flags['sta2e-toolkit'].prefabDoorKey),[ax,ay,bx,by]=wall.c;
    assert.ok(Math.abs(tile.x+tile.width/2-(ax+bx)/2)<=.5);assert.ok(Math.abs(tile.y+tile.height/2-(ay+by)/2)<=.5);
    assert.ok(Math.abs(tile.width-Math.hypot(bx-ax,by-ay))<=.5);
    assert.ok(Math.abs(Math.sin(tile.rotation*Math.PI/180)*(bx-ax)-Math.cos(tile.rotation*Math.PI/180)*(by-ay))<1e-6);
  });
  for(const item of [...data.tiles,...data.walls,...data.lights])assert.equal(!!item.levels,generation===14);
  assert.equal(generation===14?data.levels[0].background.src:data.background.src,'test.webp');
  api.drawPrefabBackground(fakeContext,{},kit,recipe);
  for(const p of [[0,0],[20,0],[20,13],[0,13],[2,5]]){
    const {angle,offset}=contextDraw;
    assert.deepEqual([Math.round(offset[0]+(p[0]*Math.cos(angle)-p[1]*Math.sin(angle))*gridSize+1e-8),Math.round(offset[1]+(p[0]*Math.sin(angle)+p[1]*Math.cos(angle))*gridSize+1e-8)],rot(p));
  }
  assert.deepEqual(contextDraw.rect,[0,0,20*gridSize,13*gridSize]);
}
// Native door states change presentation without writing any documents, for all users.
const wall={door:1,ds:0,flags:{'sta2e-toolkit':{prefabDoorKey:'door-1'}},parent:{id:'scene'}};
const tile={document:{hidden:false,flags:{'sta2e-toolkit':{prefabDoorKey:'door-1'}},parent:{walls:[wall]}},mesh:{visible:true},visible:true};
for(const isGM of [true,false])for(const state of [0,1,2]){sandbox.game.user.isGM=isGM;wall.ds=state;api.refreshPrefabDoor(tile);assert.equal(tile.mesh.visible,state!==1);}
tile.document.hidden=true;wall.ds=0;api.refreshPrefabDoor(tile);assert.equal(tile.mesh.visible,false);
sandbox.game.user.isGM=true;api.refreshPrefabDoor(tile);assert.equal(tile.mesh.visible,true);
tile.document.hidden=false;tile.visible=false;api.refreshPrefabDoor(tile);assert.equal(tile.mesh.visible,false);tile.visible=true;
tile.document.parent.walls=[];api.refreshPrefabDoor(tile);assert.equal(tile.mesh.visible,false);tile.document.parent.walls=[wall];
sandbox.canvas={scene:{id:'scene'},tiles:{placeables:[tile]}};
api.registerPrefabDoorHooks();api.registerPrefabDoorHooks();assert.equal(hooks.get('refreshTile').length,1);
wall.ds=1;hooks.get('updateWall')[0](wall);assert.equal(tile.mesh.visible,false);
wall.ds=2;hooks.get('refreshTile')[0](tile);assert.equal(tile.mesh.visible,true);
wall.door=0;hooks.get('updateWall')[0](wall);assert.equal(tile.mesh.visible,false);wall.door=1;
wall.animation={type:'slide',texture:'door.svg'};wall.ds=0;api.refreshPrefabDoor(tile);assert.equal(tile.mesh.visible,false,'native door suppresses old leaf even for GM');delete wall.animation;
// Upgrade existing starter scenes without shifting walls, unlocking doors, deleting
// tiles, or replacing animations the user has already configured.
const legacy=api.prefabSceneData(kit,{},null,{generation:13});
legacy.walls.forEach((w,i)=>w.id=`w${i}`);legacy.tiles.forEach((t,i)=>t.id=`t${i}`);
const doors=legacy.walls.filter(w=>w.door);doors[0].ds=2;doors[1].ds=1;
doors[2].animation={type:'swing',texture:'custom.svg'};
legacy.tiles.push({id:'unrelated',hidden:false,texture:{src:'other.svg'}});
const before=plain(legacy.walls.map(w=>({c:w.c,ds:w.ds}))),mutations=[];
legacy.updateEmbeddedDocuments=async(type,updates)=>{
  mutations.push({type,updates:plain(updates)});
  for(const update of updates){const doc=(type==='Wall'?legacy.walls:legacy.tiles).find(d=>d.id===update._id);Object.assign(doc,update);}
};
sandbox.game.users={activeGM:{id:'gm'}};sandbox.game.user.id='gm';
const result=await api.upgradePrefabDoors(legacy);assert.deepEqual(plain(result),{doors:4,retiredTiles:5});
assert.deepEqual(mutations.map(m=>m.type),['Wall','Tile']);assert.deepEqual(plain(legacy.walls.map(w=>({c:w.c,ds:w.ds}))),before);
assert.equal(doors[2].animation.texture,'custom.svg');assert.equal(legacy.tiles.at(-1).hidden,false);
mutations.length=0;await api.upgradePrefabDoors(legacy);assert.equal(mutations.length,0,'upgrade is idempotent');
const failed=api.prefabSceneData(kit,{},null,{generation:13});failed.updateEmbeddedDocuments=async type=>{assert.equal(type,'Wall');throw new Error('update failed');};
await assert.rejects(api.upgradePrefabDoors(failed),/update failed/);assert.ok(failed.tiles.every(t=>!t.hidden));
sandbox.game.user.id='other-gm';await api.upgradePrefabDoors(failed);sandbox.game.user.id='gm';
sandbox.game.release.generation=13;await api.upgradePrefabDoors(failed);sandbox.game.release.generation=14;
await api.upgradePrefabDoors({flags:{}});
// Permission and preparation failures must not persist a partial scene.
sandbox.game.user.isGM=false;events.length=0;await assert.rejects(api.createPrefabInteriorScene(),/GM/);assert.deepEqual(events,[]);sandbox.game.user.isGM=true;
for(const fail of ['fetch','schema','hash','decode','encode','upload']){
  failure=fail;events.length=0;await assert.rejects(api.createPrefabInteriorScene());assert.ok(!events.includes('create'));
  if(fail!=='upload')assert.ok(!events.includes('upload'));
}
failure=null;
for(const generation of [13,14]){
  sandbox.game.release.generation=generation;events.length=0;
  await api.createPrefabInteriorScene({rotation:90},{name:'Fitted section',view:false});
  assert.deepEqual(events,['fetch','validate','fetch','directory','upload','create']);assert.equal(lastData.active,false);
  assert.equal(generation===14?lastData.levels[0].background.src:lastData.background.src,'worlds/test-world/sta2e-interiors/test.webp');
}
events.length=0;await api.createPrefabInteriorScene();assert.equal(events.at(-1),'view');
assert.equal(revoked,allocated,'image object URLs released on success and failure');
console.log('PASS: starter integrity, window splitting, 24 scene variants, raster/wall alignment, door state hooks, and atomic scene creation failure paths.');

