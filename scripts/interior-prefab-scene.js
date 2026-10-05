/** Fixed, fitted starter assembly. Arbitrary prefab arrangements are not yet supported. */
const MODULE_ID="sta2e-toolkit";
// gm-authority.js's rule, inlined: this module must stay import-free (its test links no dependencies).
function isActiveGM(){
  if(!game.user?.isGM)return false;
  let id="";try{id=game.settings?.get?.(MODULE_ID,"activeGmUserId")||"";}catch{}
  const pick=game.users?.get?.(id);
  const gm=(pick?.active&&pick.isGM)?pick:(game.users?.contents??[]).filter(u=>u?.active&&u.isGM).sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0];
  return (gm?.id??game.user.id)===game.user.id;
}
export const PREFAB_FLAG="prefabInterior", PREFAB_DOOR_FLAG="prefabDoorKey";
export const PREFAB_ROOT="modules/sta2e-toolkit/assets/interiors/prefabs/starfleet-tng";
const KIT_ID="habitation-starter-v1", LEVEL_ID="staPrefabDeck001";

// Native doors repeat this single panel for the two opposing halves. Its 20 px
// height at 200 px/square matches the 0.1-square wall thickness at every grid size.
export function prefabDoorAnimation() {
  return {type:"slide",texture:`${PREFAB_ROOT}/door-panel.svg`,double:true,direction:1,flip:false,duration:750,strength:1};
}

export function normalizePrefabRecipe(input={}) {
  const kit=input.kit??KIT_ID, rotation=Number(input.rotation??0), gridSize=Number(input.gridSize??100);
  if(kit!==KIT_ID)throw new Error("Only the Starfleet habitation starter is available.");
  if(![0,90,180,270].includes(rotation))throw new Error("Choose a quarter-turn orientation.");
  if(![70,100,140].includes(gridSize))throw new Error("Choose 70, 100 or 140 pixels per square.");
  return {kit,rotation,gridSize};
}

export function validatePrefabManifest(kit) {
  if(kit?.schemaVersion!==1||kit.id!==KIT_ID||kit.width!==20||kit.height!==13||kit.metresPerUnit!==1.5
    ||kit.background?.file!=="registered-assembly.png"||!(/^[a-f0-9]{64}$/).test(kit.background.sha256)
    ||kit.background.pixels?.[0]!==2000||kit.background.pixels?.[1]!==1300)throw new Error("Unsupported starter artwork or geometry. Rebuild the starter manifest.");
  const point=p=>Array.isArray(p)&&p.length===2&&p.every((v,i)=>Number.isFinite(v)&&v>=0&&v<=[kit.width,kit.height][i]);
  if(!Array.isArray(kit.walls)||kit.walls.length!==69||new Set(kit.walls.map(w=>w.key)).size!==kit.walls.length
    ||kit.walls.some(w=>!w.key||!point(w.a)||!point(w.b)||Math.hypot(w.b[0]-w.a[0],w.b[1]-w.a[1])<.001||w.window&&w.door)
    ||kit.walls.filter(w=>w.door).length!==5||kit.walls.filter(w=>w.window).length!==2
    ||!point(kit.entry)||!Array.isArray(kit.lights)||!kit.lights.length||kit.lights.some(l=>!point(l.at)||!Number.isFinite(l.radius)||l.radius<=0))throw new Error("Invalid starter walls, windows or lights.");
  return kit;
}

export function rotatePrefabPoint([x,y],rotation,width=20,height=13) {
  switch(rotation){case 0:return[x,y];case 90:return[height-y,x];case 180:return[width-x,height-y];case 270:return[y,width-x];default:throw new Error("Invalid starter orientation.");}
}

export function prefabSceneData(kit,input={},imagePath=null,{name,generation=14}={}) {
  validatePrefabManifest(kit);
  return prefabLayoutSceneData(kit,normalizePrefabRecipe(input),imagePath,{name,generation});
}

