/** Perimeter-attached wet areas and furnished L-shaped living spaces. Units are grid squares. */
const p=(x,y)=>({x:Math.round(x*10000)/10000,y:Math.round(y*10000)/10000});
const close=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<.001;
const area=poly=>Math.abs(poly.reduce((v,a,i)=>{const b=poly[(i+1)%poly.length];return v+a.x*b.y-b.x*a.y;},0))/2;
function clip(poly,axis,cut) {
  const out=[];
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],inside=a[axis]>=cut;
    if(inside)out.push(a);
    if(inside!==(b[axis]>=cut)){const t=(cut-a[axis])/(b[axis]-a[axis]);out.push(p(a.x+t*(b.x-a.x),a.y+t*(b.y-a.y)));}
  }
  return out.filter((v,i)=>!close(v,out[(i+1)%out.length]));
}
function contains(poly,x,y) {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[j],b=poly[i],dx=b.x-a.x,dy=b.y-a.y,t=((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy);
    if(t>=0&&t<=1&&Math.hypot(x-a.x-t*dx,y-a.y-t*dy)<.002)return true;
    if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
const rectangle=(r)=>[p(r.x,r.y),p(r.x+r.w,r.y),p(r.x+r.w,r.y+r.h),p(r.x,r.y+r.h)];
const fits=(poly,r)=>[...rectangle(r),p(r.x+r.w/2,r.y),p(r.x+r.w,r.y+r.h/2),p(r.x+r.w/2,r.y+r.h),p(r.x,r.y+r.h/2),p(r.x+r.w/2,r.y+r.h/2)].every(v=>contains(poly,v.x,v.y));
// A convex bathroom polygon can contain a full-size fixture/standing rectangle, even on a curved hull.
function usableRectangle(poly,w,h) {
  const minY=Math.min(...poly.map(v=>v.y))+.12,maxY=Math.max(...poly.map(v=>v.y))-.12-h;
  for(let y=maxY;y>=minY-.001;y-=.12) {
    const cuts=[];
    for(const row of [y,y+h]) {
      const xs=[];
      for(let i=0;i<poly.length;i++) {
        const a=poly[i],b=poly[(i+1)%poly.length];
        if(row>=Math.min(a.y,b.y)&&row<=Math.max(a.y,b.y)&&Math.abs(b.y-a.y)>.0001)xs.push(a.x+(row-a.y)*(b.x-a.x)/(b.y-a.y));
      }
      cuts.push([Math.min(...xs)+.12,Math.max(...xs)-.12]);
    }
    const left=Math.max(...cuts.map(v=>v[0])),right=Math.min(...cuts.map(v=>v[1]));
    if(right-left>=w)return {x:right-w,y,w,h};
  }
  return null;
}
// Remove the corner quadrant from the living footprint, joining its two cuts at the re-entrant corner.
function livingOutline(poly,x,y) {
  const edges=[];
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],ts=[0,1];
    for(const [axis,cut]of [["x",x],["y",y]]){const t=(cut-a[axis])/(b[axis]-a[axis]);if(t>0&&t<1)ts.push(t);}
    ts.sort((a,b)=>a-b);
    for(let j=1;j<ts.length;j++) {
      const at=t=>p(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t),mid=at((ts[j-1]+ts[j])/2);
      if(mid.x<x-.0001||mid.y<y-.0001)edges.push([at(ts[j-1]),at(ts[j])]);
    }
  }
  const out=[],corner=contains(poly,x,y)?[p(x,y)]:[];
  for(const [a,b]of edges){if(out.length&&!close(out.at(-1),a))out.push(...corner,a);else if(!out.length)out.push(a);out.push(b);}
  if(!close(out.at(-1),out[0]))out.push(...corner);else out.pop();
  return out.filter((v,i)=>!close(v,out[(i+1)%out.length]));
}

