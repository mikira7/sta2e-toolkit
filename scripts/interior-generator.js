import { INTERIOR_FACTIONS, INTERIOR_ERAS, INTERIOR_SIZES, INTERIOR_PURPOSES, INTERIOR_PLANS, INTERIOR_HULL_PROFILES, INTERIOR_JUNCTIONS, INTERIOR_CABINS, INTERIOR_ROOM_TYPES, normalizeInteriorRecipe, generateInterior, validateInterior, interiorWallSegments } from "./interior-layout.js";
import { interiorBrushControls, bindInteriorBrushEditor } from "./interior-brush-editor.js";
import { INTERIOR_ROOM_KITS } from "./interior-kit.js";
import { renderInteriorSVG, escapeInteriorText as esc } from "./interior-art.js";
import { INTERIOR_ASSET_SLOTS, INTERIOR_ASSET_LIBRARY, interiorAssetPaths, loadInteriorAssets } from "./interior-assets.js";
import { createInteriorScene, INTERIOR_FLAG } from "./interior-scene.js";
import { openPrefabInteriorGenerator } from "./interior-prefab-generator.js";
import { registerPrefabDoorHooks } from "./interior-prefab-scene.js";
import { isMeasuredCabin } from "./interior-measured-cabins.js";

let activeDialog=null;
const options=(catalog,selected)=>Object.entries(catalog).map(([id,value])=>`<option value="${esc(id)}" ${id===selected?"selected":""}>${esc(value.label??value)}</option>`).join("");
const SIMPLE_FIELDS=["seed","faction","era","type","plan","hullProfile","junctions","cabinLayout","size","purpose","gridSize","lighting","labels","curved","hullWindows","jefferies","roomKit"];
function readInteriorForm(root,brush=null) {
  const field=k=>root.querySelector(`[name="${k}"]`);
  return normalizeInteriorRecipe({
    ...Object.fromEntries(SIMPLE_FIELDS.map(k=>[k,["labels","curved","hullWindows","jefferies"].includes(k)?field(k).checked:field(k).value])),
    roomTypes:field("chooseRooms").checked?[...root.querySelectorAll("[data-room-kind]:checked")].map(el=>el.dataset.roomKind):null,
    assets:Object.fromEntries(Object.keys(INTERIOR_ASSET_SLOTS).map(k=>[k,field(`asset-${k}`).value])),
    brush,
  });
}
function assetOptions(key,value) {
  const choices={auto:"Faction / era default",drawn:"Drawn detail",...Object.fromEntries(INTERIOR_ASSET_LIBRARY[key].map(a=>[a.path,a.label]))};
  if(!Object.hasOwn(choices,value))choices[value]=`Custom: ${value.split("/").at(-1)}`;
  return options(choices,value);
}

