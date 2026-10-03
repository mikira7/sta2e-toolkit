/** Persistent scene-flag driven warp-core coolant leak, replayed on every viewer. */
import { createLocalVolume } from "./console-cinematic-vfx.js";

const MODULE = "sta2e-toolkit";
export const COOLANT_LEAK_FLAG = "coolantLeak";
let live = null, liveKey = null;
const writes = new Map();
const bound = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.min(max, Math.max(min, Number(value))) : fallback;

export function getCoolantLeak(scene = globalThis.canvas?.scene) {
  const raw = scene?.getFlag(MODULE, COOLANT_LEAK_FLAG) ?? {};
  return { active: raw.active === true,
    x: Number.isFinite(raw.x) ? raw.x : null, y: Number.isFinite(raw.y) ? raw.y : null,
    size: bound(raw.size, 80, 20, 400), density: bound(raw.density, 1, .25, 2),
    speed: bound(raw.speed, 1, .2, 3),
    projection: raw.projection === "isometric" ? "isometric" : "top-down",
    angle: Number.isFinite(Number(raw.angle)) ? ((Number(raw.angle)%360)+360)%360 : 0,
    seed: bound(raw.seed, 1, 0, 4294967295), startedAt: bound(raw.startedAt, 0, 0, Number.MAX_SAFE_INTEGER) };
}

function editLeak(scene, edit) {
  if (!game.user?.isGM) return Promise.reject(new Error("Only the GM can control coolant leaks."));
  if (!scene) return Promise.reject(new Error("Open a scene first."));
  const operation = (writes.get(scene.id) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const next = edit(getCoolantLeak(scene));
    await scene.setFlag(MODULE, COOLANT_LEAK_FLAG, next);
    if (canvas?.ready && scene.id === canvas.scene?.id) syncCoolantLeak();
    return next;
  });
  writes.set(scene.id, operation);
  operation.then(() => { if (writes.get(scene.id) === operation) writes.delete(scene.id); },
    () => { if (writes.get(scene.id) === operation) writes.delete(scene.id); });
  return operation;
}

export function setCoolantLeakConfig(patch, scene = canvas?.scene) {
  return editLeak(scene, current => {
    const merged = { ...current, ...patch, active: current.active, seed: current.seed, startedAt: current.startedAt };
    if (("x" in patch || "y" in patch) && (!Number.isFinite(merged.x) || !Number.isFinite(merged.y))) {
      throw new Error("Pick a valid coolant-leak source on the canvas.");
    }
    return getCoolantLeak({ getFlag: () => merged });
  });
}

export function startCoolantLeak(scene = canvas?.scene) {
  return editLeak(scene, current => {
    if (!Number.isFinite(current.x) || !Number.isFinite(current.y)) throw new Error("Place a coolant-leak source first.");
    return { ...current, active: true, seed: current.active ? current.seed : Math.floor(Math.random()*4294967296),
      startedAt: current.active ? current.startedAt : Date.now() };
  });
}

export function stopCoolantLeak(scene = canvas?.scene) {
  return editLeak(scene, current => ({ ...current, active: false }));
}

export function clearCoolantLeakSource(scene = canvas?.scene) {
  return editLeak(scene, current => ({ ...current, active: false, x: null, y: null }));
}

