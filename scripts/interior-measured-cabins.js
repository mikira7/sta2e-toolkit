/** Place approved SVG-guide geometry at its original scale. No image assets are used. */
import { CABIN_PLAN_CATALOG } from "./interior-cabin-plans.js";
import { usesInteriorQueenBeds, INTERIOR_QUEEN_BED } from "./interior-assets.js";
export const MEASURED_CABINS = {
  "svg-mixed":"SVG plans • mixed accommodation",
  "Q01-B":"SVG • compact single cabin",
  "Q02-R":"SVG • standard single cabin",
  "Q04-P":"SVG • junior-officer pair / shared head",
  "Q03-R":"SVG • one-bedroom suite / walk-in closet",
  "Q05-F2":"SVG • two-bedroom family suite",
  "Q05-F3":"SVG • three-bedroom family suite",
};
const sequence=["Q02-R","Q04-P","Q03-R","Q05-F2","Q05-F3","Q01-B"];
export const isMeasuredCabin=key=>Object.hasOwn(MEASURED_CABINS,key);
export const measuredCabinPlan=(key,index=0)=>CABIN_PLAN_CATALOG.pieces.find(p=>p.id===(key==="svg-mixed"?sequence[index%sequence.length]:key));
export const cabinDimensions=plan=>[Math.max(...plan.footprint.map(p=>p[0])),Math.max(...plan.footprint.map(p=>p[1]))];
const point=(x,y)=>({x:Math.round(x*10000)/10000,y:Math.round(y*10000)/10000});
const rectangle=([x,y,w,h])=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
export function cabinTransform(room) {
  const f=room.frame,a=f.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  return ([x,y])=>point(f.x+(x-f.w/2)*c-(y-f.h/2)*s,f.y+(x-f.w/2)*s+(y-f.h/2)*c);
}
/** Additional collinear vertices make every measured exterior aperture a shared edge. */
export function measuredCabinOutline(plan) {
  const [w,h]=cabinDimensions(plan),windowCuts=(plan.windows??[]).flat().map(p=>p[0]);
  const doorCuts=plan.ports.flatMap(p=>[p.at[0]-.6,p.at[0]+.6]);
  return [...new Set([0,...windowCuts,w])].sort((a,b)=>a-b).map(x=>[x,0])
    .concat([...new Set([0,...doorCuts,w])].sort((a,b)=>b-a).map(x=>[x,h]));
}
export function buildMeasuredCabinArchitecture(room,recipe={}) {
  const plan=measuredCabinPlan(room.cabinPlan),world=cabinTransform(room),walls=[];
  const add=(a,b,extra={})=>{if(Math.hypot(b[0]-a[0],b[1]-a[1])>.0001)walls.push({a:world(a),b:world(b),door:false,partition:true,...extra});};
  for(const part of plan.partitions) {
    if(!part.door){add(part.a,part.b);continue;}
    const d=part.door,len=Math.hypot(part.b[0]-part.a[0],part.b[1]-part.a[1]),dir=part.b.map((v,i)=>(v-part.a[i])/len);
    const a=d.at.map((v,i)=>v-dir[i]*d.width/2),b=d.at.map((v,i)=>v+dir[i]*d.width/2);
    add(part.a,a);add(a,b,{door:true});add(b,part.b);
  }
  // Thick replicator service bulkheads are collision geometry, not just floor symbols.
  for(const solid of plan.serviceWalls??[]) {
    const poly=rectangle(solid.rect);
    for(let i=0;i<poly.length;i++)add(poly[i],poly[(i+1)%poly.length],{serviceWall:true});
  }
  const fixtures=structuredClone(plan.fixtures);
  if(usesInteriorQueenBeds(recipe))for(const fixture of fixtures.filter(f=>f.kind==="bed")) {
    const [x,y,w]=fixture.rect;
    // Preserve the wall-side edge of a bed in the mirrored half of shared quarters.
    fixture.rect=[x>room.frame.w/2?x+w-INTERIOR_QUEEN_BED.w:x,y,INTERIOR_QUEEN_BED.w,INTERIOR_QUEEN_BED.h];
    fixture.size="queen";
  }
  return {type:"measured-quarters",plan:plan.id,w:room.frame.w,h:room.frame.h,fit:1,walls,
    bedroomCount:plan.bedroomCount??0,households:plan.privateCabins?.length??1,
    fixtures,bathroom:structuredClone(plan.bathroom),
    sections:structuredClone(plan.sections??[]),accessPoints:structuredClone(plan.accessPoints??[]),
    bedrooms:structuredClone(plan.bedrooms??[]),closet:structuredClone(plan.closet??null),
    privateCabins:structuredClone(plan.privateCabins??[]),serviceWalls:structuredClone(plan.serviceWalls??[])};
}
const onSegment=(p,a,b)=>{
  const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy,t=((p.x-a.x)*dx+(p.y-a.y)*dy)/l2;
  return t>=-.0002&&t<=1.0002&&Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<.0003;
};
/** Override random entrances: the pair must keep both independently placed public doors. */
export function connectMeasuredCabins(rooms,edges,recipe) {
  for(const room of rooms.filter(r=>r.cabinPlan)) {
    const plan=measuredCabinPlan(room.cabinPlan),world=cabinTransform(room);
    const ports=plan.ports.map(p=>[world([p.at[0]-.6,p.at[1]]),world([p.at[0]+.6,p.at[1]])]);
    const windows=room.zone==="outboard"&&recipe.hullWindows&&recipe.faction!=="borg"?(plan.windows??[]).map(pair=>pair.map(world)):[];
    for(const e of edges.filter(e=>e.rooms.includes(room.id))) {
      e.kind="wall";delete e.window;delete e.exactDoor;
      const isPort=ports.some(([a,b])=>onSegment(e.a,a,b)&&onSegment(e.b,a,b));
      if(isPort&&e.rooms.some(id=>rooms.find(r=>r.id===id)?.kind==="corridor")){e.kind="door";e.exactDoor=true;}
      if(e.rooms.length===1&&windows.some(([a,b])=>onSegment(e.a,a,b)&&onSegment(e.b,a,b))){e.window=true;e.exactWindow=true;e.hull=true;}
    }
    const doors=edges.filter(e=>e.rooms.includes(room.id)&&e.exactDoor);
    if(doors.length!==ports.length)throw new Error(`${plan.name}: each measured entrance must meet a passageway.`);
  }
}

