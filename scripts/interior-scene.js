/** Foundry adapter: persisted WebP background plus editable native walls, doors and lights. */
import { generateInterior, interiorStyle, interiorWallSegments, validateInterior } from "./interior-layout.js";
import { renderInteriorBlob, interiorArtKey } from "./interior-art.js";
const MODULE_ID="sta2e-toolkit";
export const INTERIOR_FLAG="proceduralInterior";
const LEVEL_ID="sta2eInterior001";

export function interiorSceneData(layout, imagePath, { name, generation=14 }={}) {
  const { recipe }=layout, grid=recipe.gridSize, p=interiorStyle(recipe), modern=generation>=14;
  const at=p=>Math.round(p*grid), level=modern?{levels:[LEVEL_ID]}:{};
  const constants=globalThis.CONST??{}, move=constants.WALL_MOVEMENT_TYPES?.NORMAL??20;
  const sense=constants.EDGE_SENSE_TYPES?.NORMAL??constants.WALL_SENSE_TYPES?.NORMAL??20;
  const walls=interiorWallSegments(layout).map(({a,b,door,window})=>({
    c:[at(a.x),at(a.y),at(b.x),at(b.y)], move, sight:window?0:sense, light:window?0:sense, sound:sense,
    door:door?1:0, ds:0, dir:0, ...level,
  }));
  // Each long corridor needs multiple emitters; otherwise the ends go dark with global light off.
  const lightPositions=[];
  for(const room of layout.rooms) {
    if(room.lightPoints) {
      const points=room.lightPoints.length?room.lightPoints:[room.frame];
      for(const pos of points)lightPositions.push({x:pos.x,y:pos.y,radius:room.kind==="jefferies"?3:8});
      continue;
    }
    const f=room.frame, long=Math.max(f.w,f.h), count=room.kind==="corridor"?Math.max(1,Math.ceil(long/5)):1;
    for(let i=0;i<count;i++) {
      const offset=(i+.5)/count*long-long/2, x=f.w>f.h?offset:0, y=f.w>f.h?0:offset, a=f.rotation*Math.PI/180;
      lightPositions.push({x:f.x+x*Math.cos(a)-y*Math.sin(a), y:f.y+x*Math.sin(a)+y*Math.cos(a), radius:room.kind==="corridor"?8:Math.max(f.w,f.h)*1.5});
    }
  }
  const lights=lightPositions.map(pos=>({x:at(pos.x),y:at(pos.y),...level,
    config:{bright:pos.radius*.55,dim:pos.radius,color:p.light,alpha:recipe.lighting==="emergency"?.3:.13,luminosity:.5,attenuation:.4},
    walls:true, vision:false, hidden:false,
  }));
  const scene={
    name:String(name??`${p.label} ${recipe.type==="station"?"Station":"Starship"} Interior`).trim().slice(0,150)||"Generated Interior",
    width:at(layout.width),height:at(layout.height),padding:0,
    grid:{type:1,size:grid,distance:1.5,units:"m",alpha:.12,color:"#b8cbd8"},
    tokenVision:true,environment:{darknessLevel:recipe.lighting==="emergency"?.8:.25,globalLight:{enabled:false}},
    navigation:false,active:false,initial:{x:at(layout.entry.x),y:at(layout.entry.y),scale:.65}, walls,lights,
    flags:{[MODULE_ID]:{[INTERIOR_FLAG]:{recipe,entry:layout.entry,rooms:layout.rooms.map(({id,kind,name,polygon,holes})=>({id,kind,name,polygon,...(holes?{holes}:{})})),artKey:interiorArtKey(layout)}}},
  };
  if(modern) {scene.levels=[{_id:LEVEL_ID,name:"Interior deck",background:{src:imagePath,color:"#10171e"}}];scene.initialLevel=LEVEL_ID;}
  else {scene.background={src:imagePath};scene.backgroundColor="#10171e";}
  return scene;
}

/** Creates a new scene only; existing maps are never replaced. Pass a recipe to reproduce a preview. */
export async function createInteriorScene(recipe, { name, view=true }={}) {
  if(!game.user?.isGM) throw new Error("Only a GM can create interior scenes.");
  const layout=generateInterior(recipe), errors=validateInterior(layout);
  if(errors.length) throw new Error(errors.join("; "));
  const sceneData=interiorSceneData(layout,null,{name,generation:game.release?.generation??13});
  // Validate against the real host schema before persisting artwork. This constructs no world document.
  new Scene(sceneData,{strict:true});
  const blob=await renderInteriorBlob(layout), FP=foundry.applications.apps.FilePicker.implementation;
  const directory=`worlds/${game.world.id}/sta2e-interiors`;
  try {await FP.createDirectory("data",directory);} catch { /* The upload below reports inaccessible storage. */ }
  const filename=`interior-${interiorArtKey(layout)}-${foundry.utils.randomID(8)}.webp`;
  const result=await FP.upload("data",directory,new File([blob],filename,{type:"image/webp"}),{},{notify:false});
  if(!result?.path) throw new Error("Interior artwork could not be saved. Check file upload permissions.");
  // One document operation includes all embedded documents; no half-built scene on a later batch failure.
  if(sceneData.levels)sceneData.levels[0].background.src=result.path;else sceneData.background.src=result.path;
  const scene=await Scene.create(sceneData);
  if(!scene) throw new Error("Foundry did not create the interior scene.");
  ui.notifications.info(`Interior scene “${scene.name}” created.`);
  if(view) {
    try {await scene.view();} catch(error) { console.warn("STA2e | Interior created, but could not be viewed",error); ui.notifications.warn("The scene was saved. Open it from the Scenes directory."); }
  }
  return scene;
}
