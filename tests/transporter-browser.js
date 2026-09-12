import Base from '/foundry/canvas/rendering/shaders/base-shader.mjs';
import QuadMesh from '/foundry/canvas/containers/elements/quad-mesh.mjs';
import { TRANSPORTER_SHADER_PRESETS, transporterTimeline } from '../scripts/transporter-shader-config.js';
import { playTransporterShader, releaseTransporterShaders } from '../scripts/transporter-shader.js';
import { transporterShaderForm, wireTransporterShaderForm, saveTransporterShaderForm } from '../scripts/transporter-shader-ui.js';

const output = document.querySelector('#results');
window.addEventListener('error', event => { output.textContent += `\nERROR: ${event.message}`; });
window.addEventListener('unhandledrejection', event => { output.textContent += `\nERROR: ${event.reason}`; });
let frozen = null;
const presetCount=Object.keys(TRANSPORTER_SHADER_PRESETS).length;
const app = new PIXI.Application({ width: 1120, height: Math.ceil(presetCount/3)*210, backgroundColor: 0x080e19, antialias: true, preserveDrawingBuffer: true });
document.querySelector('#gallery').appendChild(app.view);
const scene = { id: 'test-scene' };
const primary = new PIXI.Container(), overlay = new PIXI.Container();
app.stage.addChild(primary, overlay);
globalThis.foundry = {
  canvas: { rendering: { shaders: { AbstractBaseShader: Base } }, containers: { QuadMesh } },
  utils: { deepClone: v => structuredClone(v), mergeObject: (a,b) => ({ ...structuredClone(a), ...b }) },
};
const savedSettings = new Map([['vfxEngine','sequencer']]);
globalThis.game = { user: { id:'gm', isGM:true }, time: { get serverTime() { return frozen ?? Date.now(); } }, settings: {
  get: (_module,key) => savedSettings.get(key),
  set: async (_module,key,value) => savedSettings.set(key,structuredClone(value)),
} };
globalThis.canvas = { app, scene, ready:true, tokens:overlay };
globalThis.ui = { notifications: { warn: text => { output.textContent += `\n${text}`; } } };
const fixtures = [];
const drawArt = portrait => {
  const g = new PIXI.Graphics();
  if (portrait) { g.beginFill(0x324962).drawCircle(48,64,45).endFill(); g.lineStyle(3,0xbdaf87).drawCircle(48,64,45); g.lineStyle(0); }
  g.beginFill(0xcea07c).drawCircle(48,portrait ? 47 : 22,portrait ? 16 : 12).endFill();
  g.beginFill(0xb8a427).drawRoundedRect(26,portrait ? 66 : 39,44,portrait ? 25 : 49,8).endFill();
  if (!portrait) {
    g.beginFill(0x485369).drawRoundedRect(29,85,15,39,4).drawRoundedRect(52,85,15,39,4).endFill();
    g.beginFill(0xcea07c).drawRoundedRect(18,48,9,37,4).drawRoundedRect(69,48,9,37,4).endFill();
  }
  g.beginFill(0xf1d68b).drawPolygon([57,portrait ? 69:44,54,portrait ? 78:53,61,portrait ? 78:53]).endFill();
  const texture = app.renderer.generateTexture(g, { region: new PIXI.Rectangle(0,0,96,128) });
  g.destroy(); return texture;
};
const art = [drawArt(false), drawArt(true)];
for (const [i,[type,preset]] of Object.entries(TRANSPORTER_SHADER_PRESETS).entries()) {
  const x = (i%3)*370+10, y = Math.floor(i/3)*210;
  const label = new PIXI.Text(preset.label,{fontFamily:'Arial',fontSize:15,fill:0xc2d9f2});
  label.position.set(x+12,y+10); primary.addChild(label);
  for (let j=0;j<2;j++) {
    const mesh = new PIXI.Sprite(art[j]); mesh.position.set(x+40+j*155,y+65);
    primary.addChild(mesh);
    const token = { id:`${type}-${j}`, w:96,h:128,alpha:1,visible:true,zIndex:1,mesh,
      document: { id:`${type}-${j}`,alpha:1,hidden:false,parent:scene },
      get center() { return {x:mesh.x+48,y:mesh.y+64}; },
    };
    fixtures.push({ token, type, framing:j?'portrait':'figure' });
  }
}
overlay.controlled = fixtures.slice(0,2).map(f => f.token);
function play(phase, midpoint = false, fraction = .475) {
  releaseTransporterShaders(); frozen = midpoint ? Date.now() : null;
  for (const {token,type,framing} of fixtures) {
    const duration = TRANSPORTER_SHADER_PRESETS[type].duration;
    playTransporterShader(token,type,{phase,preview:true,seed:72,startTime:(frozen ?? Date.now())-(midpoint?duration*fraction:0),settings:{...TRANSPORTER_SHADER_PRESETS[type],framing}});
  }
  output.textContent = `${midpoint?'Midpoint':'Playing '+phase}: ${fixtures.length} fixtures · PIXI ${PIXI.VERSION} · ${app.renderer.gl ? app.renderer.gl.getParameter(app.renderer.gl.VERSION) : 'Native fallback'}`;
}
document.querySelector('#in').onclick = () => play('in');
document.querySelector('#out').onclick = () => play('out');
document.querySelector('#half').onclick = () => play('out',true);
document.querySelector('#scrub').oninput = event => {
  const fraction=Number(event.target.value); document.querySelector('#scrub-value').value=`${Math.round(fraction*100)}%`;
  play('out',true,fraction);
};
document.querySelector('#stop').onclick = () => { releaseTransporterShaders(); frozen=null; output.textContent='Stopped — original token appearance restored.'; };
document.querySelector('#fallback').onclick = () => {
  const gl = app.renderer.gl;
  app.renderer.gl = null;
  try { play('out'); } finally { app.renderer.gl=gl; }
};
document.querySelector('#checks').onclick = async () => {
  releaseTransporterShaders(); frozen=100000;
  const assert = (condition, text) => { if (!condition) throw new Error(text); };
  let checks=0;
  try {
    app.renderer.render(app.stage); // ensure world transforms are current
    for (const {token,type,framing} of fixtures) for (const phase of ['in','out']) {
      for (const fraction of [0,.15,.32,.475,.6,.8,.99,...(type==='romulan'?[.1,.4,.7,.74]:[])]) {
        const duration=TRANSPORTER_SHADER_PRESETS[type].duration;
        const prior=token.mesh.alpha;
        const foreign = new PIXI.filters.ColorMatrixFilter(); token.mesh.filters=[foreign];
        const handle=playTransporterShader(token,type,{phase,preview:true,seed:72,startTime:frozen-duration*fraction,settings:{...TRANSPORTER_SHADER_PRESETS[type],framing}});
        assert(token.mesh.filters.length===2,`${type}: shader fell back`);
        if (type==='borg') assert(token.mesh.filters[1].uniforms.uStrands[0]>0,'Borg: missing strands');
        if (type==='romulan') assert(token.mesh.filters[1].uniforms.uField===1&&token.mesh.filters[1].uniforms.uStrands[0]===0,'Romulan: missing field');
        if (type==='dominion') assert(overlay.children[0].shader.uniforms.uHaze===1&&token.mesh.filters[1].uniforms.uHaze===1,'Dominion: missing haze');
        app.renderer.render(app.stage);
        assert(app.renderer.gl.getError()===app.renderer.gl.NO_ERROR,`${type}: GL error`);
        assert(Math.abs(token.mesh.filters[1].uniforms.uMatter-transporterTimeline(duration*fraction,duration,phase).matter)<.001,'timeline mismatch');
        handle.stop(); await handle.finished;
        assert(token.mesh.alpha===prior && token.mesh.filters[0]===foreign && token.mesh.filters.length===1,'appearance not restored');
        token.mesh.filters=[]; foreign.destroy(); checks++;
      }
    }
    assert(overlay.children.length===0,'overlay resources leaked');
    // Cylinder trajectories now run through the artwork alpha. Check movement,
    // repeatable seeded playback, and transparent/partially transparent pixels.
    const swirlMesh=new PIXI.Sprite(art[0]);primary.addChild(swirlMesh);
    const swirlToken={...fixtures[0].token,id:'swirl-alpha',mesh:swirlMesh,
      document:{...fixtures[0].token.document,id:'swirl-alpha'}};
    const sourcePixels=app.renderer.extract.pixels(swirlToken.mesh);
    const swirlHandle=playTransporterShader(swirlToken,'tosFed',{preview:true,seed:72,startTime:frozen-2700});
    const swirlFilter=swirlToken.mesh.filters[0];
    Object.assign(swirlFilter.uniforms,{uMatter:.5,uEnergy:1});
    const surface=app.renderer.extract.pixels(swirlToken.mesh);
    for(let i=3;i<surface.length;i+=4) if(sourcePixels[i]===0) assert(surface[i]===0,'token veil escaped artwork transparency');
    const cylinder=swirlFilter.uniforms;
    Object.assign(cylinder,{uTime:2.7,uEnergy:1});
    const swirlA=app.renderer.extract.pixels(swirlToken.mesh).slice();
    cylinder.uTime=3.05;
    const swirlB=app.renderer.extract.pixels(swirlToken.mesh).slice();
    cylinder.uTime=2.7;
    const swirlRepeat=app.renderer.extract.pixels(swirlToken.mesh);
    let changed=0;
    for(let i=0;i<swirlA.length;i++) {
      assert(swirlA[i]===swirlRepeat[i],'seeded swirl replay differs');
      if(Math.abs(swirlA[i]-swirlB[i])>8) changed++;
      if(i%4===3) {
        assert(swirlA[i]<=sourcePixels[i]+1&&swirlB[i]<=sourcePixels[i]+1,'particles exceeded artwork opacity');
        if(sourcePixels[i]===0) assert(swirlA[i]===0&&swirlB[i]===0,'particles escaped transparent artwork');
      }
    }
    assert(changed>40,`particle field is stationary: ${changed} changed channels in ${swirlA.length} values`);
    Object.assign(cylinder,{uParticleSpeed:0,uInnerParticleSpeed:0,uShimmer:0,uStaticAmount:0,uTime:2.7});
    const stopped=app.renderer.extract.pixels(swirlToken.mesh).slice();
    cylinder.uTime=3.05;
    const still=app.renderer.extract.pixels(swirlToken.mesh);
    assert(stopped.every((v,i)=>v===still[i]),'zero particle speed did not freeze movement');
    cylinder.uParticleSpeed=1;
    cylinder.uInnerParticleSpeed=1;
    const moving=app.renderer.extract.pixels(swirlToken.mesh);
    assert(stopped.some((v,i)=>Math.abs(v-moving[i])>8),'particle speed depends on shimmer speed');
    Object.assign(cylinder,{uNoiseStrength:0,uCoreIntensity:0});
    const noParticles=app.renderer.extract.pixels(swirlToken.mesh).slice();
    cylinder.uCoreIntensity=1;
    const innerOnly=app.renderer.extract.pixels(swirlToken.mesh).slice();
    assert(innerOnly.some((v,i)=>Math.abs(v-noParticles[i])>8),'inner cluster disappears when outer intensity is zero');
    // Compare the spatial spread of inner light at the size slider's extremes.
    const spread=pixels=>{
      let moment=0,weight=0;
      for(let i=0;i<pixels.length;i+=4) {
        const light=Math.max(...[0,1,2].map(c=>Math.abs(pixels[i+c]-noParticles[i+c])));
        if(light<8)continue;
        const x=(i/4)%96+.5-48,y=Math.floor(i/4/96)+.5-64;
        moment+=(x*x+y*y)*light;weight+=light;
        if(sourcePixels[i+3]===0)assert(pixels[i+3]===0,'resized cluster escaped artwork');
      }
      assert(weight>0,'resized inner cluster is invisible');return moment/weight;
    };
    cylinder.uInnerClusterSize=.25;
    const compact=app.renderer.extract.pixels(swirlToken.mesh).slice();
    cylinder.uInnerClusterSize=2;
    const expanded=app.renderer.extract.pixels(swirlToken.mesh);
    assert(spread(expanded)>spread(compact)*2,'inner cluster size did not expand its spread');
    cylinder.uInnerClusterSize=1;
    cylinder.uOuterDirection=-1;
    const innerUnaffected=app.renderer.extract.pixels(swirlToken.mesh);
    assert(innerUnaffected.every((v,i)=>v===innerOnly[i]),'outer direction changed inner particles');
    cylinder.uInnerDirection=-1;
    const innerReversed=app.renderer.extract.pixels(swirlToken.mesh);
    assert(innerReversed.some((v,i)=>Math.abs(v-innerOnly[i])>8),'inner direction did not reverse rotation');
    Object.assign(cylinder,{uOuterDirection:1,uInnerDirection:1});
    Object.assign(cylinder,{uNoiseStrength:1,uCoreIntensity:0});
    const outerOnly=app.renderer.extract.pixels(swirlToken.mesh).slice();
    assert(outerOnly.some((v,i)=>Math.abs(v-noParticles[i])>8),'outer cylinder disappears when inner intensity is zero');
    cylinder.uInnerClusterSize=2;
    const unchangedOuter=app.renderer.extract.pixels(swirlToken.mesh);
    assert(unchangedOuter.every((v,i)=>v===outerOnly[i]),'inner cluster size changed the outer cylinder');
    cylinder.uInnerClusterSize=1;
    cylinder.uInnerDirection=-1;
    const outerUnaffected=app.renderer.extract.pixels(swirlToken.mesh);
    assert(outerUnaffected.every((v,i)=>v===outerOnly[i]),'inner direction changed outer particles');
    cylinder.uOuterDirection=-1;
    const outerReversed=app.renderer.extract.pixels(swirlToken.mesh);
    assert(outerReversed.some((v,i)=>Math.abs(v-outerOnly[i])>8),'outer direction did not reverse rotation');
    Object.assign(cylinder,{uNoiseStrength:1,uCoreIntensity:1,uParticleSpeed:0,uInnerParticleSpeed:0});
    const reverseStopped=app.renderer.extract.pixels(swirlToken.mesh).slice();
    cylinder.uTime+=.4;
    const reverseStill=app.renderer.extract.pixels(swirlToken.mesh);
    assert(reverseStill.every((v,i)=>v===reverseStopped[i]),'reverse direction bypassed zero particle speed');
    for (const inner of [true,false]) {
      Object.assign(cylinder,{uNoiseStrength:inner?0:1,uCoreIntensity:inner?1:0,
        uParticleSpeed:inner?2:0,uInnerParticleSpeed:inner?0:2,uTime:2.7});
      const paused=app.renderer.extract.pixels(swirlToken.mesh).slice();
      cylinder.uTime=3.2;
      const unchanged=app.renderer.extract.pixels(swirlToken.mesh);
      assert(unchanged.every((v,i)=>v===paused[i]),`${inner?'inner':'outer'} particles moved at zero speed when the other layer was running`);
      cylinder[inner?'uInnerParticleSpeed':'uParticleSpeed']=1.3;
      const movingLayer=app.renderer.extract.pixels(swirlToken.mesh);
      assert(movingLayer.some((v,i)=>Math.abs(v-paused[i])>8),`${inner?'inner':'outer'} speed did not control its layer`);
    }
    Object.assign(cylinder,{uNoiseStrength:0,uCoreIntensity:0});
    const bothOff=app.renderer.extract.pixels(swirlToken.mesh);
    assert(bothOff.every((v,i)=>v===noParticles[i]),'zero intensities did not disable both particle layers');
    Object.assign(overlay.children[0].shader.uniforms,{uRainGain:0,uCircle:0});
    const outside=app.renderer.extract.pixels(overlay);
    assert(outside.every((v,i)=>i%4!==3||v===0),'particle cylinder remains on unmasked overlay');
    swirlHandle.stop();
    // Isolate the common static layer in all presets, including Borg, Romulan
    // and Dominion. It must twinkle even when particle travel/shimmer are paused.
    for(const type of Object.keys(TRANSPORTER_SHADER_PRESETS)) {
      const staticHandle=playTransporterShader(swirlToken,type,{preview:true,seed:72,startTime:frozen-2700});
      const u=swirlMesh.filters[0].uniforms;
      Object.assign(u,{uNoiseStrength:0,uCoreIntensity:0,uParticleSpeed:0,uShimmer:0,uMatter:.5,uEnergy:1,uScan:[1,0,0,0],uTime:2.7,uStaticAmount:.55});
      const a=app.renderer.extract.pixels(swirlMesh).slice();
      u.uTime=3.15;const b=app.renderer.extract.pixels(swirlMesh).slice();
      assert(a.some((v,i)=>Math.abs(v-b[i])>8),`${type}: static sparkles did not pop`);
      u.uTime=2.7;const repeated=app.renderer.extract.pixels(swirlMesh);
      assert(a.every((v,i)=>v===repeated[i]),`${type}: static sparkle replay differs`);
      for(let i=3;i<a.length;i+=4) if(sourcePixels[i]===0) assert(a[i]===0&&b[i]===0,`${type}: static sparkles escaped artwork`);
      u.uStaticAmount=0;const disabled=app.renderer.extract.pixels(swirlMesh).slice();
      u.uTime=3.15;const disabledLater=app.renderer.extract.pixels(swirlMesh);
      assert(disabled.every((v,i)=>v===disabledLater[i]),`${type}: disabled static sparkles still animated`);
      staticHandle.stop();
    }
    swirlMesh.destroy();
    // Rotate/reflect/nonuniformly scale and partially fade a token with another filter.
    const token=fixtures[0].token;
    token.mesh.rotation=.6; token.mesh.scale.set(-1.4,.8); token.mesh.alpha=.4; token.document.alpha=.4;
    const h=playTransporterShader(token,'tngFed',{preview:true,startTime:frozen-2500});
    app.renderer.render(app.stage); assert(app.renderer.gl.getError()===0,'transformed token GL error');
    h.stop(); assert(token.mesh.alpha===.4 && token.mesh.rotation===.6 && token.mesh.scale.x===-1.4,'transforms changed');
    token.mesh.rotation=0; token.mesh.scale.set(1); token.mesh.alpha=1; token.document.alpha=1;
    // With the luminous layer disabled, every source pixel must have the same
    // half opacity: this specifically rejects the old noisy cutout/dissolve.
    const flat=new PIXI.Sprite(PIXI.Texture.WHITE);flat.width=64;flat.height=64;primary.addChild(flat);
    const flatToken={...token,id:'flat-alpha',mesh:flat,w:64,h:64,document:{...token.document,id:'flat-alpha',alpha:1}};
    const flatHandle=playTransporterShader(flatToken,'tngFed',{preview:true,startTime:frozen-5600*.475,settings:{duration:5600}});
    flat.filters[0].uniforms.uEnergy=0;
    const pixels=app.renderer.extract.pixels(flat);
    for(let i=3;i<pixels.length;i+=4) assert(Math.abs(pixels[i]-128)<=1,'token fade contains holes or uneven alpha');
    flatHandle.stop();
    const fieldHandle=playTransporterShader(flatToken,'romulan',{preview:true,startTime:frozen-3000});
    Object.assign(flat.filters[0].uniforms,{uMatter:0,uEnergy:1,uScan:[.5,1,0,0]});
    const fieldPixels=app.renderer.extract.pixels(flat);
    // Extract works in the sprite's local texture dimensions, not its scale.
    const side=Math.sqrt(fieldPixels.length/4);
    assert(fieldPixels[(Math.floor(side*.25)*side+Math.floor(side*.5))*4+3]>0,'Romulan scan failed to establish field above scan');
    assert(fieldPixels[(Math.floor(side*.75)*side+Math.floor(side*.5))*4+3]===0,'Romulan field formed ahead of downward scan');
    fieldHandle.stop();flat.destroy();
    const form=document.querySelector('#form');
    const dominion=form.querySelector('[data-transporter-preset="dominion"]');
    const secondary=dominion.querySelector('[data-transporter-field="secondary"]');
    secondary.value='#c0b0ee';
    dominion.querySelector('[data-transporter-preview="in"]').click();
    assert(Math.abs(overlay.children[0].shader.uniforms.uSecondary[0]-192/255)<.001,'Dominion preview ignored secondary color');
    form.querySelector('[data-transporter-stop]').click();
    const preset=form.querySelector('[data-transporter-preset="tngFed"]');
    preset.querySelector('[data-transporter-field="noiseStrength"]').value='.95';
    const particleSpeed=preset.querySelector('[data-transporter-field="particleSpeed"]');
    const innerParticleSpeed=preset.querySelector('[data-transporter-field="innerParticleSpeed"]');
    assert(form.querySelectorAll('[data-transporter-field="innerParticleSpeed"]').length===8,'inner speed shown for a non-particle preset');
    innerParticleSpeed.value='2.4';
    const coreIntensity=preset.querySelector('[data-transporter-field="coreIntensity"]');
    const innerClusterSize=preset.querySelector('[data-transporter-field="innerClusterSize"]');
    assert(form.querySelectorAll('[data-transporter-field="innerClusterSize"]').length===8,'cluster size shown for a non-particle preset');
    innerClusterSize.value='175';
    const outerDirection=preset.querySelector('[data-transporter-field="outerDirection"]');
    const innerDirection=preset.querySelector('[data-transporter-field="innerDirection"]');
    assert(form.querySelectorAll('select[data-transporter-field="outerDirection"]').length===8,'outer direction controls missing or shown for non-particle presets');
    assert(form.querySelectorAll('select[data-transporter-field="innerDirection"]').length===8,'inner direction controls missing or shown for non-particle presets');
    outerDirection.value='counterclockwise';innerDirection.value='clockwise';
    assert(form.querySelectorAll('[data-transporter-field="coreIntensity"]').length===8,'inner intensity shown for a non-particle preset');
    coreIntensity.value='.25';
    const staticAmount=preset.querySelector('[data-transporter-field="staticAmount"]');
    const staticRate=preset.querySelector('[data-transporter-field="staticRate"]');
    assert(form.querySelectorAll('[data-transporter-field="staticAmount"]').length===presetCount,'static controls missing from a preset');
    staticAmount.value='.8';staticRate.value='2.5';
    assert(form.querySelectorAll('[data-transporter-field="particleSpeed"]').length===8,'particle speed shown for a non-particle preset');
    particleSpeed.value='.5';
    preset.querySelector('[data-transporter-field="color"]').value='#123456';
    preset.querySelector('[data-transporter-preview="in"]').click();
    assert(fixtures[0].token.mesh.filters[0].uniforms.uNoiseStrength===.95,'preview ignored unsaved form');
    assert(fixtures[0].token.mesh.filters[0].uniforms.uCoreIntensity===.25,'inner preview intensity is not independent');
    assert(fixtures[0].token.mesh.filters[0].uniforms.uInnerClusterSize===1.75,'preview ignored inner cluster size');
    assert(fixtures[0].token.mesh.filters[0].uniforms.uOuterDirection===-1&&fixtures[0].token.mesh.filters[0].uniforms.uInnerDirection===1,'preview ignored independent directions');
    assert(fixtures[0].token.mesh.filters[0].uniforms.uParticleSpeed===.5,'preview ignored particle speed');
    assert(fixtures[0].token.mesh.filters[0].uniforms.uInnerParticleSpeed===2.4,'preview ignored independent inner speed');
    assert(fixtures[0].token.mesh.filters[0].uniforms.uStaticAmount===.8&&fixtures[0].token.mesh.filters[0].uniforms.uStaticRate===2.5,'preview ignored static sparkle controls');
    assert(!savedSettings.has('transporterShaderAppearance'),'preview saved settings');
    form.querySelector('[data-transporter-stop]').click();
    assert(fixtures[0].token.mesh.alpha===1&&fixtures[0].token.document.alpha===1,'UI preview changed token');
    preset.querySelector('[data-transporter-reset]').click();
    assert(preset.querySelector('[data-transporter-field="noiseStrength"]').value==='0.65','reset did not restore preset');
    assert(particleSpeed.value==='1.5','reset did not restore particle speed');
    assert(innerParticleSpeed.value==='1.5','reset did not restore inner speed');
    innerParticleSpeed.value='0';
    assert(coreIntensity.value==='0.65','reset did not restore inner intensity');
    assert(innerClusterSize.value==='100','reset did not restore inner cluster size');
    innerClusterSize.value='150';
    assert(outerDirection.value==='clockwise'&&innerDirection.value==='clockwise','reset did not restore particle directions');
    outerDirection.value='clockwise';innerDirection.value='counterclockwise';
    coreIntensity.value='.35';
    assert(staticAmount.value==='0.55'&&staticRate.value==='1.5','reset did not restore static sparkle controls');
    staticAmount.value='.8';staticRate.value='2.5';
    particleSpeed.value='.7';
    const tmp=form.querySelector('[data-transporter-preset="tmpFed"]');
    const swipeHeight=tmp.querySelector('[data-transporter-field="swipeHeight"]');
    const swipeWidth=tmp.querySelector('[data-transporter-field="swipeWidth"]');
    assert(form.querySelectorAll('[data-transporter-field="swipeHeight"]').length===1,'TMP controls shown on another preset');
    for (const [height,width] of [[25,25],[200,300],[175,250]]) {
      swipeHeight.value=String(height);swipeWidth.value=String(width);
      tmp.querySelector('[data-transporter-preview="in"]').click();
      for (const quad of overlay.children) {
        assert(quad.shader.uniforms.uSwipeSize[0]===height/100&&quad.shader.uniforms.uSwipeSize[1]===width/100,'TMP preview ignored sliders');
        quad.shader.uniforms.uLines=[1,1,1];quad.shader.uniforms.uAlpha=1;
        assert(quad.height>=128*height/100,'TMP height clipped');
      }
      app.renderer.render(app.stage);assert(app.renderer.gl.getError()===0,'TMP slider extremes GL error');
      form.querySelector('[data-transporter-stop]').click();
    }
    form.querySelector('[data-transporter-engine]').value='shader';
    await saveTransporterShaderForm(form);
    assert(savedSettings.get('vfxEngine')==='shader'&&Object.keys(savedSettings.get('transporterShaderAppearance')).length===presetCount,'world settings form not saved');
    assert(savedSettings.get('transporterShaderAppearance').tngFed.particleSpeed===.7,'particle speed not saved');
    assert(savedSettings.get('transporterShaderAppearance').tngFed.innerParticleSpeed===0,'zero inner speed not saved');
    assert(savedSettings.get('transporterShaderAppearance').tngFed.coreIntensity===.35,'inner intensity not saved');
    assert(savedSettings.get('transporterShaderAppearance').tngFed.innerClusterSize===150,'inner cluster size not saved');
    assert(savedSettings.get('transporterShaderAppearance').tngFed.outerDirection==='clockwise'&&savedSettings.get('transporterShaderAppearance').tngFed.innerDirection==='counterclockwise','independent directions not saved');
    const savedDirections=transporterShaderForm().presets.find(p=>p.type==='tngFed').controls;
    assert(savedDirections.find(c=>c.key==='innerClusterSize').value===150,'reopened inner cluster size was lost');
    assert(savedDirections.find(c=>c.key==='innerParticleSpeed').value===0,'reopened inner speed was lost');
    assert(savedDirections.find(c=>c.key==='innerDirection').options.find(o=>o.selected).value==='counterclockwise','reopened direction selection was lost');
    assert(savedSettings.get('transporterShaderAppearance').tngFed.staticAmount===.8&&savedSettings.get('transporterShaderAppearance').tngFed.staticRate===2.5,'static sparkle controls not saved');
    preset.querySelector('[data-transporter-reset]').click();
    assert(savedSettings.get('transporterShaderAppearance').dominion.secondary==='#c0b0ee','Dominion secondary color not saved');
    dominion.querySelector('[data-transporter-reset]').click();assert(secondary.value==='#d9c7ff','Dominion secondary reset failed');
    assert(savedSettings.get('transporterShaderAppearance').tmpFed.swipeHeight===175&&savedSettings.get('transporterShaderAppearance').tmpFed.swipeWidth===250,'TMP slider values not saved');
    tmp.querySelector('[data-transporter-reset]').click();
    assert(swipeHeight.value==='100'&&swipeWidth.value==='100','TMP size reset failed');
    // The fixture settings store is private to this page; reset it for another run.
    savedSettings.delete('transporterShaderAppearance');savedSettings.set('vfxEngine','sequencer');form.querySelector('[data-transporter-engine]').value='sequencer';
    output.textContent=`PASS ${checks} shader frames (all ${presetCount} presets, both artworks/directions, extra Romulan scan milestones), swirl motion/masking/seed replay, uniform fade and scan reveal pixel checks, transformed artwork, filter preservation, cleanup, TMP size extremes, field/strand uniforms, unsaved UI preview, Stop, Reset, and settings Save. Installed Foundry QuadMesh/BaseShader and PIXI ${PIXI.VERSION}.`;
  } catch(error) { output.textContent=`FAIL after ${checks} frames: ${error.stack}`; }
  finally { releaseTransporterShaders(); frozen=null; }
};
Handlebars.registerHelper('ne',(a,b)=>a!==b);
const template=Handlebars.compile(await (await fetch('../templates/effect-config.hbs')).text());
document.querySelector('#form').innerHTML=template({tabs:[{id:'transporter',label:'Transporter',transporterShader:transporterShaderForm()}]});
wireTransporterShaderForm(document.querySelector('#form'));
output.textContent=`Ready · installed Foundry QuadMesh and AbstractBaseShader · PIXI ${PIXI.VERSION}`;
