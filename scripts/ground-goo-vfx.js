/** Medical shotgun: a glossy blue gel glob followed by a wet, spreading splat. */
import { nativeVfxContainer, playNativeVfxSound } from "./native-weapon-vfx.js";

export const GROUND_GOO_VFX_ACTION = "groundGooVfx";
const active = new Set();
const PALETTES = Object.freeze({
  blue: {tail:0x67b9df,orb:0x397da9,core:0x83d4e9,shine:0xe1f7fa,
    patch:0x438ebd,wet:0x79cce4,glint:0xdbf7fa,droplet:0x77c8e5,drip:0x65b6d9},
  toxic: {tail:0xb464e3,orb:0x713096,core:0xc878ed,shine:0xf5ddff,
    patch:0x863bb2,wet:0xb968df,glint:0xf0d2ff,droplet:0xc178e8,drip:0xa253ce},
});
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const point = p => Number.isFinite(p?.x) && Number.isFinite(p?.y) ? {x:p.x,y:p.y} : null;
function center(token) {
  if (point(token?.center)) return point(token.center);
  const d = token?.document ?? token, grid = globalThis.canvas?.grid?.size ?? 100;
  return point({x:d?.x + (token?.w ?? (d?.width ?? 1)*grid)/2,
    y:d?.y + (token?.h ?? (d?.height ?? 1)*grid)/2});
}

export async function fireGroundGooVFX(config, isHit, token, targets, {deadly = false} = {}) {
  if (config?.type !== "ground-goo" || !globalThis.PIXI || !globalThis.canvas?.ready) return false;
  const source = center(token), grid = canvas.grid?.size ?? 100;
  if (!source) return false;
  const ends = Array.from(targets ?? []).filter(t => center(t)).slice(0,64).map((t,i) => {
    const at = center(t), radius = Math.max(t.w ?? grid,t.h ?? grid)*.28;
    if (!isHit) {
      const bearing = Math.atan2(at.y-source.y,at.x-source.x), side = i%2 ? -1 : 1;
      at.x += -Math.sin(bearing)*grid*.75*side + Math.cos(bearing)*grid*.35;
      at.y += Math.cos(bearing)*grid*.75*side + Math.sin(bearing)*grid*.35;
    }
    return {...at,radius};
  });
  if (!source || !ends.length) return false;
  const msg = {action:GROUND_GOO_VFX_ACTION, sceneId:token?.document?.parent?.id ?? canvas.scene?.id,
    sourcePoint:source,targetPoints:ends,grid,hit:!!isHit,deadly:deadly === true};
  const playback = playGroundGooVfxFromSocket(msg);
  if (!playback) return false;
  playNativeVfxSound(isHit ? config.sound : config.missSound ?? config.sound);
  try { game.socket?.emit?.("module.sta2e-toolkit",msg); }
  catch(err) { console.warn("STA2e Toolkit | Goo broadcast failed:",err); }
  await playback;
  return true;
}

function blob(g, x, y, rx, ry, color, alpha, phase = 0, lobes = 0) {
  const points = Array.from({length:49},(_,i) => {
    const angle=i/48*Math.PI*2;
    const wobble=1 + Math.sin(angle*5+phase)*.055 + Math.sin(angle*9+phase)*lobes;
    return [x+Math.cos(angle)*rx*wobble,y+Math.sin(angle)*ry*wobble];
  }).flat();
  if (g.beginFill) g.beginFill(color,alpha).drawPolygon(points).endFill();
  else g.poly(points).fill({color,alpha});
}

export function playGroundGooVfxFromSocket(msg = {}) {
  if (!globalThis.PIXI || !globalThis.canvas?.ready || !canvas.app?.ticker || msg.sceneId!==canvas.scene?.id) return false;
  const source=point(msg.sourcePoint);
  const ends=Array.isArray(msg.targetPoints) ? msg.targetPoints.slice(0,64).filter(p=>point(p)) : [];
  if (!source || !ends.length) return false;
  const grid=Number.isFinite(msg.grid) ? clamp(msg.grid,10,1000) : 100;
  return Promise.all(ends.map(end=>drawGoo(source,end,grid,msg.hit===true,
    msg.deadly === true ? PALETTES.toxic : PALETTES.blue)));
}

