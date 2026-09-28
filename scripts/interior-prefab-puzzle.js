import {generatePuzzle,normalizePuzzleRecipe} from './interior-prefab-layout.js';
import {PREFAB_ROOT,prefabLayoutSceneData,savePrefabScene} from './interior-prefab-scene.js';
export {generatePuzzle,normalizePuzzleRecipe};
let libraryPromise;
export async function loadPuzzleLibrary(){
  if(!libraryPromise)libraryPromise=fetch(`${PREFAB_ROOT}/assembly-library.json`).then(async r=>{if(!r.ok)throw new Error('Puzzle library could not be loaded.');return r.json();}).catch(e=>{libraryPromise=null;throw e;});
  return libraryPromise;
}
const cache=new Map();
async function imageData(file,expected){
  const id=`${file}:${expected}`;
  if(!cache.has(id))cache.set(id,(async()=>{
    const r=await fetch(`${PREFAB_ROOT}/${file}`);if(!r.ok)throw new Error(`Missing puzzle artwork: ${file}`);
    const bytes=await r.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==expected)throw new Error(`Puzzle artwork changed: ${file}. Rebuild the library.`);
    return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error(`Cannot read ${file}`));reader.readAsDataURL(new Blob([bytes],{type:'image/png'}));});
  })().catch(e=>{cache.delete(id);throw e;}));
  return cache.get(id);
}
const path=poly=>'M'+poly.map(p=>p.join(',')).join('L')+'Z';
/** Layered composition of immutable fitted masters; all pieces keep uniform scale. */
export function puzzleSVG(layout,library,sources){
  const r=layout.recipe.rotation,swap=r%180!==0,w=swap?layout.height:layout.width,h=swap?layout.width:layout.height;
  const ppu=Math.min(layout.recipe.gridSize,8192/Math.max(w,h));
  const defs=library.pieces.map(p=>`<clipPath id="clip-${p.id}"><path d="${path(p.footprint)}"/></clipPath>`).join('');
  const transform=p=>`translate(${p.at}) rotate(${p.rotation})`;
  const corridors=layout.placements.filter(p=>library.pieces.find(k=>k.id===p.piece).category==='corridor');
  const mask=`<mask id="floor" maskUnits="userSpaceOnUse" x="0" y="0" width="${layout.width}" height="${layout.height}"><g fill="white">${corridors.map(p=>`<path transform="${transform(p)}" d="${path(library.pieces.find(k=>k.id===p.piece).footprint)}"/>`).join('')}</g><g stroke="black" stroke-width="${library.wallThickness}" stroke-linecap="butt">${layout.walls.filter(w=>!w.door).map(w=>`<path d="M${w.a}L${w.b}"/>`).join('')}</g></mask>`;
  const pattern=`<pattern id="carpet" patternUnits="userSpaceOnUse" width="2" height="2"><image href="${sources.carpet}" width="2" height="2"/></pattern>`;
  const body=layout.placements.map(p=>{
    const piece=library.pieces.find(k=>k.id===p.piece),a=piece.art,scale=a.registration.pixelsPerUnit,origin=a.registration.origin;
    return `<g transform="${transform(p)}" data-piece="${p.id}"><g clip-path="url(#clip-${piece.id})"><path d="${path(piece.footprint)}" fill="${piece.category==='structure'?'#313338':'#79737f'}"/><image href="${sources[piece.id]}" x="${-origin[0]/scale}" y="${-origin[1]/scale}" width="${a.canvas[0]/scale}" height="${a.canvas[1]/scale}"/></g></g>`;
  }).join('');
  const offset={0:[0,0],90:[layout.height,0],180:[layout.width,layout.height],270:[0,layout.width]}[r];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w*ppu)}" height="${Math.round(h*ppu)}" viewBox="0 0 ${w} ${h}"><defs>${defs}${mask}${pattern}</defs><rect width="${w}" height="${h}" fill="#151d25"/><g transform="translate(${offset}) rotate(${r})">${body}<g mask="url(#floor)"><rect width="${layout.width}" height="${layout.height}" fill="url(#carpet)"/><rect width="${layout.width}" height="${layout.height}" fill="#20252c" opacity=".24"/></g></g></svg>`;
}
export async function renderPuzzleBlob(layout,library){
  const needed=new Set(layout.placements.map(p=>p.piece)),sources={};
  await Promise.all([...library.pieces.filter(p=>needed.has(p.id)).map(async p=>{sources[p.id]=await imageData(p.art.file,p.art.sha256);}),
    (async()=>{sources.carpet=await imageData(library.corridorFinish.file,library.corridorFinish.sha256);})()]);
  const svg=puzzleSVG(layout,library,sources),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),image=new Image(),surface=document.createElement('canvas');
  try{image.src=url;await image.decode();surface.width=image.naturalWidth;surface.height=image.naturalHeight;
    const ctx=surface.getContext('2d');if(!ctx)throw new Error('Canvas rendering unavailable.');ctx.drawImage(image,0,0);
    return await new Promise((resolve,reject)=>surface.toBlob(b=>b?resolve(b):reject(new Error('Puzzle image could not be rendered.')),'image/webp',.96));
  }finally{URL.revokeObjectURL(url);surface.width=surface.height=0;}
}
export async function createPuzzleScene(input={},options={}){
  if(!game.user?.isGM)throw new Error('Only a GM can create interior scenes.');
  const library=await loadPuzzleLibrary(),layout=generatePuzzle(library,input),data=prefabLayoutSceneData(layout,layout.recipe,null,{name:options.name??'Starfleet Habitation',generation:game.release?.generation??13});
  new Scene(data,{strict:true});const blob=await renderPuzzleBlob(layout,library);
  return savePrefabScene(data,blob,layout.recipe,options);
}
