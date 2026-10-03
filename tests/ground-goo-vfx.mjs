// node --experimental-vm-modules tests/ground-goo-vfx.mjs
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
let now=0,serial=0;
const ticks=new Set(),timers=new Map(),roots=[],packets=[],sounds=[],hooks=new Map();
class Container {
  constructor(){this.children=[];}
  addChild(...children){this.children.push(...children);}
  destroy(){this.destroyed=true;this.children.forEach(c=>c.destroy());}
}
class Graphics extends Container {
  clear(){this.shapes=[];return this;}
  beginFill(color,alpha){this.color=color;this.alpha=alpha;return this;}
  drawPolygon(points){this.shapes??=[];this.shapes.push({points,color:this.color,alpha:this.alpha});return this;}
  endFill(){return this;}
}
const context=vm.createContext({console,PIXI:{Graphics},performance:{now:()=>now},
  canvas:{ready:true,scene:{id:"scene"},grid:{size:100},app:{ticker:{add:f=>ticks.add(f),remove:f=>ticks.delete(f)}}},
  game:{socket:{emit:(_,msg)=>packets.push(msg)}},Hooks:{on:(name,f)=>hooks.set(name,f)},
  setTimeout:(fn,ms)=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)});
const native=new vm.SyntheticModule(["nativeVfxContainer","playNativeVfxSound"],function(){
  this.setExport("nativeVfxContainer",()=>{const c=new Container();roots.push(c);return c;});
  this.setExport("playNativeVfxSound",p=>sounds.push(p));
},{context});
const module=new vm.SourceTextModule(await readFile(new URL("../scripts/ground-goo-vfx.js",import.meta.url),"utf8"),{context});
await module.link(()=>native);await module.evaluate();
const goo=module.namespace,source={center:{x:100,y:100}},target={center:{x:400,y:100},w:100,h:100};
const config={type:"ground-goo",sound:"hit",missSound:"miss"};
function advance(ms){for(let i=0;i<ms;i+=20){now+=20;for(const f of [...ticks])f();}}
const hit=goo.fireGroundGooVFX(config,true,source,[target]);
const root=roots.at(-1),[orb,splat]=root.children;
assert.ok(orb.shapes.length);assert.equal(splat.shapes.length,0,"no splat before arrival");
advance(180);
assert.ok(orb.shapes.at(-1).points[0]>200,"orb travels toward target");
advance(200);
assert.equal(orb.shapes.length,0,"orb disappears at impact");
assert.ok(splat.shapes.length>10,"impact produces wet patch and droplets");
assert.equal(packets[0].targetPoints[0].x,400);assert.deepEqual(sounds,["hit"]);
advance(1600);assert.equal(await hit,true);assert.ok(root.destroyed);
assert.equal(ticks.size,0);assert.equal(timers.size,0);
const miss=goo.fireGroundGooVFX(config,false,source,[target]);
const missRoot=roots.at(-1);
assert.notEqual(packets.at(-1).targetPoints[0].y,100,"miss travels beside token");
advance(400);assert.equal(missRoot.children[1].shapes.length,0,"miss never splats on target");
advance(600);await miss;assert.equal(sounds.at(-1),"miss");
const cancelled=goo.fireGroundGooVFX(config,true,source,[target]);
hooks.get("canvasTearDown")();await cancelled;
assert.equal(ticks.size,0);assert.equal(timers.size,0);
assert.equal(goo.playGroundGooVfxFromSocket({sceneId:"other"}),false);
assert.equal(await goo.fireGroundGooVFX(config,false,{},[target]),false);
assert.equal(await goo.fireGroundGooVFX({type:"ground-beam"},true,source,[target]),false);
const purple=goo.fireGroundGooVFX(config,true,source,[target],{deadly:true});
assert.equal(packets.at(-1).deadly,true,"deadly intent broadcasts to other clients");
assert.ok(roots.at(-1).children[0].shapes.some(s=>s.color===0x713096),"deadly orb is toxic purple");
advance(380);
assert.equal(roots.at(-1).children[1].shapes[0].color,0x863bb2,"deadly splat matches purple orb");
advance(1600);await purple;
const blue=goo.fireGroundGooVFX(config,true,source,[target],{deadly:false});
assert.equal(packets.at(-1).deadly,false);
assert.ok(roots.at(-1).children[0].shapes.some(s=>s.color===0x397da9),"stun orb stays blue");
advance(2000);await blue;
console.log("PASS: goo travel, delayed splat, droplets, misses, sound, broadcast, teardown and deadly/stun palettes");
