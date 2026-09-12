import Base from '/foundry/canvas/rendering/shaders/base-shader.mjs';
import QuadMesh from '/foundry/canvas/containers/elements/quad-mesh.mjs';
import { settings } from './deflector-browser-anchors.js';

const output = document.querySelector('#results');
window.addEventListener('error', e => { output.textContent += `\nERROR: ${e.message}`; });
window.addEventListener('unhandledrejection', e => { output.textContent += `\nERROR: ${e.reason}`; });
const hooks = new Map();
globalThis.Hooks = { on(name,fn) { if(!hooks.has(name))hooks.set(name,[]);hooks.get(name).push(fn); } };
globalThis.foundry = {
  canvas: { rendering: { shaders: { AbstractBaseShader: Base } }, containers: { QuadMesh } },
  utils: { deepClone: v => structuredClone(v), mergeObject: (a,b) => ({...structuredClone(a),...b}) },
};
globalThis.game = { settings: { get: () => '' } };
const app = new PIXI.Application({width:1100,height:660,backgroundColor:0x060b13,antialias:true,preserveDrawingBuffer:true});
app.stop();
document.querySelector('#gallery').appendChild(app.view);
const ticks = new Set();
let now = 100000;
Object.defineProperty(performance, 'now', {value:()=>now});
// Runner backstops follow the same clock as their animation. A frozen preview
// must not disappear because a real-time timeout expired behind the screenshot.
let timerId=0;const timers=new Map();
globalThis.setTimeout=(fn,ms)=>{const id=++timerId;timers.set(id,{at:now+ms,fn});return id;};
globalThis.clearTimeout=id=>timers.delete(id);
globalThis.canvas = { ready:true, app:{renderer:app.renderer,ticker:{add:f=>ticks.add(f),remove:f=>ticks.delete(f)}} };
const {playDeflectorEffect} = await import('../scripts/deflector-vfx.js');
const {createDeflectorField} = await import('../scripts/deflector-shader.js');
const fixtures = [];
for (const [i,type] of ['chargeGlow','pulse','beam','stream'].entries()) {
  const cell = new PIXI.Container(); cell.position.set((i%2)*550,Math.floor(i/2)*330); app.stage.addChild(cell);
  const grid = new PIXI.Graphics(); grid.lineStyle(1,0x152334,.5);
  for(let x=0;x<550;x+=50) grid.moveTo(x,45).lineTo(x,325);
  for(let y=45;y<330;y+=50) grid.moveTo(0,y).lineTo(548,y);
  cell.addChild(grid);
  const label=new PIXI.Text(['CHARGE / inward energy','PULSE / coherent front and wake','LANCE / hot core and plasma sheath','STREAM / flowing volume'][i],{fontSize:15,fontFamily:'Arial',fill:0xadc6e2});
  label.position.set(20,14);cell.addChild(label);
  const ship = new PIXI.Graphics(); ship.beginFill(0x334a61).drawEllipse(38,180,24,35).endFill();
  ship.lineStyle(2,0x6685a2).drawEllipse(38,180,24,35);cell.addChild(ship);
  const layer=new PIXI.Container();cell.addChild(layer);
  fixtures.push({type,layer,token:{id:type,document:{id:type},center:{x:65,y:180},zIndex:1}});
}
let handles=[], playing=false, elapsed=0, fallback=false;
function clear() { for(const h of handles)h?.cleanup();handles=[]; }
function advance(ms) { for(let t=0;t<ms;t+=16){now+=Math.min(16,ms-t);for(const tick of [...ticks])tick();for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}} }
function start(hold=false,late=false,useFallback=false) {
  clear(); fallback=useFallback; elapsed=0;
  const saved=foundry.canvas.containers.QuadMesh;
  if(fallback)foundry.canvas.containers.QuadMesh=null;
  for(const fn of hooks.get('canvasReady')??[])fn();
  for(const f of fixtures){canvas.tokens=f.layer;handles.push(playDeflectorEffect(f.token,f.type,{settings,isPreview:true,target:{x:f.type==='pulse'?330:495,y:180}}));}
  foundry.canvas.containers.QuadMesh=saved;
  playing=!hold;
  advance(hold?(late?1330:700):16);
  if(hold){advance(0);app.renderer.render(app.stage);}
  output.textContent=`${fallback?'Graphics fallback':hold?'Frozen preview':'Playing'} · PIXI ${PIXI.VERSION}`;
}
function animate(){if(playing){advance(16);elapsed+=16;if(elapsed>3400)start();app.renderer.render(app.stage);}requestAnimationFrame(animate);}
document.querySelector('#play').onclick=()=>start();
document.querySelector('#hold').onclick=()=>start(true);
document.querySelector('#late').onclick=()=>start(true,true);
document.querySelector('#fallback').onclick=()=>start(true,false,true);
document.querySelector('#checks').onclick=()=>{
  playing=false;clear();
  let checks=0;
  const assert=(ok,msg)=>{if(!ok)throw Error(msg);checks++;};
  const stage=new PIXI.Container();
  const pixels=()=>{app.renderer.render(stage);return app.renderer.extract.pixels(stage);};
  const intensity=p=>p.reduce((n,v,i)=>n+(i%4===3?v:0),0);
  try {
    for(const type of ['charge','pulse','stream'])for(const blend of [PIXI.BLEND_MODES.ADD,PIXI.BLEND_MODES.NORMAL]){
      const parent=new PIXI.Container();stage.addChild(parent);
      const field=createDeflectorField(parent,type,{color:0x329aff,coreColor:0xe2f6ff,blend});
      assert(field,`${type}: shader creation failed`);
      field.update(240,240,0,400,400,.7,.8,120,14,2.1,65,.4,900);
      const a=pixels();assert(intensity(a)>10000,`${type}: invisible`);
      field.update(240,240,0,400,400,1.0,.8,120,14,2.1,65,.4,900);
      const b=pixels();assert(a.some((v,i)=>Math.abs(v-b[i])>2),`${type}: texture does not animate`);
      parent.alpha=.25;const dim=pixels();assert(intensity(dim)<intensity(b)*.4,`${type}: ancestor alpha ignored`);
      parent.alpha=0;assert(intensity(pixels())===0,`${type}: zero alpha still draws`);
      parent.alpha=1;field.mesh.rotation=.7;parent.scale.set(.7);pixels();
      assert(app.renderer.gl.getError()===0,`${type}: WebGL error`);
      // Check both shaders link, rather than trusting a JS constructor.
      const program=field.mesh.shader.program.glPrograms[app.renderer.CONTEXT_UID]?.program;
      assert(program&&app.renderer.gl.getProgramParameter(program,app.renderer.gl.LINK_STATUS),`${type}: GLSL link failed`);
      parent.scale.set(1);field.mesh.rotation=0;
      for(const [size,width,sweep,tail] of [[32,1,Math.PI*2,0],[600,48,Math.PI/18,200],[400,14,Math.PI*2,65]]){
        field.update(240,240,0,size,size,1,.8,Math.min(size*.3,120),width,sweep,tail,.4,900);
        assert(intensity(pixels())>0,`${type}: boundary settings invisible`);
        assert(app.renderer.gl.getError()===0,`${type}: boundary settings GL error`);
      }
      parent.destroy({children:true});assert(stage.children.length===0,`${type}: cleanup leaked`);
    }
    start(true);playing=false;
    assert(handles.every(Boolean),'runner failed');
    for(const f of fixtures){
      const meshes=[];const visit=c=>{if(c.shader)meshes.push(c);for(const ch of c.children??[])visit(ch);};visit(f.layer);
      assert(meshes.length>0,`${f.type}: did not use shader`);
    }
    app.renderer.render(app.stage);assert(app.renderer.gl.getError()===0,'combined runner rendering failed');
    clear();assert(ticks.size===0,'effect ticker leaked');assert(timers.size===0,'effect backstop leaked');
    assert(fixtures.every(f=>f.layer.children.length===0),'effect container leaked');
    start(true,false,true);assert(handles.every(Boolean),'Graphics fallback failed');
    clear();assert(ticks.size===0&&timers.size===0,'fallback cleanup leaked');
    start(true);assert(handles.every(Boolean),'shader recovery after fallback failed');
    output.textContent=`PASS: ${checks} rendering checks. All shaders compile, animate, respect alpha/rotation, and clean up.`;
  }catch(e){output.textContent=`FAIL after ${checks} checks: ${e.stack}`;}finally{stage.destroy({children:true});}
};
start(true);animate();
