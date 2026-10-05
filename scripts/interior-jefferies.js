/** Jefferies tube network: an encounter map of crawlways only. Every node of a branching lattice
 * is an octagonal junction chamber; tubes leave its faces orthogonally or at 45°, dead ends are
 * ladder access points, and hatches at the map edge open onto deck-access stubs.
 * Units are grid squares (1.5 m). Independent of Foundry and the renderer; interiorEdges is
 * passed in so this module stays out of interior-layout.js's import graph. */
const round=n=>Math.round(n*10000)/10000;
const pt=p=>({x:round(p.x),y:round(p.y)});
const key=(a,b)=>[`${a.x},${a.y}`,`${b.x},${b.y}`].sort().join("/");

// A one-square token crawls a 1.2-square tube; an octagon face (1.45) is wider than the tube,
// so tube ends land inside a face instead of on its corners.
export const JEFFERIES_TUBE=1.2;
export const JEFFERIES_APOTHEM=1.75;
const GAPS=[6,7,8],STUB=2.5,STUB_WIDTH=2.4,LATTICE={small:[4,3],medium:[5,4],large:[6,5]};
const DIRECTIONS=[[1,0],[0,1],[1,1],[1,-1]];

/** Regular octagon with flat faces toward all eight compass directions. */
export function jefferiesOctagon(c,apothem=JEFFERIES_APOTHEM) {
  const r=apothem/Math.cos(Math.PI/8);
  return Array.from({length:8},(_,i)=>{const a=Math.PI/8+i*Math.PI/4;return {x:c.x+Math.cos(a)*r,y:c.y+Math.sin(a)*r};});
}

