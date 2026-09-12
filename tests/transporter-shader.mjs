// node --experimental-vm-modules tests/transporter-shader.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import Handlebars from 'handlebars';

async function environment() {
  let now=100000, serial=0;
  const timers=new Map(), ticks=new Set(), packets=[], warnings=[], writes=[];
  class Filter {
    constructor(_vertex,_fragment,uniforms) { this.uniforms=uniforms; this.program={glPrograms:{}}; }
    destroy() { this.destroyed=true; }
  }
  class Base {
    static create() { return {uniforms:structuredClone(this.defaultUniforms),program:{glPrograms:{}}}; }
  }
  class Quad {
    constructor(Shader) { this.shader=Shader.create(); this.position={set(){}};this.scale={set(){}}; }
    destroy() { this.destroyed=true;this.parent?.removeChild(this); }
  }
  const scene={id:'scene',tokens:new Map()};
  const layer={children:[],worldTransform:{applyInverse:p=>p},get:id=>scene.tokens.get(id)?.object,
    addChild(c){this.children.push(c);c.parent=this;},removeChild(c){this.children=this.children.filter(x=>x!==c);c.parent=null;}};
  const gl={isContextLost:()=>false,getProgramParameter:()=>true,LINK_STATUS:1};
  const view=new EventTarget();
  const renderer={gl,view,CONTEXT_UID:0,resolution:1,shader:{generateProgram(s){s.program.glPrograms[0]={program:{}};}}};
  const game={user:{id:'gm',isGM:true},users:new Map([['gm',{isGM:true}],['player',{isGM:false}]]),
    time:{get serverTime(){return now;}},settings:{get:()=>({tngFed:{duration:2000}})},socket:{emit:(_channel,msg)=>packets.push(msg)}};
  const canvas={scene,ready:true,tokens:layer,app:{renderer,ticker:{add:t=>ticks.add(t),remove:t=>ticks.delete(t)}}};
  const context=vm.createContext({console:{warn:(...s)=>warnings.push(s),error:(...s)=>warnings.push(s),log(){}},
    Math,Date,Number,String,Array,Object,Set,Map,Promise,globalThis:undefined,
    setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{at:now+Math.max(0,ms),fn});return id;},
    clearTimeout:id=>timers.delete(id),game,canvas,
    PIXI:{Filter,BLEND_MODES:{ADD:1}},foundry:{canvas:{rendering:{shaders:{AbstractBaseShader:Base}},containers:{QuadMesh:Quad}},utils:{randomID:()=>`op${++serial}`}},
    ui:{notifications:{warn:s=>warnings.push(s),error:s=>warnings.push(s)}}});
  vm.runInContext('globalThis = this',context);
  const modules=new Map();
  async function load(name) {
    const url=new URL(name,import.meta.url);
    if(modules.has(url.href)) return modules.get(url.href);
    const mod=new vm.SourceTextModule(await readFile(url,'utf8'),{context,identifier:url.href});modules.set(url.href,mod);
    await mod.link(spec=>load(new URL(spec,url).href)); return mod;
  }
  const playback=await load('../scripts/transporter-shader-playback.js');await playback.evaluate();
  const config=modules.get(new URL('../scripts/transporter-shader-config.js',import.meta.url).href).namespace;
  const shader=modules.get(new URL('../scripts/transporter-shader.js',import.meta.url).href).namespace;
  const native=modules.get(new URL('../scripts/transporter-vfx.js',import.meta.url).href).namespace;
  let fallbacks=0, fallbackStops=0;
  native.TransporterVFX.visualFallback=()=>{fallbacks++;return {setVisible(){},update(){},stop(){fallbackStops++;}};};
  function token(id='token',alpha=1) {
    const mesh={alpha,visible:true,filters:[],getBounds:()=>({x:100,y:100,width:100,height:150})};
    const doc={id,parent:scene,alpha,hidden:false,name:id,
      async update(data){writes.push(['update',id,data]);Object.assign(this,data);},
      async delete(){writes.push(['delete',id]);scene.tokens.delete(id);mesh.destroyed=true;}};
    const tok={id,document:doc,mesh,alpha:1,w:100,h:150,visible:true,center:{x:150,y:175}};doc.object=tok;scene.tokens.set(id,doc);return tok;
  }
  async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
  async function advance(ms,withTicks=true) {
    const end=now+ms;
    for(let guard=0;guard<1000;guard++) {
      await flush();const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();if(withTicks)for(const tick of [...ticks])tick();
    }
    now=end;await flush();if(withTicks)for(const tick of [...ticks])tick();await flush();
  }
  return {config,shader,playback:playback.namespace,token,game,canvas,scene,layer,renderer,view,ticks,timers,packets,warnings,writes,advance,
    get now(){return now;},get fallbacks(){return fallbacks;},get fallbackStops(){return fallbackStops;}};
}
let count=0;
async function test(name,fn){await fn();count++;console.log(`PASS ${name}`);}
await test('inner cluster size preserves the current sphere and bounds saved values',async()=>{
  const {config:c}=await environment();
  assert.equal(c.normalizeTransporterShader('tngFed').innerClusterSize,100);
  assert.equal(c.normalizeTransporterShader('tosFed',{innerClusterSize:'175'}).innerClusterSize,175);
  assert.equal(c.normalizeTransporterShader('tngFed',{innerClusterSize:0}).innerClusterSize,25);
  assert.equal(c.normalizeTransporterShader('tngFed',{innerClusterSize:999}).innerClusterSize,200);
  assert.equal(c.normalizeTransporterShader('tngFed',{innerClusterSize:'bad'}).innerClusterSize,100);
});
await test('inner speed migrates shared speeds and stays independent, including zero',async()=>{
  const {config:c}=await environment();
  assert.equal(c.normalizeTransporterShader('tosFed').innerParticleSpeed,2.2);
  assert.equal(c.normalizeTransporterShader('tngFed',{shimmerSpeed:.8}).innerParticleSpeed,.8);
  assert.equal(c.normalizeTransporterShader('tngFed',{particleSpeed:.4}).innerParticleSpeed,.4);
  assert.equal(c.normalizeTransporterShader('tngFed',{particleSpeed:0}).innerParticleSpeed,0);
  const paused=c.normalizeTransporterShader('tngFed',{particleSpeed:3,innerParticleSpeed:0});
  assert.equal(paused.particleSpeed,3);assert.equal(paused.innerParticleSpeed,0);
  const inner=c.normalizeTransporterShader('tngFed',{particleSpeed:0,innerParticleSpeed:2});
  assert.equal(inner.particleSpeed,0);assert.equal(inner.innerParticleSpeed,2);
  assert.equal(c.normalizeTransporterShader('tngFed',{innerParticleSpeed:99}).innerParticleSpeed,4);
  assert.equal(c.normalizeTransporterShader('tngFed',{innerParticleSpeed:-1}).innerParticleSpeed,0);
});
await test('particle directions default safely and normalize independently',async()=>{
  const {config:c}=await environment();
  const defaults=c.normalizeTransporterShader('tngFed');
  assert.equal(defaults.outerDirection,'clockwise');assert.equal(defaults.innerDirection,'clockwise');
  const mixed=c.normalizeTransporterShader('tngFed',{outerDirection:'counterclockwise',innerDirection:'clockwise'});
  assert.equal(mixed.outerDirection,'counterclockwise');assert.equal(mixed.innerDirection,'clockwise');
  const invalid=c.normalizeTransporterShader('tngFed',{outerDirection:'__proto__',innerDirection:0});
  assert.equal(invalid.outerDirection,'clockwise');assert.equal(invalid.innerDirection,'clockwise');
});
await test('inner intensity preserves old saves, clamps and remains independent of outer intensity',async()=>{
  const {config:c}=await environment();
  assert.equal(c.normalizeTransporterShader('tngFed',{noiseStrength:.3}).coreIntensity,.3);
  assert.equal(c.normalizeTransporterShader('tosFed').coreIntensity,.85);
  const inner=c.normalizeTransporterShader('tngFed',{noiseStrength:0,coreIntensity:.8});
  assert.equal(inner.noiseStrength,0); assert.equal(inner.coreIntensity,.8);
  assert.equal(c.normalizeTransporterShader('tngFed',{noiseStrength:1,coreIntensity:0}).coreIntensity,0);
  assert.equal(c.normalizeTransporterShader('tngFed',{coreIntensity:9}).coreIntensity,1);
  assert.equal(c.normalizeTransporterShader('tngFed',{coreIntensity:-1}).coreIntensity,0);
});
await test('eleven presets; normalization clamps invalid input and rejects unknown fields',async()=>{
  const {config:c}=await environment();assert.equal(Object.keys(c.TRANSPORTER_SHADER_PRESETS).length,11);
  const p=c.normalizeTransporterShader('tngFed',{duration:-10,noiseScale:Infinity,glow:'',color:'<script>',framing:'bad',shape:500});
  assert.equal(p.duration,2000);assert.equal(p.noiseScale,24);assert.equal(p.glow,.45);assert.equal(p.color,'#72aaff');assert.equal(p.shape,0);
  assert.equal(c.normalizeTransporterType('__proto__'),'tngFed');assert.equal(c.normalizeTransporterShader('borg',{framing:'portrait',glow:'1.2'}).glow,1.2);
});
await test('Enterprise uses TOS choreography with its own pale blue-white palette and tuning',async()=>{
  const {config:c}=await environment();
  const ent=c.normalizeTransporterShader('entFed'),tos=c.normalizeTransporterShader('tosFed');
  assert.equal(ent.color,'#c4e5ff');assert.equal(ent.highlight,'#f5fbff');
  for(const key of Object.keys(tos)) if(!['label','color','highlight'].includes(key)) assert.equal(ent[key],tos[key],key);
  assert.equal(c.normalizeTransporterShader('entFed',{color:'#123456'}).color,'#123456');
  assert.equal(c.normalizeTransporterShader('tosFed').color,'#ffd34d');
});
await test('Dominion has dense rainfall and an independently saved three-color haze palette',async()=>{
  const {config:c}=await environment();const dom=c.normalizeTransporterShader('dominion');
  assert.equal(dom.accent,'dominion');assert.equal(dom.rainDensity,1);assert(dom.rainGain>1);
  assert.equal(dom.color,'#c4e5ff');assert.equal(dom.secondary,'#d9c7ff');assert.equal(dom.highlight,'#ffffff');
  assert.equal(c.normalizeTransporterShader('dominion',{secondary:'#ABCDEF'}).secondary,'#abcdef');
  assert.equal(c.normalizeTransporterShader('dominion',{secondary:'invalid'}).secondary,'#d9c7ff');
});
await test('particle speed clamps independently and preserves motion in old saves',async()=>{
  const {config:c}=await environment();
  assert.equal(c.normalizeTransporterShader('tosFed').particleSpeed,2.2);
  assert.equal(c.normalizeTransporterShader('tngFed',{shimmerSpeed:.8}).particleSpeed,.8);
  assert.equal(c.normalizeTransporterShader('tngFed',{particleSpeed:.5,shimmerSpeed:3}).particleSpeed,.5);
  assert.equal(c.normalizeTransporterShader('tngFed',{particleSpeed:-1}).particleSpeed,0);
  assert.equal(c.normalizeTransporterShader('tngFed',{particleSpeed:99}).particleSpeed,4);
});
await test('static sparkles default on for every preset and normalize independently',async()=>{
  const {config:c}=await environment();
  for(const type of Object.keys(c.TRANSPORTER_SHADER_PRESETS)) {
    const p=c.normalizeTransporterShader(type);assert.equal(p.staticAmount,.55);assert.equal(p.staticRate,1.5);
    const off=c.normalizeTransporterShader(type,{staticAmount:-1,staticRate:999,particleSpeed:0});
    assert.equal(off.staticAmount,0);assert.equal(off.staticRate,4);assert.equal(off.particleSpeed,0);
  }
  assert.equal(c.normalizeTransporterShader('borg',{staticAmount:99,staticRate:-1}).staticAmount,1);
  assert.equal(c.normalizeTransporterShader('borg',{staticRate:-1}).staticRate,.1);
});
await test('TMP swipe limits, Romulan field and Borg filament defaults',async()=>{
  const {config:c}=await environment();
  const normal=c.normalizeTransporterShader('tmpFed',{});
  assert.equal(normal.swipeHeight,100);assert.equal(normal.swipeWidth,100);
  const low=c.normalizeTransporterShader('tmpFed',{swipeHeight:-1,swipeWidth:-1});
  const high=c.normalizeTransporterShader('tmpFed',{swipeHeight:999,swipeWidth:999});
  assert.equal(low.swipeHeight,25);assert.equal(low.swipeWidth,25);
  assert.equal(high.swipeHeight,200);assert.equal(high.swipeWidth,300);
  const rom=c.normalizeTransporterShader('romulan'),borg=c.normalizeTransporterShader('borg');
  assert.equal(rom.strandWidth,0);assert.equal(rom.accent,'romulan');assert(borg.strandWidth>0);
  const oldRom=c.normalizeTransporterShader('romulan',{strandWidth:.55,accent:'none',color:'#123456'});
  assert.equal(oldRom.accent,'romulan');assert.equal(oldRom.strandWidth,0);assert.equal(oldRom.color,'#123456');
  assert.equal(rom.rainGain,0);assert.equal(borg.rainGain,0);
});
await test('Romulan scans descend, spread faintly, return brightly and clear at commit',async()=>{
  const {config:c}=await environment();
  const scan=p=>c.transporterAccents(p,'romulan').scan;
  assert.equal(scan(0)[1],0);assert.equal(scan(0)[3],0);
  assert(scan(.1)[0]<scan(.22)[0]&&scan(.1)[1]>.9);
  assert.equal(scan(.33)[1],0);
  assert(scan(.4)[2]<scan(.49)[2]);assert(scan(.4)[3]<.2);
  assert(scan(.55)[2]>scan(.7)[2]);assert(scan(.7)[3]>scan(.4)[3]*8);
  assert.equal(scan(.74)[2],0);
  for(const p of [.8,.9,1]) {assert.equal(scan(p)[1],0);assert.equal(scan(p)[3],0);}
  for(const type of ['none','voyager','tos','tmp']) assert(c.transporterAccents(.5,type).scan.every(v=>v===0));
});
await test('timeline endpoints, reversed matter, shared rain envelope and 80% commit for all durations',async()=>{
  const {config:c}=await environment();
  for(const p of Object.values(c.TRANSPORTER_SHADER_PRESETS)){
    assert.equal(c.transporterTimeline(0,p.duration,'in').matter,0);
    assert.equal(c.transporterTimeline(p.duration*.15,p.duration,'out').matter,1);
    assert.equal(c.transporterTimeline(p.duration*.799,p.duration).commit,false);
    assert.equal(c.transporterTimeline(p.duration*.8,p.duration).commit,true);
    assert.equal(c.transporterTimeline(p.duration,p.duration,'in').matter,1);
    assert.equal(c.transporterTimeline(p.duration,p.duration).energy,0);
    for(let i=0;i<=100;i++){
      const a=c.transporterTimeline(p.duration*i/100,p.duration,'in'),b=c.transporterTimeline(p.duration*i/100,p.duration,'out');
      assert.equal(a.energy,b.energy);assert.ok(Math.abs(a.matter+b.matter-1)<1e-9);
    }
  }
});
await test('previews restore partial alpha, preserve unrelated filters, release timers and tickers',async()=>{
  const e=await environment(),t=e.token('a',.4),foreign={};t.mesh.filters=[foreign];
  const h=e.shader.playTransporterShader(t,'tngFed',{preview:true,phase:'in'});
  assert.equal(t.mesh.filters.length,2);await e.advance(1000);h.stop();h.stop();await h.finished;
  assert.equal(t.mesh.alpha,.4);assert.equal(t.mesh.filters.length,1);assert.equal(t.mesh.filters[0],foreign);
  assert.equal(e.writes.length,0);assert.equal(e.layer.children.length,0);assert.equal(e.ticks.size,0);assert.equal(e.timers.size,0);
});
await test('Voyager repeats two center-outward pairs; TMP grows lines before separating; surface glow clears before removal',async()=>{
  const {config:c}=await environment();
  const first=c.transporterAccents(.27,'voyager').orbs,second=c.transporterAccents(.58,'voyager').orbs;
  assert.ok(first[0]>0&&first[0]<1&&first[1]>.9);assert.equal(first[3],0);
  assert.equal(second[1],0);assert.ok(second[2]>0&&second[2]<1&&second[3]>.9);
  assert.equal(c.transporterAccents(.8,'voyager').orbs[3],0);
  const growing=c.transporterAccents(.27,'tmp'),splitting=c.transporterAccents(.56,'tmp');
  assert.ok(growing.lines[0]>0&&growing.lines[0]<1);assert.equal(growing.lines[1],0);
  assert.equal(splitting.lines[0],1);assert.ok(splitting.lines[1]>0&&splitting.lines[1]<1);
  assert.equal(growing.circle,1);assert.equal(c.transporterAccents(.5,'tos').circle,1);
  assert.equal(c.transporterAccents(.5).circle,0);
  assert.equal(c.TRANSPORTER_SHADER_PRESETS.tosFed.rainGain,0);assert.equal(c.TRANSPORTER_SHADER_PRESETS.tmpFed.rainGain,0);
  for(const phase of ['in','out']) assert.equal(c.transporterTimeline(1600,2000,phase).surfaceEnergy,0);
});
await test('preview replacement and no preview interference with real transport',async()=>{
  const e=await environment(),t=e.token();
  const a=e.shader.playTransporterShader(t,'tngFed',{preview:true});
  const b=e.shader.playTransporterShader(t,'tngFed',{preview:true});assert.equal((await a.finished).reason,'replaced');
  const real=e.shader.playTransporterShader(t);assert.equal((await b.finished).reason,'replaced');
  assert.equal(e.shader.playTransporterShader(t,'tngFed',{preview:true}),null);real.stop();assert.equal(e.ticks.size,0);
});
await test('native visual fallback follows timeline and never updates documents',async()=>{
  const e=await environment(),t=e.token();e.renderer.gl=null;
  const h=e.shader.playTransporterShader(t,'tngFed',{preview:true,phase:'out'});await e.advance(1000);
  assert.equal(e.fallbacks,1);assert.ok(t.mesh.alpha>0&&t.mesh.alpha<1);h.stop();assert.equal(e.fallbackStops,1);assert.equal(t.mesh.alpha,1);assert.equal(e.writes.length,0);
});
await test('timer backstop and WebGL context loss both restore appearance',async()=>{
  const e=await environment(),t=e.token();const h=e.shader.playTransporterShader(t,'tngFed',{preview:true});
  await e.advance(2200,false);assert.equal((await h.finished).reason,'complete');assert.equal(e.ticks.size,0);
  const j=e.shader.playTransporterShader(t,'tngFed',{preview:true});e.view.dispatchEvent(new Event('webglcontextlost'));
  assert.equal((await j.finished).reason,'context-lost');assert.equal(t.mesh.alpha,1);
});
await test('scene teardown and early token destruction clean active effects',async()=>{
  const e=await environment(),t=e.token();const h=e.shader.playTransporterShader(t,'tngFed',{preview:true});
  e.playback.teardownTransporterShaderPlayback();assert.equal((await h.finished).reason,'scene-change');assert.equal(e.ticks.size,0);
  const j=e.shader.playTransporterShader(t);t.mesh.destroyed=true;await e.advance(50);assert.equal((await j.finished).reason,'token-destroyed');assert.equal(e.layer.children.length,0);
});
function message(e,overrides={}){return {action:'transporterShaderVfx',operationId:'op',userId:'gm',sceneId:'scene',tokenId:'token',type:'tngFed',phase:'in',startTime:e.now,seed:52,targetAlpha:1,settings:{duration:2000},...overrides};}
await test('socket deduplication, scene guard, expiration, and player-origin rejection',async()=>{
  const e=await environment();e.token('token',0);const m=message(e);
  const h=await e.playback.receiveTransporterShader(m);assert.ok(h);
  assert.equal(await e.playback.receiveTransporterShader(m),null);
  assert.equal(await e.playback.receiveTransporterShader({...m,operationId:'other',sceneId:'other'}),null);
  assert.equal(await e.playback.receiveTransporterShader({...m,operationId:'old',startTime:e.now-3000}),null);
  assert.equal(await e.playback.receiveTransporterShader({...m,operationId:'forbidden',userId:'player'}),null);
  assert.equal(e.ticks.size,1);h.stop();assert.equal(e.writes.length,0);
});
await test('delayed token creation joins elapsed animation; cancel beats late packets',async()=>{
  const e=await environment();const m=message(e);const p=e.playback.receiveTransporterShader(m);
  await e.advance(400);const t=e.token('token',0);await e.advance(100);const h=await p;
  assert.ok(h);assert.ok(t.mesh.filters[0].uniforms.uMatter>0);h.stop();
  const cancel=message(e,{operationId:'cancel',cancel:true});await e.playback.receiveTransporterShader(cancel);
  assert.equal(await e.playback.receiveTransporterShader({...cancel,cancel:false}),null);
});
await test('pending playback cancels on scene teardown and missing token times out',async()=>{
  const e=await environment();const p=e.playback.receiveTransporterShader(message(e));e.playback.teardownTransporterShaderPlayback();await e.advance(50);assert.equal(await p,null);
  const q=e.playback.receiveTransporterShader(message(e,{operationId:'missing'}));await e.advance(1600);assert.equal(await q,null);assert.equal(e.timers.size,0);
});
await test('hidden and vision-invisible tokens never create remote overlays',async()=>{
  const e=await environment(),t=e.token();e.game.user={id:'player',isGM:false};t.document.hidden=true;
  assert.equal(await e.playback.receiveTransporterShader(message(e)),null);t.document.hidden=false;t.visible=false;
  assert.equal(await e.playback.receiveTransporterShader(message(e,{operationId:'fog'})),null);assert.equal(e.layer.children.length,0);
});
await test('GM arrival commits at 80%, broadcasts once and restores final alpha',async()=>{
  const e=await environment(),t=e.token('token',0);const p=e.playback.runTransporterShader(t,'tngFed','in');
  await e.advance(1699);assert.equal(e.writes.length,0);await e.advance(1);assert.equal(t.document.alpha,1);assert.equal(e.writes.length,1);
  await e.advance(500);await p;assert.equal(e.packets.length,1);assert.equal(e.ticks.size,0);assert.equal(t.mesh.alpha,1);
});
await test('six departures run concurrently, delete once each and finish residual rain',async()=>{
  const e=await environment();const ts=Array.from({length:6},(_,i)=>e.token(`t${i}`));
  const tasks=ts.map(t=>e.playback.runTransporterShader(t,'tngFed','out'));await e.advance(1700);
  assert.equal(e.writes.length,6);assert.equal(e.scene.tokens.size,0);assert.equal(e.layer.children.length,6);
  await e.advance(500);await Promise.all(tasks);assert.equal(e.layer.children.length,0);assert.equal(e.ticks.size,0);
});
await test('GM document timers survive scene switch even when renderer is unavailable',async()=>{
  const e=await environment(),t=e.token('token',0);e.renderer.gl=null;const p=e.playback.runTransporterShader(t,'tngFed','in');
  e.playback.teardownTransporterShaderPlayback();e.canvas.scene={id:'other'};await e.advance(2200);await p;assert.equal(t.document.alpha,1);
});
await test('failed deletion cancels remote visuals and restores token appearance',async()=>{
  const e=await environment(),t=e.token();t.document.delete=async()=>{throw new Error('denied');};
  const p=e.playback.runTransporterShader(t,'tngFed','out').catch(err=>err);await e.advance(2200);assert.ok(await p instanceof Error);
  assert.equal(e.scene.tokens.size,1);assert.equal(t.mesh.alpha,1);assert.equal(e.packets.at(-1).cancel,true);assert.equal(e.ticks.size,0);
});
await test('transient arrival update failure retries; permanent failure reports and cleans up',async()=>{
  const e=await environment(),t=e.token('token',0);let tries=0;
  t.document.update=async data=>{if(++tries===1)throw new Error('retry');Object.assign(t.document,data);};
  const p=e.playback.runTransporterShader(t,'tngFed','in');await e.advance(2400);await p;assert.equal(tries,2);assert.equal(t.document.alpha,1);
  const u=e.token('failed',0);u.document.update=async()=>{throw new Error('denied');};const q=e.playback.runTransporterShader(u,'tngFed','in').catch(err=>err);
  await e.advance(2400);assert.ok(await q instanceof Error);assert.equal(e.ticks.size,0);assert.ok(e.warnings.some(w=>typeof w==='string'&&w.includes('restore its opacity')));
});
await test('only initiating GM can mutate documents, duplicate calls share one operation',async()=>{
  const e=await environment(),t=e.token();const a=e.playback.runTransporterShader(t,'tngFed','out'),b=e.playback.runTransporterShader(t,'tngFed','out');
  await e.advance(2200);await Promise.all([a,b]);assert.equal(e.writes.length,1);assert.equal(e.packets.length,1);
  e.game.user.isGM=false;await assert.rejects(e.playback.runTransporterShader(t,'tngFed','out'),/Only the GM/);
});
await test('Transporter controls and existing sound rows render together',async()=>{
  const e=await environment();const template=Handlebars.compile(await readFile(new URL('../templates/effect-config.hbs',import.meta.url),'utf8'));Handlebars.registerHelper('ne',(a,b)=>a!==b);
  const html=template({tabs:[{id:'transporter',label:'Transporter',rows:[{label:'TNG',sndKey:'sndTransporterTngFed',soundValue:'test.ogg',animValue:null,delayValue:null}],transporterShader:{engines:[{value:'sequencer',label:'Sequencer',selected:true}],presets:Object.entries(e.config.TRANSPORTER_SHADER_PRESETS).map(([type,values])=>({type,label:values.label,values,controls:e.config.TRANSPORTER_SHADER_CONTROLS.map(c=>({...c,value:values[c.key]}))}))}}]});
  assert.equal((html.match(/data-transporter-preset=/g)||[]).length,11);assert.ok(html.includes('Dominion'));assert.ok(html.includes('Enterprise Era'));assert.ok(html.includes('test.ogg'));assert.ok(html.includes('data-transporter-engine'));assert.ok(html.includes('data-transporter-preview="in"'));assert.ok(html.includes('data-transporter-reset'));
});
console.log(`${count} transporter test groups passed.`);
