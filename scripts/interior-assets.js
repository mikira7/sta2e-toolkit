/** Bundled, reusable image library. The recipe stores paths, never large embedded images. */
import { interiorKitPaths } from "./interior-kit.js";
const BASE="modules/sta2e-toolkit/assets/interiors/";
export const INTERIOR_ASSET_SLOTS={floor:"Room floor texture",corridor:"Corridor floor texture",threshold:"Doorway sills",window:"Hull windows",console:"Consoles",bed:"Beds",chair:"Chairs",table:"Tables",crate:"Cargo containers",couch:"Couches",plant:"Potted plants",desk:"Office desks","coffee-table":"Coffee tables",biobed:"Diagnostic biobeds",core:"Reactor cores"};
export const INTERIOR_ASSET_LIBRARY={
  corridor:[{label:"Starfleet passageway carpet",path:`${BASE}corridor-deck-carpet.png`}],
  threshold:[{label:"Illuminated sliding-door sill",path:`${BASE}corridor-door-sill.png`}],
  window:[{label:"Cabin hull glazing",path:`${BASE}hull-cabin-window.png`}],
  floor:[{label:"Starfleet carpet",path:`${BASE}starfleet-carpet.png`},{label:"Metal deck plates",path:`${BASE}metal.png`},{label:"TNG room carpet",path:`${BASE}floor-room-carpet.png`},{label:"TNG service deck panels",path:`${BASE}floor-deck-panels.png`}],
  console:[{label:"Starfleet touch console",path:`${BASE}console.png`},{label:"Retro physical controls",path:`${BASE}console-retro.png`},{label:"Imperial control station",path:`${BASE}console-imperial.png`},{label:"TNG helm console",path:`${BASE}console-helm.png`,aspect:1774/887},{label:"TNG curved tactical console",path:`${BASE}console-tactical.png`,aspect:1983/793,rotation:180}],
  bed:[{label:"Crew bunk",path:`${BASE}bed.png`},{label:"TNG crew bed",path:`${BASE}bed-crew.png`,aspect:850/1851},{label:"TNG officer double bed",path:`${BASE}bed-officer.png`,aspect:1095/1437}],
  chair:[{label:"Bridge chair",path:`${BASE}chair.png`},{label:"TNG command chair",path:`${BASE}chair-command.png`,aspect:1},{label:"TNG visitor chair",path:`${BASE}chair-visitor.png`,aspect:1}],
  table:[{label:"Briefing table",path:`${BASE}table.png`}],
  crate:[{label:"Cargo container",path:`${BASE}crate.png`}],
  couch:[{label:"Starfleet sofa",path:`${BASE}couch.png`}],
  plant:[{label:"Lounge plant",path:`${BASE}plant.png`}],
  desk:[{label:"Ready room desk",path:`${BASE}desk.png`},{label:"TNG curved ready room desk",path:`${BASE}desk-ready-room.png`,aspect:1942/809},{label:"TNG compact quarters desk",path:`${BASE}desk-quarters.png`,aspect:1619/971}],
  "coffee-table":[{label:"Oval glass coffee table",path:`${BASE}coffee-table.png`}],
  biobed:[{label:"Sickbay diagnostic bed",path:`${BASE}biobed.png`}],
  core:[{label:"Matter / antimatter core",path:`${BASE}core.png`}],
};
/** Assets come from Foundry's file storage. Disallow executable URLs and external network resources. */
export function normalizeInteriorAssets(input={}) {
  return Object.fromEntries(Object.keys(INTERIOR_ASSET_SLOTS).map(key=>{
    const value=String(input?.[key]??"auto").trim();
    const valid=["auto","drawn"].includes(value)||(!/[\\:#?\u0000-\u001f]/.test(value)&&!value.startsWith("/")&&!value.split("/").includes("..")&&/\.(png|webp|jpe?g|svg)$/i.test(value));
    return [key,valid?value:"auto"];
  }));
}
export function interiorAssetPaths(recipe) {
  return Object.fromEntries(Object.entries(normalizeInteriorAssets(recipe.assets)).map(([key,value])=>{
    if(value!=="auto")return[key,value==="drawn"?null:value];
    if(key==="corridor"&&recipe.faction!=="federation")return[key,null];
    if(key==="window"&&(recipe.faction==="borg"||recipe.hullWindows===false))return[key,null];
    if(recipe.faction==="borg"&&["console","core"].includes(key))return[key,null];
    const index=key==="floor" && (recipe.faction!=="federation"||recipe.era==="ent")?1
      :key==="console"?recipe.faction!=="federation"?2:["ent","tos","movies"].includes(recipe.era)?1:0:0;
    return [key,INTERIOR_ASSET_LIBRARY[key][index].path];
  }));
}
const dataCache=new Map();
async function assetData(path) {
  if(!dataCache.has(path)) {
    const promise=(async()=>{
      const response=await fetch(path);
      if(!response.ok)throw new Error(`Image not found: ${path}`);
      const blob=await response.blob();
      if(blob.size>16*1024*1024)throw new Error(`Interior image exceeds 16 MB: ${path}`);
      if(!blob.type.startsWith("image/"))throw new Error(`Not an image: ${path}`);
      return new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error(`Could not read image: ${path}`));reader.readAsDataURL(blob);
      });
    })();
    dataCache.set(path,promise);
    promise.catch(()=>dataCache.delete(path));
    // Bound memory when browsing a large custom asset collection.
    if(dataCache.size>24)dataCache.delete(dataCache.keys().next().value);
  }
  return dataCache.get(path);
}
/** Embed once in SVG defs, because images loaded as SVG cannot fetch nested external resources. */
export async function loadInteriorAssets(recipe) {
  return Object.fromEntries(await Promise.all(Object.entries({...interiorAssetPaths(recipe),...interiorKitPaths(recipe)}).map(async([key,path])=>[key,path?await assetData(path):null])));
}