export function buildInteriorJefferies(recipe,rng,{interiorEdges}) {
  const [cols,rows]=LATTICE[recipe.size]??LATTICE.medium;
  const pick=list=>list[Math.floor(rng()*list.length)];
  // Uneven column and row spacing; a diagonal is only allowed across a square cell.
  const gx=[0],gy=[0];
  for(let i=1;i<cols;i++)gx.push(gx[i-1]+pick(GAPS));
  for(let i=1;i<rows;i++)gy.push(gy[i-1]+pick(GAPS));
  const id=(c,r)=>r*cols+c,pos=n=>({x:gx[n%cols],y:gy[Math.floor(n/cols)]});
  const neighbours=n=>{
    const c=n%cols,r=Math.floor(n/cols),out=[];
    for(const [dx,dy]of DIRECTIONS)for(const s of [1,-1]) {
      const c2=c+dx*s,r2=r+dy*s;
      if(c2<0||r2<0||c2>=cols||r2>=rows)continue;
      if(dx&&dy&&gx[Math.max(c,c2)]-gx[Math.min(c,c2)]!==gy[Math.max(r,r2)]-gy[Math.min(r,r2)])continue;
      out.push(id(c2,r2));
    }
    return out;
  };
  const cellOf=(a,b)=>`${Math.min(a%cols,b%cols)},${Math.min(Math.floor(a/cols),Math.floor(b/cols))}`;
  const isDiagonal=(a,b)=>a%cols!==b%cols&&Math.floor(a/cols)!==Math.floor(b/cols);
  const diagonalCells=new Set(),links=new Map(),included=new Set();
  const link=(a,b)=>{
    if(isDiagonal(a,b)){const cell=cellOf(a,b);if(diagonalCells.has(cell))return false;diagonalCells.add(cell);}
    for(const [x,y]of [[a,b],[b,a]]){if(!links.has(x))links.set(x,new Set());links.get(x).add(y);}
    return true;
  };
  // Randomised Prim: a branching tree over roughly three quarters of the lattice.
  const start=id(Math.floor(rng()*cols),Math.floor(rng()*rows)),target=Math.max(4,Math.round(cols*rows*(.7+rng()*.15)));
  included.add(start);
  for(let guard=0;included.size<target&&guard<500;guard++) {
    const frontier=[...included].flatMap(a=>neighbours(a).filter(b=>!included.has(b)).map(b=>[a,b]));
    if(!frontier.length)break;
    // Favour straight runs a little, so the network reads as engineered rather than random walk.
    const [a,b]=frontier[Math.floor(rng()*frontier.length)];
    if(isDiagonal(a,b)&&rng()<.45)continue;
    if(link(a,b))included.add(b);
  }
  // A few extra orthogonal links close loops, giving alternate crawl routes.
  for(const a of included)for(const b of neighbours(a))
    if(a<b&&included.has(b)&&!isDiagonal(a,b)&&!links.get(a)?.has(b)&&rng()<.16)link(a,b);

  const rooms=[],hatches=[],opens=[];
  const add=room=>{room.id=`room-${rooms.length+1}`;rooms.push(room);return room;};
  const service=recipe.faction==="federation"?"Jefferies":"Service";
  const degree=n=>links.get(n)?.size??0;
  for(const n of included) {
    const c=pos(n),access=degree(n)===1;
    add({kind:"jefferies",name:access?`${service} access point`:`${service} junction`,zone:"service",junction:true,access,
      apothem:JEFFERIES_APOTHEM,polygon:jefferiesOctagon(c),frame:{x:c.x,y:c.y,w:2*JEFFERIES_APOTHEM,h:2*JEFFERIES_APOTHEM,rotation:0},lightPoints:[c]});
  }
  const tube=(p,d,length,name)=>{
    const n={x:-d.y,y:d.x},h=JEFFERIES_TUBE/2,s=p,e={x:p.x+d.x*length,y:p.y+d.y*length};
    const steps=Math.max(1,Math.ceil(length/3));
    const centerline=Array.from({length:steps+1},(_,i)=>({x:s.x+(e.x-s.x)*i/steps,y:s.y+(e.y-s.y)*i/steps}));
    return add({kind:"jefferies",name:`${service} tube`,zone:"service",tube:true,
      polygon:[{x:s.x+n.x*h,y:s.y+n.y*h},{x:e.x+n.x*h,y:e.y+n.y*h},{x:e.x-n.x*h,y:e.y-n.y*h},{x:s.x-n.x*h,y:s.y-n.y*h}],
      frame:{x:(s.x+e.x)/2,y:(s.y+e.y)/2,w:length,h:JEFFERIES_TUBE,rotation:Math.atan2(d.y,d.x)*180/Math.PI},
      centerline,lightPoints:centerline.filter((_,i)=>i%2===1),ends:[[{x:s.x+n.x*h,y:s.y+n.y*h},{x:s.x-n.x*h,y:s.y-n.y*h}],[{x:e.x+n.x*h,y:e.y+n.y*h},{x:e.x-n.x*h,y:e.y-n.y*h}]]});
  };
  for(const [a,set]of links)for(const b of set) {
    if(a>b)continue;
    const p=pos(a),q=pos(b),L=Math.hypot(q.x-p.x,q.y-p.y),d={x:(q.x-p.x)/L,y:(q.y-p.y)/L};
    // Every tube is sealable: a full-width door where it meets the junction at each end.
    const t=tube({x:p.x+d.x*JEFFERIES_APOTHEM,y:p.y+d.y*JEFFERIES_APOTHEM},d,L-2*JEFFERIES_APOTHEM);
    hatches.push(...t.ends);
  }
  // Deck access: two boundary nodes get a short tube out to a hatch and a corridor stub at the map edge.
  const outward=n=>{const c=n%cols,r=Math.floor(n/cols);return c===0?{x:-1,y:0}:c===cols-1?{x:1,y:0}:r===0?{x:0,y:-1}:r===rows-1?{x:0,y:1}:null;};
  const boundary=[...included].filter(outward).sort((a,b)=>degree(a)-degree(b)||a-b);
  const exits=[];
  for(const n of boundary) {
    if(exits.length>=2)break;
    const d=outward(n);if(exits.some(e=>e.d.x===d.x&&e.d.y===d.y))continue;
    exits.push({n,d});
  }
  let entry=pos(start);
  for(const {n,d}of exits) {
    const c=pos(n),t=tube({x:c.x+d.x*JEFFERIES_APOTHEM,y:c.y+d.y*JEFFERIES_APOTHEM},d,STUB),end=t.ends[1];
    const nrm={x:-d.y,y:d.x},m={x:c.x+d.x*(JEFFERIES_APOTHEM+STUB),y:c.y+d.y*(JEFFERIES_APOTHEM+STUB)},hw=STUB_WIDTH/2;
    const far={x:m.x+d.x*STUB,y:m.y+d.y*STUB};
    const stub=add({kind:"corridor",name:"Deck access",zone:"circulation",
      polygon:[{x:m.x+nrm.x*hw,y:m.y+nrm.y*hw},end[0],end[1],{x:m.x-nrm.x*hw,y:m.y-nrm.y*hw},{x:far.x-nrm.x*hw,y:far.y-nrm.y*hw},{x:far.x+nrm.x*hw,y:far.y+nrm.y*hw}],
      frame:{x:(m.x+far.x)/2,y:(m.y+far.y)/2,w:STUB_WIDTH,h:STUB,rotation:Math.atan2(d.y,d.x)*180/Math.PI-90},lightPoints:[{x:(m.x+far.x)/2,y:(m.y+far.y)/2}]});
    hatches.push(...t.ends);opens.push([{x:far.x-nrm.x*hw,y:far.y-nrm.y*hw},{x:far.x+nrm.x*hw,y:far.y+nrm.y*hw}]);
    entry=stub.frame;
  }
  // Finalise: translate to positive coordinates and round once.
  const all=rooms.flatMap(r=>r.polygon);
  const minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y));
  const ox=1.5-minX,oy=2.6-minY,F=p=>pt({x:p.x+ox,y:p.y+oy});
  for(const room of rooms) {
    room.polygon=room.polygon.map(F);room.frame={...room.frame,...F(room.frame)};
    for(const k of ["centerline","lightPoints"])if(room[k])room[k]=room[k].map(F);
    delete room.ends;
  }
  const width=Math.ceil(maxX-minX+3),height=Math.ceil(maxY-minY+4.2);
  const hatchKeys=new Set(hatches.map(([a,b])=>key(F(a),F(b)))),openKeys=new Set(opens.map(([a,b])=>key(F(a),F(b))));
  const edges=interiorEdges(rooms);
  for(const e of edges) {
    const k=key(e.a,e.b);
    // Tube doors span the full tube width, so a one-square token passes; they keep the hatch look.
    if(hatchKeys.has(k)){e.kind="hatch";e.exactDoor=true;continue;}
    e.kind=openKeys.has(k)?"open":e.rooms.length===2?"open":"wall";
  }
  const structure=[{x:0,y:0},{x:width,y:0},{x:width,y:height},{x:0,y:height}].map(p=>pt({x:p.x,y:p.y}));
  return {rooms,edges,structure,entry:F(entry),width,height};
}
