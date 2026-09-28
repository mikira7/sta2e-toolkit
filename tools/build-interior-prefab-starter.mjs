// Compile the approved fitting assembly into a self-contained runtime manifest.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {placePoint} from './interior-prefab-registration.mjs';
const root=new URL('../',import.meta.url), art=new URL('assets/interiors/prefabs/starfleet-tng/',root);
const json=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'));
const kit=await json('docs/interior-prefabs/starter-kit.json');
const source=await json('docs/interior-prefabs/starter-assembly-walls.json');
const report=await json('assets/interiors/prefabs/starfleet-tng/registration-report.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const piece of report.pieces)if(hash(await readFile(new URL(piece.file,art)))!==piece.sha256)throw new Error(`Rebuild registration for ${piece.id}.`);
const shift=p=>p.map((v,i)=>Math.round((v+[2,7][i])*1e6)/1e6);
const windows=kit.assembly.placements.flatMap(p=>(kit.pieces.find(k=>k.id===p.piece).windows??[]).map(w=>w.map(pt=>placePoint(pt,p))));
const along=(p,w)=>{
  const dx=w.b[0]-w.a[0],dy=w.b[1]-w.a[1],len2=dx*dx+dy*dy;
  if(Math.abs((p[0]-w.a[0])*dy-(p[1]-w.a[1])*dx)>1e-6)return null;
  const t=((p[0]-w.a[0])*dx+(p[1]-w.a[1])*dy)/len2;
  return t>=-1e-6&&t<=1+1e-6?t:null;
};
let windowCount=0;
const walls=source.walls.flatMap((w,index)=>{
  const intervals=windows.map(win=>win.map(p=>along(p,w))).filter(ts=>ts.every(t=>t!==null)).map(ts=>ts.sort((a,b)=>a-b));
  if(w.door&&intervals.length)throw new Error('Window overlaps a door.');
  const cuts=[0,...intervals.flat(),1].sort((a,b)=>a-b);
  const point=t=>shift(w.a.map((v,i)=>v+(w.b[i]-v)*t));
  return cuts.slice(1).flatMap((hi,i)=>{
    const lo=cuts[i];if(hi-lo<1e-6)return [];
    const window=intervals.some(([a,b])=>(lo+hi)/2>a&&(lo+hi)/2<b);
    if(window)windowCount++;
    return [{key:`wall-${index}-${i}`,a:point(lo),b:point(hi),door:w.door,window}];
  });
});
if(windowCount!==windows.length||walls.filter(w=>w.door).length!==5)throw new Error('Starter aperture count changed. Review geometry before export.');
const manifest={
  schemaVersion:1,id:'habitation-starter-v1',status:'experimental-fixed-assembly',style:kit.style,
  width:20,height:13,metresPerUnit:kit.metresPerUnit,
  background:{file:'registered-assembly.png',sha256:hash(await readFile(new URL('registered-assembly.png',art))),pixels:[2000,1300]},
  sourceHashes:{geometry:hash(await readFile(new URL('docs/interior-prefabs/starter-kit.json',root))),walls:hash(await readFile(new URL('docs/interior-prefabs/starter-assembly-walls.json',root)))},
  entry:shift([2,1.05]),walls,
  lights:[[-.5+1.5,-2.2,6],[3.5,-4,4],[10.5,-2.8,7],[8.2,-4.6,4],[2,3.3,4],[2,1.05,7],[6,1.05,7],[10,1.05,7],[14.8,1.05,6],[15.05,3.3,5]].map(([x,y,radius])=>({at:shift([x,y]),radius})),
  placements:kit.assembly.placements.map(p=>({...p,at:shift(p.at),polygon:kit.pieces.find(k=>k.id===p.piece).footprint.map(pt=>shift(placePoint(pt,p)))})),
  pieces:report.pieces.map(({id,file,sha256})=>({id,file,sha256}))
};
await writeFile(new URL('starter-scene.json',art),JSON.stringify(manifest,null,2)+'\n');
console.log(`Starter: ${walls.length} walls, ${windowCount} windows, five doors; artwork pinned by SHA-256.`);
