/** Native, clipped hazard fields and scene-scoped token bursts. */
import { getSceneZones } from './zone-data.js';
import { getRegionFeatures, regionHazardView } from './region-terrain.js';
import { regionPolygons } from './spawn-regions.js';
import { isActiveGM, ACTIVE_GM_CHANGED_HOOK } from './gm-authority.js';
import { createLocalVolume } from './console-cinematic-vfx.js';
import { HAZARD_VFX_TYPES, HAZARD_VFX_SUPPORTED, normalizeHazardVfx } from './hazard-vfx-config.js';

export const HAZARD_VFX_ACTION = 'hazardVfx';
const MODULE = 'sta2e-toolkit';
const fields = new Map(), bursts = new Set(), seen = new Set();
let registered = false, refreshTimer = null;

// World-space noise keeps detail at a consistent scale across differently sized
// Regions. Each branch has its own motion, silhouette, and light response.
export const HAZARD_SHADER = `
uniform float uTime, uKind, uIntensity, uR, uG, uB, uWidth, uHeight, uX, uY, uGrid, uBurst;
uniform float uArcX, uArcY, uArcRadius, uArcSeed;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
 vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec2 p) { float v=0.,a=.5; for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+7.1;a*=.5;} return v; }
// A leader advances segment-by-segment, with its own travel time and turns.
// Forks inherit the arrival time at their junction; nothing reveals by radius.
vec3 leaderNode(vec2 start,float heading,float seed,int count,float scale) {
 vec2 point=start; float arrival=0.,angle=heading;
 for(int j=0;j<10;j++) {
   if(j>=count) break;
   float k=float(j);
   angle=mix(angle,heading,.25)+(hash(vec2(seed,k))-.5)*1.7;
   point+=vec2(cos(angle),sin(angle))*(.045+.045*hash(vec2(k,seed+7.)))*scale;
   arrival+=.035+.065*hash(vec2(seed+31.,k));
 }
 return vec3(point,arrival);
}
float leaderDistance(vec2 p,vec2 start,float heading,float seed,float age,float scale) {
 float nearest=10.,arrival=0.,angle=heading;vec2 last=start;
 for(int j=0;j<10;j++) {
   float k=float(j),duration=.035+.065*hash(vec2(seed+31.,k));
   angle=mix(angle,heading,.25)+(hash(vec2(seed,k))-.5)*1.7;
   vec2 next=last+vec2(cos(angle),sin(angle))*(.045+.045*hash(vec2(k,seed+7.)))*scale;
   float progress=clamp((age-arrival)/duration,0.,1.);
   if(progress>0.) {
     vec2 edge=(next-last)*progress;
     float along=clamp(dot(p-last,edge)/max(dot(edge,edge),.00001),0.,1.);
     nearest=min(nearest,length(p-last-edge*along));
   }
   last=next;arrival+=duration;
 }
 return nearest;
}
// Faceted, shaded stone. Returned channels are coverage and surface brightness.
vec2 rockSurface(vec2 point,float seed,float spin) {
 float cs=cos(spin),sn=sin(spin);vec2 v=mat2(cs,-sn,sn,cs)*point;
 float sides=6.+floor(seed*3.),angle=atan(v.y,v.x)+seed*6.28;
 float sector=6.283185/sides;
 float edge=cos(3.14159/sides)/cos(mod(angle,sector)-sector*.5);
 edge*=.88+.12*sin(angle*3.+seed*29.);
 float radius=length(v),coverage=1.-smoothstep(edge-.035,edge+.035,radius);
 if(coverage<=0.)return vec2(0.);
 float grain=fbm(v*8.+seed*41.);
 vec3 normal=normalize(vec3(v,sqrt(max(.02,1.-radius*radius))));
 float light=.22+max(0.,dot(normal,normalize(vec3(-.6,-.7,1.))))*.8;
 float fissure=smoothstep(.02,.085,abs(noise(v*7.+seed*71.)-.5));
 return vec2(coverage,light*(.65+grain*.55)*(.58+fissure*.42));
}
vec4 volume(vec2 p) {
 vec2 uv=(p+1.)*.5;
 vec2 q=(vec2(uX,uY)+uv*vec2(uWidth,uHeight))/uGrid;
 float t=uTime, alpha=0.; vec3 tint=vec3(uR,uG,uB), col=tint;
 if(uKind<.5) {
   // Crossing swells and local eddies heave the surface in place. No constant
   // scroll vector: neighboring patches rise, fold, and sink at different times.
   float phase=fbm(q*.55)*6.283185;
   float swell=sin(dot(q,vec2(1.7,.8))-t*1.05+phase)*.44
     +sin(dot(q,vec2(-.9,2.1))+t*1.37)*.3
     +sin(dot(q,vec2(2.8,-1.6))-t*.79+phase*.5)*.18;
   vec2 orbitA=vec2(sin(t*.43),cos(t*.57))*.75;
   vec2 orbitB=vec2(cos(t*.71),sin(t*.39))*.6;
   vec2 eddy=vec2(fbm(q*1.2+orbitA),fbm(q*1.4+orbitB+17.))-.5;
   vec2 surface=q+eddy*.85+vec2(sin(t*.8+phase)*.14,swell*.35);
   float fold=fbm(surface*3.1+eddy*2.+orbitB*.35);
   float churn=fbm(surface*5.3-orbitA*.45);
   float crest=smoothstep(-.1,.75,swell+churn*.35);
   float flame=smoothstep(.25,.78,fold+crest*.2);
   float hot=pow(flame,4.)*(.35+crest*.65);
   col=mix(tint*(.4+flame*.4),vec3(1.,.88,.47),hot*.85);
   alpha=flame*(.56+crest*.22);
   vec2 emberField=surface*7.+eddy*.6;
   vec2 cell=floor(emberField),spark=fract(emberField)-.5;
   float flicker=smoothstep(.2,.9,.5+.5*sin(t*3.7+hash(cell)*19.));
   float ember=(1.-smoothstep(.015,.1,length(spark)))*step(.96,hash(cell))*flicker;
   col+=vec3(1.,.55,.14)*ember;alpha+=ember*.7;
 } else if(uKind<1.5) {
   vec2 world=vec2(uX,uY)+uv*vec2(uWidth,uHeight);
   vec2 local=(world-vec2(uArcX,uArcY))/max(uArcRadius,1.);
   float eventTime=mod(t,2.4), seed=uArcSeed;
   if(uBurst>.5) {local=p;seed=hash(vec2(uX,uY))*317.;eventTime=t;}
   float charge=smoothstep(0.,.18,eventTime)*(1.-smoothstep(.25,.55,eventTime));
   float core=0.,glow=0.;
   float width=uBurst>.5 ? max(.014,2.4/uWidth) : .01;
   // Unevenly spaced leaders launch at different times and fork independently.
   // No rings, cross-links, or expanding circular reveal.
   for(int i=0;i<5;i++) {
     float k=float(i),s=seed+k*43.7;
     float angle=hash(vec2(seed,k))*6.283185;
     float speed=.85+hash(vec2(s,2.))*.7;
     float age=(eventTime-.18-hash(vec2(s,3.))*.24)*speed;
     float d=leaderDistance(local,vec2(0.),angle,s,age,1.);
     vec3 junction=leaderNode(vec2(0.),angle,s,3,1.);
     float forkAngle=angle+(hash(vec2(s,4.))>.5?1.:-1.)*(.55+hash(vec2(s,5.)));
     float forks=leaderDistance(local,junction.xy,forkAngle,s+91.,age-junction.z,.65);
     vec3 junction2=leaderNode(vec2(0.),angle,s,6,1.);
     forks=min(forks,leaderDistance(local,junction2.xy,angle-1.,s+173.,age-junction2.z,.4));
     float flash=(.75+.25*sin(t*37.+s))*(1.-smoothstep(1.35,1.95,eventTime));
     core=max(core,(exp(-d/width)+exp(-forks/(width*.6))*.7)*flash);
     glow=max(glow,(exp(-d/(width*4.5))*.45+exp(-forks/(width*3.))*.22)*flash);
   }
   float radius=length(local);
   float orb=exp(-radius*radius/.012)*charge;
   float halo=exp(-radius*radius/.12)*charge*.38;
   alpha=(core+glow+orb+halo)*(1.-smoothstep(.94,1.,radius));
   col=mix(tint,vec3(.94,.98,1.),clamp(core+orb,0.,1.));
 } else if(uKind<2.5) {
   // Slowly advected translucent haze, without scanning bands or sharp motes.
   vec2 drift=vec2(t*.045,-t*.035);
   vec2 warp=vec2(fbm(q*.65+drift),fbm(q*.8-drift));
   float mist=fbm(q*1.35+warp*1.8+drift);
   float veil=fbm(q*.55-drift*.6);
   float haze=.08+smoothstep(.2,.8,mist)*.27+veil*.08;
   float orbs=0.,bloom=0.;
   vec2 cell=floor(q);
   // Neighboring cells contribute their glow across cell boundaries. Each orb
   // fades fully out before its next randomized position and size are chosen.
   for(int iy=-1;iy<=1;iy++) for(int ix=-1;ix<=1;ix++) {
     vec2 id=cell+vec2(float(ix),float(iy));
     float seed=hash(id+7.3), clock=t/(2.2+seed*2.8)+seed*9.;
     float cycle=floor(clock), phase=fract(clock);
     float presence=smoothstep(.04,.26,phase)*(1.-smoothstep(.57,.86,phase));
     vec2 center=id+.18+.64*vec2(hash(id+cycle*13.7),hash(id+cycle*17.3+41.));
     center+=vec2(sin(t*.5+seed*13.),cos(t*.4+seed*17.))*.045;
     float size=.055+.065*hash(id+cycle+82.);
     float dist2=dot(q-center,q-center);
     orbs+=exp(-dist2/(size*size))*presence*.85;
     bloom+=exp(-dist2/(size*size*7.))*presence*.24;
   }
   alpha=haze+orbs+bloom;
   col=mix(tint*(.65+mist*.3),mix(tint,vec3(.88,1.,.9),.65),clamp(orbs,0.,1.));
 } else if(uKind<3.5) {
   vec2 warp=vec2(fbm(q*1.1+vec2(t*.09,0)),fbm(q*1.3-vec2(0,t*.08)));
   float n=fbm(q*2.+warp*2.-vec2(t*.18,t*.05));
   float wisps=fbm(q*5.+warp*3.+vec2(t*.1,0));
   alpha=smoothstep(.22,.75,n)*.72;
   col=tint*(.35+n*.8+wisps*.25);
 } else if(uKind<4.5) {
   // Billowing plasma banks with lightning threading through the hot crests.
   vec2 eddy=vec2(fbm(q*.8+vec2(sin(t*.35),cos(t*.4))),fbm(q*.9+vec2(cos(t*.3),sin(t*.5))+31.));
   float cloud=fbm(q*1.7+eddy*2.5+vec2(sin(t*.6),cos(t*.43))*.35);
   float crest=smoothstep(.35,.78,cloud);
   float seed=uArcSeed;
   vec2 world=vec2(uX,uY)+uv*vec2(uWidth,uHeight);
   vec2 local=(world-vec2(uArcX,uArcY))/max(uArcRadius,1.);
   float age=mod(t,2.4);
   float angle=hash(vec2(seed,4.))*6.283185;
   float bolt=leaderDistance(local,vec2(0.),angle,seed,age*2.,1.);
   bolt=min(bolt,leaderDistance(local,vec2(0.),angle+2.,seed+41.,age*1.7,1.));
   float flash=smoothstep(.08,.15,age)*(1.-smoothstep(.65,1.3,age));
   float arc=exp(-bolt/.013)*flash,glow=exp(-bolt/.07)*flash*.35;
   if(uBurst>.5) {
     bolt=leaderDistance(p,vec2(0.),hash(vec2(uX,uY))*6.28,7.,t*2.,1.2);
     arc+=exp(-bolt/.02)*(.7+.3*sin(t*27.));
   }
   alpha=.08+crest*.64+arc+glow;
   col=mix(tint*(.55+cloud*.9),vec3(.85,.8,1.),clamp(arc+crest*.15,0.,1.));
 } else if(uKind<5.5 || uKind>6.5) {
   bool falling=uKind>6.5;
   vec3 stone=vec3(0.);float coverage=0.,dust=0.;
   if(uBurst>.5) {
     // A local impact ejects fragments from the token, then leaves fading dust.
     for(int i=0;i<9;i++) {
       float k=float(i),seed=hash(vec2(k,uX+uY)),angle=seed*6.283185;
       float travel=(.1+t*.6)*( .5+hash(vec2(k,11.))*.5);
       vec2 center=vec2(cos(angle),sin(angle))*travel;
       float size=(.035+hash(vec2(k,23.))*.07)*(1.-min(t/2.,.9));
       vec2 rock=rockSurface((p-center)/size,seed,t*(seed-.5)*5.);
       stone=mix(stone,tint*rock.y,rock.x);coverage=max(coverage,rock.x);
     }
     float r=length(p),front=.12+t*.3;
     dust=exp(-pow((r-front)/(.12+t*.09),2.))*(1.-t/2.)*.75;
     dust*=.45+fbm(p*7.+t*.25);
     dust+=exp(-dot(p,p)/(.035+t*.06))*exp(-t*4.)*.85;
   } else {
     vec2 space=falling?q*.75:q*.75-vec2(t*.055,t*.023);
     vec2 cell=floor(space);
     for(int iy=-1;iy<=1;iy++)for(int ix=-1;ix<=1;ix++) {
       vec2 id=cell+vec2(float(ix),float(iy));float seed=hash(id+19.);
       vec2 center=id+.2+.6*vec2(hash(id),hash(id+7.));
       float size=.065+seed*.16,fade=1.;
       vec2 relative=space-center;
       float phase=fract(t/(2.7+seed*2.)+seed*9.);
       if(falling) {
         float drop=smoothstep(.12,.48,phase);
         relative-=vec2((seed-.5)*.22,-.7*(1.-drop));
         size*=.35+drop*.65;
         fade=smoothstep(.04,.12,phase)*(1.-smoothstep(.5,.63,phase));
         float impact=smoothstep(.46,.5,phase)*(1.-smoothstep(.55,.94,phase));
         float r=length(space-center),spread=.08+max(0.,phase-.46)*.9;
         dust+=exp(-pow(r/spread,2.))*impact*.38*(.6+noise(space*15.)*.4);
       } else {
         relative-=vec2(sin(t*(.09+seed*.08)+seed*17.),cos(t*.11+seed*21.))*.16;
       }
       vec2 rock=rockSurface(relative/size,seed,t*(seed-.5)*.55);rock.x*=fade;
       stone=mix(stone,tint*rock.y,rock.x);coverage=max(coverage,rock.x);
     }
   }
   alpha=coverage*.94+dust;
   col=(stone*coverage+tint*dust*.75)/max(coverage+dust,.001);
 } else {
   // Deep, slow nebula layers: diffuse banks and luminous filaments.
   vec2 warp=vec2(fbm(q*.55+vec2(t*.025,0)),fbm(q*.7+vec2(0,-t*.032))+ .1);
   float bank=fbm(q*.95+warp*3.);
   float detail=fbm(q*3.1+warp*2.+vec2(sin(t*.12),cos(t*.15))*.3);
   float filament=pow(max(0.,1.-abs(detail-.5)*4.),5.)*smoothstep(.4,.7,bank);
   alpha=smoothstep(.16,.82,bank)*.7+filament*.18;
   col=mix(tint*.5,mix(tint,vec3(.4,.8,.95),.38),smoothstep(.3,.72,bank));
   col+=filament*.25;
   if(uBurst>.5) {
     float curl=fbm(p*2.8+vec2(sin(t*.7),cos(t*.9))*.5);
     alpha=max(alpha,.25+curl*.45);
     col=mix(tint*.65,mix(tint,vec3(.5,.85,1.),.4),curl);
   }
 }
 float envelope=uBurst>.5 ? (1.-smoothstep(.45,1.,length(p)))*sin(min(1.,t/2.)*3.14159) : 1.;
 if(uBurst>.5 && uKind>.5 && uKind<1.5) {
   envelope=(1.-smoothstep(.82,1.,length(p)))*smoothstep(0.,.06,t)*(1.-smoothstep(1.65,2.,t));
 }
 alpha=clamp(alpha*uIntensity*envelope,0.,.88);
 return vec4(col*alpha,alpha);
}`;