// A cold turbulent jet widens into rolling vapor, with absorption and lighting
// integrated through its depth. Time advects density continuously rather than
// replaying a finite explosion or allocating new smoke particles every frame.
export const COOLANT_PLUME_SHADER = `
uniform float uTime, uSeed, uDensity, uRamp, uAngle, uMinX, uMinY, uWidth, uHeight, uIsometric;
float hash(vec3 p) {
  p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);
}
float noise(vec3 p) {
  vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p) {return noise(p)*.58+noise(p*2.03+17.0)*.28+noise(p*4.07+31.0)*.14;}
// Moving ellipsoidal billows have separate depth offsets. Their foreground
// surfaces absorb the rear layers and catch a directional key and rim light.
vec4 billowField(vec3 point) {
  float base=floor(point.y*6.0-uTime*.55);
  float distance=3.0;vec3 normal=vec3(0,0,1);
  for(int lobe=0;lobe<3;lobe++) {
    float id=base+float(lobe)-1.0;
    float h=(id+.5+uTime*.55)/6.0;
    float growth=clamp(h,0.0,1.0);
    float width=.045+.43*pow(growth,.7);
    float drift=(sin(h*8.0-uTime*.55+uSeed)*.11+sin(h*15.0-uTime*.35)*.05)*growth;
    float variation=hash(vec3(id,uSeed,.7));
    vec3 center=vec3(drift+sin(id*2.4+uSeed)*width*.18,h,sin(id*3.7+uSeed)*(.035+growth*.14));
    vec3 radii=vec3(width*(.78+variation*.25),.09+growth*.15,.09+growth*.39);
    vec3 q=(point-center)/radii;
    float d=length(q)-1.0;
    float weight=clamp(.5+.5*(distance-d)/.5,0.0,1.0);
    distance=mix(distance,d,weight)-.5*weight*(1.0-weight);
    normal=mix(normal,normalize(q/radii+vec3(.0001)),weight);
  }
  return vec4(normal,distance);
}
vec4 vaporVolume(vec2 world) {
  // Filters operate in screen-aligned bounds: rotate the sampled volume about
  // its source, not the filter quad, so diagonal jets keep their shape.
  float c=cos(uAngle),s=sin(uAngle);
  vec2 local=vec2(c*world.x+s*world.y,-s*world.x+c*world.y);
  float projectedHeight=-local.y/mix(4.0,3.0,uIsometric);
  if(projectedHeight<-.15 || projectedHeight>1.15)return vec4(0.0);
  float across=local.x/1.4;
  vec3 rgb=vec3(0.0);float alpha=0.0;
  for(int stepIndex=0;stepIndex<16;stepIndex++) {
    float z=.72-float(stepIndex)*.096;
    // An oblique camera projects depth onto the floor's vertical screen axis.
    // Sampling along this tilted ray preserves round billows above that floor.
    float height=projectedHeight+z*.18*uIsometric;
    if(height<0.0 || height>1.0)continue;
    float width=.045+.43*pow(height,.7);
    float drift=(sin(height*8.0-uTime*.55+uSeed)*.11+sin(height*15.0-uTime*.35)*.05)*height;
    if(abs(across-drift)>width*1.35)continue;
    float envelope=smoothstep(0.0,.025,height)*(1.0-smoothstep(.72,1.0,height));
    envelope*=1.0-smoothstep(uRamp*.9,uRamp*.9+.1,height);
    vec3 point=vec3(across,height,z);
    vec4 billow=billowField(point);
    vec3 flow=vec3(across*15.0,height*13.0-uTime*1.35,z*12.0)+vec3(uSeed*.013,0,0);
    flow.x+=sin(height*16.0-uTime*.9)*height*.65;
    float n=fbm(flow);
    float edge=1.0-smoothstep(-.16,.16,billow.w+(n-.5)*.32);
    float jet=exp(-pow((across-drift)/max(width*.42,.01),2.0)-pow(z/.1,2.0))*(1.0-smoothstep(.06,.3,height));
    float density=(edge+jet*.65)*envelope*(.35+1.25*smoothstep(.2,.75,n))*uDensity;
    if(density<.005)continue;
    float opacity=1.0-exp(-density*.46);
    vec3 normal=normalize(billow.xyz);
    vec3 lightDirection=normalize(vec3(-.55,.2,.8));
    float diffuse=max(0.0,dot(normal,lightDirection));
    float occlusion=1.0-smoothstep(-.2,.45,billowField(point+lightDirection*.09).w);
    float shadow=exp(-occlusion*.85)*(.65+.35*n);
    float rim=pow(1.0-abs(normal.z),2.0)*max(0.0,normal.x)*.32;
    vec3 vapor=vec3(.14,.21,.25)+vec3(.65,.72,.74)*(.12+.88*diffuse)*shadow;
    vapor+=vec3(.27,.47,.55)*rim+vec3(.06,.14,.18)*exp(-height*7.0);
    float transmission=1.0-alpha;rgb+=transmission*opacity*vapor;alpha+=transmission*opacity;
    if(alpha>.98)break;
  }
  return vec4(min(rgb,vec3(alpha)),alpha);
}
vec4 volume(vec2 p) {
  vec2 world=vec2(uMinX,uMinY)+(p*.5+.5)*vec2(uWidth,uHeight);
  vec4 vapor=vaporVolume(world);
  // The contact shadow stays in the map's floor plane when the jet rotates.
  float footprint=exp(-pow(world.x/.72,2.0)-pow((world.y-.08)/.23,2.0));
  float shadow=footprint*.22*uIsometric*uRamp*min(uDensity,1.5);
  return vapor+(1.0-vapor.a)*vec4(vec3(.025,.045,.06)*shadow,shadow);
}`;

export function coolantPlumeBounds(size, angle, projection = "top-down") {
  const radians=angle*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  const iso=projection==="isometric",top=iso?-3.5:-4,bottom=iso?.5:.25;
  const corners=[[-1.4,top],[1.4,top],[-1.4,bottom],[1.4,bottom]]
    .map(([x,y])=>({x:(c*x-s*y)*size,y:(s*x+c*y)*size}));
  if(iso)corners.push({x:-1.6*size,y:-.6*size},{x:1.6*size,y:.8*size});
  const x=Math.min(...corners.map(p=>p.x)),y=Math.min(...corners.map(p=>p.y));
  return {x,y,width:Math.max(...corners.map(p=>p.x))-x,height:Math.max(...corners.map(p=>p.y))-y};
}

