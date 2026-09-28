import {normalizePrefabRecipe,loadPrefabManifest,renderPrefabBlob,createPrefabInteriorScene} from "./interior-prefab-scene.js";
import {loadPuzzleLibrary,generatePuzzle,normalizePuzzleRecipe,renderPuzzleBlob,createPuzzleScene} from "./interior-prefab-puzzle.js";

let activeDialog=null;
const esc=value=>String(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const choices=(values,selected)=>Object.entries(values).map(([value,label])=>`<option value="${value}" ${String(value)===String(selected)?"selected":""}>${label}</option>`).join("");

/** Assemble the available habitation pieces; keep the original starter available. */
export async function openPrefabInteriorGenerator(input={}) {
  if(!game.user?.isGM)throw new Error("Only a GM can create interior scenes.");
  if(activeDialog){activeDialog.bringToFront();return;}
  const initial=normalizePuzzleRecipe(input),[kit,library]=await Promise.all([loadPrefabManifest(),loadPuzzleLibrary()]);
  if(!document.querySelector('link[href="modules/sta2e-toolkit/styles/interior-generator.css"]')){
    const link=document.createElement("link");link.rel="stylesheet";link.href="modules/sta2e-toolkit/styles/interior-generator.css";document.head.append(link);
  }
  let previewURL=null,revision=0,busy=false,ready=false;
  const read=root=>{
    const value=k=>root.querySelector(`[name="${k}"]`).value;
    const values={rotation:value("rotation"),gridSize:value("gridSize"),seed:value("seed"),cabins:value("cabins"),mix:value("mix"),shape:value("shape")};
    return value("mode")==="starter"?normalizePrefabRecipe(values):normalizePuzzleRecipe(values);
  };
  try{
    return await foundry.applications.api.DialogV2.wait({
      window:{title:"Assembled Interior — Starfleet Habitation"},position:{width:1000},
      content:`<div class="sta2e-interior-generator"><div class="interior-fields">
        <h3>Starfleet habitation</h3>
        <p>Fitted cabins with perimeter bathrooms, an inboard turbolift and connected corridors.</p>
        <label class="interior-field"><span>Scene name</span><input name="sceneName" maxlength="150" value="Starfleet Habitation"></label>
        <label class="interior-field"><span>Layout</span><select name="mode">${choices({automatic:"Automatic assembly",starter:"Original starter"},input.kit==="habitation-starter-v1"?"starter":"automatic")}</select></label>
        <label class="interior-field"><span>Cabins</span><select name="cabins" data-puzzle-control>${choices({2:"2 cabins",3:"3 cabins",4:"4 cabins",5:"5 cabins",6:"6 cabins"},initial.cabins)}</select></label>
        <label class="interior-field"><span>Cabin mix</span><select name="mix" data-puzzle-control>${choices({mixed:"Mixed quarters",standard:"Standard quarters",officer:"Officer suites"},initial.mix)}</select></label>
        <label class="interior-field"><span>Corridor</span><select name="shape" data-puzzle-control>${choices({bent:"Inboard bend",straight:"Straight passage"},initial.shape)}</select></label>
        <label class="interior-field"><span>Layout seed</span><input name="seed" data-puzzle-control maxlength="100" value="${esc(initial.seed)}"></label>
        <button type="button" data-puzzle-reroll data-puzzle-control>New layout</button>
        <label class="interior-field"><span>Outer hull side</span><select name="rotation">${choices({0:"Top",90:"Right",180:"Bottom",270:"Left"},initial.rotation)}</select></label>
        <label class="interior-field"><span>Grid resolution</span><select name="gridSize">${choices({70:"70 px / square",100:"100 px / square",140:"140 px / square"},initial.gridSize)}</select></label>
        <p class="interior-help">Each square is 1.5 m. Officer cabins are L-shaped, with a separate tub and shower. Cabins face the outer hull.</p>
        <p class="interior-help">The same seed and options reproduce the arrangement. This kit supports a straight hull edge; curved hulls, other room families and Jefferies routes are still in production.</p>
        <p class="interior-help">The preview shows open doorways. The new scene starts with closed, operable doors.</p>
      </div><div><div class="interior-preview"><img data-prefab-preview alt="Fitted Starfleet habitation preview" hidden></div><p data-prefab-status role="status" aria-live="polite">Preparing preview…</p></div></div>`,
      render:(_event,dialog)=>{
        activeDialog=dialog;const root=dialog.element;
        const preview=async()=>{
          const current=++revision;ready=false;
          const button=root.querySelector('[data-action="create"]'),status=root.querySelector('[data-prefab-status]'),img=root.querySelector('[data-prefab-preview]');
          if(button)button.disabled=true;status.textContent="Preparing preview…";
          try{
            const recipe=read(root),automatic=recipe.kit==="habitation-puzzle-v1";
            root.querySelectorAll('[data-puzzle-control]').forEach(el=>el.disabled=!automatic);
            const layout=automatic?generatePuzzle(library,recipe):kit;
            const blob=automatic?await renderPuzzleBlob(layout,library):await renderPrefabBlob(kit,recipe);
            if(current!==revision||!root.isConnected)return;
            const next=URL.createObjectURL(blob);if(previewURL)URL.revokeObjectURL(previewURL);previewURL=next;
            img.src=next;img.hidden=false;ready=true;
            status.textContent=`${(recipe.rotation%180?layout.height:layout.width)*1.5} × ${(recipe.rotation%180?layout.width:layout.height)*1.5} m canvas · ${layout.placements.length} pieces · ${layout.walls.filter(w=>w.door).length} doors · ${layout.walls.filter(w=>w.window).length} hull windows`;
          }catch(error){if(current===revision){status.textContent=error.message;img.hidden=true;}}
          finally{if(current===revision&&button)button.disabled=!ready||busy;}
        };
        root.querySelectorAll('select,[name="seed"]').forEach(el=>el.addEventListener("change",preview));
        root.querySelector('[data-puzzle-reroll]').addEventListener("click",()=>{root.querySelector('[name="seed"]').value=foundry.utils.randomID(10);preview();});
        preview();
      },
      buttons:[{action:"create",label:"Create Scene",icon:"fas fa-puzzle-piece",default:true,
        callback:async(_event,_button,dialog)=>{
          if(busy||!ready)throw new Error("Wait for a valid starter preview before creating the scene.");
          const root=dialog.element,recipe=read(root),name=root.querySelector('[name="sceneName"]').value;
          busy=true;root.querySelectorAll("button,input,select").forEach(el=>el.disabled=true);
          try{return await (recipe.kit==="habitation-puzzle-v1"?createPuzzleScene:createPrefabInteriorScene)(recipe,{name});}
          catch(error){ui.notifications.error(`Could not assemble interior: ${error.message}`);throw error;}
          finally{busy=false;root.querySelectorAll("button,input,select").forEach(el=>el.disabled=false);}
        }},{action:"cancel",label:"Cancel"}],
    });
  }finally{revision++;activeDialog=null;if(previewURL)URL.revokeObjectURL(previewURL);}
}
