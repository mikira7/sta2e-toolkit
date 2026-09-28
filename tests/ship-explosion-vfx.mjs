// node --experimental-vm-modules tests/ship-explosion-vfx.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

let now=0, shaderDestroyed=0, broadcast=[], nextId=0, lastColor, ringsCreated=0, ringsDestroyed=0;
const ticks=new Set(), hooks=new Map(), timers=new Map();
class Container {
  constructor() { this.children=[];this.position={set(){}}; }
  addChild(child) { this.children.push(child);child.parent=this;return child; }
  destroy() { this.destroyed=true; if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this); }
}
class Graphics extends Container {
  clear(){return this;} beginFill(){return this;} drawPolygon(){return this;} endFill(){return this;}
}
const token={id:'ship',center:{x:100,y:100},w:100,h:150,visible:true,document:{hidden:false,texture:{scaleX:1,scaleY:1}}};
const layer=new Container(); layer.get=id=>id==='ship'?token:null;layer.controlled=[token];
const canvas={ready:true,scene:{id:'scene'},grid:{size:100},tokens:layer,app:{ticker:{add:f=>ticks.add(f),remove:f=>ticks.delete(f)}}};
const game={user:{isGM:true},settings:{get:()=> 'native'},socket:{emit:(_,e)=>broadcast.push(e)}};
const context=vm.createContext({console,performance:{now:()=>now},PIXI:{Container,Graphics},canvas,game,
  crypto:{randomUUID:()=>String(++nextId)},Hooks:{on:(k,f)=>hooks.set(k,f)},ui:{notifications:{warn(){}}},
  setTimeout:f=>{const id=++nextId;timers.set(id,f);return id;},clearTimeout:id=>timers.delete(id)});
const module=new vm.SourceTextModule(await readFile(new URL('../scripts/ship-explosion-vfx.js',import.meta.url),'utf8'),{context});
await module.link(async name=>{
  if(name.endsWith('ship-explosion-colors.js')) return new vm.SourceTextModule(
    await readFile(new URL('../scripts/ship-explosion-colors.js',import.meta.url),'utf8'),{context});
  if(name.endsWith('ship-shockwave-shader.js')) return new vm.SyntheticModule(['createShipShockwave'],function(){
    this.setExport('createShipShockwave',()=>{ringsCreated++;return {display:new Container(),update(){},destroy(){ringsDestroyed++;}};});
  },{context});
  return new vm.SyntheticModule(['createShipFireball'],function(){this.setExport('createShipFireball',(_size,_seed,color)=>{
    lastColor=color; return {display:new Container(),update(){},destroy(){shaderDestroyed++;}};
  });},{context});
});await module.evaluate();const api=module.namespace;
let checks=0;const check=(v,msg)=>{assert.ok(v,msg);checks++;};
const tick=ms=>{now+=ms;for(const fn of [...ticks])fn();};
const event={id:'first',sceneId:'scene',tokenId:'ship',x:100,y:100,size:150,seed:15};
check(api.useNativeShipExplosion(),'setting chooses native');
check(JSON.stringify(api.buildShipExplosionParticles(5))===JSON.stringify(api.buildShipExplosionParticles(5)),'deterministic on all clients');
check(api.buildShipExplosionParticles(1).length===248,'bounded particle budget');
check(api.buildShipExplosionParticles(1).filter(p=>p.debris).length===28,'solid hull fragments included');
check(api.buildShipExplosionParticles(1,true).length===54,'small hull burst uses fewer particles');
check(api.playShipExplosionFromSocket({...event,sceneId:'elsewhere'})===null,'wrong scene ignored');
check(api.playShipExplosionFromSocket({...event,size:NaN})===null,'invalid dimensions ignored');
game.user.isGM=false;
check(api.playShipExplosionFromSocket({...event,hidden:true})===null,'hidden ships protected');
token.visible=false;check(api.playShipExplosionFromSocket(event)===null,'unseen ships protected');token.visible=true;game.user.isGM=true;
const first=api.playShipExplosionFromSocket(event);
check(ticks.size===1,'one ticker starts');
check(api.playShipExplosionFromSocket(event)===null,'duplicate socket ignored');
// The burst is a snapshot, so a moving or deleted token cannot drag it away.
canvas.tokens.get=()=>null;tick(1000);check(ticks.size===1,'burst survives token removal');
tick(2300);await first.finished;check(ticks.size===0&&timers.size===0,'natural completion releases ticker and timer');
check(shaderDestroyed===1,'natural completion releases renderer');
canvas.tokens.get=()=>token;
api.previewShipExplosion();check(broadcast.length===0,'preview is local');
check(token.document.alpha===undefined,'preview never changes token alpha');
api.stopShipExplosionPreviews();check(ticks.size===0,'preview can be stopped');
const live=api.playNativeShipExplosion(token);check(broadcast.length===1,'live explosion broadcasts once');
api.stopShipExplosionPreviews();check(ticks.size===1,'stop preview leaves combat effects alone');
canvas.scene.id='new';tick(20);await live.finished;check(ticks.size===0,'scene change stops effect');canvas.scene.id='scene';
api.playNativeShipExplosion(token,{secondary:true});tick(1601);check(ticks.size===0,'secondary burst expires sooner');
for(let i=0;i<20;i++)api.playShipExplosionFromSocket({...event,id:'many'+i});
check(ticks.size===16,'simultaneous bursts bounded');
hooks.get('canvasTearDown')();check(ticks.size===0&&timers.size===0,'teardown releases every effect');

