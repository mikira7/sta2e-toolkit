import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {roomCorridorModule,blankCorridorHalf,jefferiesCorridorHalf,assembleRoomCorridor} from '../scripts/interior-room-corridor-layout.js';
const root=new URL('../',import.meta.url),out=new URL('docs/interior-prefabs/room-corridor-halves/',root);
await mkdir(out,{recursive:true});
const bytes=await readFile(new URL('docs/interior-prefabs/cabin-revisions/catalog.json',root));
const cabins=JSON.parse(bytes),modules=cabins.pieces.flatMap(p=>['interior','hull'].map(location=>roomCorridorModule(cabins,p,{location})));
const alcove=jefferiesCorridorHalf(),blank=blankCorridorHalf(2.5);
const get=(id,location='interior')=>modules.find(m=>m.sourceRoom===id&&m.location===location);
const proof=assembleRoomCorridor({north:[get('Q03-R','hull'),get('Q01-B','hull')],south:[get('Q04-P'),alcove,blank]});
const catalog={schemaVersion:2,status:'approved-architecture-geometry-proof',metresPerUnit:1.5,wallThickness:.1,
  sourceGeometrySha256:createHash('sha256').update(bytes).digest('hex'),
  corridor:{clearWidth:2,halfClearWidth:1,wallCentreToSeam:1.05,join:'floor-centreline',centreStripWidth:.1},
  rules:['Room and corridor-facing wall are a single artwork master.','Room entrance is an internal native door, not an artwork connector.',
    'Floor seams are open and never export as walls or doors.','One shared centre finish owns the floor join; no duplicated central runners.',
    'Unequal bank frontages require explicit blank-half coverage.','Ends, bends and junctions own their full corridor cross-section.',
    'Jefferies hatch stays closed until connected to a maintenance destination.',
    'Interior cabins use a solid rear-wall layer; windows require an exposed hull bank.',
    'Straight hull rows require equal cabin depths; curved rows require measured adapters, not stretched room images.',
    'Cabin base artwork omits the rear-wall band; exactly one matching solid or windowed layer completes it.'],
  hullWallPlan:{straight:'implemented',curved:'geometry-pending',
    approach:'One shared hull curve with registered wall sections, reserved service wedges and matching collision geometry.',
    constraints:['Keep cabin furnishings and corridor entrances at their approved scale.',
      'A curved decorative overlay cannot change the walkable boundary by itself.',
      'Do not rotate individual rooms without also solving corridor-half seams and intervening gaps.',
      'Window and solid variants must share wall endpoints, thickness and lighting.']},
  modules:[...modules,alcove,blank],
  supportArtwork:[{id:'BLANK-HC',purpose:'Repeatable wall and floor half, clipped to exact frontage'},
    {id:'END-FULL',purpose:'One full-width corridor cap'},
    {id:'BEND-FULL',purpose:'Full-width bend; pair of half-floor interfaces at each end',status:'geometry-pending'},
    {id:'T-FULL',purpose:'Full-width junction; pair of half-floor interfaces on each branch',status:'geometry-pending'},
    {id:'CENTRE-FINISH',purpose:'World-aligned narrow floor seam treatment'},
    {id:'REAR-SOLID',purpose:'Solid rear-wall layer, matched to each cabin frontage'},
    {id:'REAR-WINDOWED',purpose:'Hull-facing rear-wall layer with registered cabin window positions'},
    {id:'HULL-CURVED',purpose:'Measured gentle-curve wall sections and service wedges',status:'geometry-pending'}]};