function drawGoo(source,end,grid,hit,palette) {
  const root=nativeVfxContainer(end.y,"above");
  if (!root) return Promise.resolve(false);
  const orb=new PIXI.Graphics(), splat=new PIXI.Graphics(); root.addChild(orb,splat);
  const travel=clamp(Math.hypot(end.x-source.x,end.y-source.y)/grid*110,260,850);
  const duration=travel+(hit ? 1400 : 180);
  const radius=Number.isFinite(end.radius) ? clamp(end.radius,grid*.1,grid*2) : grid*.28;
  let elapsed=0, previous=performance.now(), stopped=false, timer, resolve;
  const done=new Promise(r=>{resolve=r;});
  const ticker=canvas.app.ticker, sceneId=canvas.scene.id;
  const dispose=()=>{
    if(stopped) return;
    stopped=true; active.delete(dispose); ticker.remove(tick); clearTimeout(timer);
    if(!root.destroyed) root.destroy({children:true}); resolve(true);
  };
  const flight = u => ({x:source.x+(end.x-source.x)*u,
    y:source.y+(end.y-source.y)*u-Math.sin(Math.PI*u)*grid*.16});
  const draw=()=>{
    orb.clear(); splat.clear();
    if(elapsed<travel) {
      const u=elapsed/travel, at=flight(u), r=grid*.105;
      for(let i=3;i>0;i--) {
        const tail=flight(Math.max(0,u-i*.045));
        blob(orb,tail.x,tail.y,r*(1-i*.2),r*(1-i*.2),palette.tail,.25*(1-i*.18),elapsed*.01);
      }
      blob(orb,at.x,at.y,r*1.08,r*.95,palette.orb,.95,elapsed*.016);
      blob(orb,at.x-r*.08,at.y-r*.1,r*.82,r*.75,palette.core,.9,elapsed*.016);
      blob(orb,at.x-r*.26,at.y-r*.32,r*.32,r*.2,palette.shine,.85);
      return;
    }
    if(!hit) return;
    const age=elapsed-travel, spread=1-Math.exp(-age/65);
    const fade=1-clamp((age-850)/550,0,1), r=radius*(.35+.65*spread);
    // Scalloped wet patch, flying droplets, then small downward drips.
    blob(splat,end.x,end.y,r,r*.78,palette.patch,.78*fade,.8,.15);
    blob(splat,end.x-r*.05,end.y-r*.07,r*.8,r*.58,palette.wet,.65*fade,.8,.12);
    blob(splat,end.x-r*.24,end.y-r*.28,r*.24,r*.07,palette.glint,.7*fade);
    for(let i=0;i<11;i++) {
      const a=i/11*Math.PI*2+.23, distance=r*(.85+spread*(.35+(i%3)*.2));
      const x=end.x+Math.cos(a)*distance, y=end.y+Math.sin(a)*distance+clamp(age/1000,0,1)*grid*.06;
      const droplet=grid*(.022+(i%3)*.009);
      blob(splat,x,y,droplet,droplet*(1.2+spread*.4),palette.droplet,.8*fade,a);
    }
    for(let i=0;i<3;i++) {
      const drip=clamp((age-120)/550,0,1)*grid*(.06+i*.018);
      blob(splat,end.x+(i-1)*r*.45,end.y+r*.45+drip*.5,grid*.023,grid*.03+drip*.5,palette.drip,.7*fade);
    }
  };
  const tick=()=>{
    if(root.destroyed || !canvas.ready || canvas.scene?.id!==sceneId) return dispose();
    const now=performance.now(); elapsed+=clamp(now-previous,0,50); previous=now;
    if(elapsed>=duration) return dispose();
    try {draw();} catch(err) {dispose();console.warn("STA2e Toolkit | Goo animation stopped:",err);}
  };
  active.add(dispose);
  try {draw();ticker.add(tick);timer=setTimeout(dispose,duration+1000);}
  catch(err) {dispose();console.warn("STA2e Toolkit | Goo animation failed:",err);}
  return done;
}

globalThis.Hooks?.on("canvasTearDown",()=>{for(const dispose of [...active]) dispose();});