export function polygonBounds(polygons) {
  const pts = polygons.flat().filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) return null;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  const width = Math.max(...xs) - x, height = Math.max(...ys) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** Positive distance inside the even-odd shape; negative in holes/outside. */
export function hazardInteriorDistance(point, polygons) {
  let inside = false, distance = Infinity;
  for (const poly of polygons) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      distance = Math.min(distance, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
    }
  }
  return inside ? distance : -distance;
}

/** Precompute safe origins once per reshape; no polygon work in the ticker. */
export function electricalOrigins(polygons, bounds, grid = 100) {
  const candidates = [];
  // A low-discrepancy sequence covers narrow and disconnected shapes reliably.
  for (let i = 1; i <= 1024; i++) {
    const x = bounds.x + ((i * .754877666) % 1) * bounds.width;
    const y = bounds.y + ((i * .569840296) % 1) * bounds.height;
    const clearance = hazardInteriorDistance({ x, y }, polygons);
    if (clearance > 0) candidates.push({ x, y, clearance });
  }
  const deepest = candidates.reduce((max, p) => Math.max(max, p.clearance), 0);
  // Narrow shapes use their deepest interior instead of an impossible fixed inset.
  const inset = Math.min(grid * .65, deepest * .75);
  return candidates.filter(p => p.clearance >= inset).map(p => ({
    ...p, radius: Math.min(grid * 2, p.clearance * .9),
  }));
}