await writeFile(new URL('catalog.json',out),JSON.stringify(catalog,null,2)+'\n');
await writeFile(new URL('assembly-proof.json',out),JSON.stringify(proof,null,2)+'\n');
const roomBodies=new Map();
for(const room of cabins.pieces){
  const svg=await readFile(new URL(`docs/interior-prefabs/cabin-revisions/${room.id}-production-guide.svg`,root),'utf8');
  roomBodies.set(room.id,`<g transform="scale(${1/110}) translate(-11 -11)">${svg.replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'')}</g>`);
}
const path=p=>'M'+p.map(v=>v.join(',')).join('L')+'Z';
const line=(a,b,color,width=.1)=>`<path d="M${a}L${b}" stroke="${color}" stroke-width="${width}" fill="none"/>`;
function body(m){
  let s=`<path d="${path(m.footprint)}" fill="#626973"/><path d="${path(m.corridorFloor)}" fill="#907d89"/>`;
  if(m.room){
    s+=roomBodies.get(m.sourceRoom);
    // Replace the original guide's rear facade with the selected geometry layer.
    s+=line([0,0],[m.frontage,0],'#e0dcd5',m.wallThickness);
    for(const [a,b]of m.rearWallLayer.windows)s+=line(a,b,'#6fcee0',.07);
  }
  else for(const w of m.walls)s+=line(w.a,w.b,'#e0dcd5');
  if(m.alcoveClearFloor){s+=`<path d="${path(m.alcoveClearFloor)}" fill="#657f90"/>`;s+=line([1.6,0],[2.4,0],'#e8a95b',.07);}
  const y=m.roomDepth+m.halfSpan;
  s+=`<path d="M0 ${y}H${m.frontage}" stroke="#74e8ca" stroke-width=".025" stroke-dasharray=".12 .1" fill="none"/>`;
  return s;
}
for(const module of catalog.modules){
  const ppu=110,width=Math.round((module.frontage+.2)*ppu),height=Math.round((module.roomDepth+module.halfSpan+.2)*ppu);
  await writeFile(new URL(`${module.id}-guide.svg`,out),`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="-.1 -.1 ${module.frontage+.2} ${module.roomDepth+module.halfSpan+.2}">${body(module)}</svg>`);
  if(module.room){
    const layers=module.rearWallLayer.walls.map(w=>line(w.a,w.b,'#e0dcd5',module.wallThickness)+(w.window?line(w.a,w.b,'#6fcee0',.07):'')).join('');
    // Same canvas and origin as the combined master: layers require no repositioning.
    const wrap=content=>`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="-.1 -.1 ${module.frontage+.2} ${module.roomDepth+module.halfSpan+.2}">${content}</svg>`;
    await writeFile(new URL(`${module.id}-rear-wall.svg`,out),wrap(layers));
    if(module.location==='interior')await writeFile(new URL(`${module.baseArtwork}-guide.svg`,out),wrap(`<defs><clipPath id="base"><rect x="-.1" y="${module.wallThickness/2}" width="${module.frontage+.2}" height="${module.roomDepth+module.halfSpan+.1}"/></clipPath></defs><g clip-path="url(#base)">${body(module)}</g>`));
  }
}
const ppu=90,W=Math.ceil(proof.width*ppu),H=Math.ceil(proof.height*ppu)+100;
const moduleMap=new Map(catalog.modules.map(m=>[m.id,m]));
const label=(x,y,s)=>`<text x="${x}" y="${y}" font-family="Arial" font-size="16" fill="#e7edf3" text-anchor="middle">${s}</text>`;
const world=proof.coordinateTransform;
const placed=proof.placements.map(p=>`<g transform="translate(${p.transform.at}) rotate(${p.transform.rotation})">${body(moduleMap.get(p.module))}</g>`).join('');
const caps=proof.walls.filter(w=>w.owners.includes('end-cap')).map(w=>line(w.a,w.b,'#e0dcd5')).join('');
const seam=proof.floorSeams.map(s=>line(s.a,s.b,'#74e8ca',.025)).join('');
let labels='';
for(const p of proof.placements){
  const xs=p.footprint.map(v=>v[0]),ys=p.footprint.map(v=>v[1]);
  const x=(Math.min(...xs)+Math.max(...xs))/2*ppu;
  const y=(p.bank==='north'?Math.min(...ys)*ppu-16:Math.max(...ys)*ppu+25)+65;
  const m=moduleMap.get(p.module);
  labels+=label(x,y,`${m.sourceRoom??(m.category==='alcove-half'?'2×1 JEFFERIES':'FILLER')} · ${m.location??`${m.frontage} squares frontage`}`);
}
await writeFile(new URL('assembly-proof.svg',out),`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#16212b"/>${label(W/2,28,'ROOM + HALF-CORRIDOR ASSEMBLY · ALL GREEN JOINS ARE FLOOR ONLY')}<g transform="translate(0 65) scale(${ppu})"><g transform="translate(${world.offset}) rotate(${world.rotation})">${placed}</g>${caps}${seam}</g>${labels}${label(W/2,H-15,'Shared wall and doorway stay inside each module · Full corridor = 2 clear squares / 3 m')}</svg>`);
console.log('Built six cabin plans in solid/windowed variants, 2×1 Jefferies half and aligned hull assembly proof.');
