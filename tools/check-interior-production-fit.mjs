// Read-only raster registration and a diagnostic SVG overlay. Source images are never altered.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fitRegistration} from './interior-prefab-registration.mjs';
const root=new URL('../',import.meta.url),out=new URL('assets/interiors/prefabs/production/',root);
const kit=JSON.parse(await readFile(new URL('docs/interior-prefabs/cabin-revisions/catalog.json',root),'utf8'));
const measurements=JSON.parse(await readFile(new URL('registration-measurements.json',out),'utf8'));
const report={status:'fit-review-not-runtime-approval',method:measurements.method,thresholdUnits:measurements.maxResidualUnits,candidates:[]};
for(const candidate of measurements.candidates){
  const piece=kit.pieces.find(p=>p.id===candidate.piece);
  const bytes=await readFile(new URL(candidate.file,out)),sha256=createHash('sha256').update(bytes).digest('hex');
  if(sha256!==candidate.sourceSha256||createHash('sha256').update(JSON.stringify(piece)).digest('hex')!==candidate.geometrySha256)throw new Error(`Stale measurements for ${candidate.file}; remeasure after image or geometry changes.`);
  const actualDoors=[...piece.ports.map(p=>{const angle=(p.facing+90)*Math.PI/180;return [-1,1].map(s=>[p.at[0]+s*.6*Math.cos(angle),p.at[1]+s*.6*Math.sin(angle)]);}),...piece.partitions.filter(p=>p.door).map(p=>{const length=Math.hypot(p.b[0]-p.a[0],p.b[1]-p.a[1]);return [-1,1].map(s=>p.door.at.map((v,i)=>v+s*p.door.width/2*(p.b[i]-p.a[i])/length));})];
  const same=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-5;
  if(candidate.doors.length!==actualDoors.length||!actualDoors.every(d=>candidate.doors.some(c=>d.every(p=>c.units.some(q=>same(p,q))))))throw new Error(`Measurements must include every approved aperture for ${candidate.file}.`);
  const fit=fitRegistration(piece.footprint.map((units,i)=>({units,pixels:candidate.corners[i]})));
  const project=p=>p.map((v,i)=>fit.origin[i]+v*fit.pixelsPerUnit);
  const endpoints=candidate.doors.flatMap(d=>d.units.map((p,i)=>({door:d.name,units:p,observed:d.pixels[i],predicted:project(p),residualUnits:Math.hypot(...project(p).map((v,k)=>v-d.pixels[i][k]))/fit.pixelsPerUnit})));
  const maxDoorResidualUnits=Math.max(...endpoints.map(e=>e.residualUnits));
  const passed=Math.max(fit.maxResidualUnits,maxDoorResidualUnits)<=measurements.maxResidualUnits;
  report.candidates.push({file:candidate.file,sha256,fit,maxDoorResidualUnits,endpoints,fitPassed:passed,runtimeReady:false,remaining:candidate.remaining});
  const line=(a,b,color,width=2)=>`<path d="M${a}L${b}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
  let overlay='';
  for(let i=0;i<piece.footprint.length;i++)overlay+=line(project(piece.footprint[i]),project(piece.footprint[(i+1)%piece.footprint.length]),'#32f0bb');
  for(const p of piece.partitions)overlay+=line(project(p.a),project(p.b),'#32f0bb');
  for(const door of candidate.doors){overlay+=line(project(door.units[0]),project(door.units[1]),'#ff42e2',5);for(const p of door.pixels)overlay+=`<circle cx="${p[0]}" cy="${p[1]}" r="5" fill="#ffff33"/>`;}
  const name=candidate.file.replace('.png','-fit.svg');
  await writeFile(new URL(name,out),`<svg xmlns="http://www.w3.org/2000/svg" width="2035" height="773"><rect width="100%" height="100%" fill="#273340"/><image href="data:image/png;base64,${bytes.toString('base64')}" width="2035" height="773"/>${overlay}</svg>`);
}
await writeFile(new URL('registration-report.json',out),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.candidates.map(c=>({file:c.file,fitPassed:c.fitPassed,maxDoorErrorUnits:c.maxDoorResidualUnits}))));
if(report.candidates.some(c=>!c.fitPassed))process.exitCode=1;
