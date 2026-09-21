// Geometry proof only: no Foundry documents or production generator changes.
// Run: node tests/interior-prefab-proof.mjs [--render]
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
const root=new URL("../docs/interior-prefabs/",import.meta.url);
const kit=JSON.parse(await readFile(new URL("starter-kit.json",root),"utf8"));
const near=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-5;
const key=p=>p.map(n=>Math.round(n*1e5)/1e5).join(",");
const length=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const at=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
const area=poly=>Math.abs(poly.reduce((s,a,i)=>{const b=poly[(i+1)%poly.length];return s+a[0]*b[1]-b[0]*a[1];},0))/2;
const edges=poly=>poly.map((a,i)=>[a,poly[(i+1)%poly.length]]);
function distance(p,a,b){const t=Math.max(0,Math.min(1,((p[0]-a[0])*(b[0]-a[0])+(p[1]-a[1])*(b[1]-a[1]))/length(a,b)**2));return length(p,at(a,b,t));}
function inside(p,poly,boundary=true){if(edges(poly).some(([a,b])=>distance(p,a,b)<1e-6))return boundary;let yes=false;for(const [a,b]of edges(poly))if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;return yes;}
const corners=([x,y,w,h])=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
function pose(p,placement){const a=placement.rotation*Math.PI/180;return [placement.at[0]+p[0]*Math.cos(a)-p[1]*Math.sin(a),placement.at[1]+p[0]*Math.sin(a)+p[1]*Math.cos(a)];}
function opening(port){const angle=(port.facing+90)*Math.PI/180,half=kit.connectors[port.type].width/2;return [-1,1].map(s=>[port.at[0]+s*half*Math.cos(angle),port.at[1]+s*half*Math.sin(angle)]);}
function splitWall(a,b,holes=[]){const len=length(a,b),ranges=holes.map(h=>h.map(p=>((p[0]-a[0])*(b[0]-a[0])+(p[1]-a[1])*(b[1]-a[1]))/len**2).sort((a,b)=>a-b)).sort((a,b)=>a[0]-b[0]);const out=[];let t=0;for(const [start,end]of ranges){if(start>t+1e-6)out.push({a:at(a,b,t),b:at(a,b,start)});t=end;}if(t<1-1e-6)out.push({a:at(a,b,t),b});return out;}
function pieceWalls(piece){const walls=[];for(const [a,b]of edges(piece.footprint)){const ports=piece.ports.filter(p=>distance(p.at,a,b)<1e-6);walls.push(...splitWall(a,b,ports.map(opening)));}for(const part of piece.partitions??[]){let holes=[];if(part.door){const len=length(part.a,part.b),mid=length(part.a,part.door.at)/len,half=part.door.width/(2*len);holes=[[at(part.a,part.b,mid-half),at(part.a,part.b,mid+half)]];walls.push({a:holes[0][0],b:holes[0][1],door:true});}walls.push(...splitWall(part.a,part.b,holes));}return walls;}
function mergeWalls(walls){const points=walls.flatMap(w=>[w.a,w.b]),merged=new Map();for(const wall of walls){const len=length(wall.a,wall.b),cuts=points.filter(p=>distance(p,wall.a,wall.b)<1e-6).map(p=>length(wall.a,p)/len).sort((a,b)=>a-b);for(let i=1;i<cuts.length;i++){if(cuts[i]-cuts[i-1]<1e-6)continue;const a=at(wall.a,wall.b,cuts[i-1]),b=at(wall.a,wall.b,cuts[i]),id=[key(a),key(b)].sort().join("/");if(!merged.has(id)||wall.door)merged.set(id,{a,b,door:!!wall.door});}}return [...merged.values()];}