/** Canvas even-odd fill preserves concavity, disjoint islands and Region holes. */
function makeMask(polygons, b) {
  const image = document.createElement('canvas');
  const scale = Math.min(1, 1536 / Math.max(b.width, b.height));
  image.width = Math.max(1, Math.ceil(b.width * scale));
  image.height = Math.max(1, Math.ceil(b.height * scale));
  const ctx = image.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale); ctx.translate(-b.x, -b.y);
  ctx.beginPath();
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    ctx.moveTo(poly[0].x, poly[0].y);
    for (const p of poly.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
  }
  ctx.fillStyle = '#ffffff'; ctx.fill('evenodd');
  const texture = PIXI.Texture.from(image), display = new PIXI.Sprite(texture);
  display.position.set(b.x, b.y); display.width = b.width; display.height = b.height;
  return { display, destroy() { display.parent?.removeChild(display); display.destroy(); texture.destroy(true); } };
}

function createEffect(type, config, bounds, polygons = null) {
  const parent = canvas?.interface ?? canvas?.stage, ticker = canvas?.app?.ticker;
  if (!parent || !ticker) return null;
  const color = parseInt(config.color.slice(1), 16);
  const hasLightning = type === 'electrical' || type === 'plasma-storm';
  const origins = hasLightning && polygons ? electricalOrigins(polygons, bounds, canvas.grid?.size ?? 100) : [];
  if (hasLightning && polygons && !origins.length) return null;
  const originSeed = Math.floor(Math.abs(Math.sin(bounds.x * .013 + bounds.y * .071)) * 10000);
  const arcUniforms = epoch => {
    const index = Math.floor(((epoch * .618033989 + originSeed * .754877666) % 1) * origins.length);
    const point = origins[index];
    return { uArcX: point?.x ?? 0, uArcY: point?.y ?? 0, uArcRadius: point?.radius ?? 1, uArcSeed: originSeed + epoch * 17.31 + 5.7 };
  };
  const uniforms = { uTime: 0, uKind: Object.keys(HAZARD_VFX_TYPES).indexOf(type), uIntensity: config.intensity,
    uR: ((color >> 16) & 255) / 255, uG: ((color >> 8) & 255) / 255, uB: (color & 255) / 255,
    uWidth: bounds.width, uHeight: bounds.height, uX: bounds.x, uY: bounds.y,
    uGrid: canvas.grid?.size ?? 100, uBurst: polygons ? 0 : 1, ...arcUniforms(0) };
  const volume = createLocalVolume({ body: HAZARD_SHADER, uniforms, bounds, stableCoordinates: true });
  if (!volume) return null;
  const root = new PIXI.Container(); root.eventMode = 'none';
  root.addChild(volume.display);
  const mask = polygons ? makeMask(polygons, bounds) : null;
  if (polygons && !mask) { volume.destroy(); root.destroy(); return null; }
  if (mask) { root.addChild(mask.display); volume.display.mask = mask.display; }
  parent.addChild(root);
  let elapsed = 0, destroyed = false, arcEpoch = 0;
  const effect = { root,
    destroy() {
      if (destroyed) return;
      destroyed = true; ticker.remove(tick); bursts.delete(effect);
      volume.display.mask = null; volume.destroy(); mask?.destroy();
      root.parent?.removeChild(root); root.destroy({ children: true });
    } };
  const tick = () => {
    if (config.mode === 'gm' && !isActiveGM()) { effect.destroy(); return; }
    elapsed += Math.min(ticker.deltaMS ?? 16.67, 100) / 1000;
    const epoch = Math.floor(elapsed / 2.4);
    volume.update({ uTime: elapsed, ...(origins.length && epoch !== arcEpoch ? arcUniforms(epoch) : {}) });
    arcEpoch = epoch;
    if (!polygons && elapsed >= 2) effect.destroy();
  };
  ticker.add(tick);
  return effect;
}

