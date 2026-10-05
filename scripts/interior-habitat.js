/** Habitat run: an encounter-sized slice of one deck, assembled from whole compartments.
 * A cabin is ONE quarters room whose sections (living, bed, closet, head, study, hall) are
 * internal partitions on the cabin's own rectangular frame, so nothing is ever fitted into a
 * wedge. Units are grid squares (1.5 m). Independent of Foundry and the renderer; the caller
 * passes interiorEdges in, which keeps this module out of interior-layout.js's import graph. */
import { usesInteriorQueenBeds, INTERIOR_QUEEN_BED } from "./interior-assets.js";
const round=n=>Math.round(n*10000)/10000;
const pt=p=>({x:round(p.x),y:round(p.y)});
const key=(a,b)=>[`${a.x},${a.y}`,`${b.x},${b.y}`].sort().join("/");

// Section widths along the hull (squares). The head is sized for shower + toilet + sink.
export const HABITAT_SECTIONS={living:2.6,bed:2,closet:1,head:1.6,study:2};
export const HABITAT_CABINS={
  single:{name:"Crew quarters",sections:["living","bed","closet","head"]},
  pair:{name:"Junior officers' quarters",sections:["bed","head","bed"]},
  suite:{name:"Officer's suite",sections:["living","study","bed","closet","head"],hall:true},
  family2:{name:"Family quarters",sections:["living","bed","closet","closet","bed","head"],hall:true},
  family3:{name:"Family quarters",sections:["living","bed","closet","closet","bed","closet","bed","head"],hall:true},
};
const DEPTH_OUT=4.6, DEPTH_IN=4, CORRIDOR=2, RUN=2.5, HALL=1.1, DOOR=1.1, ENTRY=1.2, POD=1.3;
// A lift car holds a 2 × 2 block of tokens: radius 1.5 squares clears the half-diagonal (1.414).
const LIFT_RADIUS=1.5,LIFT_PITCH=3.4;
const SLICE_LENGTH={small:30,medium:42,large:54};
// Rooms that want the hull; everything else goes inboard.
const WINDOW_KINDS=new Set(["quarters","lounge","office","briefing","bridge","ops","regeneration"]);
const ROOM_WIDTH={bridge:8,ops:7,engineering:8,reactor:6,lab:5,medical:7,cargo:6,transporter:5,security:4.5,lounge:6,briefing:6,office:4,airlock:4,workshop:4.5,regeneration:5,assimilation:6};
const PROGRAMS={
  mixed:{out:["lounge"],in:["transporter","lab","security","cargo","workshop"],cabins:{single:4,pair:2,family2:1,suite:1}},
  command:{out:["briefing","office"],in:["security","lab","transporter"],cabins:{suite:4,single:3,pair:1}},
  engineering:{out:["lounge"],in:["workshop","cargo","reactor","lab"],cabins:{single:4,pair:3,family2:1}},
  habitat:{out:["lounge"],in:["medical","lab","transporter","security"],cabins:{family2:3,single:3,pair:1,suite:1,family3:1}},
};

/** Polar slice geometry. s is arc length along the corridor's outboard wall; r is distance from
 * the ship's centre. A straight slice is the same formulas with an infinite radius. */
function sliceGeometry(R) {
  const curved=Number.isFinite(R);
  return {
    curved,
    P:(s,r)=>curved?{x:r*Math.sin(s/R),y:-r*Math.cos(s/R)}:{x:s,y:-r},
    // s-length taken up by a chord of length w laid at radius r.
    span:(w,r)=>curved?2*Math.asin(Math.min(1,w/(2*r)))*R:w,
    tangent:s=>curved?s/R*180/Math.PI:0,
  };
}

/** A rigid rectangle on the chord A→B. Local +x runs along the frame, local +y points at the
 * corridor, so y = -h/2 is the hull (outboard) or the deep back wall (inboard). */
function placeRect(A,B,depth,outward) {
  const length=Math.hypot(B.x-A.x,B.y-A.y),t={x:(B.x-A.x)/length,y:(B.y-A.y)/length},n={x:-t.y,y:t.x};
  const ex=outward?t:{x:-t.x,y:-t.y},ey={x:-ex.y,y:ex.x},side=outward?-1:1;
  const c={x:(A.x+B.x)/2+n.x*side*depth/2,y:(A.y+B.y)/2+n.y*side*depth/2};
  return {w:length,h:depth,center:c,rotation:Math.atan2(ex.y,ex.x)*180/Math.PI,
    toWorld:(x,y)=>({x:c.x+x*ex.x+y*ey.x,y:c.y+x*ex.y+y*ey.y})};
}

