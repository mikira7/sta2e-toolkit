/** Cosmetic token-local meltdown. Only the combat caller controls destruction. */
import { createShipMeltdownFilter } from "./ship-meltdown-shader.js";
import { getShipExplosionColor } from "./ship-explosion-vfx.js";

export const SHIP_MELTDOWN_ACTION="shipMeltdownVfx";
export const SHIP_MELTDOWN_STOP_ACTION="stopShipMeltdownVfx";
export const SHIP_MELTDOWN_DURATION_MS=5000;
export const SHIP_MELTDOWN_BLAST_MS=3000;
const active=new Map(), seen=new Set();
let hooked=false;

export function stopShipMeltdownFromSocket(event){
  const record=active.get(event.tokenId);
  if(record?.sceneId===event.sceneId && record.id===event.id)record.stop();
}

export function playShipMeltdownFromSocket(event){
  const canvas=globalThis.canvas;
  if(!canvas?.ready || canvas.scene?.id!==event?.sceneId || typeof event.id!=="string" || seen.has(event.id))return null;
  const token=canvas.tokens?.get(event.tokenId),mesh=token?.mesh;
  if(!mesh || mesh.destroyed || (!game.user?.isGM && (event.hidden || token.document?.hidden || token.visible===false)))return null;
  if(!Number.isFinite(event.startedAt))return null;
  const late=Math.max(0,(game.time?.serverTime ?? Date.now())-event.startedAt);
  if(late>SHIP_MELTDOWN_DURATION_MS+10000)return null;
  seen.add(event.id);if(seen.size>256)seen.delete(seen.values().next().value);
  if(!hooked){
    hooked=true;
    Hooks.on("canvasTearDown",()=>{for(const r of [...active.values()])r.stop();seen.clear();});
    Hooks.on("destroyToken",t=>active.get(t.id)?.stop());
  }
  active.get(token.id)?.stop();
  const shader=createShipMeltdownFilter(mesh,event.color,event.seed ?? 1);
  if(shader)mesh.filters=[...(mesh.filters ?? []),shader.filter];
  const ticker=canvas.app.ticker, start=performance.now()-late;
  let finishedResolve,blastResolve,complete=false,stopped=false,finishTimer,blastTimer,safetyTimer;
  const record={id:event.id,sceneId:event.sceneId,finished:new Promise(resolve=>{finishedResolve=resolve;}),
    detonationReady:new Promise(resolve=>{blastResolve=resolve;}),stop};
  function finish(){
    if(complete)return;complete=true;shader?.update(1);blastResolve(true);finishedResolve(true);
    if(event.preview)stop();
  }
  function stop(){
    if(stopped)return;stopped=true;
    clearTimeout(finishTimer);clearTimeout(blastTimer);clearTimeout(safetyTimer);ticker.remove(tick);
    blastResolve(false);
    if(active.get(token.id)===record)active.delete(token.id);
    if(shader){
      if(!mesh.destroyed){const filters=(mesh.filters ?? []).filter(f=>f!==shader.filter);mesh.filters=filters.length?filters:null;}
      shader.destroy();
    }
    if(!complete)finishedResolve(false);
  }
  function tick(){
    if(stopped)return;
    if(!canvas.ready || canvas.scene?.id!==event.sceneId || token.destroyed || mesh.destroyed || token.mesh!==mesh){stop();return;}
    try {
      if(shader && !mesh.filters?.includes(shader.filter))mesh.filters=[...(mesh.filters ?? []),shader.filter];
      const progress=(performance.now()-start)/SHIP_MELTDOWN_DURATION_MS;
      shader?.update(progress);
      if(progress*SHIP_MELTDOWN_DURATION_MS>=SHIP_MELTDOWN_BLAST_MS)blastResolve(true);
      if(progress>=1)finish();
    }catch(error){console.warn("STA2e Toolkit | Hull meltdown stopped:",error);stop();}
  }
  active.set(token.id,record);ticker.add(tick);
  finishTimer=setTimeout(finish,Math.max(0,SHIP_MELTDOWN_DURATION_MS-late));
  blastTimer=setTimeout(()=>blastResolve(true),Math.max(0,SHIP_MELTDOWN_BLAST_MS-late));
  safetyTimer=setTimeout(stop,Math.max(0,SHIP_MELTDOWN_DURATION_MS+10000-late));
  tick();return record;
}

export function playShipMeltdown(token,{preview=false,broadcast=!preview,color}={}){
  if(!token?.document || !globalThis.canvas?.scene)return null;
  const event={action:SHIP_MELTDOWN_ACTION,id:crypto.randomUUID(),sceneId:token.document.parent?.id ?? canvas.scene.id,
    tokenId:token.id,hidden:token.document.hidden===true,preview,startedAt:game.time?.serverTime ?? Date.now(),
    color:color ?? getShipExplosionColor(token),seed:[...String(token.id)].reduce((n,c)=>(n*31+c.charCodeAt(0))%10007,0)};
  const handle=playShipMeltdownFromSocket(event);
  if(broadcast)game.socket?.emit("module.sta2e-toolkit",event);
  // Even an unsupported/local off-scene renderer waits for the other clients.
  let fallbackTimer,fallbackResolve,fallbackBlastTimer,fallbackBlastResolve;
  const finished=handle?.finished ?? new Promise(resolve=>{fallbackResolve=resolve;fallbackTimer=setTimeout(()=>resolve(true),SHIP_MELTDOWN_DURATION_MS);});
  const detonationReady=handle?.detonationReady ?? new Promise(resolve=>{fallbackBlastResolve=resolve;fallbackBlastTimer=setTimeout(()=>resolve(true),SHIP_MELTDOWN_BLAST_MS);});
  return {finished,detonationReady,stop(){
    clearTimeout(fallbackTimer);clearTimeout(fallbackBlastTimer);fallbackResolve?.(false);fallbackBlastResolve?.(false);handle?.stop();
    if(broadcast)game.socket?.emit("module.sta2e-toolkit",{action:SHIP_MELTDOWN_STOP_ACTION,id:event.id,sceneId:event.sceneId,tokenId:event.tokenId});
  }};
}

export function previewShipMeltdown(){
  const token=globalThis.canvas?.tokens?.controlled?.[0];
  if(!token){ui.notifications.warn("Select a ship to preview its hull meltdown.");return null;}
  return playShipMeltdown(token,{preview:true});
}
