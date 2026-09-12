import Base from '/foundry/canvas/rendering/shaders/base-shader.mjs';
import QuadMesh from '/foundry/canvas/containers/elements/quad-mesh.mjs';
import {samples} from './weapon-browser-stubs.js';
const out=document.querySelector('#results');
window.addEventListener('error',e=>{out.textContent+=`\nERROR: ${e.message}`;});
window.addEventListener('unhandledrejection',e=>{out.textContent+=`\nERROR: ${e.reason}`;});
const hooks=new Map();
globalThis.Hooks={on(name,fn){if(!hooks.has(name))hooks.set(name,[]);hooks.get(name).push(fn);}};
const emit=name=>{for(const f of hooks.get(name)??[])f();};
globalThis.foundry={canvas:{rendering:{shaders:{AbstractBaseShader:Base}},containers:{QuadMesh}},utils:{deepClone:v=>structuredClone(v),mergeObject:(a,b)=>({...structuredClone(a),...b})}};
let appearance={cannon:{boltCount:3,travelDuration:700,boltSpacing:140,boltLength:26}};
globalThis.game={settings:{get:(_m,key)=>key==='beamVfxAppearance'?appearance:key==='weaponAnimationModes'?{'weapon-energy-array':'shader'}:''}};
const app=new PIXI.Application({width:1100,height:660,backgroundColor:0x060b13,antialias:true,preserveDrawingBuffer:true});app.stop();document.querySelector('#gallery').appendChild(app.view);
const ticks=new Set(),tickLayers=new Map(),timers=new Map(),tweens=new Set();let now=100000,id=0;
Object.defineProperty(performance,'now',{value:()=>now});
globalThis.setTimeout=(fn,ms)=>{const key=++id;timers.set(key,{at:now+ms,fn,layer:globalThis.canvas?.tokens});return key;};globalThis.clearTimeout=key=>timers.delete(key);
// Deterministic animation adapter for the native runner's animejs seam.
globalThis.animejs={animate(target,opts){const from={};for(const k of Object.keys(opts))if(typeof target[k]==='number')from[k]=target[k];tweens.add({target,opts,from,start:now+(opts.delay??0)});}};
globalThis.canvas={ready:true,scene:{id:'fixture'},grid:{size:100},app:{renderer:app.renderer,ticker:{add:f=>{ticks.add(f);tickLayers.set(f,canvas.tokens);},remove:f=>{ticks.delete(f);tickLayers.delete(f);}}}};
const native=await import('../scripts/native-weapon-vfx.js');
const beams=await import('../scripts/beam-shader.js');
const energy=await import('../scripts/weapon-energy-shader.js');
const torps=await import('../scripts/torpedo-glow-vfx.js');
const effects=new Map();globalThis.Sequencer={EffectManager:{getEffects:({name})=>effects.has(name)?[effects.get(name)]:[]}};
const cells=[];
for(let i=0;i<4;i++){
  const cell=new PIXI.Container();cell.position.set(i%2*550,Math.floor(i/2)*330);app.stage.addChild(cell);
  const label=new PIXI.Text(['BEAMS / layered core and flowing sheath','CANNONS / compact rounds and ion streaks','ARRAY CHARGE / converging energy on the spine','TORPEDOES / photon, quantum, plasma'][i],{fontFamily:'Arial',fontSize:14,fill:0xadc6e2});label.position.set(15,16);cell.addChild(label);
  const background=new PIXI.Graphics();background.lineStyle(1,0x152334,.5);for(let x=0;x<550;x+=50)background.moveTo(x,45).lineTo(x,325);for(let y=45;y<330;y+=50)background.moveTo(0,y).lineTo(548,y);cell.addChild(background);
  if(i===2){background.lineStyle(2,0x35485d,.9);samples.forEach((p,j)=>j?background.lineTo(p.x,p.y):background.moveTo(p.x,p.y));}
  const art=new PIXI.Container(),layer=new PIXI.Container();cell.addChild(art,layer);cells.push({cell,art,layer});
}
const videos=[];
for(const [i,type]of ['Photon','Quantum','Plasma'].entries()){
  const video=document.createElement('video');video.src=`/assets/vfx/${type}-Torpedo.webm`;video.muted=true;video.loop=true;video.preload='auto';
  await new Promise((resolve,reject)=>{video.addEventListener('loadeddata',resolve,{once:true});video.addEventListener('error',()=>reject(Error(type+' video failed')),{once:true});video.load();});
  const sprite=new PIXI.Sprite(PIXI.Texture.from(video));sprite.anchor.set(.5);sprite.width=sprite.height=100;sprite.position.set(80,90+i*85);cells[3].art.addChild(sprite);
  videos.push({video,sprite,type,index:i});
}
let playing=false,elapsed=0,sceneStart=now;
function advance(ms){for(let dt=0;dt<ms;dt+=16){now+=Math.min(16,ms-dt);
  const age=now-sceneStart;
  for(const {sprite,index}of videos){sprite.position.set(65+430*Math.min(1,age/1500),90+index*85+Math.sin(age/1500*Math.PI)*15);}
  for(const t of [...tweens]){const p=Math.min(1,Math.max(0,(now-t.start)/(t.opts.duration??1)));if(now<t.start)continue;for(const [k,v]of Object.entries(t.from))t.target[k]=v+(t.opts[k]-v)*p;if(p===1)tweens.delete(t);}
  const layer=canvas.tokens;
  for(const f of [...ticks]){canvas.tokens=tickLayers.get(f);f();}
  for(const [k,t]of [...timers])if(t.at<=now){timers.delete(k);canvas.tokens=t.layer;t.fn();}
  canvas.tokens=layer;
}}
function clear(){emit('canvasTearDown');for(const c of cells)for(const ch of [...c.layer.children])ch.destroy({children:true});ticks.clear();tickLayers.clear();timers.clear();tweens.clear();effects.clear();}
function start(hold=true,at=430,fallback=false){
  clear();sceneStart=now;elapsed=0;playing=!hold;const quad=foundry.canvas.containers.QuadMesh;if(fallback)foundry.canvas.containers.QuadMesh=null;emit('canvasReady');
  canvas.tokens=cells[0].layer;
  for(const [j,family]of ['bank','array','lance'].entries())native.playShipBeamVfxFromSocket({draw:family==='bank'?'beam':'array',family,sourcePoint:{x:45,y:95+j*70},targetPoint:{x:505,y:95+j*70},color:[0xff942e,0xffb531,0x669eff][j],coreColor:0xfff0d7,hit:true,duration:1500,shaded:true});
  native.playNativeBeamBetweenPoints({x:80,y:285},{x:365,y:285},{shaded:true,color:'#ff6633',coreColor:'#fff1d5',shape:native.getBeamVfxSettings().groundPhaser,duration:1500});
  canvas.tokens=cells[1].layer;native.playShipBeamVfxFromSocket({draw:'tracer',family:'cannon',sourcePoint:{x:45,y:180},targetPoint:{x:505,y:180},color:0x58ff94,coreColor:0xddffe8,hit:true,shaded:true});
  canvas.tokens=cells[2].layer;native.playArrayCurveChargeVFX({id:'ship'},{name:'Phaser Array'},{x:270,y:0},{shaded:true,duration:900});
  canvas.tokens=cells[3].layer;
  for(const {sprite,index,type}of videos){sprite.position.set(65,90+index*85);effects.set(type,{spriteContainer:sprite});torps.startTorpedoGlow({launch:{x:65,y:90+index*85},fallbackTarget:{x:495,y:90+index*85},travelMs:1500,px:100,glowPx:66,glowColor:[0xff432f,0x63baff,0x67ff83][index]},type);}
  foundry.canvas.containers.QuadMesh=quad;advance(hold?at:16);app.renderer.render(app.stage);
  for(const {video}of videos){if(hold)video.pause();else video.play().catch(()=>{});}
  out.textContent=`${fallback?'Graphics fallback':hold?'Frozen preview':'Playing'} · PIXI ${PIXI.VERSION}`;
}
document.querySelector('#play').onclick=()=>start(false);
document.querySelector('#hold').onclick=()=>start(true);
document.querySelector('#flash').onclick=()=>start(true,920);
document.querySelector('#fallback').onclick=()=>start(true,430,true);
function frame(){if(playing){advance(16);elapsed+=16;if(elapsed>2300)start(false);app.renderer.render(app.stage);}requestAnimationFrame(frame);}
document.querySelector('#checks').onclick=()=>{
  playing=false;clear();let count=0;const assert=(v,m)=>{if(!v)throw Error(m);count++;};
  const stage=new PIXI.Container();const pixels=()=>{app.renderer.render(stage);return app.renderer.extract.pixels(stage);};const sum=a=>a.reduce((s,v,i)=>s+(i%4===3?v:0),0);
  try{
    emit('canvasReady');
    for(const mode of ['beam','bolts'])for(const blend of [0,1]){
      const parent=new PIXI.Container();stage.addChild(parent);
      const ribbon=beams.createBeamRibbon(parent,{mode,from:{x:20,y:30},to:{x:500,y:30},halfWidth:12,profile:{core:2,rail:[4,1]},color:0xff6622,coreColor:0xffe7b9,blendMode:blend,lifetimeMs:3000});
      assert(ribbon,mode+' failed');if(mode==='bolts')ribbon.setBolts([{head:.45,length:.2,brightness:1},{head:.8,length:.16,brightness:.85}]);
      const a=pixels();assert(sum(a)>1000,mode+' invisible');advance(100);const b=pixels();assert(a.some((v,i)=>Math.abs(v-b[i])>2),mode+' stationary');
      parent.alpha=.25;assert(sum(pixels())<sum(b)*.4,mode+' alpha ignored');parent.alpha=0;assert(sum(pixels())===0,mode+' zero opacity');
      parent.alpha=1;ribbon.setSegment({x:20,y:30},{x:20,y:30},1);pixels();assert(app.renderer.gl.getError()===0,mode+' zero-length GL error');
      ribbon.setSegment({x:20,y:30},{x:500,y:30},24);
      Object.assign(ribbon.mesh.shader.uniforms,{uNoiseCfg:[0,3,1.6],uFlicker:[0,22],uSurge:[0,1,.12,.55],uTime:3});
      const stopped=pixels();ribbon.mesh.shader.uniforms.uTime=4;const still=pixels();
      assert(stopped.every((v,i)=>v===still[i]),mode+' noise/flicker off or single surge did not settle');
      ribbon.stop();parent.destroy({children:true});assert(stage.children.length===0,mode+' cleanup');
    }
    for(const type of ['orb','trail'])for(const blend of [0,1]){
      const parent=new PIXI.Container();stage.addChild(parent);
      const field=type==='orb'?energy.createWeaponEnergyOrb(parent,{color:0xff9433,coreColor:0xfff0b8,blend,radius:40,coreRadius:6,haloRadius:28}):energy.createWeaponEnergyTrail(parent,{color:0xff9433,coreColor:0xfff0b8,blend,width:18,coreWidth:4});
      assert(field,type+' failed');const update=time=>type==='orb'?field.update(time):field.update(t=>({x:20+250*t,y:80-60*Math.sin(t*Math.PI)}),0,.8,time);update(.5);const a=pixels();assert(sum(a)>1000,type+' invisible');update(.8);const b=pixels();assert(a.some((v,i)=>Math.abs(v-b[i])>2),type+' stationary');
      parent.alpha=.25;assert(sum(pixels())<sum(b)*.4,type+' alpha ignored');parent.alpha=0;assert(sum(pixels())===0,type+' zero alpha');parent.alpha=1;parent.rotation=.7;parent.scale.set(.5);pixels();assert(app.renderer.gl.getError()===0,type+' transform GL error');parent.destroy({children:true});
    }
    start(true);for(let i=0;i<4;i++){let n=0;const visit=c=>{if(c.shader)n++;for(const x of c.children??[])visit(x);};visit(cells[i].layer);assert(n>0,'runner '+i+' missing shader');}
    const orbs=cells[2].layer.children[0].children.filter(c=>c.energyField);
    assert(orbs.length===2,'charge orb pair missing');
    assert(Math.abs(orbs[0].x+orbs[1].x-540)<.01&&Math.abs(orbs[0].y-orbs[1].y)<.01,'unset charge meeting point moved to array end');
    assert(cells[0].layer.children.length===4,'ground phaser renderer missing');
    app.renderer.render(app.stage);assert(app.renderer.gl.getError()===0,'runner GL error');
    // Keep the real cleanup paths live, rather than clearing the test clocks.
    advance(4000);assert(ticks.size===0,'runner ticker leaked');assert(timers.size===0,'runner timeout leaked');assert(cells.every(c=>c.layer.children.length===0),'runner container leaked');
    // Delay binding, remove a torpedo mid-flight, and use a zero-duration fade.
    canvas.tokens=cells[3].layer;appearance={torpedoGlow:{fadeMs:0}};
    effects.set('delayed',{});
    torps.startTorpedoGlow({launch:{x:10,y:10},fallbackTarget:{x:200,y:10},travelMs:600},'delayed');advance(50);assert(cells[3].layer.children.length===1,'zero fade or unready sprite killed live torpedo');
    const sprite=videos[0].sprite;sprite.position.set(75,120);effects.set('delayed',{spriteContainer:sprite});advance(16);effects.delete('delayed');sprite.visible=false;sprite.parent.removeChild(sprite);advance(16);assert(cells[3].layer.children.length===0,'removed torpedo did not stop');cells[3].art.addChild(sprite);sprite.visible=true;
    appearance={torpedoGlow:{fadeMs:140}};
    torps.startTorpedoGlow({launch:{x:10,y:10},fallbackTarget:{x:200,y:10},travelMs:600},'never-created');
    advance(450);const fallbackGlow=cells[3].layer.children[0].children.find(c=>c.shader);
    assert(fallbackGlow?.visible&&fallbackGlow.position.x>10,'unbound glow never entered fallback flight');advance(1000);
    assert(cells[3].layer.children.length===0,'fallback flight leaked');
    appearance={cannon:{boltCount:3,travelDuration:700,boltSpacing:140,boltLength:26}};
    start(true,430,true);assert(cells.every(c=>c.layer.children.length>0),'fallback runner missing');advance(4000);assert(ticks.size===0,'fallback ticker leaked');
    start(true);out.textContent=`PASS: ${count} checks. WebGL rendering, alpha, motion, tracking, fallback, and cleanup verified.`;
  }catch(e){out.textContent=`FAIL after ${count}: ${e.stack}`;}finally{stage.destroy({children:true});}
};
start();frame();