/** Shared export for validated fitted layouts of any canvas dimensions. */
export function prefabLayoutSceneData(kit,recipe,imagePath=null,{name,generation=14}={}) {
  const grid=recipe.gridSize,modern=generation>=14;
  const level=modern?{levels:[LEVEL_ID]}:{}, at=p=>rotatePrefabPoint(p,recipe.rotation,kit.width,kit.height).map(v=>Math.round(v*grid+1e-8));
  const c=globalThis.CONST??{},sense=c.EDGE_SENSE_TYPES?.NORMAL??c.WALL_SENSE_TYPES?.NORMAL??20;
  const walls=kit.walls.map(w=>({c:[...at(w.a),...at(w.b)],move:c.WALL_MOVEMENT_TYPES?.NORMAL??20,
    sight:w.window?0:sense,light:w.window?0:sense,sound:sense,door:w.door?1:0,ds:0,dir:0,...level,
    ...(modern&&w.door?{animation:prefabDoorAnimation()}:{}),
    flags:{...(modern&&w.door?{core:{textureGridSize:200}}:{}),[MODULE_ID]:{prefabWallKey:w.key,...(w.door?{[PREFAB_DOOR_FLAG]:w.key}:{})}}}));
  // v13 tile coordinates are top-left. v14 anchors differ; use wall-native doors there.
  const tiles=modern?[]:walls.filter(w=>w.door).map(w=>{
    const [ax,ay,bx,by]=w.c,width=Math.round(Math.hypot(bx-ax,by-ay)),height=Math.max(6,Math.round(.1*grid));
    return {name:"Sliding door leaf",x:Math.round((ax+bx-width)/2),y:Math.round((ay+by-height)/2),width,height,
      rotation:(Math.atan2(by-ay,bx-ax)*180/Math.PI+360)%360,texture:{src:`${PREFAB_ROOT}/door-leaf.svg`},
      alpha:1,hidden:false,locked:true,elevation:0,sort:100,...level,flags:{[MODULE_ID]:{[PREFAB_DOOR_FLAG]:w.flags[MODULE_ID][PREFAB_DOOR_FLAG]}}};
  });
  const swapped=recipe.rotation%180!==0,entry=at(kit.entry);
  const scene={name:String(name??"Starfleet Habitation — Starter").trim().slice(0,150)||"Starfleet Habitation — Starter",
    width:(swapped?kit.height:kit.width)*grid,height:(swapped?kit.width:kit.height)*grid,padding:0,
    grid:{type:1,size:grid,distance:kit.metresPerUnit,units:"m",alpha:.12,color:"#b8cbd8"},
    tokenVision:true,environment:{darknessLevel:.25,globalLight:{enabled:false}},navigation:false,active:false,
    initial:{x:entry[0],y:entry[1],scale:.65},walls,tiles,
    lights:kit.lights.map(l=>{const [x,y]=at(l.at);return{x,y,...level,config:{bright:l.radius*.55,dim:l.radius,color:"#e5e9ff",alpha:.13,luminosity:.5,attenuation:.4},walls:true,vision:false,hidden:false};}),
    flags:{[MODULE_ID]:{[PREFAB_FLAG]:{recipe,artHash:kit.background.sha256,status:kit.status,...(kit.recipe?{placements:kit.placements,pieces:kit.pieces}: {})}}}};
  if(modern){scene.levels=[{_id:LEVEL_ID,name:"Habitation deck",background:{src:imagePath,color:"#151d25"}}];scene.initialLevel=LEVEL_ID;}
  else{scene.background={src:imagePath};scene.backgroundColor="#151d25";}
  return scene;
}

export async function loadPrefabManifest() {
  const response=await fetch(`${PREFAB_ROOT}/starter-scene.json`);
  if(!response.ok)throw new Error("The habitation starter could not be loaded.");
  return validatePrefabManifest(await response.json());
}

/** Use exactly the same quarter-turn transform as the native geometry. */
export function drawPrefabBackground(context,image,kit,input={}) {
  const recipe=normalizePrefabRecipe(input),g=recipe.gridSize,r=recipe.rotation;
  context.save();
  try{
    const origin={0:[0,0],90:[kit.height*g,0],180:[kit.width*g,kit.height*g],270:[0,kit.width*g]}[r];
    context.translate(...origin);context.rotate(r*Math.PI/180);
    context.drawImage(image,0,0,kit.width*g,kit.height*g);
  }finally{context.restore();}
}

export async function renderPrefabBlob(kit,input={}) {
  validatePrefabManifest(kit);const recipe=normalizePrefabRecipe(input);
  const response=await fetch(`${PREFAB_ROOT}/${kit.background.file}`);
  if(!response.ok)throw new Error("The fitted starter image could not be loaded.");
  const bytes=await response.arrayBuffer();
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,"0")).join("");
  if(hash!==kit.background.sha256)throw new Error("Starter artwork has changed. Rebuild its manifest before creating a scene.");
  const url=URL.createObjectURL(new Blob([bytes],{type:"image/png"})),image=new Image(),surface=document.createElement("canvas");
  try{
    image.src=url;await image.decode();
    if(image.naturalWidth!==2000||image.naturalHeight!==1300)throw new Error("Unexpected starter image dimensions.");
    const swap=recipe.rotation%180!==0;
    surface.width=(swap?kit.height:kit.width)*recipe.gridSize;surface.height=(swap?kit.width:kit.height)*recipe.gridSize;
    const context=surface.getContext("2d");if(!context)throw new Error("Canvas image rendering is unavailable.");
    drawPrefabBackground(context,image,kit,recipe);
    return await new Promise((resolve,reject)=>surface.toBlob(blob=>blob?resolve(blob):reject(new Error("Starter image could not be rendered.")),"image/webp",.96));
  }finally{URL.revokeObjectURL(url);surface.width=surface.height=0;}
}

