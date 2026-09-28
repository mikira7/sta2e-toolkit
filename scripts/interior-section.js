/** A cutaway hull sector. Room programs are chosen before their footprints are sized. */
import { isMeasuredCabin, measuredCabinPlan, cabinDimensions, cabinTransform, measuredCabinOutline } from "./interior-measured-cabins.js";
const point=(x,y)=>({x:Math.round(x*10000)/10000,y:Math.round(y*10000)/10000});
const exteriorKinds=new Set(["quarters","lounge","office","briefing"]);
const profiles={
  quarters:[6.2,6.8],lounge:[7,6],office:[4.6,4.5],briefing:[7,5],
  bridge:[9,8],ops:[8,7],medical:[8,7],engineering:[9,8],reactor:[7,7],
  cargo:[8,7],transporter:[6,5.5],lab:[6,6],security:[5,5],
  lift:[3.4,3.2],airlock:[4,4],workshop:[5,5],regeneration:[5,5],assimilation:[7,6],
};
const programs={
  mixed:[["quarters","lift"],["quarters","medical"],["lounge","transporter"],["quarters","lab"],["office","security"],["quarters","workshop"]],
  command:[["office","lift"],["briefing","security"],["bridge","lab"],["lounge","transporter"],["quarters","medical"]],
  engineering:[["workshop","lift"],["cargo","transporter"],["engineering","reactor"],["cargo","workshop"],["lab","security"]],
  habitat:[["quarters","lift"],["quarters","medical"],["lounge","office"],["quarters","lab"],["quarters","transporter"],["quarters","security"]],
};