function makePlume(state) {
  const angle=state.angle*Math.PI/180,bounds=coolantPlumeBounds(state.size,state.angle,state.projection);
  const volume = createLocalVolume({ body: COOLANT_PLUME_SHADER,
    uniforms: { uTime: 0, uSeed: state.seed % 10000, uDensity: state.density, uRamp: 1,
      uIsometric:state.projection==="isometric"?1:0,
      uAngle:angle,uMinX:bounds.x/state.size,uMinY:bounds.y/state.size,uWidth:bounds.width/state.size,uHeight:bounds.height/state.size },
    bounds });
  if (volume) return volume;
  const g = new PIXI.Graphics();
  g.rotation=angle;
  const circle = (x,y,r,color,alpha) => {
    if (Number.parseInt(PIXI.VERSION,10)<8 && g.beginFill) g.beginFill(color,alpha).drawCircle(x,y,r).endFill();
    else g.circle(x,y,r).fill({ color, alpha });
  };
  return { display: g, update({ uTime, uRamp }) {
    g.clear();
    for (let i=0;i<24;i++) {
      const h=((uTime*.14+i/24)%1), width=state.size*(.08+h*.6);
      if(h>uRamp)continue;
      const depth=Math.sin(i*3.7+state.seed)*width*.35;
      const x=Math.sin(i*2.39996+uTime*.5+state.seed)*width*.55,
        y=-h*state.size*(state.projection==="isometric"?3:4)+(state.projection==="isometric"?depth:0);
      const alpha=Math.sin(h*Math.PI)*state.density*.045;
      for(let band=5;band>0;band--) {
        circle(x,y,width*band/5,0x395864,alpha*1.2);
        circle(x-width*.22,y-width*.16,width*band/6,0xc7e2e8,alpha*.9);
        circle(x+width*.4,y,width*band/12,0x8fc9da,alpha*.3);
      }
    }
  }, destroy() { g.parent?.removeChild(g); g.destroy(); } };
}

/** Called on all clients: the scene flag, not a transient socket, is authoritative. */
export function syncCoolantLeak() {
  const state = getCoolantLeak(), scene = globalThis.canvas?.scene;
  if (!canvas?.ready || !scene || !state.active || !Number.isFinite(state.x) || !Number.isFinite(state.y)) {
    detachCoolantLeak(); return false;
  }
  const key = JSON.stringify([scene.id,state]);
  if (live && key === liveKey) return true;
  detachCoolantLeak();
  if (!globalThis.PIXI || !canvas.app?.ticker || !(canvas.interface ?? canvas.tokens)?.addChild) return false;
  const ticker=canvas.app.ticker, layer=canvas.interface ?? canvas.tokens;
  let plume;
  try {
    plume=makePlume(state);
    const display=plume.display;
    display.position.set(state.x,state.y);
    display.eventMode="none";display.zIndex=950000;
    layer.sortableChildren=true;layer.addChild(display);
    const tick=()=>{
      if (!canvas.ready || canvas.scene?.id!==scene.id || display.destroyed) { detachCoolantLeak();return; }
      const age=Math.max(0,(Date.now()-state.startedAt)/1000);
      try { plume.update({uTime:age*state.speed,uRamp:Math.min(1,age/2),uDensity:state.density}); }
      catch(error) { console.warn("STA2e Toolkit | Coolant plume stopped:",error);detachCoolantLeak(); }
    };
    live={plume,ticker,tick};liveKey=key;ticker.add(tick);tick();return true;
  } catch(error) { plume?.destroy();console.warn("STA2e Toolkit | Coolant plume failed:",error);return false; }
}

export function detachCoolantLeak() {
  const previous=live;live=null;liveKey=null;
  if (!previous)return;
  previous.ticker.remove(previous.tick);previous.plume.destroy();
}

export function registerCoolantLeakHooks() {
  Hooks.on("canvasReady",syncCoolantLeak);
  Hooks.on("canvasTearDown",detachCoolantLeak);
  Hooks.on("updateScene",(scene,changes)=>{
    const flags=changes.flags?.[MODULE];
    const changed=(flags && (COOLANT_LEAK_FLAG in flags || `-=${COOLANT_LEAK_FLAG}` in flags))
      || `flags.${MODULE}.${COOLANT_LEAK_FLAG}` in changes;
    if(scene.id===canvas.scene?.id && changed)syncCoolantLeak();
  });
}