let actorColor, tokenColor;
let savedAnchors;
token.actor={getFlag:(_,key)=>key==='shipVfxAnchors'?savedAnchors:actorColor,setFlag:async(_,key,value)=>{if(key==='shipVfxAnchors')savedAnchors=value;else actorColor=value;}};
token.document.getFlag=()=>tokenColor;
token.document.unsetFlag=async()=>{tokenColor=undefined;};
check(api.getShipExplosionColor(token)==='classic','unsaved ships keep classic colors');
await api.saveShipExplosionColor(token,'green');
check(actorColor==='green' && api.getShipExplosionColor(token)==='green','ship actor stores Borg palette');
api.playNativeShipExplosion(token);
check(broadcast.at(-1).color==='green' && lastColor==='green','saved palette reaches local playback and socket');
hooks.get('canvasTearDown')();
api.playShipExplosionFromSocket({...event,id:'remote-green',color:'green'});
check(lastColor==='green','remote client renders sender palette');
hooks.get('canvasTearDown')();
api.previewShipExplosion({color:'purple'});
check(lastColor==='purple' && actorColor==='green','preview override never changes saved ship');
api.stopShipExplosionPreviews();
tokenColor='red';check(api.getShipExplosionColor(token)==='red','token override takes precedence');
await api.saveShipExplosionColor(token,'blue');
check(tokenColor===undefined && actorColor==='blue','saving clears stale token override');
await api.saveShipExplosionColor(token,'__proto__');
check(actorColor==='classic','invalid palette names normalize safely');
game.user.isGM=false;await assert.rejects(api.saveShipExplosionColor(token,'green'),/Only the GM/);
check(actorColor==='classic','non-GM cannot save ship palette');game.user.isGM=true;

const fills=[];
const sparkGraphics={clear(){},beginFill(color,alpha){fills.push({color,alpha});return this;},drawPolygon(){return this;},endFill(){return this;}};
api.drawShipExplosionParticles(new Graphics(),api.buildShipExplosionParticles(1),.4,100,'green',sparkGraphics);
check(fills.length>600 && fills.some(f=>f.color===0x71ff36 && f.alpha<.1)
  && fills.some(f=>f.color===0xe0ffd0 && f.alpha>.8),'green sparks have dim halos and bright cores');

savedAnchors={settings:{explosion:{renderer:'jb2a',color:'green',shockwave:true}}};
check(!api.useNativeShipExplosion(token),'per-ship JB2A overrides native world default');
savedAnchors.settings.explosion.renderer='native';
check(api.useNativeShipExplosion(token),'per-ship native renderer resolves');
check(api.getShipExplosionColor(token)==='green','editor palette overrides legacy color');
const draft=api.previewShipDestruction(token,{renderer:'native',color:'inherit',shockwave:false});
check(lastColor==='classic','unsaved inherited palette previews the legacy default, not the saved editor override');draft.stop();
const withRing=api.playNativeShipExplosion(token);
check(ringsCreated===1 && broadcast.at(-1).shockwave===true,'enabled shockwave accompanies native explosion and broadcasts');
withRing.stop();check(ringsDestroyed===1,'combined effect releases shockwave');
api.playNativeShipExplosion(token,{secondary:true});check(ringsCreated===1,'small secondary bursts do not create shockwaves');
api.playNativeShipExplosion(token,{secondary:true,shockwave:true});
check(ringsCreated===1 && broadcast.at(-1).shockwave===false,'explicit ring request still cannot add shockwaves to secondary bursts');
api.playShipExplosionFromSocket({...event,id:'secondary-ring-packet',secondary:true,shockwave:true});
check(ringsCreated===1,'receivers also suppress shockwaves on secondary explosion packets');
hooks.get('canvasTearDown')();
const beforeShader=shaderDestroyed;
const ringOnly=api.playNativeShipShockwave(token,{preview:true,broadcast:false});
check(ringsCreated===2,'independent shockwave preview starts');
tick(1801);await ringOnly.finished;
check(ringsDestroyed===2 && shaderDestroyed===beforeShader,'shockwave-only playback creates no fireball and expires');
savedAnchors.settings.explosion.shockwave=false;
api.playNativeShipExplosion(token);check(ringsCreated===2,'unchecked toggle creates no ring');
hooks.get('canvasTearDown')();
await api.saveShipExplosionColor(token,'purple');
check(savedAnchors.settings.explosion.color==='purple' && savedAnchors.settings.explosion.renderer==='native','test-panel color save preserves editor renderer settings');