export function buildInteriorSection(recipe,rng,names) {
  const roomProfiles={...profiles,quarters:recipe.cabinLayout==="officer"?[9,7.8]:recipe.cabinLayout==="standard"?[7,6.8]:profiles.quarters};
  const size=["small","medium","large"].indexOf(recipe.size);
  const count=Math.max(4+size,Math.ceil((recipe.roomTypes?.length??0)/2));
  const remaining=[...(recipe.roomTypes??[])], program=programs[recipe.purpose];
  let cabinIndex=0;
  const pick=(exterior,fallback)=>{
    if(!recipe.roomTypes)return fallback;
    // A selected lift must never fill an exterior bay, even after the palette is exhausted.
    const allowed=k=>!exterior||k!=="lift";
    let i=!exterior?remaining.indexOf("lift"):-1;
    if(i<0)i=remaining.findIndex(k=>allowed(k)&&exteriorKinds.has(k)===exterior);
    if(i<0)i=remaining.findIndex(allowed);
    if(i>=0)return remaining.splice(i,1)[0];
    const eligible=recipe.roomTypes.filter(allowed),pool=eligible.filter(k=>exteriorKinds.has(k)===exterior);
    const candidates=pool.length?pool:eligible;
    if(!candidates.length)return null;
    return candidates[Math.floor(rng()*candidates.length)];
  };
  const bays=Array.from({length:count},(_,i)=>{
    const defaults=recipe.faction==="borg"?["regeneration","assimilation"]:program[i%program.length];
    const outer=pick(true,defaults[0]),inner=pick(false,defaults[1]);
    // Inboard radial bays narrow toward the ship's centre; reserve the bathroom before tapering.
    const outerPlan=outer==="quarters"&&isMeasuredCabin(recipe.cabinLayout)?measuredCabinPlan(recipe.cabinLayout,cabinIndex++):null;
    const innerPlan=inner==="quarters"&&isMeasuredCabin(recipe.cabinLayout)?measuredCabinPlan(recipe.cabinLayout,cabinIndex++):null;
    const width=Math.max(roomProfiles[outer]?.[0]??0,roomProfiles[inner][0]*(inner==="quarters"?1.4:1))*(.95+rng()*.1);
    // Reserve taper clearance for rigid rectangular inboard cabins. They are never warped.
    return {outer,inner,outerPlan,innerPlan,width:Math.max(width,outerPlan?cabinDimensions(outerPlan)[0]+1.2:0,innerPlan?(cabinDimensions(innerPlan)[0]+1.2)*1.6:0)};
  });
  const services=recipe.jefferies&&bays.some(b=>b.inner!=="lift");
  // Reserve whole bays for circulation: no corridor is drawn through an occupied room.
  if(recipe.junctions!=="none")for(let i=bays.length-1;i>0;i--) {
    if(i%2===0) bays.splice(i,0,{inner:"corridor",outer:recipe.junctions==="cross"||(recipe.junctions==="mixed"&&i%4===0)?"corridor":null,width:2.4,junction:true});
  }
  if(services)bays.splice(1,0,{inner:"jefferies",outer:null,width:2.4,alcove:true});
  const span=recipe.type==="station"?1.65:recipe.faction==="federation"?1.15:1.35;
  // Precalculated local section radii in 1.5 m squares, stable across seeds and map sizes.
  const designRadius={galaxy:96,intrepid:52}[recipe.hullProfile];
  const total=bays.reduce((v,b)=>v+b.width,0),radius=designRadius??Math.max(23,total/span),passage=2.2;
  const depth=Math.max(...bays.map(b=>b.innerPlan?cabinDimensions(b.innerPlan)[1]+radius*(1-Math.cos(b.width/radius/2)):roomProfiles[b.inner]?.[1]??0));
  const outerRadius=radius+passage, hull=outerRadius+Math.max(...bays.map(b=>b.outerPlan?cabinDimensions(b.outerPlan)[1]:roomProfiles[b.outer]?.[1]??0));
  const serviceRadius=radius-depth-1.25;
  const rooms=[],at=(r,a)=>point(Math.cos(a)*r,Math.sin(a)*r);
  const arc=(r,a,b,landing=false)=>{
    if(!recipe.curved)return[at(r,a),at(r,b)];
    if(landing){
      const middle=(a+b)/2,half=Math.min(Math.asin(1/r),(b-a)*.32);
      const sample=(from,to)=>{const steps=Math.max(1,Math.ceil(r*(to-from)/.75));return Array.from({length:steps+1},(_,i)=>at(r,from+(to-from)*i/steps));};
      return [...sample(a,middle-half),...sample(middle+half,b)];
    }
    const steps=Math.max(2,Math.ceil(r*(b-a)/.75));
    return Array.from({length:steps+1},(_,i)=>at(r,a+(b-a)*i/steps));
  };
  const frame=(r1,r2,a,b,inboard=false)=>{
    const angle=(a+b)/2,half=(b-a)/2,far=r2*Math.cos(half),mid=(r1+far)/2;
    return {...at(mid,angle),w:Math.max(1,2*r1*Math.sin(half)-.7),h:Math.max(1,far-r1-.7),rotation:angle*180/Math.PI+(inboard?-90:90)};
  };
  const add=(kind,polygon,frame,extra={})=>{const r={id:`room-${rooms.length+1}`,kind,name:names[kind],polygon,frame,...extra};rooms.push(r);return r;};
  const addCabin=(plan,a,b,inboard)=>{
    const [w,h]=cabinDimensions(plan),middle=(a+b)/2,front=(inboard?radius:outerRadius)*Math.cos((b-a)/2);
    const f={...at(front+(inboard?-h/2:h/2),middle),w,h,rotation:middle*180/Math.PI+(inboard?-90:90)};
    const world=cabinTransform({frame:f});
    const room=add("quarters",measuredCabinOutline(plan).map(world),f,{name:plan.name,cabinPlan:plan.id,zone:inboard?"inboard":"outboard"});
    if(!inboard)room.hullBoundary=[world([0,0]),...(plan.windows??[]).flat().map(world),world([w,0])];
    return room;
  };
  let angle=-Math.PI/2-total/radius/2;
  for(const bay of bays){
    const end=angle+bay.width/radius,innerRadius=radius-(roomProfiles[bay.inner]?.[1]??depth);
    const measured=bay.innerPlan||bay.outerPlan;
    const divisions=!bay.outer?0:bay.outerPlan?1:exteriorKinds.has(bay.outer)&&bay.width>roomProfiles[bay.outer][0]*(bay.outer==="quarters"?2.05:1.55)?2:1;
    const outerRooms=Array.from({length:divisions},(_,i)=>{
      const a=angle+(end-angle)*i/divisions,b=angle+(end-angle)*(i+1)/divisions;
      return {a,b,entry:measured?[at(outerRadius,a),at(outerRadius,b)]:arc(outerRadius,a,b,true),hull:arc(hull,a,b)};
    });
    const inside=bay.alcove||measured?[at(radius,angle),at(radius,end)]:arc(radius,angle,end,!bay.junction),outside=outerRooms.length?outerRooms.flatMap((r,i)=>i?r.entry.slice(1):r.entry):arc(outerRadius,angle,end);
    const access=services&&bay.inner!=="lift"&&!bay.innerPlan,middle=(angle+end)/2,portHalf=Math.asin(.5/serviceRadius);
    const lo=middle-portHalf,hi=middle+portHalf;
    const portArc=(r)=>[...arc(r,angle,lo).slice(0,-1),at(r,lo),at(r,hi),...arc(r,hi,end).slice(1)];
    const innerFront=access?portArc(innerRadius):arc(innerRadius,angle,end);
    let alcoveRear;
    if(bay.alcove) {
      // Leave shoulders around the rectangular alcove so its rear corners cannot
      // overlap the neighbouring radial rooms as the bay narrows inboard.
      const frontCentre=point((inside[0].x+inside[1].x)/2,(inside[0].y+inside[1].y)/2);
      const mouth=[-1,1].map(t=>point(frontCentre.x-t*Math.sin(middle),frontCentre.y+t*Math.cos(middle)));
      const shift=p=>point(p.x-Math.cos(middle),p.y-Math.sin(middle));
      alcoveRear=mouth.map(shift);
      const centre=point((inside[0].x+inside[1].x)/2-Math.cos(middle)*.5,(inside[0].y+inside[1].y)/2-Math.sin(middle)*.5);
      add("corridor",[...mouth,...alcoveRear.slice().reverse()],{...centre,w:2,h:1,rotation:middle*180/Math.PI+90},{zone:"inboard",name:"Jefferies access alcove",alcove:{width:2,depth:1}});
    } else if(bay.innerPlan)addCabin(bay.innerPlan,angle,end,true);
    else add(bay.inner,[...inside,...innerFront.slice().reverse()],frame(innerRadius,radius,angle,end,true),{zone:bay.junction?"circulation":"inboard",template:bay.inner,...(bay.junction?{name:"Inboard branch"}:{})});
    const hall=add("corridor",[...outside,...inside.slice().reverse()],frame(radius,outerRadius,angle,end),{name:bay.junction?(bay.outer?"Four-way intersection":"Three-way intersection"):"Deck passageway",zone:"circulation",...(bay.junction?{junction:bay.outer?4:3}:{}),curveRadius:radius});
    // Curved guide rails follow the deck, rather than bending a straight corridor picture.
    if(!bay.junction&&!bay.alcove)hall.guidePaths=measured?[[at(radius+.22,angle),at(radius+.22,end)],[at(outerRadius-.22,angle),at(outerRadius-.22,end)]]:[arc(radius+.22,angle,end),arc(outerRadius-.22,angle,end)];
    hall.centerline=measured?[at(radius+passage/2,angle),at(radius+passage/2,end)]:arc(radius+passage/2,angle,end);
    hall.lightPoints=hall.centerline.filter((_,i)=>i%5===2);
    for(const part of outerRooms) {
      if(bay.outerPlan){addCabin(bay.outerPlan,part.a,part.b,false);continue;}
      const room=add(bay.outer,[...part.hull,...part.entry.slice().reverse()],frame(outerRadius,hull,part.a,part.b),{zone:"outboard",template:bay.outer,hullBoundary:part.hull});
      if(exteriorKinds.has(bay.outer))room.windowEligible=true;
    }
    if(services) {
      const outer=access?portArc(serviceRadius):arc(serviceRadius,angle,end);
      const tube=add("jefferies",[...outer,...arc(serviceRadius-1,angle,end).reverse()],frame(serviceRadius-1,serviceRadius,angle,end),{zone:"service"});
      tube.centerline=arc(serviceRadius-.5,angle,end);tube.lightPoints=tube.centerline.filter((_,i)=>i%5===2);
      if(access)add("jefferies",bay.alcove?[at(serviceRadius,lo),at(serviceRadius,hi),...alcoveRear.slice().reverse()]:[at(serviceRadius,lo),at(serviceRadius,hi),at(innerRadius,hi),at(innerRadius,lo)],frame(serviceRadius,innerRadius,lo,hi),{zone:"service",name:"Jefferies access",centerline:[at(serviceRadius,middle),at(innerRadius,middle)]});
    }
    // Smooth outer hull, straight radial partitions, and a clear entry face on the passageway.
    angle=end;
  }
  // Crop to the encounter sector; the rest of the vessel is intentionally outside this map.
  const all=rooms.flatMap(r=>r.polygon),minX=Math.min(...all.map(p=>p.x))-3,minY=Math.min(...all.map(p=>p.y))-3;
  const move=p=>point(p.x-minX,p.y-minY);
  for(const room of rooms){
    room.polygon=room.polygon.map(move);room.frame={...room.frame,...move(room.frame)};
    for(const key of ["hullBoundary","centerline","lightPoints"])if(room[key])room[key]=room[key].map(move);
    if(room.guidePaths)room.guidePaths=room.guidePaths.map(ps=>ps.map(move));
  }
  const width=Math.ceil(Math.max(...all.map(p=>p.x))-minX+3),height=Math.ceil(Math.max(...all.map(p=>p.y))-minY+3);
  const halls=rooms.filter(r=>r.kind==="corridor"),entry={x:halls[0].frame.x,y:halls[0].frame.y};
  const start=-Math.PI/2-total/radius/2;
  const structure=[...arc(hull,start,angle),...arc(services?serviceRadius-1:radius-depth,start,angle).reverse()].map(move);
  return {rooms,width,height,entry,structure};
}

