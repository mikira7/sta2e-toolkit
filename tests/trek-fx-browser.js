import { refreshTrekFx, registerTrekFx, clearTrekFx, setTrekFx } from '../scripts/trek-fx.js';
import { TREK_FX_SECTION } from '../scripts/trek-fx-hud.js';
const output = document.querySelector('#results');
window.addEventListener('error', e => output.textContent += `\nERROR: ${e.message}`);
window.addEventListener('unhandledrejection', e => output.textContent += `\nERROR: ${e.reason}`);
const app = new PIXI.Application({width:1100,height:460,backgroundColor:0x080e19,antialias:true,preserveDrawingBuffer:true});
document.querySelector('#gallery').appendChild(app.view);
let frozen = 2500, origin = Date.now();
const hooks = new Map();
globalThis.Hooks = {on:(event,fn)=>{const list=hooks.get(event)??[];list.push(fn);hooks.set(event,list);}};
globalThis.game = {user:{isGM:true},time:{get serverTime(){return frozen??Date.now()-origin;}}};
globalThis.canvas = {app,tokens:{placeables:[]}};
registerTrekFx();
const g = new PIXI.Graphics();
g.beginFill(0xcea07c).drawCircle(48,22,12).endFill();
g.beginFill(0xc09a29).drawRoundedRect(26,39,44,49,8).endFill();
g.beginFill(0x485369).drawRoundedRect(29,85,15,39,4).drawRoundedRect(52,85,15,39,4).endFill();
g.beginFill(0xcea07c).drawRoundedRect(18,48,9,37,4).drawRoundedRect(69,48,9,37,4).endFill();
g.beginFill(0xf1d68b).drawPolygon([57,44,54,53,61,53]).endFill();
const texture=app.renderer.generateTexture(g,{region:new PIXI.Rectangle(0,0,96,128)});g.destroy();
const fixtures=[];
for(const [i,key] of ['none','blueHaze','particleStorm','blueDissolve'].entries()) {
  const label=new PIXI.Text(['Original','Blue Static Haze','Particle Bombardment','Blue Particle Dissolve'][i],{fontSize:17,fill:0xc2d9f2});
  label.position.set(i*270+18,20);app.stage.addChild(label);
  const mesh=new PIXI.Sprite(texture);mesh.position.set(i*270+55,120);mesh.scale.set(1.45);app.stage.addChild(mesh);
  const flags={[key]:true,startedAt:0};
  const token={id:`fixture-${i}`,mesh,document:{getFlag:()=>flags,
    async update(changes){for(const [key,value] of Object.entries(changes))flags[key.split('.').at(-1)]=value;},
    async unsetFlag(){for(const k of Object.keys(flags))delete flags[k];}}};
  fixtures.push({token,flags});canvas.tokens.placeables.push(token);refreshTrekFx(token);
}
const palette=document.querySelector('#particle-hud');
const host={token:fixtures[2].token,palette,rebuild(nav){palette.replaceChildren(...TREK_FX_SECTION.build(host,nav));}};
host.rebuild();
document.querySelector('#play').onclick=()=>{origin=Date.now();frozen=null;output.textContent='Playing a single dissolve; fully gone at 6.5 seconds (isolated visual preview).';};
document.querySelector('#half').onclick=()=>{frozen=2500;output.textContent='Dissolve at 2.5 seconds.';};
function renderAt(time){frozen=time;for(const {token} of fixtures)refreshTrekFx(token);app.renderer.render(app.stage);}
function pixels(mesh){
  // Read the rendered screen: extracting a Sprite alone re-roots its transform.
  const b=mesh.getBounds();
  return app.renderer.extract.pixels(undefined,new PIXI.Rectangle(b.x,app.screen.height-b.y-b.height,b.width,b.height));
}
document.querySelector('#checks').onclick=async()=>{
  try {
    let count=0;
    const check=(yes,label)=>{if(!yes)throw new Error(label);count++;};
    renderAt(0);
    for(const {token} of fixtures.slice(1))check(token.mesh.filters?.length===1,'shader compiles and attaches');
    const storm=fixtures[2].token.mesh;
    renderAt(1000);const a=pixels(storm);renderAt(1100);const b=pixels(storm);
    check(a.some((v,i)=>v!==b[i]),'bombardment animates');
    const haze=fixtures[1].token.mesh;
    renderAt(1000);const c=pixels(haze);renderAt(1600);const d=pixels(haze);
    check(c.some((v,i)=>v!==d[i]),'blue haze animates');
    const dissolve=fixtures[3].token.mesh;
    const alpha=()=>{const p=pixels(dissolve);let sum=0;for(let i=0;i<p.length;i+=4)sum+=Math.abs(p[i]-8)+Math.abs(p[i+1]-14)+Math.abs(p[i+2]-25);return sum;};
    renderAt(0);const full=alpha();renderAt(2700);const partial=alpha();renderAt(6500);const gone=alpha();
    check(full>partial&&partial>gone,'dissolve progressively removes artwork');
    check(gone===0,'dissolve reaches fully transparent');
    renderAt(7999);check(alpha()===0,'dissolve stays gone instead of re-forming');
    const token=fixtures[3].token;
    const foreign=new PIXI.filters.AlphaFilter(.8);token.mesh.filters.push(foreign);
    await clearTrekFx(token);check(token.mesh.filters.length===1&&token.mesh.filters[0]===foreign,'clear preserves foreign filters');
    token.mesh.filters=null;foreign.destroy();fixtures[3].flags.blueDissolve=true;fixtures[3].flags.startedAt=0;
    renderAt(2500);
    check(app.renderer.gl.getError()===app.renderer.gl.NO_ERROR,'no WebGL errors');
    // PIXI can still have the Trek program bound when Foundry tears down a scene.
    // Recreating filters must not replace that program behind ShaderSystem's cache.
    const gl=app.renderer.gl;
    for(let cycle=0;cycle<3;cycle++) {
      app.renderer.shader.bind(fixtures[2].token.mesh.filters[0],true);
      for(const fn of hooks.get('canvasTearDown')??[])fn();
      for(const fn of hooks.get('canvasReady')??[])fn();
      const restored=fixtures[2].token.mesh.filters[0];
      app.renderer.shader.bind(restored,true);
      check(gl.getParameter(gl.CURRENT_PROGRAM)===restored.program.glPrograms[app.renderer.CONTEXT_UID].program,
        'scene switch keeps PIXI and WebGL on the same shader program');
      renderAt(1000);const before=pixels(storm);renderAt(1200);const after=pixels(storm);
      check(before.some((v,i)=>v!==after[i]),'bombardment animates after scene switch');
      app.renderer.shader.bind(restored,true);
      await clearTrekFx(fixtures[2].token);
      await setTrekFx(fixtures[2].token,'particleStorm',true);
      const reset=storm.filters[0];
      app.renderer.shader.bind(reset,true);
      check(gl.getParameter(gl.CURRENT_PROGRAM)===reset.program.glPrograms[app.renderer.CONTEXT_UID].program,
        'clear and re-enable keeps PIXI and WebGL on the same shader program');
      renderAt(1000);const resetBefore=pixels(storm);renderAt(1200);const resetAfter=pixels(storm);
      check(resetBefore.some((v,i)=>v!==resetAfter[i]),'bombardment animates after clear and re-enable');
    }
    renderAt(2500);
    check(gl.getError()===gl.NO_ERROR,'no WebGL errors after repeated scene switches');
    output.textContent=`PASS: ${count} rendering checks · PIXI ${PIXI.VERSION}. Midpoint preview below.`;
  } catch(error){output.textContent=`FAIL: ${error.stack}`;}
};
output.textContent=`Ready · PIXI ${PIXI.VERSION}. Dissolve midpoint preview.`;
