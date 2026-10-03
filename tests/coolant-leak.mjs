// node --experimental-vm-modules tests/coolant-leak.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

let now=100000, saved, volumes=0, destroyed=0, latest, filterAvailable=true;
const ticks=new Set(), hooks=new Map(), layer={children:[],addChild(display){this.children.push(display);display.parent=this;},
  removeChild(display){this.children=this.children.filter(d=>d!==display);display.parent=null;}};
const scene={id:"engineering",getFlag:()=>saved,setFlag:async(module,key,value)=>{
  assert.equal(module,"sta2e-toolkit");assert.equal(key,"coolantLeak");saved=structuredClone(value);
}};
class Graphics {
  constructor(){this.position={set:(x,y)=>{this.x=x;this.y=y;}};}
  clear(){return this;}beginFill(){return this;}drawCircle(){return this;}endFill(){return this;}destroy(){this.destroyed=true;}
}
const canvas={ready:true,scene,interface:layer,app:{ticker:{add:fn=>ticks.add(fn),remove:fn=>ticks.delete(fn)}}};
const game={user:{isGM:true}};
const context=vm.createContext({console,canvas,game,PIXI:{VERSION:"7",Graphics},Date:{now:()=>now},Math,
  Hooks:{on:(name,fn)=>hooks.set(name,fn)}});
const mod=new vm.SourceTextModule(await readFile(new URL("../scripts/coolant-leak.js",import.meta.url),"utf8"),{context});
await mod.link(()=>new vm.SyntheticModule(["createLocalVolume"],function(){this.setExport("createLocalVolume",options=>{
  if(!filterAvailable)return null;
  volumes++;const display=new Graphics();latest={options,display,updates:[],destroyCount:0};const record=latest;
  return {display,update:values=>record.updates.push({...values}),destroy(){record.destroyCount++;destroyed++;display.parent?.removeChild(display);display.destroy();}};
});},{context}));await mod.evaluate();const api=mod.namespace;
const tick=ms=>{now+=ms;for(const fn of [...ticks])fn();};

assert.equal(api.getCoolantLeak().active,false);
assert.equal(api.getCoolantLeak().angle,0,"older scenes retain upward flow");
assert.equal(api.getCoolantLeak().projection,"top-down","older scenes retain their projection");
assert.equal(api.getCoolantLeak({getFlag:()=>({projection:"invalid"})}).projection,"top-down");
assert.equal(api.getCoolantLeak({getFlag:()=>({angle:-90})}).angle,270);
assert.equal(api.getCoolantLeak({getFlag:()=>({angle:450})}).angle,90);
for(const angle of [0,45,90,135,180,270]) {
  const size=90,bounds=api.coolantPlumeBounds(size,angle),r=angle*Math.PI/180;
  for(const [x,y]of [[0,0],[-1.4,-4],[1.4,-4],[-1.4,.25],[1.4,.25]]) {
    const px=(Math.cos(r)*x-Math.sin(r)*y)*size,py=(Math.sin(r)*x+Math.cos(r)*y)*size;
    assert.ok(px>=bounds.x-1e-7&&px<=bounds.x+bounds.width+1e-7&&py>=bounds.y-1e-7&&py<=bounds.y+bounds.height+1e-7,
      `rotated bounds contain source and plume corners at ${angle} degrees`);
  }
}
await assert.rejects(api.startCoolantLeak(),/Place/);
await api.setCoolantLeakConfig({x:230,y:410,size:90});
assert.equal(saved.x,230);assert.equal(saved.y,410);assert.equal(saved.active,false);assert.equal(ticks.size,0);
await api.startCoolantLeak();assert.equal(saved.active,true);assert.equal(saved.startedAt,now);
assert.equal(ticks.size,1);assert.equal(layer.children.length,1);assert.equal(latest.display.x,230);
assert.ok(latest.options.body.includes("stepIndex<16"));assert.ok(latest.options.body.includes("transmission=1.0-alpha"));
const first=latest;tick(60000);assert.equal(ticks.size,1,"plume has no duration expiry");
assert.equal(first.updates.at(-1).uTime,60);assert.equal(first.updates.at(-1).uRamp,1);
tick(3600000);assert.equal(ticks.size,1,"plume continues for long sessions");
api.syncCoolantLeak();assert.equal(volumes,1,"unchanged flag does not duplicate plume");
await api.startCoolantLeak();assert.equal(volumes,1,"repeated Start does not restart active plume");
const startedAt=saved.startedAt;
const seed=saved.seed;
await api.setCoolantLeakConfig({projection:"isometric"});
assert.equal(saved.startedAt,startedAt);assert.equal(saved.seed,seed);
assert.equal(latest.options.uniforms.uIsometric,1);assert.equal(ticks.size,1);
for(const angle of [0,45,90,135,180,270]) {
  const bounds=api.coolantPlumeBounds(90,angle,"isometric"),r=angle*Math.PI/180;
  const points=[[-1.4,-3.5],[1.4,-3.5],[-1.4,.5],[1.4,.5]].map(([x,y])=>[
    (Math.cos(r)*x-Math.sin(r)*y)*90,(Math.sin(r)*x+Math.cos(r)*y)*90]);
  points.push([-1.6*90,-.6*90],[1.6*90,.8*90]);
  for(const [x,y]of points)assert.ok(x>=bounds.x-1e-7&&x<=bounds.x+bounds.width+1e-7&&y>=bounds.y-1e-7&&y<=bounds.y+bounds.height+1e-7);
}
await api.setCoolantLeakConfig({density:1.7,speed:2,x:250});
assert.equal(saved.startedAt,startedAt);assert.equal(first.destroyCount,1);assert.equal(ticks.size,1);
assert.equal(latest.display.x,250);assert.equal(latest.options.uniforms.uDensity,1.7);
assert.equal(latest.updates.at(-1).uTime,7320);
const beforeRotation=latest;
await api.setCoolantLeakConfig({angle:135});
assert.equal(saved.angle,135);assert.equal(saved.startedAt,startedAt,"rotation preserves ongoing flow time");
assert.equal(latest.options.uniforms.uAngle,135*Math.PI/180);
assert.equal(beforeRotation.destroyCount,1);assert.equal(ticks.size,1,"live rotation keeps one active plume");