export function buildQuartersArchitecture(room,edges=[],recipe={}) {
  const f=room.frame,a=f.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const local=v=>p((v.x-f.x)*c+(v.y-f.y)*s,-(v.x-f.x)*s+(v.y-f.y)*c);
  const world=v=>p(f.x+v.x*c-v.y*s,f.y+v.x*s+v.y*c);
  const poly=room.polygon.map(local),roomArea=area(poly);
  const entrances=edges.filter(e=>["door","hatch"].includes(e.kind)&&e.rooms.includes(room.id)).map(e=>{
    const a=local(e.a),b=local(e.b),length=Math.hypot(b.x-a.x,b.y-a.y),dx=(b.x-a.x)/length,dy=(b.y-a.y)/length,half=e.kind==="hatch"?.5:.9;
    return [-half,0,half].map(t=>p((a.x+b.x)/2+dx*t,(a.y+b.y)/2+dy*t));
  }).flat();
  let chosen;
  // Large suites reserve enough standing space for a separate tub and sonic shower.
  for(const luxury of [true,false]) {
    if(luxury&&recipe.cabinLayout==="standard")continue;
    if(luxury&&(roomArea<49||f.w<6.3||f.h<5))continue;
    const w=luxury?3:2,h=luxury?2.8:2.4;
    for(const [sx,sy]of [[1,1],[-1,1],[1,-1],[-1,-1]]) {
      const oriented=poly.map(v=>p(v.x*sx,v.y*sy));
      for(const x of [Math.max(.95,f.w/2-w-.4),f.w/2-w-.85,-f.w*.15])for(const y of [f.h/2-h-.4,f.h/2-h-.85,-f.h/2-.35]) {
        if(entrances.some(v=>v.x*sx>x-.12&&v.y*sy>y-.12))continue;
        const bath=clip(clip(oriented,"x",x),"y",y);
        if(bath.length<3||area(bath)>roomArea*.52)continue;
        const usable=usableRectangle(bath,w,h);if(!usable)continue;
        const partitions=bath.map((a,i)=>({a,b:bath[(i+1)%bath.length]})).filter(e=>(Math.abs(e.a.x-x)<.001&&Math.abs(e.b.x-x)<.001)||(Math.abs(e.a.y-y)<.001&&Math.abs(e.b.y-y)<.001));
        const door=partitions.slice().sort((a,b)=>Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y)-Math.hypot(a.b.x-a.a.x,a.b.y-a.a.y))[0];
        if(!door||Math.hypot(door.b.x-door.a.x,door.b.y-door.a.y)<1.4)continue;
        const score=area(bath)+(sy<0?1:0)+(sx<0?.3:0);
        if(!chosen||score<chosen.score)chosen={bath,usable,partitions,door,x,y,sx,sy,score,luxury,oriented};
      }
    }
    if(chosen)break;
  }
  if(!chosen)throw new Error(`Crew quarters need more space for a perimeter bathroom (${room.id}, ${f.w.toFixed(1)} by ${f.h.toFixed(1)}).`);
  const {sx,sy,usable:u}=chosen,unflip=v=>p(v.x*sx,v.y*sy),walls=[];
  let bathroomDoor;
  for(const edge of chosen.partitions) {
    if(edge!==chosen.door){walls.push({a:world(unflip(edge.a)),b:world(unflip(edge.b)),door:false,partition:true,bathroom:true});continue;}
    const length=Math.hypot(edge.b.x-edge.a.x,edge.b.y-edge.a.y),at=t=>world(unflip(p(edge.a.x+(edge.b.x-edge.a.x)*t,edge.a.y+(edge.b.y-edge.a.y)*t)));
    const start=at(.5-.55/length),end=at(.5+.55/length);
    walls.push({a:at(0),b:start,door:false,partition:true,bathroom:true},{a:start,b:end,door:true,partition:true,bathroom:true},{a:end,b:at(1),door:false,partition:true,bathroom:true});
    bathroomDoor=[local(start),local(end)];
  }
  const fixture=(kind,x,y,w,h)=>({kind,x:sx>0?x:-x-w,y:sy>0?y:-y-h,w,h});
  const fixtures=[fixture("shower",u.x+u.w-1,u.y,1,1),fixture("sink",u.x,u.y,.65,.5),fixture("toilet",u.x+u.w-.65,u.y+u.h-.85,.55,.7)];
  if(chosen.luxury)fixtures.push(fixture("tub",u.x,u.y+u.h-.85,1.55,.8));
  const living=livingOutline(chosen.oriented,chosen.x,chosen.y).map(unflip);
  const furniture=[],blocked=[...entrances,...bathroomDoor];
  const minX=Math.min(...poly.map(v=>v.x)),maxX=Math.max(...poly.map(v=>v.x)),minY=Math.min(...poly.map(v=>v.y)),maxY=Math.max(...poly.map(v=>v.y));
  const place=(kind,w,h)=>{
    let best;
    for(let y=minY+.3;y+h<maxY-.15;y+=.25)for(let x=minX+.3;x+w<maxX-.15;x+=.25) {
      const r={x,y,w,h};if(!fits(living,r))continue;
      if(blocked.some(v=>v.x>x-.6&&v.x<x+w+.6&&v.y>y-.6&&v.y<y+h+.6))continue;
      if(furniture.some(v=>x<v.x+v.w+.3&&x+w>v.x-.3&&y<v.y+v.h+.3&&y+h>v.y-.3))continue;
      const sofa=furniture.find(v=>v.kind==="couch");
      // Reference studies: sleeping opposite the wet area, work along that side wall,
      // and seating with a low table on the other side of the central entrance route.
      const study=recipe.cabinLayout!==undefined&&recipe.cabinLayout!=="auto";
      const px=(x+w/2)*sx,py=(y+h/2)*sy;
      const score=study?(kind==="bed"?px-py:kind==="desk"?px+Math.abs(py):kind==="couch"?-px+py:kind==="coffee"&&sofa?Math.hypot(x+w/2-sofa.x-sofa.w/2,y+h/2-sofa.y-sofa.h/2):0):kind==="bed"?y+x*.15:kind==="desk"?y-x*.15:kind==="coffee"&&sofa?Math.hypot(x+w/2-sofa.x-sofa.w/2,y+h/2-sofa.y+.9):-y+x*.1;
      if(!best||score<best.score)best={kind,...r,score};
    }
    if(best)furniture.push(best);
  };
  place("bed",1,1.9);place("desk",1.8,1.85);
  if(roomArea>35){place("couch",2.1,1.1);place("coffee",1.2,.7);}
  return {type:"quarters",arrangement:recipe.cabinLayout??"auto",w:f.w,h:f.h,fit:1,ensuite:true,walls,livingPolygon:living,furniture,
    bathroom:{polygon:chosen.bath.map(unflip),usable:rectangle(u).map(unflip),fixtures,tub:chosen.luxury,area:area(chosen.bath),door:bathroomDoor}};
}