const weighted=(rng,table)=>{
  const entries=Object.entries(table),total=entries.reduce((v,[,w])=>v+w,0);
  let roll=rng()*total;
  for(const [k,w]of entries){roll-=w;if(roll<0)return k;}
  return entries[0][0];
};
const shuffle=(rng,list)=>{const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const cabinWidth=type=>HABITAT_CABINS[type].sections.reduce((v,s)=>v+HABITAT_SECTIONS[s],0);

/** One cabin in its own local frame: x ∈ [-W/2, W/2], y ∈ [-D/2 (hull/back), D/2 (corridor)]. */
export function habitatCabinPlan(type,{reversed=false,depth=DEPTH_OUT,windows=true,recipe={}}={}) {
  const spec=HABITAT_CABINS[type],names=reversed?[...spec.sections].reverse():spec.sections;
  const W=cabinWidth(type),D=depth,D2=D/2,yHall=D2-HALL,hall=!!spec.hall;
  // The door line: every walk-through door in a cabin without a hall sits on this one span.
  const lineLo=D2-1.6,lineHi=lineLo+DOOR;
  let x=-W/2;
  const sections=names.map(kind=>{const x0=x;x+=HABITAT_SECTIONS[kind];return {kind,x0,x1:x,cx:(x0+x)/2};});
  // Each closet belongs to an adjacent bedroom not already served (B C | C B, B C B ...).
  const served=new Set();
  sections.forEach((sec,i)=>{
    if(sec.kind!=="closet")return;
    const owner=[i-1,i+1].find(j=>sections[j]?.kind==="bed"&&!served.has(j));
    if(owner!==undefined){served.add(owner);sec.owner=owner;}
  });
  const bottom=sec=>hall&&sec.kind!=="living"?yHall:D2;
  const walls=[],seg=(ax,ay,bx,by,door=false)=>{if(Math.hypot(bx-ax,by-ay)>.001)walls.push({a:{x:ax,y:ay},b:{x:bx,y:by},door});};
  const vertical=(xb,y0,y1,door)=>{
    if(!door){seg(xb,y0,xb,y1);return;}
    seg(xb,y0,xb,door[0]);seg(xb,door[0],xb,door[1],true);seg(xb,door[1],xb,y1);
  };
  for(let i=1;i<sections.length;i++) {
    const a=sections[i-1],b=sections[i],xb=b.x0;
    const owns=(a.kind==="closet"&&a.owner===i)||(b.kind==="closet"&&b.owner===i-1);
    if(hall) {
      if(a.kind==="living"||b.kind==="living"){vertical(xb,-D2,yHall,null);continue;}
      const mid=(-D2+yHall)/2;
      vertical(xb,-D2,yHall,owns?[mid-DOOR/2,mid+DOOR/2]:null);
    } else {
      const closetPair=a.kind==="closet"&&b.kind==="closet";
      vertical(xb,-D2,D2,closetPair?null:[lineLo,lineHi]);
    }
  }
  let hallSpan=null;
  if(hall) {
    // The private hall runs along the corridor side, open to the living room at one end.
    const others=sections.filter(s=>s.kind!=="living");
    hallSpan=[Math.min(...others.map(s=>s.x0)),Math.max(...others.map(s=>s.x1))];
    const gaps=others.filter(s=>["bed","head","study"].includes(s.kind)).map(s=>[s.cx-DOOR/2,s.cx+DOOR/2]).sort((p,q)=>p[0]-q[0]);
    let from=hallSpan[0];
    for(const [g0,g1]of gaps){seg(from,yHall,g0,yHall);seg(g0,yHall,g1,yHall,true);from=g1;}
    seg(from,yHall,hallSpan[1],yHall);
  }
  const rect=(x0,y0,x1,y1)=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
  const floors=sections.map(s=>({kind:s.kind,polygon:rect(s.x0,-D2,s.x1,bottom(s))}));
  if(hallSpan)floors.push({kind:"hall",polygon:rect(hallSpan[0],yHall,hallSpan[1],D2)});
  // Head: wet wall on the cabin's end wall (where it backs onto the neighbouring head).
  const headIndex=sections.findIndex(s=>s.kind==="head"),head=sections[headIndex];
  const hy1=bottom(head),wetRight=headIndex!==0;
  const along=(w)=>wetRight?head.x1-w-.06:head.x0+.06;
  const fixtures=[
    {kind:"shower",x:along(.7),y:-D2+.08,w:.7,h:.7},
    {kind:"toilet",x:along(.45),y:-D2+1.25,w:.45,h:.55},
    {kind:"sink",x:along(.5),y:-D2+2.15,w:.5,h:.35},
  ];
  const bathroomPolygon=rect(head.x0,-D2,head.x1,hy1);
  // Everything but the head, for the area check; a mid-row head leaves a zero-width seam.
  let livingPolygon;
  if(hy1<D2) livingPolygon=wetRight
    ?[{x:-W/2,y:-D2},{x:head.x0,y:-D2},{x:head.x0,y:hy1},{x:W/2,y:hy1},{x:W/2,y:D2},{x:-W/2,y:D2}]
    :[{x:head.x1,y:-D2},{x:W/2,y:-D2},{x:W/2,y:D2},{x:-W/2,y:D2},{x:-W/2,y:hy1},{x:head.x1,y:hy1}];
  else if(headIndex===sections.length-1) livingPolygon=rect(-W/2,-D2,head.x0,D2);
  else if(headIndex===0) livingPolygon=rect(head.x1,-D2,W/2,D2);
  else livingPolygon=[{x:-W/2,y:-D2},{x:head.x0,y:-D2},{x:head.x0,y:D2},{x:head.x1,y:D2},{x:head.x1,y:-D2},{x:W/2,y:-D2},{x:W/2,y:D2},{x:-W/2,y:D2}];
  const furniture=[];
  for(const s of sections) {
    const w=s.x1-s.x0;
    if(s.kind==="living"){const cw=Math.min(2.1,w-.5);furniture.push({kind:"couch",x:s.cx-cw/2,y:-D2+.15,w:cw},{kind:"coffee",x:s.cx-.6,y:-D2+1.3});}
    if(s.kind==="bed") {
      const bed=usesInteriorQueenBeds(recipe)?INTERIOR_QUEEN_BED:{w:.85,h:1.6};
      furniture.push({kind:"bed",x:s.cx-bed.w/2,y:-D2+.15,w:bed.w,h:bed.h});
    }
    if(s.kind==="study")furniture.push({kind:"desk",x:s.cx-.9,y:-D2+.15});
    if(s.kind==="closet") {
      // Wardrobe on the wall away from the door: the shared wall for back-to-back closets.
      const doorOnLeft=s.owner!==undefined?s.owner<sections.indexOf(s):true;
      const y1=hall?yHall-.12:lineLo-.15;
      furniture.push({kind:"wardrobe",x:doorOnLeft?s.x1-.42:s.x0+.04,y:-D2+.12,w:.38,h:y1-(-D2+.12)});
    }
  }
  const entries=(spec.sections.includes("living")?sections.filter(s=>s.kind==="living"):sections.filter(s=>s.kind==="bed")).map(s=>[s.cx-ENTRY/2,s.cx+ENTRY/2]);
  const windowSpans=windows?sections.filter(s=>["living","bed","study"].includes(s.kind)).map(s=>{const half=s.kind==="living"?.8:.5;return [s.cx-half,s.cx+half];}):[];
  return {type,name:spec.name,w:W,h:D,walls,floors,entries,windowSpans,furniture,hall:hallSpan,
    bathroom:{polygon:bathroomPolygon,usable:bathroomPolygon,area:(head.x1-head.x0)*(hy1+D2),tub:false,fixtures},
    livingPolygon,sections:sections.map(({kind,x0,x1,owner})=>({kind,x0,x1,...(owner!==undefined?{owner}:{})}))};
}

/** Build the slice. Returns rooms (raw program) plus exact door/window/open specs; edges are
 * classified here so the caller gets a finished layout. */
export function buildInteriorHabitat(recipe,rng,names,{interiorEdges}) {
  const borg=recipe.faction==="borg";
  const program=PROGRAMS[recipe.purpose]??PROGRAMS.mixed;
  const kinds=recipe.roomTypes??(borg?["regeneration","assimilation","reactor","workshop","cargo","lift"]:["quarters",...program.out,...program.in,"lift"]);
  const hasLift=kinds.includes("lift"),others=kinds.filter(k=>k!=="lift");
  let outKinds=others.filter(k=>WINDOW_KINDS.has(k)),inKinds=others.filter(k=>!WINDOW_KINDS.has(k));
  if(!outKinds.length)outKinds=[...inKinds];
  // Small crew cabins also line the inboard side, windowless; family cabins and suites keep the hull.
  if(outKinds.includes("quarters")&&!inKinds.includes("quarters"))inKinds.push("quarters");
  const cabinTable=recipe.cabinLayout==="standard"?{single:1}:recipe.cabinLayout==="officer"?{suite:1}:program.cabins;
  const innerCabinTable=recipe.cabinLayout==="standard"||recipe.cabinLayout==="officer"?{single:1}:{single:3,pair:2};

  const halfAngle=(w,r)=>Math.asin(Math.min(1,w/(2*r)));
  // Rigid rectangles converge going inboard; open a sliver of structure between them.
  const inboardGap=(w0,w1)=>G.curved?G.span(DEPTH_IN*(Math.tan(halfAngle(w0,Ri))+Math.tan(halfAngle(w1,Ri)))*Ri/(Ri-DEPTH_IN)*1.05+.04,Ri):0;
  const roomWidth=k=>k==="quarters"?null:ROOM_WIDTH[k]??5;

  // ---- inboard program, sized first so the slice is long enough to hold every required room
  const liftCount=hasLift?2:0,bayFloor=liftCount*LIFT_PITCH+.4,CHAMFER=.8,bayWidth=liftCount?bayFloor+2*CHAMFER:0,branchWidth=2.2;
  const inRequired=shuffle(rng,inKinds);
  const inboardItemWidth=k=>k==="quarters"?cabinWidth(weighted(rng,cabinTable)):roomWidth(k);
  const requiredInboard=inRequired.reduce((v,k)=>v+(k==="quarters"?cabinWidth("single"):roomWidth(k))+1,0)+bayWidth+branchWidth+2;
  const outRequired=shuffle(rng,outKinds.filter(k=>k!=="quarters"));
  const requiredOutboard=outRequired.reduce((v,k)=>v+roomWidth(k),0)+(outKinds.includes("quarters")?cabinWidth("family2")*2:0);
  const target=Math.max(SLICE_LENGTH[recipe.size]??42,requiredInboard*1.2,requiredOutboard*1.05);

  // An encounter slice of a big hull is a gentle bow: never let it sweep much past 25 degrees.
  const R=Math.max({generic:recipe.type==="station"?220:150,galaxy:150,intrepid:70}[recipe.hullProfile]??150,target*2.4);
  const G=sliceGeometry(recipe.curved?R:Infinity),Ri=R-CORRIDOR;
  // ---- outboard row: cabins mirrored in alternation so heads and living rooms meet in pairs
  const outboard=[];let used=0,cabins=0,sinceBreak=0;
  const featureQueue=[...outRequired],hasQuarters=outKinds.includes("quarters"),features=outKinds.filter(k=>k!=="quarters");
  const pods=hasQuarters&&!borg;
  while(used<target||featureQueue.length) {
    const placeFeature=featureQueue.length&&(!hasQuarters||(cabins>=1&&rng()<.4)||used>=target);
    if(placeFeature){const k=featureQueue.shift();outboard.push({kind:k,w:roomWidth(k)});used+=roomWidth(k);sinceBreak=0;continue;}
    if(hasQuarters) {
      if(pods&&sinceBreak>=2&&rng()<.55){outboard.push({kind:"pod",w:POD});used+=POD;sinceBreak=0;continue;}
      const type=weighted(rng,cabinTable);
      outboard.push({kind:"quarters",cabin:type,reversed:cabins%2===1,w:cabinWidth(type)});
      used+=cabinWidth(type);cabins++;sinceBreak++;continue;
    }
    if(!features.length)break;
    const k=features[Math.floor(rng()*features.length)];outboard.push({kind:k,w:roomWidth(k)});used+=roomWidth(k);
  }

  // ---- lay the outboard row along the corridor wall
  const rooms=[],exactDoors=[],windows=[],opens=[],hullSegments=new Map();
  const add=(room)=>{room.id=`room-${rooms.length+1}`;rooms.push(room);return room;};
  let s=0;const outerPoints=[];
  for(const item of outboard) {
    const s0=s;s+=G.span(item.w,R);
    const A=G.P(s0,R),B=G.P(s,R),f=placeRect(A,B,DEPTH_OUT,true);
    outerPoints.push({s:s0,p:A});
    item.frame=f;item.s0=s0;item.s1=s;
  }
  const sEnd=Math.max(s,target),sStart=0;
  if(outboard.length)outerPoints.push({s,p:G.P(s,R)});
  const frameOf=(f,extra={})=>({x:f.center.x,y:f.center.y,w:f.w,h:f.h,rotation:f.rotation,...extra});
  const polygonFrom=(f,{bottomCuts=[],topCuts=[]}={})=>{
    // Corridor edge left→right with door cuts, far edge right→left with window cuts.
    const W=f.w/2,H=f.h/2,cut=(list)=>list.flat().filter(x=>x>-W+1e-6&&x<W-1e-6);
    return [{x:-W,y:H},...cut(bottomCuts).sort((a,b)=>a-b).map(x=>({x,y:H})),{x:W,y:H},{x:W,y:-H},
      ...cut(topCuts).sort((a,b)=>b-a).map(x=>({x,y:-H})),{x:-W,y:-H}].map(p=>f.toWorld(p.x,p.y));
  };
  const hullWindows=recipe.hullWindows&&!borg;
  for(const item of outboard) {
    const f=item.frame;
    if(item.kind==="pod") {
      const room=add({kind:"corridor",name:"Escape pod",pod:true,zone:"outboard",polygon:polygonFrom(f),frame:frameOf(f)});
      exactDoors.push([f.toWorld(-f.w/2,f.h/2),f.toWorld(f.w/2,f.h/2)]);
      room.lightPoints=[];continue;
    }
    if(item.kind==="quarters") {
      const plan=habitatCabinPlan(item.cabin,{reversed:item.reversed,windows:hullWindows,recipe});
      const room=add({kind:"quarters",name:plan.name,zone:"outboard",habitatCabin:plan.type,
        polygon:polygonFrom(f,{bottomCuts:plan.entries,topCuts:plan.windowSpans}),frame:frameOf(f)});
      room.architecture=cabinArchitecture(plan,f);
      for(const [x0,x1]of plan.entries)exactDoors.push([f.toWorld(x0,f.h/2),f.toWorld(x1,f.h/2)]);
      for(const [x0,x1]of plan.windowSpans)windows.push([f.toWorld(x0,-f.h/2),f.toWorld(x1,-f.h/2)]);
      hullSegments.set(room.id,[f.toWorld(-f.w/2,-f.h/2),f.toWorld(f.w/2,-f.h/2)]);
      continue;
    }
    const panes=Math.max(1,Math.floor(f.w/2.2));
    const spans=hullWindows&&WINDOW_KINDS.has(item.kind)?Array.from({length:panes},(_,i)=>{const c=-f.w/2+(i+.5)*f.w/panes;return [c-.6,c+.6];}):[];
    const room=add({kind:item.kind,name:names[item.kind],zone:"outboard",generic:true,windowEligible:spans.length>0,
      polygon:polygonFrom(f,{topCuts:spans}),frame:frameOf(f)});
    for(const [x0,x1]of spans)windows.push([f.toWorld(x0,-f.h/2),f.toWorld(x1,-f.h/2)]);
    hullSegments.set(room.id,[f.toWorld(-f.w/2,-f.h/2),f.toWorld(f.w/2,-f.h/2)]);
  }

  // ---- inboard row: rooms up to a junction (lift bay + branch corridor), then more rooms
  const innerPoints=[{s:sStart,p:G.P(sStart,Ri)}],lifts=[];
  let si=sStart,prevW=null,branch=null;
  const junctionSpan=G.span(bayWidth+branchWidth+.6,Ri);
  const junctionAt=Math.max(0,Math.min(sEnd*(.45+rng()*.25),sEnd-junctionSpan-.5));
  const queue=[...inRequired];
  const placeJunction=()=>{
    if(prevW!==null)si+=G.curved?G.span(.4,Ri):0;
    if(liftCount) {
      // The corridor's inboard wall steps back into a bay; bare circular shafts open off its floor.
      const b0=si,b1=si+G.span(bayWidth,Ri),c0=b0+G.span(CHAMFER,Ri),c1=b1-G.span(CHAMFER,Ri);
      const F0=G.P(c0,Ri-1),F1=G.P(c1,Ri-1);
      innerPoints.push({s:b0,p:G.P(b0,Ri)},{s:c0,p:F0},{s:c1,p:F1},{s:b1,p:G.P(b1,Ri)});
      const L=Math.hypot(F1.x-F0.x,F1.y-F0.y),t={x:(F1.x-F0.x)/L,y:(F1.y-F0.y)/L},n={x:-t.y,y:t.x};
      for(let i=0;i<liftCount;i++) {
        const along=L/2+(i-(liftCount-1)/2)*LIFT_PITCH,at=d=>({x:F0.x+t.x*d,y:F0.y+t.y*d}),back=Math.sqrt(LIFT_RADIUS**2-.36);
        lifts.push({L0:at(along-.6),L1:at(along+.6),c:{x:F0.x+t.x*along+n.x*back,y:F0.y+t.y*along+n.y*back},n,t});
      }
      si=b1;
    }
    const j0=si,j1=si+G.span(branchWidth,Ri),J0=G.P(j0,Ri),J1=G.P(j1,Ri);
    innerPoints.push({s:j0,p:J0},{s:j1,p:J1});
    branch=placeRect(J0,J1,DEPTH_IN+2.2,false);
    si=j1;prevW=null;
  };
  let afterJunction=false;
  /** Place one inboard room if it ends by `limit`; returns false when it would not fit. */
  const tryPlace=(k,limit,cabin=null)=>{
    if(k==="quarters"&&!cabin)cabin=weighted(rng,innerCabinTable);
    const w=cabin?cabinWidth(cabin):roomWidth(k);
    const gap=prevW===null?(afterJunction&&G.curved?G.span(.4,Ri):0):inboardGap(prevW,w);
    const s0=si+gap,s1=s0+G.span(w,Ri);
    if(s1>limit+1e-9)return false;
    const A=G.P(s0,Ri),B=G.P(s1,Ri),f=placeRect(A,B,DEPTH_IN,false);
    innerPoints.push({s:s0,p:A},{s:s1,p:B});
    if(cabin) {
      const plan=habitatCabinPlan(cabin,{reversed:rooms.filter(r=>r.zone==="inboard"&&r.kind==="quarters").length%2===1,depth:DEPTH_IN,windows:false,recipe});
      const room=add({kind:"quarters",name:plan.name,zone:"inboard",habitatCabin:plan.type,polygon:polygonFrom(f,{bottomCuts:plan.entries}),frame:frameOf(f)});
      room.architecture=cabinArchitecture(plan,f);
      for(const [x0,x1]of plan.entries)exactDoors.push([f.toWorld(x0,f.h/2),f.toWorld(x1,f.h/2)]);
    } else add({kind:k,name:names[k],zone:"inboard",generic:true,polygon:polygonFrom(f),frame:frameOf(f)});
    si=s1;prevW=w;return true;
  };
  const randomFill=limit=>{
    // Extra rooms only while one fits; a single cabin is the fallback for quarters.
    for(let tries=0;tries<40&&inKinds.length;tries++) {
      const k=inKinds[Math.floor(rng()*inKinds.length)];
      if(tryPlace(k,limit))continue;
      if(k==="quarters"&&tryPlace(k,limit,"single"))continue;
      break;
    }
  };
  // Required rooms first, before and after the junction, then fill out the remainder.
  while(queue.length&&tryPlace(queue[0],junctionAt))queue.shift();
  randomFill(junctionAt);
  placeJunction();afterJunction=true;
  while(queue.length) {
    if(!tryPlace(queue[0],sEnd)&&!(queue[0]==="quarters"&&tryPlace("quarters",sEnd,"single")))throw new Error("The selected room palette does not fit this deck.");
    queue.shift();
  }
  randomFill(sEnd);
  innerPoints.push({s:sEnd,p:G.P(sEnd,Ri)});

  // ---- corridor: one main run between isolation doors, a short run past each, and the branch
  const arcPoints=(r,a,b)=>{const n=Math.max(1,Math.ceil(Math.abs(b-a)/1.2));return Array.from({length:n+1},(_,i)=>({s:a+(b-a)*i/n,p:G.P(a+(b-a)*i/n,r)}));};
  const outerAll=[...arcPoints(R,sStart-RUN,sStart),...(outboard.length?outerPoints:arcPoints(R,sStart,sEnd)),...arcPoints(R,outboard.length?s:sEnd,sEnd),...arcPoints(R,sEnd,sEnd+RUN)];
  const innerAll=[...arcPoints(Ri,sStart-RUN,sStart),...innerPoints,...arcPoints(Ri,sEnd,sEnd+RUN)];
  const dedupe=list=>{const out=[];for(const q of list.sort((a,b)=>a.s-b.s)){const last=out.at(-1);if(last&&Math.hypot(last.p.x-q.p.x,last.p.y-q.p.y)<.02)continue;out.push(q);}return out;};
  const outerLine=dedupe(outerAll),innerLine=dedupe(innerAll);
  // Pieces meet on a shared vertex; snap each cut to the nearest real vertex so a corner that
  // rounding left a hair inside the cut cannot split the boundary into two mismatched edges.
  const anchor=(line,c)=>{let best=line[0];for(const q of line)if(Math.abs(q.s-c)<Math.abs(best.s-c))best=q;best.s=c;return best.p;};
  const cuts=Object.fromEntries([sStart-RUN,sStart,sEnd,sEnd+RUN].map(c=>[c,[anchor(innerLine,c),anchor(outerLine,c)]]));
  const piece=(lo,hi,name,extra={})=>{
    const outer=outerLine.filter(q=>q.s>=lo-1e-9&&q.s<=hi+1e-9),inner=innerLine.filter(q=>q.s>=lo-1e-9&&q.s<=hi+1e-9);
    const mid=(lo+hi)/2,c=G.P(mid,R-CORRIDOR/2);
    const rail=r=>arcPoints(r,lo,hi).map(q=>q.p);
    const centerline=rail(R-CORRIDOR/2);
    return add({kind:"corridor",name,zone:"circulation",polygon:[...outer.map(q=>q.p),...inner.reverse().map(q=>q.p)],
      frame:{x:c.x,y:c.y,w:Math.max(1,hi-lo),h:CORRIDOR,rotation:G.tangent(mid)},
      guidePaths:[rail(R-.22),rail(Ri+.22)],centerline,lightPoints:centerline.filter((_,i)=>i%4===2),...extra});
  };
  piece(sStart-RUN,sStart,"Deck passageway");
  const main=piece(sStart,sEnd,"Deck passageway");
  piece(sEnd,sEnd+RUN,"Deck passageway");
  for(const at of [sStart,sEnd])exactDoors.push(cuts[at]);
  for(const at of [sStart-RUN,sEnd+RUN])opens.push(cuts[at]);
  const bp=[branch.toWorld(-branch.w/2,branch.h/2),branch.toWorld(branch.w/2,branch.h/2),branch.toWorld(branch.w/2,-branch.h/2),branch.toWorld(-branch.w/2,-branch.h/2)];
  add({kind:"corridor",name:"Branch passageway",zone:"circulation",polygon:bp,frame:frameOf(branch),lightPoints:[branch.center]});
  opens.push([bp[2],bp[3]]);
  for(const lift of lifts) {
    const {L0,L1,c,n}=lift,radius=LIFT_RADIUS,start=Math.atan2(L1.y-c.y,L1.x-c.x),end=Math.atan2(L0.y-c.y,L0.x-c.x);
    // Sweep the long way round, through the side facing away from the corridor.
    let sweep=end-start;while(sweep<=0)sweep+=Math.PI*2;
    const midA=start+sweep/2;if(Math.cos(midA)*n.x+Math.sin(midA)*n.y<0)sweep-=Math.PI*2;
    const arc=Array.from({length:19},(_,i)=>{const a=start+sweep*(i+1)/20;return {x:c.x+Math.cos(a)*radius,y:c.y+Math.sin(a)*radius};});
    const ey={x:-n.x,y:-n.y},ex={x:ey.y,y:-ey.x};
    add({kind:"lift",name:names.lift,zone:"inboard",compactLift:true,polygon:[L0,L1,...arc],
      frame:{x:c.x,y:c.y,w:3.7,h:3.7,rotation:Math.atan2(ex.y,ex.x)*180/Math.PI}});
    exactDoors.push([L0,L1]);
  }
  const structure=[...arcPoints(R+DEPTH_OUT+.5,sStart-RUN-8,sEnd+RUN+8).map(q=>q.p),...arcPoints(Ri-DEPTH_IN-3,sStart-RUN-8,sEnd+RUN+8).reverse().map(q=>q.p)];

  // ---- finalise: translate to positive map coordinates, then round every point exactly once
  const all=rooms.flatMap(r=>r.polygon);
  const minX=Math.min(...all.map(p=>p.x)),maxX=Math.max(...all.map(p=>p.x)),minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y));
  const ox=.5-minX,oy=2.6-minY,F=p=>pt({x:p.x+ox,y:p.y+oy});
  for(const room of rooms) {
    room.polygon=room.polygon.map(F);
    room.frame={...room.frame,...F(room.frame)};
    for(const k of ["centerline","lightPoints"])if(room[k])room[k]=room[k].map(F);
    if(room.guidePaths)room.guidePaths=room.guidePaths.map(path=>path.map(F));
    if(room.architecture)room.architecture.walls=room.architecture.walls.map(w=>({...w,a:F(w.a),b:F(w.b)}));
  }
  const keys=list=>new Set(list.map(([a,b])=>key(F(a),F(b))));
  const doorKeys=keys(exactDoors),windowKeys=keys(windows),openKeys=keys(opens);
  const hulls=new Map([...hullSegments].map(([id,[a,b]])=>[id,[F(a),F(b)]]));
  const onSegment=(p,[a,b])=>{const dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy,t=((p.x-a.x)*dx+(p.y-a.y)*dy)/l2;return t>=-1e-4&&t<=1+1e-4&&Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<5e-4;};
  const edges=interiorEdges(rooms),byId=new Map(rooms.map(r=>[r.id,r]));
  for(const e of edges) {
    const k=key(e.a,e.b);
    if(doorKeys.has(k)){e.kind="door";e.exactDoor=true;continue;}
    if(e.rooms.length===1) {
      if(openKeys.has(k)){e.kind="open";continue;}
      e.kind="wall";
      const hull=hulls.get(e.rooms[0]);
      if(hull&&onSegment(e.a,hull)&&onSegment(e.b,hull)){e.hull=true;if(windowKeys.has(k)){e.window=true;e.exactWindow=true;}}
      continue;
    }
    e.kind=e.rooms.every(id=>byId.get(id).kind==="corridor")?"open":"wall";
  }
  // Ordinary rooms take one centred door on their longest corridor face.
  for(const room of rooms.filter(r=>r.generic)) {
    const face=edges.filter(e=>e.rooms.length===2&&e.rooms.includes(room.id)&&e.rooms.some(id=>byId.get(id).kind==="corridor"))
      .sort((a,b)=>Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y)-Math.hypot(a.b.x-a.a.x,a.b.y-a.a.y))[0];
    if(face&&Math.hypot(face.b.x-face.a.x,face.b.y-face.a.y)>=1.5)face.kind="door";
    delete room.generic;
  }
  return {rooms,edges,structure:structure.map(F),entry:F(G.P((sStart+sEnd)/2,R-CORRIDOR/2)),
    width:Math.ceil(maxX-minX+1),height:Math.ceil(maxY-minY+3.2),main:main.id};
}

/** World-space partitions plus local-space furnishing, in the shape the renderer and the
 * shared quarters tests already expect (bathroom, livingPolygon, furniture, walls). */
function cabinArchitecture(plan,f) {
  return {type:"habitat-cabin",plan:plan.type,w:plan.w,h:plan.h,fit:1,
    walls:plan.walls.map(w=>({a:f.toWorld(w.a.x,w.a.y),b:f.toWorld(w.b.x,w.b.y),door:w.door,partition:true})),
    bathroom:plan.bathroom,livingPolygon:plan.livingPolygon,furniture:plan.furniture,floors:plan.floors,sections:plan.sections,hall:plan.hall};
}
