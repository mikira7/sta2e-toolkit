// Deterministic drawing guides, not generated artwork. Run with Node.
import {readFile, mkdir, writeFile} from 'node:fs/promises';
const root = new URL('../docs/interior-prefabs/', import.meta.url);
const kit = JSON.parse(await readFile(new URL('starter-kit.json', root), 'utf8'));
const out = new URL('art-guides/', root);
await mkdir(out, {recursive:true});
const size=1536, scale=kit.masterPixelsPerUnit;
const path = points => `M${points.map(p=>p.join(',')).join('L')}Z`;
const segment = (a,b,color,width) => `<path d="M${a}L${b}" fill="none" stroke="${color}" stroke-width="${width}"/>`;
const distance=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const interpolate=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const on=(p,a,b)=>Math.abs(distance(a,p)+distance(p,b)-distance(a,b))<1e-6;
function wall(a,b,holes=[]){
  const length=distance(a,b); let start=0, svg='';
  const intervals=holes.map(({at,width})=>[distance(a,at)/length-width/length/2,distance(a,at)/length+width/length/2]).sort((a,b)=>a[0]-b[0]);
  for(const [lo,hi] of [...intervals,[1,1]]){
    if(lo>start)svg+=segment(interpolate(a,b,start),interpolate(a,b,lo),'#e0dcd5',kit.wallThickness);
    start=hi;
  }
  return svg;
}
const manifest={status:'drawing-guides-only',canvas:[size,size],pixelsPerUnit:scale,metresPerUnit:kit.metresPerUnit,pieces:[]};
for(const piece of kit.pieces){
  const xs=piece.footprint.map(p=>p[0]),ys=piece.footprint.map(p=>p[1]);
  const min=[Math.min(...xs),Math.min(...ys)],max=[Math.max(...xs),Math.max(...ys)];
  const origin=min.map((v,i)=>(size-(max[i]-v)*scale)/2-v*scale);
  const head=`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><clipPath id="footprint"><path d="${path(piece.footprint)}"/></clipPath></defs><g transform="translate(${origin}) scale(${scale})">`;
  const floor=piece.category==='corridor'?'#49474d':piece.category==='structure'?'#25262b':'#79737f';
  let body=`<path d="${path(piece.footprint)}" fill="${floor}"/>`;
  if(piece.bathroom)body+=`<path d="${path(piece.bathroom.polygon)}" fill="#adaaa4"/>`;
  body+='<g clip-path="url(#footprint)">';
  piece.footprint.forEach((a,i)=>{const b=piece.footprint[(i+1)%piece.footprint.length];body+=wall(a,b,piece.ports.filter(p=>on(p.at,a,b)).map(p=>({...p,width:kit.connectors[p.type].width})));});
  for(const p of piece.partitions??[])body+=wall(p.a,p.b,p.door?[p.door]:[]);
  for(const [a,b] of piece.windows??[])body+=segment(a,b,'#76b6c9',.08);
  body+='</g>';
  for(const f of piece.fixtures){
    const [x,y,w,h]=f.rect;
    body+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx=".035" fill="${['bed','chair','sofa'].includes(f.kind)?'#66809a':'#d5d1c9'}" stroke="#323238" stroke-width=".025"/>`;
    body+=`<text transform="translate(${x+w/2} ${y+h/2+.04}) scale(.009)" font-family="Arial" font-size="14" text-anchor="middle" fill="#17191c">${f.kind.toUpperCase()}</text>`;
  }
  await writeFile(new URL(`${piece.id}-guide.svg`,out),head+body+'</g></svg>');
  await writeFile(new URL(`${piece.id}-mask.svg`,out),head+`<path d="${path(piece.footprint)}" fill="white"/></g></svg>`);
  manifest.pieces.push({id:piece.id,name:piece.name,origin,footprintPixels:piece.footprint.map(p=>p.map((v,i)=>origin[i]+v*scale)),ports:piece.ports.map(p=>({...p,pixels:p.at.map((v,i)=>origin[i]+v*scale),widthPixels:kit.connectors[p.type].width*scale})),guide:`${piece.id}-guide.png`,mask:`${piece.id}-mask.svg`});
}
await writeFile(new URL('manifest.json',out),JSON.stringify(manifest,null,2)+'\n');
console.log(`Exported ${kit.pieces.length} fixed-canvas guides and masks (${size} px, ${scale} px/unit).`);