/** Scalable vector symbols inside the exact fixture envelopes in the approved plans. */
export function renderMeasuredCabin(room,p,labels=false) {
  const a=room.architecture,parts=[],r=(x,y,w,h,fill,rx=.05)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
  parts.push(`<g data-cabin-plan="${a.plan}" transform="translate(${-a.w/2} ${-a.h/2})">`);
  parts.push(`<path d="M${a.bathroom.polygon.map(v=>v.join(',')).join('L')}Z" fill="${p.metal}" opacity=".7"/>`);
  for(const s of a.serviceWalls)parts.push(r(...s.rect,p.panel,0));
  for(const f of a.fixtures) {
    const [x,y,w,h]=f.rect;
    parts.push(`<g data-cabin-fixture="${f.kind}" data-facing="${f.facing??0}">${r(x,y,w,h,p.panel)}`);
    if(f.kind==='bed') {
      if(f.size==='queen') {
        parts.push(r(x+.07,y+.1,w-.14,h-.2,p.floor,.08));
        for(const offset of [.12,w/2+.025])parts.push(r(x+offset,y+.14,w/2-.145,.23,'#dedfd8',.06));
      } else parts.push(r(x+.05,y+.05,w-.1,h-.1,p.floor,.08),r(x+.08,y+.08,w-.16,Math.min(.28,h*.25),'#dedfd8'));
    }
    else if(['shower','tub','basin'].includes(f.kind))parts.push(r(x+.06,y+.06,w-.12,h-.12,f.kind==='shower'?p.metal:'#587582',f.kind==='tub'?.18:.05));
    else if(f.kind==='toilet') {
      // Local +X is the bowl direction; rotate within the recorded envelope.
      const angle=f.facing??90,wide=angle%180===0?w:h,high=angle%180===0?h:w;
      parts.push(`<g transform="translate(${x+w/2} ${y+h/2}) rotate(${angle})">${r(-wide/2,-high/2,wide*.28,high,p.metal)}<ellipse cx="${wide*.14}" cy="0" rx="${wide*.31}" ry="${high*.38}" fill="#e1dfd5"/></g>`);
    } else if(['food replicator','desk'].includes(f.kind))parts.push(r(x+w*.12,y+h*.17,w*.65,h*.4,p.metal),r(x+w*.16,y+h*.2,w*.25,h*.28,p.screen));
    else if(['wardrobe','hanging storage'].includes(f.kind))parts.push(r(x+w*.15,y+h*.1,w*.7,h*.8,p.metal));
    else if(['sofa','armchair','chair','dining bench'].includes(f.kind)) {
      parts.push(r(x+.05,y+.05,Math.max(.05,w-.1),Math.max(.05,h-.1),p.floor));
      if(f.kind==='chair'&&Number.isFinite(f.facing)) {
        const angle=f.facing*Math.PI/180,cx=x+w/2-Math.cos(angle)*w*.35,cy=y+h/2-Math.sin(angle)*h*.35;
        const tx=-Math.sin(angle)*w*.35,ty=Math.cos(angle)*h*.35;
        parts.push(`<path d="M${cx-tx},${cy-ty}L${cx+tx},${cy+ty}" stroke="${p.metal}" stroke-width=".06"/>`);
      }
    }
    parts.push('</g>');
  }
  if(labels) {
    const text=(poly,label,head=false)=>{const xs=poly.map(v=>v[0]),ys=poly.map(v=>v[1]);parts.push(`<text x="${(Math.min(...xs)+Math.max(...xs))/2}" y="${head?Math.min(...ys)+(Math.max(...ys)-Math.min(...ys))*.65:Math.max(...ys)-.6}" font-family="sans-serif" font-size=".16" text-anchor="middle" fill="#e8eef1">${label}</text>`);};
    for(const [i,b]of a.bedrooms.entries())text(b.polygon,b.master?'MASTER':`BEDROOM ${i+1}`);
    if(a.closet)text(a.closet.polygon,'WALK-IN CLOSET');
    text(a.bathroom.polygon,a.bathroom.shared?'SHARED HEAD':'HEAD',true);
  }
  parts.push('</g>');return parts.join('');
}