/** GM generator, available without an active canvas through the Scenes directory and public API. */
export async function openInteriorGenerator(input={}) {
  if(!game.user?.isGM) {ui.notifications.warn("Only a GM can generate interior scenes.");return null;}
  if(activeDialog) {activeDialog.bringToFront();return null;}
  // Also covers an already-running world whose cached module manifest predates this feature.
  if(!document.querySelector('link[href$="styles/interior-generator.css"]')) {
    const css=document.createElement("link");css.rel="stylesheet";css.href="modules/sta2e-toolkit/styles/interior-generator.css";document.head.append(css);
  }
  const initial=normalizeInteriorRecipe({seed:foundry.utils.randomID(10),...input});
  const name=String(input.name??"New Interior"), label=(title,field)=>`<label class="interior-field"><span>${title}</span>${field}</label>`;
  let recipe=initial, busy=false, previewURL=null, previewRevision=0,brushEditor=null;
  const content=`<div class="sta2e-interior-generator"><div class="interior-fields">
    ${label("Scene name",`<input type="text" name="sceneName" value="${esc(name)}" maxlength="150" required>`)}
    ${label("Interior",`<select name="type">${options({starship:"Starship deck section",station:"Station deck section"},initial.type)}</select>`)}
    ${label("Faction",`<select name="faction">${options(INTERIOR_FACTIONS,initial.faction)}</select>`)}
    ${label("Era",`<select name="era"></select>`)}
    ${label("Deck architecture",`<select name="plan">${options(INTERIOR_PLANS,initial.plan)}</select>`)}
    ${label("Hull-section curve",`<select name="hullProfile">${options(INTERIOR_HULL_PROFILES,initial.hullProfile)}</select>`)}
    ${label("Hull-section intersections",`<select name="junctions">${options(INTERIOR_JUNCTIONS,initial.junctions)}</select>`)}
    ${label("Cabin arrangement",`<select name="cabinLayout">${options(INTERIOR_CABINS,initial.cabinLayout)}</select>`)}
    <p class="interior-help">SVG cabin plans reuse the measured single cabins, junior-officer pair with shared head, and one-, two- or three-bedroom suites with closets. These choices switch to hull sections and reserve full-size rectangular bays. Mixed accommodation cycles through the plans as quarters are placed. Include Crew quarters in your room selection.</p>
    <p class="interior-help">Habitat run builds an encounter slice: a passageway with an isolation door at each cut end, cabins along the hull as rows of living, bed, closet and head sections (single, junior-officer pair, officer's suite, two- and three-bedroom family), a lift bay with a branch corridor, and support rooms inboard. Standard or officer cabin arrangements fix the cabin type; otherwise the department mix chooses.</p>
    <p class="interior-help">Jefferies tube network is crawlways only: octagonal junction chambers joined by one-square tubes running straight or at 45°, ladder access points at dead ends, a sealable door at each end of every tube, and hatches out to deck access at the map edge. It ignores the room selection; size sets how far the network spreads.</p>
    <p class="interior-help">Galaxy and Intrepid use fixed design radii for encounter sections, not canonical full-deck plans. Branches and 2 × 1 access alcoves apply to hull sections. Standard and officer cabin studies guide sleeping, work and lounge placement.</p>
    <label class="interior-row"><input type="checkbox" name="curved" ${initial.curved?"checked":""}> Curved hull and passageways</label>
    <label class="interior-row"><input type="checkbox" name="hullWindows" ${initial.hullWindows?"checked":""}> Windows in exterior cabins and lounges</label>
    <label class="interior-row"><input type="checkbox" name="jefferies" ${initial.jefferies?"checked":""}> Jefferies tubes and access hatches</label>
    <p class="interior-help">Hull sections can include a connected maintenance crawlway behind inboard rooms. Hatches are narrower than ordinary doors; use a smaller token when crawling. Turbolifts are compact inboard cabins opening directly onto a passageway.</p>
    <p class="interior-help">Hull sections size rooms by purpose, place living spaces outboard, and follow the hull with a continuous passageway. Crew bathrooms join the cabin walls, leaving L-shaped living areas. Standard quarters have a sonic shower; larger suites can add a tub. Windows appear only on identified exterior walls. Painted layouts keep your room shapes.</p>
    ${label("Size",`<select name="size">${options(INTERIOR_SIZES,initial.size)}</select>`)}
    ${label("Room artwork",`<select name="roomKit">${options(INTERIOR_ROOM_KITS,initial.roomKit)}</select>`)}
    <p class="interior-help">The pre-rendered kit includes Starfleet bridge, sickbay, engineering, quarters, lounge, office, and corridor artwork. Compact lifts and rooms with internal partitions use individual furnishings so their artwork matches their walls.</p>
    ${label("Department mix",`<select name="purpose">${options(INTERIOR_PURPOSES,initial.purpose)}</select>`)}
    ${label("Seed",`<div class="interior-row"><input type="text" name="seed" maxlength="100" value="${esc(initial.seed)}"><button type="button" data-reroll title="Generate a new layout" aria-label="New random seed"><i class="fas fa-dice"></i></button></div>`)}
    ${label("Grid resolution",`<select name="gridSize">${options({70:"70 px / square",100:"100 px / square",140:"140 px / square"},String(initial.gridSize))}</select>`)}
    ${label("Lighting",`<select name="lighting">${options({standard:"Standard shipboard",emergency:"Emergency lighting"},initial.lighting)}</select>`)}
    <label class="interior-row"><input type="checkbox" name="labels" ${initial.labels?"checked":""}> Room labels on map</label>
    <details ${initial.roomTypes?"open":""}><summary>Rooms to include</summary>
      <label class="interior-row"><input type="checkbox" name="chooseRooms" ${initial.roomTypes?"checked":""}> Choose room types</label>
      <div class="interior-row"><button type="button" data-room-all>All types</button><button type="button" data-room-clear>Clear selection</button></div>
      <p class="interior-help">Every selected type appears at least once; larger sections repeat types. Unselected types are excluded. Corridors connect the deck automatically.</p>
      <div class="interior-room-choices">${Object.entries(INTERIOR_ROOM_TYPES).map(([kind,title])=>`<label><input type="checkbox" data-room-kind="${kind}" ${(initial.roomTypes??Object.keys(INTERIOR_ROOM_TYPES)).includes(kind)?"checked":""}>${esc(title)}</label>`).join("")}</div>
    </details>
    ${interiorBrushControls}
    <details><summary>Image assets</summary><p class="interior-help">Bundled images or files in your Foundry storage. Use transparent overhead images for furniture. Selections are saved with the scene recipe.</p>
      ${Object.entries(INTERIOR_ASSET_SLOTS).map(([key,title])=>`<div class="interior-asset-row"><img data-asset-thumb="${key}" alt="${title} image"><div>${label(title,`<select name="asset-${key}">${assetOptions(key,initial.assets[key])}</select>`)}<button type="button" data-asset-browse="${key}">Browse ${title.toLowerCase()}</button></div></div>`).join("")}
    </details>
    <p class="interior-help">Original genre-inspired deck sections, not exact plans of named vessels. The same seed and options reproduce the layout. Borg interiors use modular conduit grids.</p>
    <button type="button" data-use-current>Use viewed scene’s recipe</button>
  </div><div><div class="interior-map-area"><canvas data-brush-canvas aria-label="Paint interior layout" hidden></canvas><div class="interior-preview"><img alt="Procedural interior preview"></div></div><div class="interior-row"><span class="interior-summary" data-summary aria-live="polite"></span><button type="button" data-zoom>Zoom 2×</button></div>
    <p class="interior-help">Creates a new scene with a saved background, square grid (1.5 m), editable walls, closed doors, and local lights. Place crew tokens in the passageway by the initial view. The scene opens for you without activating it for players.</p>
    <details><summary>Room list</summary><p class="interior-help" data-room-list></p></details>
    <p class="interior-help" data-error role="alert"></p></div></div>`;
  try {
    return await foundry.applications.api.DialogV2.wait({
      window:{title:"Procedural Interiors"},position:{width:1060},content,
      render:(_event,dialog)=>{
        activeDialog=dialog;
        const root=dialog.element, field=k=>root.querySelector(`[name="${k}"]`);
        const eras=selected=>{field("era").innerHTML=options(Object.fromEntries(INTERIOR_FACTIONS[field("faction").value].eras.map(k=>[k,INTERIOR_ERAS[k]])),selected);};
        eras(initial.era);
        const preview=async()=>{
          if(busy)return;
          const revision=++previewRevision;
          try {
            recipe=readInteriorForm(root,brushEditor?.getBrush()??null);
            root.querySelectorAll("[data-room-kind]").forEach(el=>el.disabled=!!recipe.brush||recipe.roomTypes===null||recipe.plan==="jefferies");
            for(const [key,path]of Object.entries(interiorAssetPaths(recipe))) {
              const thumbnail=root.querySelector(`[data-asset-thumb="${key}"]`);thumbnail.hidden=!path;if(path)thumbnail.src=path;else thumbnail.removeAttribute("src");
            }
            const layout=generateInterior(recipe);
            root.querySelector("[data-summary]").textContent="Loading interior artwork…";
            const assets=await loadInteriorAssets(recipe);
            if(revision!==previewRevision||!root.isConnected)return;
            const svg=renderInteriorSVG(layout,{assets});
            if(previewURL)URL.revokeObjectURL(previewURL);
            previewURL=URL.createObjectURL(new Blob([svg],{type:"image/svg+xml"}));
            root.querySelector(".interior-preview img").src=previewURL;
            const walls=interiorWallSegments(layout);
            root.querySelector("[data-summary]").textContent=`${layout.rooms.filter(r=>!["corridor","jefferies"].includes(r.kind)).length} rooms · ${walls.filter(w=>w.door&&!w.hatch).length} doors · ${walls.filter(w=>w.hatch).length} service hatches · ${layout.width} × ${layout.height} squares`;
            const counts=new Map();for(const r of layout.rooms)if(!["corridor","jefferies"].includes(r.kind))counts.set(r.name,(counts.get(r.name)??0)+1);
            root.querySelector("[data-room-list]").textContent=[...counts].map(([name,count])=>`${name} × ${count}`).join(" · ");
            const errors=validateInterior(layout);
            root.querySelector("[data-error]").textContent=errors.join(" ");
            root.querySelector('[data-action="create"]').disabled=errors.length>0;
          } catch(error) {if(revision===previewRevision){root.querySelector("[data-error]").textContent=error.message;root.querySelector("[data-summary]").textContent="Preview could not be generated.";root.querySelector('[data-action="create"]').disabled=true;}}
        };
        brushEditor=bindInteriorBrushEditor(root,{initial:initial.brush,getLayout:()=>generateInterior(readInteriorForm(root,brushEditor?.getBrush()??null)),onChange:preview});
        root.querySelectorAll("input,select").forEach(el=>el.addEventListener("change",()=>{
          if(el.name==="faction") {const current=field("era").value;eras(INTERIOR_FACTIONS[field("faction").value].eras.includes(current)?current:"tng");}
          if(isMeasuredCabin(field("cabinLayout").value))field("plan").value="section";
          preview();
        }));
        root.querySelector("[data-reroll]").addEventListener("click",()=>{field("seed").value=foundry.utils.randomID(10);preview();});
        for(const [selector,checked]of [["[data-room-all]",true],["[data-room-clear]",false]])root.querySelector(selector).addEventListener("click",()=>{
          field("chooseRooms").checked=true;root.querySelectorAll("[data-room-kind]").forEach(el=>el.checked=checked);preview();
        });
        root.querySelectorAll("[data-asset-browse]").forEach(button=>button.addEventListener("click",()=>{
          const key=button.dataset.assetBrowse;
          new foundry.applications.apps.FilePicker.implementation({type:"image",current:interiorAssetPaths(readInteriorForm(root))[key]??"",callback:path=>{
            if(!root.isConnected)return;
            field(`asset-${key}`).innerHTML=assetOptions(key,path);preview();
          }}).render(true);
        }));
        root.querySelector("[data-zoom]").addEventListener("click",event=>{
          const box=root.querySelector(".interior-preview"),img=box.querySelector("img"),zoom=img.dataset.zoom!=="true";
          img.dataset.zoom=String(zoom);
          const fit=Math.min(box.clientWidth/(img.naturalWidth||1),box.clientHeight/(img.naturalHeight||1));
          img.style.width=zoom?`${img.naturalWidth*fit*2}px`:"100%";img.style.height=zoom?`${img.naturalHeight*fit*2}px`:"100%";
          img.style.margin="0 auto";box.scrollLeft=Math.max(0,(box.scrollWidth-box.clientWidth)/2);box.scrollTop=0;
          event.currentTarget.textContent=zoom?"Fit map":"Zoom 2×";
        });
        const existing=globalThis.canvas?.scene?.getFlag("sta2e-toolkit",INTERIOR_FLAG);
        root.querySelector("[data-use-current]").disabled=!existing;
        root.querySelector("[data-use-current]").addEventListener("click",()=>{
          const saved=normalizeInteriorRecipe(existing.recipe);field("faction").value=saved.faction;eras(saved.era);
          for(const k of SIMPLE_FIELDS) {if(["labels","curved","hullWindows","jefferies"].includes(k))field(k).checked=saved[k];else field(k).value=saved[k];}
          field("chooseRooms").checked=saved.roomTypes!==null;
          root.querySelectorAll("[data-room-kind]").forEach(el=>el.checked=(saved.roomTypes??Object.keys(INTERIOR_ROOM_TYPES)).includes(el.dataset.roomKind));
          for(const [key,value]of Object.entries(saved.assets))field(`asset-${key}`).innerHTML=assetOptions(key,value);
          brushEditor.setBrush(saved.brush);
          field("sceneName").value=`${canvas.scene.name} — Variant`;preview();
        });
        preview();
      },
      buttons:[{action:"create",label:"Create Scene",icon:"fas fa-plus",default:true,
        callback:async(_event,_button,dialog)=>{
          if(busy)return false;
          busy=true;const root=dialog.element;
          // Capture values on submit as well, including a seed whose input has not blurred yet.
          recipe=readInteriorForm(root,brushEditor?.getBrush()??null);
          root.querySelectorAll("button,input,select").forEach(el=>el.disabled=true);
          try {return await createInteriorScene(recipe,{name:root.querySelector('[name="sceneName"]').value});}
          catch(error) {ui.notifications.error(`Could not create interior: ${error.message}`);throw error;}
          finally {busy=false;root.querySelectorAll("button,input,select").forEach(el=>el.disabled=false);brushEditor?.refresh();root.querySelectorAll("[data-room-kind]").forEach(el=>el.disabled=!!recipe.brush||recipe.roomTypes===null||recipe.plan==="jefferies");}
        }}, {action:"cancel",label:"Cancel"}],
    });
  } finally {previewRevision++;activeDialog=null;if(previewURL)URL.revokeObjectURL(previewURL);}
}

export function registerInteriorGeneratorHooks() {
  registerPrefabDoorHooks();
  Hooks.on("renderSceneDirectory",(_app,html)=>{
    if(!game.user?.isGM)return;
    const root=html instanceof HTMLElement?html:html?.[0];
    if(!root||root.querySelector("[data-sta2e-interior]"))return;
    const header=root.querySelector(".directory-header");if(!header)return;
    const button=document.createElement("button");button.type="button";button.dataset.sta2eInterior="";
    button.innerHTML='<i class="fas fa-dungeon"></i> Generate Interior';
    button.addEventListener("click",()=>openInteriorGenerator().catch(error=>console.error("STA2e | Interior generator",error)));
    header.append(button);
    const starter=document.createElement("button");starter.type="button";starter.dataset.sta2ePrefab="";
    starter.innerHTML='<i class="fas fa-puzzle-piece"></i> Assembled Interior';
    starter.addEventListener("click",()=>openPrefabInteriorGenerator().catch(error=>{
      console.error("STA2e | Assembled interior",error);ui.notifications.error(error.message);
    }));
    header.append(starter);
  });
}