export async function createPrefabInteriorScene(input={}, {name,view=true}={}) {
  if(!game.user?.isGM)throw new Error("Only a GM can create interior scenes.");
  const recipe=normalizePrefabRecipe(input),kit=await loadPrefabManifest();
  const data=prefabSceneData(kit,recipe,null,{name,generation:game.release?.generation??13});
  new Scene(data,{strict:true});
  const blob=await renderPrefabBlob(kit,recipe);
  return savePrefabScene(data,blob,recipe,{view});
}

export async function savePrefabScene(data,blob,recipe,{view=true}={}) {
  if(!game.user?.isGM)throw new Error("Only a GM can create interior scenes.");
  const FP=foundry.applications.apps.FilePicker.implementation;
  const directory=`worlds/${game.world.id}/sta2e-interiors`;
  try{await FP.createDirectory("data",directory);}catch{/* Upload reports inaccessible storage. */}
  const filename=`habitation-${recipe.rotation}-${foundry.utils.randomID(8)}.webp`;
  const result=await FP.upload("data",directory,new File([blob],filename,{type:blob.type}),{},{notify:false});
  if(!result?.path)throw new Error("Starter artwork could not be saved. Check file upload permissions.");
  if(data.levels)data.levels[0].background.src=result.path;else data.background.src=result.path;
  const scene=await Scene.create(data);if(!scene)throw new Error("Foundry did not create the starter scene.");
  ui.notifications.info(`Interior scene “${scene.name}” created.`);
  if(view)try{await scene.view();}catch(error){console.warn("STA2e | Starter saved but could not be viewed",error);ui.notifications.warn("The scene was saved. Open it from the Scenes directory.");}
  return scene;
}

/** Presentation only: every client follows its synchronized native wall state. */
export function refreshPrefabDoor(tile) {
  const key=tile.document?.flags?.[MODULE_ID]?.[PREFAB_DOOR_FLAG];if(!key||!tile.mesh)return;
  const wall=tile.document.parent?.walls?.find(w=>w.flags?.[MODULE_ID]?.[PREFAB_DOOR_FLAG]===key);
  // Legacy leaves retained during upgrade must never cover a native animated door,
  // including the GM's normally visible hidden tiles.
  if((globalThis.game?.release?.generation??13)>=14&&wall?.animation?.texture&&wall.animation.type){tile.mesh.visible=false;return;}
  const open=globalThis.CONST?.WALL_DOOR_STATES?.OPEN??1;
  tile.mesh.visible=!!(tile.visible&&(!tile.document.hidden||globalThis.game?.user?.isGM)&&wall?.door&&wall.ds!==open);
}
let doorHooksRegistered=false;
const doorUpgrades=new WeakMap();
/** Upgrade only module-owned starter doors. Keep old leaves hidden for recovery.
 * Existing wall positions, door states, locks and user-supplied animations survive.
 */
export async function upgradePrefabDoors(scene) {
  if(!scene?.flags?.[MODULE_ID]?.[PREFAB_FLAG]||!game.user?.isGM||(game.release?.generation??13)<14)return;
  if(!isActiveGM())return;
  if(doorUpgrades.has(scene))return doorUpgrades.get(scene);
  const run=(async()=>{
    const walls=[...scene.walls].filter(w=>w.door&&w.flags?.[MODULE_ID]?.[PREFAB_DOOR_FLAG]);
    const updates=walls.filter(w=>!(w.animation?.type&&w.animation.texture)).map(w=>({_id:w.id,animation:prefabDoorAnimation(),"flags.core.textureGridSize":200}));
    // Enable wall meshes first. A failed update leaves the old art intact.
    if(updates.length)await scene.updateEmbeddedDocuments("Wall",updates);
    const keys=new Set(walls.map(w=>w.flags[MODULE_ID][PREFAB_DOOR_FLAG]));
    const tiles=[...scene.tiles].filter(t=>!t.hidden&&keys.has(t.flags?.[MODULE_ID]?.[PREFAB_DOOR_FLAG])&&t.texture?.src===`${PREFAB_ROOT}/door-leaf.svg`);
    if(tiles.length)await scene.updateEmbeddedDocuments("Tile",tiles.map(t=>({_id:t.id,hidden:true})));
    return {doors:updates.length,retiredTiles:tiles.length};
  })();
  doorUpgrades.set(scene,run);
  try{return await run;}finally{doorUpgrades.delete(scene);}
}
export function registerPrefabDoorHooks() {
  if(doorHooksRegistered)return;doorHooksRegistered=true;
  Hooks.on("refreshTile",refreshPrefabDoor);
  const refresh=()=>{for(const tile of globalThis.canvas?.tiles?.placeables??[])refreshPrefabDoor(tile);};
  Hooks.on("canvasReady",async()=>{
    try{await upgradePrefabDoors(globalThis.canvas?.scene);}
    catch(error){console.error("STA2e | Starter door upgrade",error);ui.notifications.warn("Starter doors could not be upgraded. Reopen the scene to retry.");}
    finally{refresh();}
  });
  for(const hook of ["createWall","updateWall","deleteWall"])Hooks.on(hook,wall=>{if(wall.parent?.id===globalThis.canvas?.scene?.id)refresh();});
}