/** Fit a compact lift cabin against its existing corridor port, with no oversized lobby. */
export function compactInteriorLifts(rooms,edges) {
  const byId=new Map(rooms.map(r=>[r.id,r]));
  for(const room of rooms.filter(r=>r.kind==="lift")) {
    const face=edges.filter(e=>e.rooms.includes(room.id)&&e.rooms.some(id=>byId.get(id)?.kind==="corridor"))
      .sort((a,b)=>Number(b.rooms.some(id=>byId.get(id)?.curveRadius))-Number(a.rooms.some(id=>byId.get(id)?.curveRadius))||Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y)-Math.hypot(a.b.x-a.a.x,a.b.y-a.a.y))[0];
    if(!face||Math.hypot(face.b.x-face.a.x,face.b.y-face.a.y)<1.5)continue;
    const length=Math.hypot(face.b.x-face.a.x,face.b.y-face.a.y),mx=(face.a.x+face.b.x)/2,my=(face.a.y+face.b.y)/2;
    let nx=-(face.b.y-face.a.y)/length,ny=(face.b.x-face.a.x)/length;
    if((room.frame.x-mx)*nx+(room.frame.y-my)*ny<0){nx=-nx;ny=-ny;}
    const tx=ny,ty=-nx,half=Math.min(1,length/2),radius=1.25,offset=Math.sqrt(radius*radius-half*half);
    const p=(x,y)=>point(mx+tx*x+nx*y,my+ty*x+ny*y),start=Math.atan2(-offset,half),stop=Math.PI-start;
    room.polygon=[p(-half,0),p(half,0),...Array.from({length:19},(_,i)=>{
      const a=start+(stop-start)*(i+1)/20;return p(Math.cos(a)*radius,offset+Math.sin(a)*radius);
    })];
    room.frame={...p(0,offset+.2),w:1.6,h:1.4,rotation:Math.atan2(ty,tx)*180/Math.PI};
    room.compactLift=true;room.zone="inboard";delete room.hullBoundary;delete room.windowEligible;
  }
}

/** Mark only actual outward-facing hull edges, never a map cut or an internal bulkhead. */
export function addInteriorHullWindows(layout) {
  const key=(a,b)=>[`${a.x},${a.y}`,`${b.x},${b.y}`].sort().join("/");
  for(const room of layout.rooms){
    if(!room.hullBoundary)continue;
    const boundary=room.hullBoundary,edges=[];
    for(let i=0;i<boundary.length-1;i++){
      const a=boundary[i],b=boundary[i+1];
      const edge=layout.edges.find(e=>e.rooms.length===1&&e.rooms[0]===room.id&&key(e.a,e.b)===key(a,b));
      if(edge){edge.hull=true;edges.push(edge);}
    }
    if(!room.windowEligible||!layout.recipe.hullWindows||layout.recipe.faction==="borg")continue;
    // Keep structural piers at both ends and between each pane.
    for(let i=1;i<edges.length-1;i+=2)edges[i].window=true;
    // Faceted hulls have a single long edge. Split it later into pane and structural piers.
    if(edges.length===1&&Math.hypot(edges[0].b.x-edges[0].a.x,edges[0].b.y-edges[0].a.y)>2.5)edges[0].window=true;
  }
}