export function collectHazardFields(scene = canvas?.scene) {
  if (!scene) return [];
  const out = [];
  const add = (key, hazard, polygons) => {
    if (!Object.hasOwn(HAZARD_VFX_TYPES, hazard.type)) return;
    const config = normalizeHazardVfx(hazard.vfx, hazard.type);
    if (config.mode !== 'all' && !(config.mode === 'gm' && isActiveGM())) return;
    const bounds = polygonBounds(polygons);
    if (bounds) out.push({ key, type: hazard.type, config, bounds, polygons });
  };
  if (scene.getFlag(MODULE, 'zonesEnabled') !== false) {
    for (const z of getSceneZones(scene)) for (const h of z.hazards ?? []) add(`z:${z.id}:${h.id}`, h, [z.vertices ?? []]);
  }
  for (const f of getRegionFeatures(scene, 'hazard')) {
    add(`r:${f.region.id}:${f.behavior.id}`, regionHazardView(f), regionPolygons(f.region));
  }
  return out;
}

export function syncHazardFields() {
  if (!canvas?.ready) return;
  const wanted = new Set();
  for (const entry of collectHazardFields()) {
    wanted.add(entry.key);
    const signature = JSON.stringify(entry);
    if (fields.get(entry.key)?.signature === signature) continue;
    fields.get(entry.key)?.effect.destroy(); fields.delete(entry.key);
    const effect = createEffect(entry.type, entry.config, entry.bounds, entry.polygons);
    if (effect) fields.set(entry.key, { signature, effect });
  }
  for (const [key, value] of fields) if (!wanted.has(key)) { value.effect.destroy(); fields.delete(key); }
}

