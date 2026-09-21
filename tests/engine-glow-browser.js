import { createEngineGlow } from '../scripts/engine-glow-shader.js';
import { settings } from './engine-glow-browser-anchors.js';
const output = document.querySelector('#results');
window.addEventListener('error', e => { output.textContent += `\nERROR: ${e.message}`; });
window.addEventListener('unhandledrejection', e => { output.textContent += `\nERROR: ${e.reason}`; });
globalThis.CONFIG = {};
globalThis.game = { settings: { get: () => '' } };
const app = new PIXI.Application({ width: 1000, height: 570, backgroundColor: 0x050913, antialias: true, preserveDrawingBuffer: true });
app.stop(); document.querySelector('#gallery').appendChild(app.view);
const ticks = new Set(), timers = new Map(); let now = 100000, serial = 0;
Object.defineProperty(performance, 'now', { value: () => now });
globalThis.setTimeout = (fn, ms) => { timers.set(++serial, { at: now + ms, fn }); return serial; };
globalThis.clearTimeout = id => timers.delete(id);
const layer = new PIXI.Container(); app.stage.addChild(layer);
globalThis.canvas = { scene: {}, app: { renderer: app.renderer, ticker: { add: f => ticks.add(f), remove: f => ticks.delete(f) } }, tokens: layer };
const { playWarpChargeGlow } = await import('../scripts/warp-jump-vfx.js');
const { spawnEngineTrail } = await import('../scripts/engine-trail-vfx.js');
const tokens = [];
for (const [i, label] of ['WARP / whole-nacelle power-up', 'WARP / traveling ignition', 'IMPULSE / soft exhaust'].entries()) {
  const x = 170 + i * 330;
  const text = new PIXI.Text(label, { fontFamily: 'Arial', fontSize: 15, fill: 0x9fb9d6 }); text.position.set(x - 148, 22); app.stage.addChild(text);
  const ship = new PIXI.Graphics(); ship.beginFill(0x24384d).lineStyle(1, 0x4f6b87);
  ship.drawEllipse(x, 180, 72, 80).drawRoundedRect(x - 16, 195, 32, 146, 12);
  ship.drawPolygon([x-10,270,x-76,295,x-76,317,x-7,295]); ship.drawPolygon([x+10,270,x+76,295,x+76,317,x+7,295]);
  ship.drawRoundedRect(x - 88, 190, 22, 151, 10).drawRoundedRect(x + 66, 190, 22, 151, 10).endFill(); app.stage.addChildAt(ship, 0);
  const curves = [-77,77].map(dx => Array.from({length:48},(_,j)=>({x:dx+Math.sin(j/47*Math.PI)*3,y:195+j/47*133})));
  tokens.push({ id: `engine-${i}`, document: {id:`engine-${i}`}, center:{x,y:0}, curves });
}
let handles = [], playing = false, elapsed = 0;
function clear() { for (const h of handles) { h.cleanup?.(); h.stop?.({immediate:true}); } handles=[]; }
function advance(ms) { for(let t=0;t<ms;t+=16) { now+=Math.min(16,ms-t); for(const tick of [...ticks])tick(); for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();} } }
function start(hold=false,fallback=false) {
  clear(); elapsed=0;
  for(const child of app.stage.children)child.visible=true;
  const shader = PIXI.Shader; if(fallback)PIXI.Shader=null;
  handles.push(playWarpChargeGlow(tokens[0],{chargeMode:'flood',sweepMs:700}));
  handles.push(playWarpChargeGlow(tokens[1],{chargeMode:'sweep',sweepMs:700}));
  handles.push(spawnEngineTrail({...tokens[2],center:{x:tokens[2].center.x,y:246}},'impulse',{emitDuration:1500,isPreview:true}));
  PIXI.Shader=shader; playing=!hold; advance(hold?950:16); app.renderer.render(app.stage);
  output.textContent=`${fallback?'Fallback':hold?'Powered engines':'Playing'} · PIXI ${PIXI.VERSION}`;
}
document.querySelector('#play').onclick=()=>start();
document.querySelector('#hold').onclick=()=>start(true);
document.querySelector('#fallback').onclick=()=>start(true,true);
document.querySelector('#curves').onclick=()=>{
  clear();playing=false;
  for(const child of app.stage.children)child.visible=child===layer;
  const paths=[
    Array.from({length:161},(_,i)=>{const a=-Math.PI/2+i/160*Math.PI*1.75;return{x:170+22*Math.cos(a),y:220+22*Math.sin(a)};}),
    Array.from({length:161},(_,i)=>({x:500+45*Math.sin(i/160*Math.PI*2),y:100+i/160*280})),
    [{x:790,y:110},{x:790,y:280},{x:840,y:280},{x:820,y:160},{x:875,y:330}],
  ];
  for(const path of paths){const glow=createEngineGlow({color:0x369dff,width:9,glowSize:35,warp:true,blendMode:PIXI.BLEND_MODES.ADD});layer.addChild(glow.mesh);glow.update(path,{alpha:.85});handles.push({cleanup:()=>glow.destroy()});}
  app.renderer.render(app.stage);output.textContent='Tight loop / S bend / sharp return · continuous glow';
};
function animate(){if(playing){advance(16);elapsed+=16;if(elapsed===1600){handles[0].stop();handles[1].stop();}if(elapsed>2600)start();app.renderer.render(app.stage);}requestAnimationFrame(animate);}
document.querySelector('#checks').onclick=()=>{
  playing=false;clear();let checks=0;
  const assert=(ok,msg)=>{if(!ok)throw Error(msg);checks++;};
  const stage=new PIXI.Container(); const rt=PIXI.RenderTexture.create({width:360,height:200});
  const pixels=()=>{app.renderer.render(stage,{renderTexture:rt,clear:true});return app.renderer.extract.pixels(rt);};
  const energy=p=>p.reduce((sum,n,i)=>sum+(i%4===3?n:0),0);
  try {
    for(const warp of [false,true]) for(const blendMode of [PIXI.BLEND_MODES.ADD,PIXI.BLEND_MODES.NORMAL]) {
      const glow=createEngineGlow({color:warp?0x369dff:0xff572e,width:10,glowSize:20,warp,blendMode});
      assert(glow,'Shader construction failed');stage.addChild(glow.mesh);
      const path=[{x:50,y:100},{x:160,y:100},{x:290,y:100}];
      glow.update(path);const full=pixels();assert(energy(full)>10000,'Invisible shader');
      const at=(x,y)=>full[(y*360+x)*4+3];
      assert(at(160,100)>at(160,108)&&at(160,108)>at(160,117)&&at(160,117)>at(160,125),'Halo does not soften continuously');
      glow.update(path,{reveal:.4});const swept=energy(pixels());assert(swept<energy(full)*.6,`Sweep did not limit light (${warp}, ${blendMode}: ${swept}/${energy(full)})`);
      glow.update(path,{alpha:0});assert(energy(pixels())===0,'Zero alpha draws');
      glow.update(path);stage.alpha=.25;assert(energy(pixels())<energy(full)*.3,'Ancestor alpha ignored');stage.alpha=1;
      glow.update([{x:50,y:100},{x:50,y:100},{x:150,y:80},{x:280,y:150}],{taper:true});assert(energy(pixels())>0,'Curved trail invisible');
      const bend=Array.from({length:257},(_,i)=>{const a=-Math.PI/2+i/256*Math.PI*1.75;return{x:175+12*Math.cos(a),y:100+12*Math.sin(a)};});
      glow.update(bend);const curved=pixels();
      const peak=p=>p.reduce((n,v,i)=>i%4===3?Math.max(n,v):n,0);
      assert(peak(curved)<=peak(full)+3,'Tight curve accumulated bright beads');
      let rays=0;
      for(let y=0;y<200;y++)for(let x=0;x<360;x++){
        if(curved[(y*360+x)*4+3]>1&&Math.min(...bend.map(p=>Math.hypot(x+.5-p.x,y+.5-p.y)))>26)rays++;
      }
      assert(rays===0,'Tight curve has rays outside its halo');
      const coreValues=bend.slice(8,-8).map(p=>curved[(Math.floor(p.y)*360+Math.floor(p.x))*4+3]);
      assert(Math.min(...coreValues)>Math.max(...coreValues)*.86,'Tight curve core has visible gaps or beads');
      glow.update([{x:50,y:100},{x:50,y:100}]);assert(energy(pixels())===0,'Degenerate path leaves stale glow');
      glow.update(path);pixels();assert(app.renderer.gl.getError()===0,'WebGL error');
      glow.destroy();glow.destroy();assert(stage.children.length===0,'Mesh cleanup leak');
    }
    start(true);playing=false;
    assert(ticks.size===3,'Runners did not start');
    assert(layer.children.every(c=>c.children.some(x=>x.shader)),'Runner did not use shader');
    advance(6000);assert(ticks.size===0&&layer.children.length===0&&timers.size===0,'Natural expiration leaked');
    start(true);playing=false;canvas.scene={};advance(16);assert(ticks.size===0&&layer.children.length===0,'Scene teardown leaked');
    start(true,true);playing=false;assert(layer.children.every(c=>c.children.some(x=>x instanceof PIXI.Graphics)),'Fallback failed');
    clear();assert(ticks.size===0&&timers.size===0,'Explicit cleanup leaked');
    start(true);playing=false;
    output.textContent=`PASS · ${checks} rendering and lifecycle checks · PIXI ${PIXI.VERSION}`;
  }catch(error){output.textContent=`FAIL after ${checks} checks: ${error.stack}`;}
  finally {rt.destroy(true);stage.destroy({children:true});}
};
start(true);requestAnimationFrame(animate);
