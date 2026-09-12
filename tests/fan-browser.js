import Base from '/foundry/canvas/rendering/shaders/base-shader.mjs';
import QuadMesh from '/foundry/canvas/containers/elements/quad-mesh.mjs';
import {maskReads,mask} from './fan-browser-stubs.js';
const out=document.querySelector('#results');
const warnings=[];const warn=console.warn.bind(console);console.warn=(...args)=>{warnings.push(args.map(x=>x?.stack??String(x)).join(' '));warn(...args);};
window.addEventListener('error',e=>out.textContent+=`\nERROR: ${e.message}`);
window.addEventListener('unhandledrejection',e=>out.textContent+=`\nERROR: ${e.reason}`);
const hooks=new Map();
globalThis.Hooks={on(n,f){if(!hooks.has(n))hooks.set(n,[]);hooks.get(n).push(f);}};
const emit=(n,...args)=>{for(const f of hooks.get(n)??[])f(...args);};
globalThis.foundry={canvas:{rendering:{shaders:{AbstractBaseShader:Base}},containers:{QuadMesh}},utils:{deepClone:v=>structuredClone(v),mergeObject:(a,b)=>({...structuredClone(a),...b}),getProperty:(o,p)=>p.split('.').reduce((v,k)=>v?.[k],o)}};
let mode='shader',tractorMode='shader',appearance={};
globalThis.game={settings:{get:(_m,k)=>k==='weaponAnimationModes'?{'weapon-ground-phaser':mode}:k==='beamVfxAppearance'?appearance:k==='tractorBeamAnimationRenderer'?tractorMode:{}},socket:{emit(){}},user:{isGM:true}};
const app=new PIXI.Application({width:1100,height:660,backgroundColor:0x060b13,antialias:true,preserveDrawingBuffer:true});app.stop();document.querySelector('#gallery').appendChild(app.view);
let now=100000,id=0;const ticks=new Map(),timers=new Map(),tweens=new Set();
Object.defineProperty(performance,'now',{value:()=>now});
globalThis.setTimeout=(fn,ms)=>{const key=++id;timers.set(key,{fn,at:now+ms,layer:canvas.tokens});return key;};globalThis.clearTimeout=k=>timers.delete(k);
globalThis.animejs={animate(target,opts){tweens.add({target,opts,alpha:target.alpha,start:now+(opts.delay??0)});}};
globalThis.canvas={ready:true,scene:{id:'fixture'},grid:{size:55},app:{renderer:app.renderer,ticker:{add:f=>ticks.set(f,canvas.tokens),remove:f=>ticks.delete(f)}}};
const ground=await import('../scripts/ground-phaser-vfx.js');
const tractor=await import('../scripts/tractor-beam-vfx.js');
const {createFanField}=await import('../scripts/fan-field-shader.js');
const {createTractorHullLock}=await import('../scripts/tractor-hull-shader.js');
const {sampleTractorHullContact}=await import('../scripts/tractor-contact-geometry.js');
const hullCanvas=document.createElement('canvas');hullCanvas.width=hullCanvas.height=100;
const hullCtx=hullCanvas.getContext('2d');hullCtx.fillStyle='#355267';
hullCtx.beginPath();for(const [i,p]of [[46,8],[54,8],[61,36],[93,20],[95,33],[66,54],[62,70],[85,85],[81,94],[52,78],[19,94],[15,85],[38,70],[34,54],[5,33],[7,20],[39,36]].entries()){if(i)hullCtx.lineTo(...p);else hullCtx.moveTo(...p);}hullCtx.closePath();hullCtx.fill();
hullCtx.clearRect(46,46,8,8);
const hullTexture=PIXI.Texture.from(hullCanvas);
mask.width=mask.height=100;mask.opaque=[];mask.opaqueSet.clear();
const maskPixels=hullCtx.getImageData(0,0,100,100).data;
for(let y=0;y<100;y++)for(let x=0;x<100;x++)if(maskPixels[(y*100+x)*4+3]>=128){mask.opaque.push({x,y});mask.opaqueSet.add(y*100+x);}
tractor.registerTractorBeamVfxHooks();
function advance(ms){for(let d=0;d<ms;d+=16){now+=Math.min(16,ms-d);
  for(const cell of cells){const t=cell.target;if(t.mesh){t.mesh.position.set(t.center.x,t.center.y);t.mesh.rotation=(t.document.rotation??0)*Math.PI/180;t.mesh.width=t.w*.9;t.mesh.height=t.h*.9;}}
  for(const t of [...tweens]){if(now<t.start)continue;const p=Math.min(1,(now-t.start)/(t.opts.duration??1));if(!t.target.destroyed)t.target.alpha=t.alpha+(t.opts.alpha-t.alpha)*p;if(p===1)tweens.delete(t);}
  const layer=canvas.tokens;for(const [f,l]of [...ticks]){canvas.tokens=l;canvas.primary=l;f();}
  for(const [k,t]of [...timers])if(t.at<=now){timers.delete(k);canvas.tokens=t.layer;canvas.primary=t.layer;t.fn();}
  canvas.tokens=layer;canvas.primary=layer;
}}
const cells=[];
function token(id,x,y,w=70,h=70){return{id,x,y,w,h,get center(){return{x:this.x+this.w/2,y:this.y+this.h/2};},document:{parent:{id:'fixture'},texture:{},rotation:0,getFlag(){return this.tractorState;}}};}
for(let i=0;i<4;i++){
  const cell=new PIXI.Container();cell.position.set(i%2*550,Math.floor(i/2)*330);app.stage.addChild(cell);
  const label=new PIXI.Text(['GROUND / shader cone','TRACTOR / full hull alpha-masked lock','GROUND / polished native fallback','TRACTOR / violet, wider hull'][i],{fontFamily:'Arial',fontSize:14,fill:0xadc6e2});label.position.set(15,16);cell.addChild(label);
  const bg=new PIXI.Graphics();bg.lineStyle(1,0x152334,.5);for(let x=0;x<550;x+=50)bg.moveTo(x,45).lineTo(x,325);for(let y=45;y<330;y+=50)bg.moveTo(0,y).lineTo(548,y);cell.addChild(bg);
  const source=token('source'+i,25,150,42,42),target=token('target'+i,420,80,90,i===3?210:150);
  source.emitter={x:65,y:171};target.mask=true;
  target.document.texture={fit:'fill',scaleX:.9,scaleY:.9};
  if(i%2){target.mesh=new PIXI.Sprite(hullTexture);target.mesh.anchor.set(.5);target.mesh.position.set(target.center.x,target.center.y);target.mesh.width=target.w*.9;target.mesh.height=target.h*.9;cell.addChild(target.mesh);}
  const layer=new PIXI.Container();layer.placeables=[source,target];layer.get=id=>layer.placeables.find(t=>t.id===id);cell.addChild(layer);
  if(!(i%2)){bg.lineStyle(1,0x63798c,.7);for(const p of [{x:430,y:120},{x:450,y:240}])bg.drawCircle(p.x,p.y,14);}
  bg.lineStyle(1,0x8194aa,.8);bg.drawCircle(55,171,12);cells.push({cell,layer,source,target});
}
function layer(i){canvas.tokens=cells[i].layer;canvas.primary=canvas.tokens;}
function clear(){emit('canvasTearDown');for(const c of cells)for(const ch of [...c.layer.children])ch.destroy({children:true});ticks.clear();timers.clear();tweens.clear();}
function cone(i,hit=true){layer(i);mode=i===2?'experimental':'shader';ground.playGroundPhaserVfxFromSocket({mode:'cone',sceneId:'fixture',sourcePoint:{x:55,y:171},targetPoints:[{x:430,y:120},{x:450,y:240}],hit,style:{color:'#ff9433',core:'#fff3cf',group:{coneOpenDuration:280,coneHitDuration:1100,missDuration:800},shared:{cleanupDelay:120}}});}
let playing=false,elapsed=0;
async function start(play=false,at=420){clear();appearance={};emit('canvasReady');cone(0);cone(2);
  for(const i of [1,3]){layer(i);tractor.NativeTractorBeamVFX.play(cells[i].source,cells[i].target,{renderer:'shader',colorMode:'custom',color:i===3?'#a875ff':'#44bbff',persistentKey:'gallery'+i});}
  await Promise.resolve();advance(at);app.renderer.render(app.stage);playing=play;elapsed=at;out.textContent=`${play?'Playing':'Frozen preview'} · PIXI ${PIXI.VERSION}`;
}
document.querySelector('#play').onclick=()=>start(true,0);
document.querySelector('#hold').onclick=()=>start(false);
document.querySelector('#opening').onclick=()=>start(false,100);
function frame(){if(playing){advance(16);elapsed+=16;if(elapsed>2200){playing=false;start(true,0);}app.renderer.render(app.stage);}requestAnimationFrame(frame);}
document.querySelector('#checks').onclick=async()=>{
  playing=false;clear();let count=0;const assert=(v,m)=>{if(!v)throw Error(m);count++;};
  const stage=new PIXI.Container(),pixels=()=>{app.renderer.render(stage);return app.renderer.extract.pixels(stage);};
  const sum=p=>p.reduce((s,v,i)=>s+(i%4===3?v:0),0);
  try {
    layer(0);emit('canvasReady');
    for(const rotation of [0,.4,1.2,2.4,Math.PI,5.7]){
      const c=Math.cos(rotation),s=Math.sin(rotation);
      const transform=p=>({x:300+(p.x+.5-50)*c-(p.y+.5-50)*s,y:150+(p.x+.5-50)*s+(p.y+.5-50)*c});
      const contact=sampleTractorHullContact(mask,{x:0,y:150},transform);
      assert(contact?.contour.length===33,'adaptive contact missing at rotation '+rotation);
      assert(contact.contour.every(p=>{const x=Math.floor(50+(p.x-300)*c+(p.y-150)*s),y=Math.floor(50-(p.x-300)*s+(p.y-150)*c);return mask.opaqueSet.has(y*100+x);}), 'contact ended in transparent artwork');
      assert(contact.contour[16].x<contact.center.x,'contact failed to favor facing hull');
    }
    assert(sampleTractorHullContact(null,{x:0,y:0},p=>p)===null,'missing art did not fall back');
    const hullArt=new PIXI.Sprite(hullTexture);stage.addChild(hullArt);hullArt.alpha=0;
    const hullParent=new PIXI.Container();stage.addChild(hullParent);
    const hullToken={mesh:hullArt},coating=createTractorHullLock(hullParent,hullToken,{opacity:.8});assert(coating,'hull shader failed');coating.update(.5);
    const painted=pixels(),original=hullCtx.getImageData(0,0,100,100).data;
    assert(painted.length===original.length,'hull texture alignment dimensions');
    assert(painted.every((v,i)=>i%4!==3||original[i]!==0||v===0),'hull glow filled transparent pixels');
    for(const [x,y]of [[50,25],[12,28],[88,28],[24,87],[76,87]])assert(painted[(y*100+x)*4+3]>0,'hull extremity uncoated');
    assert(painted[(50*100+50)*4+3]===0,'transparent interior hole filled');
    coating.update(1.5);assert(pixels().some((v,i)=>Math.abs(v-painted[i])>2),'hull coating has no flow');
    hullParent.alpha=0;assert(sum(pixels())===0,'hull ignores parent fade');hullParent.alpha=1;
    hullArt.rotation=.8;hullArt.scale.set(-1.2,.7);pixels();
    assert(coating.mesh.geometry.getBuffer('aVertexPosition').data.every((v,i)=>Math.abs(v-hullArt.vertexData[i])<.001),'rotated mirrored hull mask detached');
    hullParent.position.set(30,-12);hullParent.scale.set(.6,1.4);pixels();
    const hullVertices=coating.mesh.geometry.getBuffer('aVertexPosition').data;
    for(let i=0;i<4;i++){const p=hullParent.worldTransform.apply(new PIXI.Point(hullVertices[i*2],hullVertices[i*2+1]));assert(Math.abs(p.x-hullArt.vertexData[i*2])<.001&&Math.abs(p.y-hullArt.vertexData[i*2+1])<.001,'different layer transform misaligned hull');}
    const cropped=new PIXI.Texture(hullTexture.baseTexture,new PIXI.Rectangle(50,0,50,100));hullArt.texture=cropped;pixels();
    assert(coating.mesh.shader.uniforms.uHullTexture===cropped,'changed texture not followed');
    assert(coating.mesh.geometry.getBuffer('aTextureCoord').data.every((v,i)=>v===cropped._uvs.uvsFloat32[i]),'atlas UV mask mismatch');
    hullArt.texture=hullTexture;cropped.destroy(false);pixels();
    hullToken.mesh=null;assert(!coating.update(2),'missing token texture not detected');pixels();hullToken.mesh=hullArt;assert(coating.update(3),'hull texture did not recover');
    hullParent.destroy({children:true});assert(!hullTexture.destroyed&&hullTexture.valid,'cleanup destroyed borrowed token texture');hullArt.destroy();
    for(const kind of ['ground','tractor'])for(const blend of [0,1]){
      const parent=new PIXI.Container();stage.addChild(parent);const f=createFanField(parent,{kind,blend});assert(f,kind+' shader compile');
      const shape=[{x:350,y:25},{x:320,y:80},{x:305,y:120},{x:330,y:180}];
      f.update({x:20,y:110},shape,.5);const a=pixels();assert(sum(a)>1000,kind+' invisible');f.update({x:20,y:110},shape,1.2);const b=pixels();assert(a.some((v,i)=>Math.abs(v-b[i])>2),kind+' no motion');
      parent.alpha=.25;assert(sum(pixels())<sum(b)*.4,kind+' ancestor opacity');parent.alpha=0;assert(sum(pixels())===0,kind+' zero opacity');parent.alpha=1;
      const pos=f.mesh.geometry.getBuffer('aVertexPosition').data;
      for(let i=0;i<shape.length;i++){const k=(16*shape.length+i)*2;assert(Math.abs(pos[k]-shape[i].x)<.001&&Math.abs(pos[k+1]-shape[i].y)<.001,'hull corner lost');}
      f.update({x:20,y:110},[{x:350,y:30},{x:350,y:220}],2);pixels();assert(app.renderer.gl.getError()===0,'changing contour topology GL error');
      const u=f.mesh.shader.uniforms;u.uRays[0]=0;const noRays=pixels();assert(sum(noRays)>0,'ray toggle removed body');
      u.uOpacity=0;assert(sum(pixels())===0,'zero body and rays did not vanish');u.uOpacity=.5;
      parent.rotation=.6;parent.scale.set(.7);pixels();assert(app.renderer.gl.getError()===0,'world transform GL error');
      f.update({x:20,y:110},[{x:20,y:110},{x:20,y:110}],2);assert(!f.mesh.visible,'zero-length field visible');
      parent.destroy({children:true});assert(stage.children.length===0,'field cleanup');
    }
    for(const modeValue of ['shader','pixi','jb2a','invalid']){tractorMode=modeValue;assert(tractor.getTractorBeamAnimationRenderer()===(modeValue==='invalid'?'jb2a':modeValue),'renderer setting resolution');}tractorMode='shader';
    await start();playing=false;
    assert(cells[0].layer.children.some(c=>c.children.some(x=>x.shader)),'ground runner missing shader');
    assert(!cells[2].layer.children.some(c=>c.children.some(x=>x.shader)),'native fallback unexpectedly shaded');
    assert(cells[1].layer.children[0].children.some(x=>x.shader),'tractor runner missing shader');
    assert(cells[3].layer.children[0].children.some(x=>x.shader),'second persistent tractor missing');
    layer(1);const target=cells[1].target,source=cells[1].source;
    const live=cells[1].layer.children[0],fan=live.children.find(x=>x.shader);
    const positions=fan.geometry.getBuffer('aVertexPosition');
    const initial=positions.data.slice(),reads=maskReads.loads;
    for(let rotation=0;rotation<=720;rotation+=15){target.document.rotation=rotation;advance(16);app.renderer.render(app.stage);}
    assert(!live.destroyed&&tractor.NativeTractorBeamVFX._persistent.get('gallery1')?.container===live,'rotation stopped persistent beam');
    assert(positions.data.length===initial.length&&positions.data.every(Number.isFinite),'rotation broke fixed contact topology');
    assert(maskReads.loads===reads,'rotation reloaded alpha mask');
    assert(app.renderer.gl.getError()===0,'rotation GPU error');
    const middle=(16*33+16)*2,dx=target.center.x-source.emitter.x,dy=target.center.y-source.emitter.y;
    advance(500);
    assert((positions.data[middle]-target.center.x)*dx+(positions.data[middle+1]-target.center.y)*dy<0,'beam still locks at fixed center');
    const hitTarget=new PIXI.Graphics().beginFill(0x123456,.001).drawRect(target.x,target.y,target.w,target.h).endFill();
    hitTarget.eventMode='static';cells[1].layer.addChildAt(hitTarget,0);app.stage.eventMode='static';app.renderer.render(app.stage);
    const boundary=new PIXI.EventBoundary(app.stage),world=hitTarget.toGlobal(new PIXI.Point(target.center.x,target.center.y));
    assert(boundary.hitTest(world.x,world.y)===hitTarget,'tractor intercepts token selection');
    assert(live.eventMode==='none'&&!live.interactiveChildren,'tractor descendants still interactive');hitTarget.destroy();
    const oldX=target.x,oldY=target.y;
    target.x=source.emitter.x-target.w/2;target.y=source.emitter.y-target.h/2;advance(16);
    assert(!live.destroyed&&!live.renderable,'overlap cancelled lock or drew invalid field');
    target.x=oldX;target.y=oldY;advance(16);assert(live.renderable&&!live.destroyed,'beam did not recover from overlap');
    target.w=0;advance(16);assert(!live.renderable&&!live.destroyed,'temporary invalid size cancelled lock');target.w=90;advance(16);assert(live.renderable,'size recovery requires refresh');
    const savedEmitter={...source.emitter};source.emitter.x+=20;source.emitter.y-=15;advance(16);
    assert(positions.data[0]===source.emitter.x&&positions.data[1]===source.emitter.y,'beam detached from moving emitter');source.emitter=savedEmitter;advance(16);
    const mesh=cells[1].layer.children[0].children.find(x=>x.shader),before=mesh.geometry.getBuffer('aVertexPosition').data.slice();target.x-=50;target.document.rotation=30;advance(200);
    assert(before.some((v,i)=>Math.abs(v-mesh.geometry.getBuffer('aVertexPosition').data[i])>1),'tractor not following moved/rotated target');target.x+=50;target.document.rotation=0;
    cells[1].layer.placeables=[source];advance(16);assert(cells[1].layer.children.length===0,'deleted target retained beam');cells[1].layer.placeables=[source,target];
    emit('canvasTearDown');advance(4000);assert(ticks.size===0,'teardown ticker leak');assert(timers.size===0,'teardown timer leak');assert(cells.every(c=>c.layer.children.length===0),'teardown container leak');
    layer(0);cone(0);advance(4000);assert(ticks.size===0&&timers.size===0&&cells[0].layer.children.length===0,'normal ground completion leak');
    cone(0,false);advance(4000);assert(ticks.size===0&&timers.size===0&&cells[0].layer.children.length===0,'ground miss completion leak');
    cone(0);emit('canvasTearDown');advance(4000);assert(cells[0].layer.children.length===0&&ticks.size===0,'opening teardown spawned impacts');
    layer(1);const h=tractor.NativeTractorBeamVFX.play(source,target,{renderer:'shader',duration:500});assert(h,'preview missing');advance(1000);assert(cells[1].layer.children.length===0&&ticks.size===0&&timers.size===0,'preview cleanup');
    source.document.tractorState={targetTokenId:target.id};tractor.refreshPersistentTractorBeamVfx();assert(tractor.NativeTractorBeamVFX._persistent.size===1,'flag playback missing');source.document.tractorState=null;
    emit('updateToken',source.document,{flags:{'sta2e-toolkit':{'-=tractorBeam':null}}});assert(tractor.NativeTractorBeamVFX._persistent.size===0,'remote release failed');
    const gl=canvas.app.renderer.gl;canvas.app.renderer.gl=null;
    const fallback=tractor.NativeTractorBeamVFX.play(source,target,{renderer:'shader'});assert(fallback&&!fallback.container.children.some(c=>c.shader),'tractor GPU fallback failed');fallback.stop();
    cone(0);assert(!cells[0].layer.children.some(c=>c.children.some(x=>x.shader)),'ground GPU fallback failed');canvas.app.renderer.gl=gl;advance(4000);
    for(let i=0;i<12;i++){layer(1);tractor.NativeTractorBeamVFX.play(source,target,{renderer:'shader'});advance(32);tractor.NativeTractorBeamVFX.stopActive();}
    assert(ticks.size===0&&timers.size===0&&cells[1].layer.children.length===0,'repeated tractor preview leaked');
    layer(1);cells[1].layer.placeables=[source];tractor.NativeTractorBeamVFX.play(source,target,{renderer:'shader'});assert(timers.size===0&&ticks.size===0,'invalid token scheduled a timer');cells[1].layer.placeables=[source,target];
    assert(app.renderer.gl.getError()===0,'final GPU error');
    await start();out.textContent=`PASS ${count}/${count} checks · real Foundry + PIXI ${PIXI.VERSION} · WebGL shaders, contours, movement, modes, opacity, fallbacks and cleanup.`;
  } catch(e){out.textContent=`FAIL after ${count} checks: ${e.stack}\n${warnings.join('\n')}`;throw e;}
};
await start();requestAnimationFrame(frame);