// A one-square token must reach all declared standing/approach positions with doors open.
function checkWalking(piece){if(!piece.accessPoints?.length)return;const walls=pieceWalls(piece).filter(w=>!w.door),radius=.5,step=.05;
  const clear=p=>inside(p,piece.footprint)&&walls.every(w=>distance(p,w.a,w.b)>=radius+kit.wallThickness/2-1e-6)&&piece.fixtures.every(f=>{const [x,y,w,h]=f.rect;return Math.hypot(p[0]-Math.max(x,Math.min(x+w,p[0])),p[1]-Math.max(y,Math.min(y+h,p[1])))>=radius-1e-6;});
  for(const p of piece.accessPoints)assert.ok(clear(p),`${piece.id}: standing clearance at ${p}`);
  const xs=piece.footprint.map(p=>p[0]),ys=piece.footprint.map(p=>p[1]),w=Math.ceil((Math.max(...xs)+1)/step),h=Math.ceil((Math.max(...ys)+1)/step),snap=p=>[Math.round(p[0]/step),Math.round(p[1]/step)];
  const start=snap(piece.accessPoints[0]),todo=[start],seen=new Set([start.join()]);
  while(todo.length){const [x,y]=todo.pop();for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const a=x+dx,b=y+dy,k=`${a},${b}`;if(a<0||b<0||a>w||b>h||seen.has(k)||!clear([a*step,b*step]))continue;seen.add(k);todo.push([a,b]);}}
  for(const p of piece.accessPoints)assert.ok(seen.has(snap(p).join()),`${piece.id}: reachable approach at ${p}`);
}
const byId=new Map(kit.pieces.map(p=>[p.id,p]));assert.equal(byId.size,kit.pieces.length);
for(const piece of kit.pieces){assert.ok(area(piece.footprint)>0);for(const port of piece.ports){assert.ok(kit.connectors[port.type]);assert.ok(edges(piece.footprint).some(([a,b])=>opening(port).every(p=>distance(p,a,b)<1e-6)),`${piece.id}: port fits a boundary`);}
  for(const fixture of piece.fixtures){assert.ok(corners(fixture.rect).every(p=>inside(p,piece.footprint)),`${piece.id}: fixture inside footprint`);if(["shower","basin","toilet","tub"].includes(fixture.kind))assert.ok(corners(fixture.rect).every(p=>inside(p,piece.bathroom.polygon)),`${piece.id}: fixture inside bathroom`);}
  if(piece.bathroom){assert.ok(edges(piece.bathroom.polygon).filter(([a,b])=>edges(piece.footprint).some(([c,d])=>distance(a,c,d)<1e-6&&distance(b,c,d)<1e-6)).length>=2,`${piece.id}: bathroom shares two perimeter walls`);assert.equal(piece.fixtures.some(f=>f.kind==="tub"),piece.bathroom.tub);}
  checkWalking(piece);
}
const placements=kit.assembly.placements.map(p=>({...p,master:byId.get(p.piece),polygon:byId.get(p.piece).footprint.map(v=>pose(v,p))}));
const ports=placements.flatMap(p=>p.master.ports.map(port=>({...port,id:`${p.id}/${port.id}`,owner:p.id,at:pose(port.at,p),facing:(port.facing+p.rotation)%360})));
const joins=[],used=new Set();for(const port of ports){if(used.has(port.id))continue;const matches=ports.filter(p=>p.id!==port.id&&near(p.at,port.at)&&p.type===port.type&&(p.facing-port.facing+360)%360===180);assert.equal(matches.length,1,`Exactly one mate for ${port.id}`);joins.push([port,matches[0]]);used.add(port.id);used.add(matches[0].id);}
for(let i=0;i<placements.length;i++)for(const b of placements.slice(i+1)){const a=placements[i];for(let x=Math.min(...a.polygon.map(p=>p[0]))+.071;x<Math.max(...a.polygon.map(p=>p[0]));x+=.1)for(let y=Math.min(...a.polygon.map(p=>p[1]))+.073;y<Math.max(...a.polygon.map(p=>p[1]));y+=.1)assert.ok(!(inside([x,y],a.polygon,false)&&inside([x,y],b.polygon,false)),`No floor overlap: ${a.id}/${b.id}`);}
const graph=new Map(placements.filter(p=>p.master.category!=="structure").map(p=>[p.id,[]]));for(const [a,b]of joins){graph.get(a.owner).push(b.owner);graph.get(b.owner).push(a.owner);}const seen=new Set(),todo=[graph.keys().next().value];while(todo.length){const id=todo.pop();if(seen.has(id))continue;seen.add(id);todo.push(...graph.get(id));}assert.equal(seen.size,graph.size);
assert.ok(placements.filter(p=>p.master.zone==="inboard").every(p=>Math.min(...p.polygon.map(v=>v[1]))>=2.1));
assert.ok(placements.filter(p=>p.master.zone==="outboard").every(p=>Math.max(...p.polygon.map(v=>v[1]))<=0));
for(const rotation of [0,90,180,270])for(const [a,b]of joins){const transform={rotation,at:[0,0]};assert.ok(near(pose(a.at,transform),pose(b.at,transform)));assert.equal(((a.facing+rotation)-(b.facing+rotation)+360)%360,180);}
const walls=mergeWalls([...placements.flatMap(p=>pieceWalls(p.master).map(w=>({...w,a:pose(w.a,p),b:pose(w.b,p)}))),...joins.filter(([p])=>p.type==="room").map(([p])=>{const [a,b]=opening(p);return {a,b,door:true};})]);
assert.equal(walls.filter(w=>w.door).length,5,"Three external doors and two bathroom doors, with no duplicates");