// Exercise the actual CombatHUD method in isolation, including missing Sequencer.
const combat=await readFile(new URL('../scripts/combat/combat-hud-core.js',import.meta.url),'utf8');
const method=combat.slice(combat.indexOf('  static async fireDestructionEffect(token,'),combat.indexOf('  // ── Status',combat.indexOf('  static async fireDestructionEffect(token,')));
for(const deletion of [false,true]){
  let deleted=0,updates=[],played=0;
  const document={id:'ship',getFlag:()=>false,parent:{tokens:{has:()=>true}},update:async x=>updates.push(x),delete:async()=>{deleted++;}};
  const c=vm.createContext({console,game:{user:{isGM:true},settings:{get:(_,key)=>key==='deleteTokenOnDestruction'?deletion:''}},
    useNativeShipExplosion:()=>true,playNativeShipExplosion:()=>{played++;return {finished:Promise.resolve()};},
    SHIP_EXPLOSION_DURATION_MS:3200,setTimeout:f=>f(),window:{},token:{document}});
  await vm.runInContext(`class CombatHUD { static async _stopBreachTrailFX(){} static async _clearHullDecalsForDestruction(){} ${method} }; CombatHUD.fireDestructionEffect(token);`,c);
  check(played===1,'native runs without Sequencer');
  check(deleted===(deletion?1:0),'respects deletion setting');
  check(updates.length===(deletion?1:0),'kept tokens retain alpha');
}
for(const native of [false,true]){
  let finishHull,deleted=0,played=0;const updates=[];
  const meltdown={finished:new Promise(resolve=>{finishHull=resolve;})};
  class Sequence {
    effect(){return this;} file(){return this;} atLocation(){return this;} scaleToObject(){return this;}
    zIndex(){return this;} wait(){return this;} play(){played++;}
  }
  const document={id:'ship',width:1,getFlag:()=>false,parent:{tokens:{has:()=>true}},update:async x=>updates.push(x),delete:async()=>{deleted++;}};
  const c=vm.createContext({console,meltdown,game:{user:{isGM:true},settings:{get:(_,key)=>key==='deleteTokenOnDestruction'}},
    useNativeShipExplosion:()=>native,getShipExplosionSettings:()=>({shockwave:false}),
    playNativeShipExplosion:()=>{played++;return {finished:Promise.resolve()};},
    SHIP_EXPLOSION_DURATION_MS:3200,setTimeout:f=>f(),window:{Sequence},token:{id:'ship',document},canvas:{tokens:{get:()=>true}}});
  const pending=vm.runInContext(`class CombatHUD { static async _stopBreachTrailFX(){} static async _clearHullDecalsForDestruction(){} ${method} }; CombatHUD.fireDestructionEffect(token,{meltdown});`,c);
  for(let i=0;i<20;i++)await Promise.resolve();
  check(played===1 && deleted===0,'explosion plays while deletion waits for overlapping dissolve');
  check(updates.length===0,'active meltdown prevents premature token fade or hide');
  finishHull(true);await pending;
  check(deleted===1,'token deletion follows dissolve completion');
}
for(const shockwave of [false,true]) {
  let ringCalls=0, played=0;
  class Sequence {
    effect(){return this;} file(){return this;} atLocation(){return this;} scaleToObject(){return this;}
    zIndex(){return this;} wait(){return this;} play(){played++;}
  }
  const c=vm.createContext({console,game:{user:{isGM:true},settings:{get:()=>false}},
    useNativeShipExplosion:()=>false,getShipExplosionSettings:()=>({shockwave}),playNativeShipShockwave:()=>{ringCalls++;},
    setTimeout:f=>f(),window:{Sequence},token:{document:{width:1,getFlag:()=>false}},canvas:{tokens:{get:()=>null}}});
  await vm.runInContext(`class CombatHUD { static async _stopBreachTrailFX(){} static async _clearHullDecalsForDestruction(){} ${method} }; CombatHUD.fireDestructionEffect(token);`,c);
  check(played===1 && ringCalls===(shockwave?1:0),'JB2A playback respects independent shockwave toggle');
}
console.log(`PASS: ${checks} ship explosion lifecycle and integration checks`);
