// node --experimental-vm-modules tests/ship-meltdown-vfx.mjs
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
let now=10000,id=0,created=0,destroyed=0,progress=0;
const ticks=new Set(),timers=new Map(),hooks=new Map(),sent=[];
const foreign={foreign:true}, mesh={filters:[foreign]}, doc={parent:{id:'scene'},hidden:false};
const token={id:'ship',mesh,document:doc,visible:true};
const canvas={ready:true,scene:{id:'scene'},tokens:{get:()=>token,controlled:[token]},app:{ticker:{add:f=>ticks.add(f),remove:f=>ticks.delete(f)}}};
const game={user:{isGM:true},time:{get serverTime(){return now;}},socket:{emit:(_,e)=>sent.push(e)}};
const context=vm.createContext({console,canvas,game,performance:{now:()=>now},crypto:{randomUUID:()=>String(++id)},
  Hooks:{on:(k,f)=>hooks.set(k,f)},ui:{notifications:{warn(){}}},
  setTimeout:(f,ms)=>{const key=++id;timers.set(key,{f,at:now+ms});return key;},clearTimeout:key=>timers.delete(key)});
const mod=new vm.SourceTextModule(await readFile(new URL('../scripts/ship-meltdown-vfx.js',import.meta.url),'utf8'),{context});
await mod.link(name=>name.includes('shader')?new vm.SyntheticModule(['createShipMeltdownFilter'],function(){
  this.setExport('createShipMeltdownFilter',()=>{created++;return {filter:{meltdown:true},update:p=>{progress=p;},destroy:()=>{destroyed++;}};});
},{context}):new vm.SyntheticModule(['getShipExplosionColor'],function(){this.setExport('getShipExplosionColor',()=> 'green');},{context}));
await mod.evaluate();const fx=mod.namespace;
let checks=0;const check=(v,msg)=>{assert.ok(v,msg);checks++;};
const advance=ms=>{now+=ms;for(const [k,t]of [...timers])if(t.at<=now){timers.delete(k);t.f();}for(const tick of [...ticks])tick();};
const first=fx.playShipMeltdown(token);
let blastReady=false,fullyDissolved=false;
first.detonationReady.then(v=>{blastReady=v;});first.finished.then(v=>{fullyDissolved=v;});
check(sent.length===1 && sent[0].color==='green','broadcast snapshots the chosen palette');
check(mesh.filters.length===2 && mesh.filters[0]===foreign,'preserves unrelated filters');
advance(2500);check(progress===.5,'meltdown advances with elapsed time');
mesh.filters=[foreign];advance(10);check(mesh.filters.length===2,'token refresh cannot silently remove meltdown');
advance(489);await Promise.resolve();check(!blastReady,'no blast cue before three seconds');
advance(1);await Promise.resolve();
check(blastReady && !fullyDissolved && progress===.6,'blast starts at three seconds while hull keeps dissolving');
advance(2000);check(await first.finished===true,'five-second phase completes');
check(mesh.filters.length===2 && progress>=1,'fully dissolved hull stays hidden through explosion');
first.stop();check(mesh.filters.length===1 && mesh.filters[0]===foreign,'cleanup removes only meltdown filter');
check(ticks.size===0 && timers.size===0,'completion clears ticker and timers');
check(sent.at(-1).action===fx.SHIP_MELTDOWN_STOP_ACTION,'cleanup broadcasts matching stop');
const preview=fx.playShipMeltdown(token,{preview:true});const sentCount=sent.length;
advance(5000);await preview.finished;
check(mesh.filters.length===1 && sent.length===sentCount,'standalone preview restores token without broadcasting');
check(!('alpha' in doc),'visual effect never writes token alpha');
const cancelled=fx.playShipMeltdown(token,{preview:true});cancelled.stop();
check(await cancelled.finished===false,'cancelled preview settles its completion promise');
check(await cancelled.detonationReady===false,'cancelled preview settles pending blast cue');
const late={action:fx.SHIP_MELTDOWN_ACTION,id:'late',sceneId:'scene',tokenId:'ship',startedAt:now-2000,color:'red',seed:1};
const remote=fx.playShipMeltdownFromSocket(late);check(Math.abs(progress-.4)<.001,'remote clients catch up to server timestamp');
check(fx.playShipMeltdownFromSocket(late)===null,'duplicate packets do not restart meltdown');
fx.stopShipMeltdownFromSocket({...late,id:'old'});check(ticks.size===1,'stale stop cannot cancel newer playback');
fx.stopShipMeltdownFromSocket(late);check(await remote.finished===false && ticks.size===0,'matching remote stop cleans up');
game.user.isGM=false;doc.hidden=true;
check(fx.playShipMeltdownFromSocket({...late,id:'hidden'})===null,'hidden token protected on player clients');doc.hidden=false;game.user.isGM=true;
const sceneChange=fx.playShipMeltdown(token);canvas.scene.id='other';advance(16);
check(await sceneChange.finished===false && mesh.filters.length===1,'scene switch restores filter and settles wait');canvas.scene.id='scene';
const teardown=fx.playShipMeltdown(token);hooks.get('canvasTearDown')();
check(await teardown.finished===false && ticks.size===0 && timers.size===0,'canvas teardown cleans every resource');
check(created===destroyed,'every allocated filter is destroyed');

// The real finalizer starts the blast at its cue, before dissolve completion.
const combat=await readFile(new URL('../scripts/combat/combat-hud-core.js',import.meta.url),'utf8');
const begin=combat.indexOf('  static async _finalizeShipDestruction(data,');
const end=combat.indexOf('\n  /**',begin);
const method=combat.slice(begin,end);
for(const [vaporize,enabled]of [[true,true],[true,false],[false,true]]){
  let release,releaseFinished,stopped=0;const order=[];
  const c=vm.createContext({console,canvas:{tokens:{get:()=>({id:'ship',document:{unsetFlag:async()=>{}},actor:{id:'actor'}})}},
    game:{actors:{get:()=>null}},getShipExplosionSettings:()=>({meltdown:enabled}),
    playShipMeltdown:()=>{order.push('heat');return {detonationReady:new Promise(r=>{release=r;}),finished:new Promise(r=>{releaseFinished=r;}),stop(){stopped++;}};}});
  const pending=vm.runInContext(`class CombatHUD {
    static _stopDeathThroes(){} static async _stopBreachTrailFX(){} static async setShipStatus(){}
    static _clearBreachTokenFX(){} static async setWarpBreachState(){} static async _clearHullDecalsForDestruction(){}
    static async fireDestructionEffect(token,{meltdown}){recordExplosion();if(meltdown)await meltdown.finished;}
    ${method}
  }; CombatHUD._finalizeShipDestruction({tokenId:'ship',actorId:'actor',vaporize:${vaporize}},{postChat:false});`,
    Object.assign(c,{recordExplosion:()=>order.push('explosion')}));
  // Allow the existing async status/cleanup methods to run.
  for(let i=0;i<12;i++)await Promise.resolve();
  if(vaporize && enabled){
    check(order.join(',')==='heat','breach finalizer waits for blast cue');release(true);
    for(let i=0;i<12;i++)await Promise.resolve();
    check(order.join(',')==='heat,explosion' && stopped===0,'blast overlaps active meltdown without clearing its filter');
    releaseFinished(true);
  }
  await pending;
  check(order.join(',')===(vaporize&&enabled?'heat,explosion':'explosion'),'meltdown only precedes qualifying destruction');
  check(stopped===(vaporize&&enabled?1:0),'finalizer always releases meltdown after blast');
}
console.log(`PASS: ${checks} hull meltdown lifecycle and sequencing checks`);