const colors={room:"#283d50",corridor:"#263b39",bath:"#305f65",structure:"#303137",wall:"#d5dbe0",port:"#63d9c1",door:"#f9b16d",fixture:"#8da4b6",floor:"#101c28"};
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const path=poly=>`M${poly.map(p=>p.join(',')).join('L')}Z`;
const line=(a,b,style)=>`<path d="M${a}L${b}" fill="none" ${style}/>`;
const label=(x,y,s,size=14,fill="#dce7ef",anchor="start")=>size<1?`<text transform="translate(${x} ${y}) scale(${size/14})" font-size="14" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`:`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
function drawPiece(piece,showPorts=true){let svg=`<path d="${path(piece.footprint)}" fill="${colors[piece.category]}"/>`;
  if(piece.bathroom)svg+=`<path d="${path(piece.bathroom.polygon)}" fill="${colors.bath}"/>`;
  svg+=`<path d="${path(piece.footprint)}" fill="url(#grid)"/>`;
  for(const f of piece.fixtures){const [x,y,w,h]=f.rect;svg+=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx=".06" fill="${f.kind==='tub'?'#c9b5da':colors.fixture}" stroke="#14232f" stroke-width=".025"/>`;svg+=label(x+w/2,y+h/2+.055,{shower:'SH',toilet:'WC',basin:'B',tub:'TUB',console:'•',chair:'C',bed:'BED',desk:'DESK',sofa:'SOFA',table:'TABLE'}[f.kind],.16,'#14232f','middle');}
  for(const wall of pieceWalls(piece))svg+=line(wall.a,wall.b,`stroke="${wall.door?colors.door:colors.wall}" stroke-width="${wall.door?.04:kit.wallThickness}" ${wall.door?'stroke-dasharray=".1 .06"':''}`);
  for(const [a,b]of piece.windows??[])svg+=line(a,b,'stroke="#7dc5f4" stroke-width=".075"');
  if(showPorts)for(const port of piece.ports){const [a,b]=opening(port);svg+=line(a,b,`stroke="${port.type==='room'?colors.door:colors.port}" stroke-width=".06"`);svg+=`<circle cx="${port.at[0]}" cy="${port.at[1]}" r=".1" fill="${colors.port}"/>`;}
  return svg;
}
function begin(w,h){return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="#dce7ef" stroke-opacity=".08" stroke-width=".015"/></pattern></defs><rect width="100%" height="100%" fill="${colors.floor}"/><g font-family="Arial,sans-serif">`;}
if(process.argv.includes('--render')){
  let sheet=begin(1320,1440)+label(40,48,'STARFLEET TNG / PREFAB FOOTPRINT STUDY',26)+label(40,78,'Geometry proof • not final artwork • all pieces shown at the same scale • 1 square = 1.5 m',15,'#94afc3');
  kit.pieces.forEach((piece,i)=>{const x=35+(i%3)*430,y=115+Math.floor(i/3)*430;sheet+=`<rect x="${x}" y="${y}" width="415" height="412" rx="10" fill="#182836"/>`+label(x+18,y+30,piece.id+'  '+piece.name,17)+`<g transform="translate(${x+35} ${y+60}) scale(49)">${drawPiece(piece)}</g>`;const xs=piece.footprint.map(p=>p[0]),ys=piece.footprint.map(p=>p[1]);sheet+=label(x+18,y+380,`${((Math.max(...xs)-Math.min(...xs))*1.5).toFixed(2)} × ${((Math.max(...ys)-Math.min(...ys))*1.5).toFixed(2)} m wall-centre envelope`,13,'#94afc3');});
  sheet+=label(40,1430,'SH sonic shower   WC toilet   B basin   Orange doorway   Green joining port   Cyan hull glazing',14,'#94afc3')+'</g></svg>';
  await writeFile(new URL('starter-footprints.svg',root),sheet);
  let map=begin(1500,1120)+label(45,52,'HABITATION / ASSEMBLY PROOF',28)+label(45,84,'Nine reusable masters • ten placements • every port paired • lift on the inboard side',17,'#94afc3')+label(45,126,'OUTBOARD / HULL SIDE',15,'#7dc5f4');
  map+='<g transform="translate(165 580) scale(71)">';
  for(const p of placements){map+=`<g transform="translate(${p.at}) rotate(${p.rotation})">${drawPiece(p.master,false)}</g>`;const xs=p.polygon.map(v=>v[0]),ys=p.polygon.map(v=>v[1]);if(p.master.category==='room')map+=label((Math.min(...xs)+Math.max(...xs))/2,Math.max(...ys)-.2,p.piece,.2,'#dce7ef','middle');}
  for(const [a]of joins){const [p,q]=opening(a);map+=line(p,q,`stroke="${a.type==='room'?colors.door:colors.port}" stroke-width=".045" stroke-dasharray=".1 .05"`);}
  map+=`<circle cx="5.5" cy="1.05" r=".5" fill="#63d9c1" fill-opacity=".12" stroke="#63d9c1" stroke-width=".035"/>`;
  map+='</g>'+label(45,1000,'INBOARD / SHIP INTERIOR',15,'#94afc3')+label(45,1040,'Standard bathroom: 9.9 m² • Officer bathroom: 15.1 m² with tub • Corridor: 3 m clear',18)+label(45,1074,'Dashed green = module seam   Orange = one shared door   Circle = one-square token   Dark infill = structure',15,'#94afc3')+'</g></svg>';
  await writeFile(new URL('starter-assembly.svg',root),map);
  await writeFile(new URL('starter-assembly-walls.json',root),JSON.stringify({units:'grid squares; 1 unit = 1.5 m',status:'prototype, not a Foundry import',walls},null,2)+'\n');
}
console.log(`Verified ${kit.pieces.length} masters, ${placements.length} placements, ${joins.length} exact connections, ${walls.length} merged wall/door segments, no footprint overlaps, inboard lift placement and one-square-token access in both cabins.`);