export function clearHazardVfx() {
  clearTimeout(refreshTimer); refreshTimer = null;
  for (const value of fields.values()) value.effect.destroy();
  fields.clear();
  for (const effect of [...bursts]) effect.destroy();
  seen.clear();
}

export function handleHazardVfxSocket(msg) {
  if (msg?.action !== HAZARD_VFX_ACTION || !game.users?.get(msg.userId)?.isGM) return false;
  if (!canvas?.ready || msg.sceneId !== canvas.scene?.id || !Object.hasOwn(HAZARD_VFX_TYPES, msg.type)) return false;
  if (seen.has(msg.id)) return false;
  seen.add(msg.id); if (seen.size > 256) seen.delete(seen.values().next().value);
  const config = normalizeHazardVfx(msg.config, msg.type);
  if (config.mode === 'off' || (config.mode === 'gm' && !isActiveGM())) return false;
  const token = canvas.tokens?.get(msg.tokenId);
  // Never advertise a hidden token to another viewer.
  if (!token || (!isActiveGM() && (token.document?.hidden || token.visible === false))) return false;
  const size = Math.max(token.w ?? 100, token.h ?? 100) * 1.8;
  const cx = token.center?.x ?? token.x + (token.w ?? 100) / 2;
  const cy = token.center?.y ?? token.y + (token.h ?? 100) / 2;
  const effect = createEffect(msg.type, config, { x: cx - size / 2, y: cy - size / 2, width: size, height: size });
  if (effect) bursts.add(effect);
  if (config.sound) {
    const key = { fire: 'sndHazardFire', electrical: 'sndHazardElectrical', radiation: 'sndHazardRadiation', 'toxic-gas': 'sndHazardToxicGas',
      'plasma-storm': 'sndHazardPlasmaStorm', 'asteroid-field': 'sndHazardAsteroid', 'nebula-gas': 'sndHazardNebula', 'falling-rocks': 'sndHazardFallingRocks' }[msg.type];
    const src = game.settings.get(MODULE, key);
    if (src) {
      const helper = globalThis.foundry?.audio?.AudioHelper ?? globalThis.AudioHelper;
      Promise.resolve(helper?.play({ src, volume: .7, autoplay: true, loop: false }, false)).catch(console.warn);
    }
  }
  return !!effect;
}