api.registerCoolantLeakHooks();hooks.get("canvasTearDown")();
assert.equal(ticks.size,0);assert.equal(layer.children.length,0);assert.equal(saved.active,true,"leaving scene retains persisted running state");
game.user.isGM=false;hooks.get("canvasReady")();
assert.equal(ticks.size,1,"late player or returning viewer restores persisted plume");
assert.equal(latest.options.uniforms.uAngle,135*Math.PI/180,"returning players restore saved direction");
assert.equal(latest.options.uniforms.uIsometric,1,"returning players restore scene projection");
await assert.rejects(api.stopCoolantLeak(),/Only the GM/);
await assert.rejects(api.setCoolantLeakConfig({x:1,y:2}),/Only the GM/);
const count=volumes;
hooks.get("updateScene")({id:"elsewhere"},{flags:{"sta2e-toolkit":{coolantLeak:{}}}});assert.equal(volumes,count);
saved={...saved,active:false};hooks.get("updateScene")(scene,{flags:{"sta2e-toolkit":{coolantLeak:saved}}});
assert.equal(ticks.size,0,"remote GM stop removes player's plume");
game.user.isGM=true;await api.startCoolantLeak();await api.stopCoolantLeak();
assert.equal(saved.active,false);assert.equal(saved.x,250);assert.equal(ticks.size,0,"Stop retains source but removes renderer");
await api.startCoolantLeak();await api.clearCoolantLeakSource();
assert.equal(saved.x,null);assert.equal(saved.active,false);assert.equal(ticks.size,0);
await assert.rejects(api.setCoolantLeakConfig({x:NaN,y:2}),/valid/);
await Promise.all([api.setCoolantLeakConfig({x:150,y:250}),api.setCoolantLeakConfig({size:120}),api.setCoolantLeakConfig({density:.8})]);
assert.equal(saved.x,150);assert.equal(saved.size,120);assert.equal(saved.density,.8,"rapid edits preserve fields");
filterAvailable=false;await api.setCoolantLeakConfig({angle:270});await api.startCoolantLeak();tick(5000);assert.equal(ticks.size,1,"Graphics fallback continuously flows");
assert.equal(layer.children[0].rotation,270*Math.PI/180,"Graphics fallback rotates around emitter too");
api.detachCoolantLeak();assert.equal(layer.children.length,0,"fallback renderer cleanup removes its parent");
filterAvailable=true;api.syncCoolantLeak();
canvas.scene={id:"bridge",getFlag:()=>undefined};tick(50);
assert.equal(ticks.size,0,"scene switch releases old plume");assert.equal(saved.active,true);
api.syncCoolantLeak();assert.equal(ticks.size,0,"leak does not follow viewers into another scene");
canvas.scene=scene;api.syncCoolantLeak();assert.equal(ticks.size,1);
saved=undefined;hooks.get("updateScene")(scene,{flags:{"sta2e-toolkit":{"-=coolantLeak":null}}});
assert.equal(ticks.size,0,"remote flag removal clears plume");
await api.setCoolantLeakConfig({size:999,density:99,speed:-2,active:true});
assert.equal(saved.size,400);assert.equal(saved.density,2);assert.equal(saved.speed,.2);assert.equal(saved.active,false);
assert.equal(destroyed,volumes,"every allocated GPU volume released exactly once");
console.log("Coolant leak checks passed: scene persistence, GM writes, continuous lifetime, idempotence, live edits, late-player restoration, stop, source removal, serialized writes, fallback and scene teardown.");
