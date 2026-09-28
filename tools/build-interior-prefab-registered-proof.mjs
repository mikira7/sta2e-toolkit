// Compiles a passive SVG deck proof from immutable raster art and fixed geometry.
// This is scene rendering, not a modification of any generated source PNG.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fitRegistration,rasterPlacement,polygonPath,doorSegments,renderDoorLayer,corridorFinishGeometry} from './interior-prefab-registration.mjs';
const root=new URL('../',import.meta.url),art=new URL('assets/interiors/prefabs/starfleet-tng/',root);
const read=async url=>JSON.parse(await readFile(url,'utf8'));
const kit=await read(new URL('docs/interior-prefabs/starter-kit.json',root));
const catalog=await read(new URL('catalog.json',art));
const specs=await read(new URL('registration-anchors.json',art));
const registered=[];
for(const item of catalog.pieces){
  const spec=specs.pieces.find(p=>p.id===item.id);
  if(spec.file!==item.file)throw new Error(`${item.id}: calibration is for a different image revision.`);
  const fit=fitRegistration(spec.anchors),bytes=await readFile(new URL(item.file,art));
  registered.push({...item,canvas:spec.canvas,registration:fit,sha256:createHash('sha256').update(bytes).digest('hex'),source:`data:image/png;base64,${bytes.toString('base64')}`});
}
const doors=doorSegments(kit);
const carpet=await readFile(new URL('assets/interiors/floor-room-carpet.png',root));
const finish=corridorFinishGeometry(kit);
const finishMask=`<mask id="corridor-finish" maskUnits="userSpaceOnUse" x="-2" y="-7" width="20" height="13"><g fill="white">${finish.polygons.map(p=>`<path d="${polygonPath(p)}"/>`).join('')}</g><g stroke="black" stroke-width="${kit.wallThickness}" stroke-linecap="butt">${finish.walls.map(w=>`<path d="M${w.a}L${w.b}"/>`).join('')}</g></mask>`;
const floorPattern=`<pattern id="shared-carpet" patternUnits="userSpaceOnUse" width="2" height="2"><image href="data:image/png;base64,${carpet.toString('base64')}" width="2" height="2"/></pattern>`;
const defs=kit.pieces.map(p=>`<clipPath id="clip-${p.id}" clipPathUnits="userSpaceOnUse"><path d="${polygonPath(p.footprint)}"/></clipPath>`).join('')+finishMask+floorPattern;
const body=kit.assembly.placements.map(place=>{
  const item=registered.find(p=>p.id===place.piece),piece=kit.pieces.find(p=>p.id===place.piece),r=rasterPlacement(item.registration,item.canvas);
  const floor=piece.category==='corridor'?'#505057':piece.category==='structure'?'#313338':'#79737f';
  return `<g data-piece="${place.id}" transform="translate(${place.at}) rotate(${place.rotation})"><g clip-path="url(#clip-${piece.id})"><path d="${polygonPath(piece.footprint)}" fill="${floor}"/><image href="${item.source}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"/></g></g>`;
}).join('');
const corridorFinish='<g mask="url(#corridor-finish)"><rect x="-2" y="-7" width="20" height="13" fill="url(#shared-carpet)"/><rect x="-2" y="-7" width="20" height="13" fill="#20252c" opacity=".24"/></g>';
const wrap=(content,title)=>`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1300" viewBox="-2 -7 20 13"><title>${title}</title><defs>${defs}</defs><rect x="-2" y="-7" width="20" height="13" fill="#151d25"/>${content}</svg>`;
await writeFile(new URL('registered-assembly.svg',art),wrap(body+corridorFinish,'Registered habitation artwork — fitting proof, doors open'));
await writeFile(new URL('registered-assembly-closed.svg',art),wrap(body+corridorFinish+renderDoorLayer(doors,{closed:true}),'Registered habitation artwork — fitting proof, doors closed'));
await writeFile(new URL('registered-door-layer.svg',art),`<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1300" viewBox="-2 -7 20 13">${renderDoorLayer(doors,{closed:true})}</svg>`);
const report={status:'registered-proof-not-foundry-approved',date:'2026-09-22',method:'Least-squares uniform translation and scale from recorded anchors; exact polygon clip during scene rendering; plain underlay fills transparent raster edge holes; no source raster edits. Shared corridor finish is a world-aligned texture layer masked by exact corridor and wall geometry.',corridorFinish:{source:'assets/interiors/floor-room-carpet.png',sha256:createHash('sha256').update(carpet).digest('hex'),repeatUnits:2,wallThicknessUnits:kit.wallThickness},doors,placements:kit.assembly.placements,pieces:registered.map(({source,...item})=>item)};
await writeFile(new URL('registration-report.json',art),JSON.stringify(report,null,2)+'\n');
console.log(registered.map(p=>`${p.id}: ${(p.registration.maxResidualUnits*1.5*100).toFixed(1)} cm maximum anchor residual`).join('\n'));
console.log(`Saved open/closed deck proofs and separate ${doors.length}-door layer.`);