export function broadcastHazardVfx(token, type, vfx) {
  if (!Object.hasOwn(HAZARD_VFX_TYPES, type)) return false;
  if (!game.user?.isGM || !canvas?.scene) return true;
  const config = normalizeHazardVfx(vfx, type);
  if (config.mode === 'off') return true;
  const msg = { action: HAZARD_VFX_ACTION, id: crypto.randomUUID(), userId: game.user.id,
    sceneId: canvas.scene.id, tokenId: token.id, type, config };
  handleHazardVfxSocket(msg);
  game.socket.emit(`module.${MODULE}`, msg);
  return true;
}

/** Local preview never changes hazard state, spends Threat, or emits a socket. */
export function previewHazardVfx(type, vfx) {
  if (!game.user?.isGM) return false;
  if (!Object.hasOwn(HAZARD_VFX_TYPES, type)) {
    ui.notifications.info(`Native effects: ${HAZARD_VFX_SUPPORTED}.`);
    return false;
  }
  const token = canvas?.tokens?.controlled?.[0];
  if (!token) { ui.notifications.info('Select a token to preview the hazard effect.'); return false; }
  return handleHazardVfxSocket({ action: HAZARD_VFX_ACTION, id: crypto.randomUUID(), userId: game.user.id,
    sceneId: canvas.scene.id, tokenId: token.id, type, config: { ...vfx, mode: 'trigger' } });
}

export function registerHazardVfxHooks() {
  if (registered) return;
  registered = true;
  const refresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => {
    refreshTimer = null;
    try { syncHazardFields(); } catch (err) { console.warn('STA2e Toolkit | Hazard effects refresh failed:', err); }
  }, 50); };
  Hooks.on('canvasReady', refresh);
  Hooks.on('canvasTearDown', clearHazardVfx);
  Hooks.on('updateScene', (scene) => { if (scene.id === canvas?.scene?.id) refresh(); });
  for (const event of ['createRegion', 'updateRegion', 'deleteRegion', 'createRegionBehavior', 'updateRegionBehavior', 'deleteRegionBehavior']) Hooks.on(event, refresh);
  Hooks.on(ACTIVE_GM_CHANGED_HOOK, refresh);
  Hooks.on('updateUser', refresh);
  refresh();
}
