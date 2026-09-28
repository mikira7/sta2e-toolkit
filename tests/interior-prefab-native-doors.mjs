// Optional integration check against a locally installed Foundry v14 DoorMesh.
// No Foundry source is copied into the repository or modified on disk.
// node --experimental-vm-modules tests/interior-prefab-native-doors.mjs <Foundry app directory>
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import vm from 'node:vm';
const install=process.argv[2];if(!install)throw new Error('Pass the installed Foundry resources/app directory.');
const source=await readFile(resolve(install,'client/canvas/containers/elements/door-mesh.mjs'),'utf8');
const vector=()=>({x:0,y:0,set(x,y){this.x=x;this.y=y;}});
class Sprite {
  constructor(options){Object.assign(this,options);this.position=vector();this.anchor=vector();this.scale=vector();}
}
const context=vm.createContext({console,Blob,PrimarySpriteMesh:Sprite,Color:class{},
  PrimaryCanvasGroup:{SORT_LAYERS:{SCENE:0}},
  CanvasAnimation:{easeInOutCosine:x=>x,async animate(list,options){for(const a of list)a.parent[a.attribute]=a.to;options.ontick();}},
  canvas:{scene:{_source:{grid:{size:100}}},primary:{foreground:{elevation:0,sort:0}}},
  CONFIG:{Wall:{animationTypes:{},textureGridSize:100}},
  foundry:{documents:{BaseWall:{schema:{fields:{animation:{clean:()=>({direction:1,double:false,duration:750,flip:false,strength:1})}}}}},utils:{deepClone:structuredClone,setProperty:(o,k,v)=>o[k]=v}},
});
const native=new vm.SourceTextModule(source.replace(/^import .*;\r?\n/gm,''),{context});
await native.link(()=>{throw new Error('Unexpected native import');});await native.evaluate();
const DoorMesh=native.namespace.default;
context.CONFIG.Wall.animationTypes.slide={animate:DoorMesh.animateSlide};
const adapter=new vm.SourceTextModule(await readFile(new URL('../scripts/interior-prefab-scene.js',import.meta.url),'utf8'),{context});
await adapter.link(()=>{throw new Error('Unexpected adapter import');});await adapter.evaluate();
const kit=JSON.parse(await readFile(new URL('../assets/interiors/prefabs/starfleet-tng/starter-scene.json',import.meta.url),'utf8'));
const texture=await readFile(new URL('../assets/interiors/prefabs/starfleet-tng/door-panel.svg',import.meta.url),'utf8');
assert.match(texture,/width="120" height="20"/);
let count=0;
for(const rotation of [0,90,180,270])for(const gridSize of [70,100,140]){
  context.canvas.scene._source.grid.size=gridSize;
  const data=adapter.namespace.prefabSceneData(kit,{rotation,gridSize},null,{generation:14});
  for(const doc of data.walls.filter(w=>w.door)){
    const [ax,ay,bx,by]=doc.c,dx=bx-ax,dy=by-ay,length=Math.hypot(dx,dy),ux=dx/length,uy=dy/length;
    const object={id:`door${count++}`,isOpen:false,document:doc,edge:{a:{x:ax,y:ay},b:{x:bx,y:by}},midpoint:[(ax+bx)/2,(ay+by)/2],
      toRay:()=>({A:{x:ax,y:ay},B:{x:bx,y:by},distance:length,angle:Math.atan2(dy,dx),project:t=>({x:ax+dx*t,y:ay+dy*t})})};
    const meshes=['doubleL','doubleR'].map(style=>new DoorMesh({...doc.animation,object,texture:{width:120,height:20},style}));
    const spans=()=>meshes.map(mesh=>{
      // Actual native pivot, anchor and scale: this would catch the old half-width tile offset.
      const start=-mesh.anchor.x*120*mesh.scale.x,end=(1-mesh.anchor.x)*120*mesh.scale.x;
      const project=x=>((mesh.position.x+Math.cos(mesh.rotation)*x-ax)*ux+(mesh.position.y+Math.sin(mesh.rotation)*x-ay)*uy)/length;
      assert.ok(Math.abs((mesh.position.x-ax)*uy-(mesh.position.y-ay)*ux)<1e-6);
      assert.ok(Math.abs(Math.abs(mesh.scale.y)*20-gridSize*.1)<1e-6);
      return[project(start),project(end)].sort((a,b)=>a-b);
    }).sort((a,b)=>a[0]-b[0]);
    const near=(actual,expected)=>actual.flat().forEach((v,i)=>assert.ok(Math.abs(v-expected.flat()[i])<1e-6,`${v} != ${expected.flat()[i]}`));
    near(spans(),[[0,.5],[.5,1]]);
    await Promise.all(meshes.map(m=>m.animate(true)));near(spans(),[[-.5,0],[1,1.5]]);
    await Promise.all(meshes.map(m=>m.animate(false)));near(spans(),[[0,.5],[.5,1]]);
  }
}
console.log(`PASS: installed Foundry DoorMesh aligns and opens/closes all ${count} rotated/resized doorway pairs with correct wall thickness.`);

