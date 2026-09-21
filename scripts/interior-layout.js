/** Seeded interior geometry, independent of Foundry and the renderer. Units are grid squares. */
import { normalizeInteriorAssets } from "./interior-assets.js";
import { normalizeInteriorBrush, interiorBrushRooms } from "./interior-brush.js";
import { buildInteriorSection, addInteriorHullWindows, compactInteriorLifts } from "./interior-section.js";
import { addInteriorRoomDetails } from "./interior-room-details.js";
export const INTERIOR_VERSION = 4;
export const INTERIOR_ERAS = {
  ent: "Enterprise • 22nd century", tos: "Original Series • 23rd century",
  movies: "Movie era • late 23rd century", tng: "TNG / DS9 / Voyager • 24th century",
  picard: "Picard • early 25th century",
};
export const INTERIOR_FACTIONS = {
  federation: { label: "Federation / Starfleet", eras: ["ent", "tos", "movies", "tng", "picard"], floor: "#696570", panel: "#c5bcad", accent: "#f5b675", screen: "#88bcf3", metal: "#343944", shape: .65, sectors: 12 },
  klingon: { label: "Klingon Empire", eras: ["tos", "movies", "tng", "picard"], floor: "#434b3e", panel: "#77715c", accent: "#fba15d", screen: "#f66a43", metal: "#262e29", shape: 1.2, sectors: 8 },
  romulan: { label: "Romulan Star Empire", eras: ["tos", "movies", "tng"], floor: "#385b55", panel: "#889b86", accent: "#8cf2bb", screen: "#65e9b5", metal: "#203b3c", shape: 1, sectors: 10 },
  cardassian: { label: "Cardassian Union", eras: ["tng", "picard"], floor: "#655347", panel: "#b59963", accent: "#ffd078", screen: "#78c5de", metal: "#3c3029", shape: 1.4, sectors: 12 },
  borg: { label: "Borg Collective", eras: ["tng", "picard"], floor: "#343d35", panel: "#667568", accent: "#a8fb66", screen: "#65ff88", metal: "#161f1b", shape: 0, sectors: 8 },
};
export const INTERIOR_SIZES = { small: "Small section", medium: "Medium section", large: "Large section" };
export const INTERIOR_PURPOSES = { mixed: "Mixed operations", command: "Command & science", engineering: "Engineering & cargo", habitat: "Habitation & medical" };
export const INTERIOR_PLANS = { auto:"Faction default", section:"Hull section / curved passageway", spine:"Longitudinal spine", ring:"Radial / ring deck", lattice:"Modular grid" };
export function interiorSeedHash(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function random(seed) {
  let s = interiorSeedHash(seed);
  return () => { s += 0x6d2b79f5; let t = Math.imul(s ^ s >>> 15, s | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const choice = (value, catalog, fallback) => Object.hasOwn(catalog, value) ? value : fallback;
export function normalizeInteriorRecipe(input = {}) {
  const faction = choice(input.faction, INTERIOR_FACTIONS, "federation");
  const eras = INTERIOR_FACTIONS[faction].eras;
  return {
    version: INTERIOR_VERSION, seed: String(input.seed ?? "enterprise").trim().slice(0, 100) || "enterprise",
    faction, era: eras.includes(input.era) ? input.era : "tng",
    type: input.type === "station" ? "station" : "starship",
    size: choice(input.size, INTERIOR_SIZES, "medium"), purpose: choice(input.purpose, INTERIOR_PURPOSES, "mixed"),
    plan: choice(input.plan, INTERIOR_PLANS, "auto"),
    curved: input.curved !== false,
    hullWindows: input.hullWindows !== false,
    jefferies: input.jefferies !== false,
    roomKit: input.roomKit === "starfleet" ? "starfleet" : "assembled",
    gridSize: [70, 100, 140].includes(Number(input.gridSize)) ? Number(input.gridSize) : 100,
    labels: input.labels !== false, lighting: input.lighting === "emergency" ? "emergency" : "standard",
    roomTypes: Array.isArray(input.roomTypes) ? [...new Set(input.roomTypes.filter(k=>Object.hasOwn(INTERIOR_ROOM_TYPES,k)))] : null,
    assets: normalizeInteriorAssets(input.assets),
    brush: normalizeInteriorBrush(input.brush, {...INTERIOR_ROOM_TYPES,jefferies:"Jefferies tube"}),
  };
}
export function interiorStyle(recipe) {
  const r = normalizeInteriorRecipe(recipe), p = { ...INTERIOR_FACTIONS[r.faction] };
  if (r.faction === "federation") Object.assign(p, {
    ent: { floor: "#535e67", panel: "#a2adb0", accent: "#91c1d7", screen: "#87c8ee", metal: "#303b43" },
    tos: { floor: "#70767d", panel: "#aeb6ba", accent: "#ee7055", screen: "#99d7ff", metal: "#3e444b" },
    movies: { floor: "#535c61", panel: "#c2bfaf", accent: "#a8dacc", screen: "#78cfe4", metal: "#303a42" },
    picard: { floor: "#3e4a58", panel: "#a9b2ba", accent: "#c2e5ff", screen: "#76bbfa", metal: "#26333f" },
  }[r.era] ?? {});
  p.industrial = r.faction === "borg" || r.faction === "klingon" || r.era === "ent";
  p.interface = r.faction === "federation" && ["tng", "picard"].includes(r.era) ? "lcars" : r.era === "tos" ? "buttons" : "segments";
  p.light = r.lighting === "emergency" ? "#ff6259" : p.accent;
  return p;
}
const round = n => Math.round(n * 10000) / 10000;
const pt = (x, y) => ({ x: round(x), y: round(y) });
const rect = (x, y, w, h) => [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)];
const chamfer = (x, y, w, h, c) => [pt(x+c,y),pt(x+w-c,y),pt(x+w,y+c),pt(x+w,y+h-c),pt(x+w-c,y+h),pt(x+c,y+h),pt(x,y+h-c),pt(x,y+c)];
export const INTERIOR_ROOM_TYPES = {
  bridge: "Bridge", ops: "Operations", engineering: "Main engineering", reactor: "Reactor control", quarters: "Crew quarters", lab: "Science lab",
  medical: "Sickbay", cargo: "Cargo bay", transporter: "Transporter room", security: "Security", lounge: "Mess / lounge", briefing: "Briefing room", lift: "Turbolift",
  airlock: "Airlock control", regeneration: "Regeneration alcoves", assimilation: "Assimilation chamber", workshop: "Maintenance",
  office: "Ready room / office",
};
const ROOM_NAMES={...INTERIOR_ROOM_TYPES,corridor:"Passageway",jefferies:"Jefferies tube"};
function roomKinds(recipe) {
  if (recipe.faction === "borg") return ["regeneration", "assimilation", "reactor", "regeneration", "workshop", "cargo"];
  return {
    mixed: ["transporter", "medical", "lab", "quarters", "security", "lounge", "cargo", "workshop"],
    command: ["briefing", "security", "lab", "transporter", "lab", "medical", "quarters", "lounge"],
    engineering: ["reactor", "workshop", "cargo", "transporter", "cargo", "lab", "medical", "security"],
    habitat: ["medical", "quarters", "lounge", "quarters", "lab", "transporter", "quarters", "security"],
  }[recipe.purpose];
}

/** Shared polygon boundaries are split at T junctions before walls/doors are assigned. */
export function interiorEdges(rooms) {
  const key = p => `${p.x},${p.y}`;
  const vertices = [...new Map(rooms.flatMap(r => [r.polygon,...(r.holes??[])].flat()).map(p=>[key(p),p])).values()], segments = new Map();
  for (const room of rooms) for(const loop of [room.polygon,...(room.holes??[])]) for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i+1) % loop.length];
    const dx = b.x-a.x, dy = b.y-a.y, l2 = dx*dx+dy*dy;
    if (l2 < 1e-8) continue;
    const splits = new Map([[key(a), { p: a, t: 0 }], [key(b), { p: b, t: 1 }]]);
    for (const p of vertices) {
      const t = ((p.x-a.x)*dx+(p.y-a.y)*dy)/l2;
      if (t > 1e-6 && t < 1-1e-6 && Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)/Math.sqrt(l2) < .0002) splits.set(key(p), { p, t });
    }
    const points = [...splits.values()].sort((a,b) => a.t-b.t);
    for (let j = 1; j < points.length; j++) {
      const a = points[j-1].p, b = points[j].p, id = [key(a), key(b)].sort().join("/");
      if (!segments.has(id)) segments.set(id, { a, b, rooms: [] });
      const edge = segments.get(id);
      if (!edge.rooms.includes(room.id)) edge.rooms.push(room.id);
    }
  }
  return [...segments.values()];
}

export function generateInterior(input = {}) {
  const recipe = normalizeInteriorRecipe(input), style = interiorStyle(recipe), rng = random(recipe.seed);
  if(recipe.brush) {
    const rooms=interiorBrushRooms(recipe.brush,{...INTERIOR_ROOM_TYPES,jefferies:"Jefferies tube"}),edges=connectInteriorRooms(rooms,rng,true);
    const f=(rooms.find(r=>r.kind==="corridor")??rooms[0])?.frame;
    return {recipe,plan:"painted",width:recipe.brush.width,height:recipe.brush.height,rooms,edges,entry:pt(f?.x??3,f?.y??3)};
  }
  if(recipe.roomTypes?.length===0)throw new Error("Select at least one room type, or use the department mix.");
  const rooms = [], kinds = roomKinds(recipe), sizeIndex = ["small", "medium", "large"].indexOf(recipe.size);
  const add = (kind, polygon, frame, name) => {
    const room = { id: `room-${rooms.length+1}`, kind, name: name || ROOM_NAMES[kind], polygon, frame };
    rooms.push(room); return room;
  };
  const box = (kind, x, y, w, h, name, cut = 0) => add(kind, cut ? chamfer(x,y,w,h,cut) : rect(x,y,w,h), { x:x+w/2, y:y+h/2, w:w-2*cut, h:h-2*cut, rotation:0 }, name);
  let width, height, entry, structure;
  const plan=recipe.plan!=="auto" ? recipe.plan : recipe.faction==="borg" ? "lattice" : "section";
  if(plan==="section") {
    const section=buildInteriorSection(recipe,rng,ROOM_NAMES);
    rooms.push(...section.rooms);({width,height,entry,structure}=section);
  } else if (plan === "lattice") {
    const n = Math.max(sizeIndex+2,Math.ceil(Math.sqrt(recipe.roomTypes?.length??0))), cell = 5+Math.floor(rng()*3), passage = 2, stride=cell+passage, margin = 3;
    width = height = 2*margin+n*cell+(n-1)*passage;
    for (let y=0; y<n; y++) for (let x=0; x<n; x++) {
      box(x===0 && y===0 ? "ops" : kinds[Math.floor(rng()*kinds.length)], margin+x*stride,margin+y*stride,cell,cell);
    }
    for (let i=1; i<n; i++) {
      box("corridor", margin+i*stride-passage,margin,passage,width-2*margin, "Distribution conduit");
      // Split crossing corridors into disjoint polygons so the shared-edge model stays exact.
      for (let x=0; x<n; x++) box("corridor",margin+x*stride,margin+i*stride-passage,cell,passage,"Transverse conduit");
    }
    entry = pt(margin+cell+passage/2,margin+cell/2);
  } else if (plan === "ring") {
    const n = Math.max(style.sectors,Math.ceil(((recipe.roomTypes?.length??0)+1)/3)*2), inner = 6+sizeIndex+Math.floor(rng()*3)*.5, ring = inner+4+sizeIndex, outer = ring+2.4, hull = outer+5+sizeIndex+Math.floor(rng()*3)*.5;
    width = height = Math.ceil((hull+3)*2); const cx=width/2, cy=height/2;
    const at = (r,i) => pt(cx+Math.cos(i/n*Math.PI*2-Math.PI/2)*r,cy+Math.sin(i/n*Math.PI*2-Math.PI/2)*r);
    // Shared circular arcs are sampled identically on both sides of each bulkhead.
    // A short straight landing in the middle of each arc leaves room for a proper sliding door.
    const arc=(radius,i)=>{
      if(!recipe.curved)return[at(radius,i),at(radius,i+1)];
      const step=Math.PI*2/n, start=i*step-Math.PI/2, middle=start+step/2;
      const landing=Math.min(Math.asin(.95/radius),step*.46), span=step/2-landing, steps=Math.max(1,Math.ceil(radius*span/.8));
      const point=a=>pt(cx+Math.cos(a)*radius,cy+Math.sin(a)*radius);
      return [...Array.from({length:steps+1},(_,j)=>point(start+span*j/steps)),
        ...Array.from({length:steps+1},(_,j)=>point(middle+landing+span*j/steps))];
    };
    const sector = (r1,r2,i) => [...arc(r2,i),...arc(r1,i).reverse()];
    const frame = (r1,r2,i) => {
      const a=(i+.5)/n*Math.PI*2-Math.PI/2, mid=(r1+r2)/2;
      return { x:cx+Math.cos(a)*mid, y:cy+Math.sin(a)*mid, w:2*r1*Math.sin(Math.PI/n)-.6, h:(r2-r1)*Math.cos(Math.PI/n)-.6, rotation:(a*180/Math.PI)+90 };
    };
    add(recipe.type==="starship"?"bridge":"ops",Array.from({length:n},(_,i)=>arc(inner,i).slice(0,-1)).flat(),{x:cx,y:cy,w:inner*1.4,h:inner*1.4,rotation:0});
    for (let i=0; i<n; i++) {
      // Pair inner sectors so usable rooms do not taper into furniture-sized wedges.
      if(i%2===0) {
        const transit=i===0||i===Math.floor(n/4)*2,a=(i+1)/n*Math.PI*2-Math.PI/2,mid=(inner+ring)/2;
        const outerArc=[...arc(ring,i).slice(0,-1),...arc(ring,i+1)],innerArc=[...arc(inner,i).slice(0,-1),...arc(inner,i+1)];
        const room=add(transit?"corridor":i===2?"lift":kinds[(i+Math.floor(rng()*3))%kinds.length],[...outerArc,...innerArc.reverse()],
          {x:cx+Math.cos(a)*mid,y:cy+Math.sin(a)*mid,w:2*inner*Math.sin(2*Math.PI/n)-.6,h:(ring-inner)*Math.cos(2*Math.PI/n)-.6,rotation:a*180/Math.PI-90},transit?"Core access":undefined);
        room.zone="inboard";
      }
      add("corridor",sector(ring,outer,i),frame(ring,outer,i),"Promenade");
      const kind = i===0 ? "airlock" : i===Math.floor(n*.75) ? "engineering" : kinds[(i+3+Math.floor(rng()*3))%kinds.length];
      const hullRadius=hull+(recipe.faction!=="federation"&&i%3===0 ? .6 : 0);
      const room=add(kind,sector(outer,hullRadius,i),frame(outer,hull,i));
      room.hullBoundary=arc(hullRadius,i);room.zone="outboard";
    }
    const f = frame(ring,outer,0); entry = pt(f.x,f.y);
  } else {
    const rows=Math.max(4+sizeIndex*2,Math.ceil(((recipe.roomTypes?.length??0)-2)/2)), depths=Array.from({length:rows},()=>5+Math.floor(rng()*3));
    const length=depths.reduce((a,b)=>a+b,0), cx=15+sizeIndex, top=12;
    width = cx*2; height=top+length+12;
    box("bridge",cx-6,3,12,9,undefined,style.shape);
    box("corridor",cx-1,top,2,length,"Main passageway");
    box("engineering",cx-7,top+length,14,9,undefined,style.shape);
    let y=top;
    for (let i=0; i<rows; i++) {
      const h=depths[i], w=7+Math.floor(rng()*3)+(i>0 && i<rows-1 ? 1 : 0);
      for (const side of [-1,1]) {
        const kind=i===0 && side===-1 ? "lift" : i===rows-1 && side===1 ? "airlock" : kinds[(i*2+(side===1?1:0)+Math.floor(rng()*2))%kinds.length];
        const x=side===-1 ? cx-1-w : cx+1, c=style.shape;
        // Chamfer only the hull-facing corners; shared corridor walls remain straight.
        const polygon=side===-1 ? [pt(x+c,y),pt(x+w,y),pt(x+w,y+h),pt(x+c,y+h),pt(x,y+h-c),pt(x,y+c)]
          : [pt(x,y),pt(x+w-c,y),pt(x+w,y+c),pt(x+w,y+h-c),pt(x+w-c,y+h),pt(x,y+h)];
        const room=add(kind,polygon,{x:x+w/2,y:y+h/2,w:w-2*c,h:h-1,rotation:side===-1?90:-90});
        room.hullBoundary=side===-1?[polygon[4],polygon[5]]:[polygon[2],polygon[3]];
        // Frames are rotated; their dimensions follow the local axes.
        const f=rooms.at(-1).frame; [f.w,f.h]=[f.h,f.w];
      }
      y+=h;
    }
    entry=pt(cx,top+2);
  }
  if(recipe.roomTypes&&plan!=="section") {
    const available=rooms.filter(r=>r.kind!=="corridor"), assigned=new Set();
    // Retain a matching purpose in its original location where possible, then place missing types.
    for(const kind of recipe.roomTypes) {
      const room=available.find(r=>!assigned.has(r.id)&&r.kind===kind)??available.find(r=>!assigned.has(r.id));
      if(!room)throw new Error("The selected room palette does not fit this deck.");
      room.kind=kind;room.name=ROOM_NAMES[kind];assigned.add(room.id);
    }
    for(const room of available) if(!assigned.has(room.id)) {room.kind=recipe.roomTypes[Math.floor(rng()*recipe.roomTypes.length)];room.name=ROOM_NAMES[room.kind];}
  }
  if(plan==="ring") {
    // Palette reassignment must obey the same inboard rule as the default room program.
    for(const room of rooms.filter(r=>r.kind==="lift"&&r.zone==="outboard")) {
      const target=rooms.find(r=>r.zone==="inboard"&&!["corridor","lift"].includes(r.kind));
      if(target) {
        room.kind=target.kind;room.name=target.name;
        target.kind="lift";target.name=ROOM_NAMES.lift;
      } else {
        const replacement=(recipe.roomTypes??kinds).find(k=>k!=="lift");
        if(replacement){room.kind=replacement;room.name=ROOM_NAMES[replacement];}
        else rooms.splice(rooms.indexOf(room),1);
      }
    }
  }
  compactInteriorLifts(rooms,interiorEdges(rooms));
  for(const room of rooms)if(room.hullBoundary)room.windowEligible=["quarters","lounge","office","briefing"].includes(room.kind);
  const edges=connectInteriorRooms(rooms,rng,false,plan==="section");
  for(const room of rooms)if(plan==="section"||room.kind==="quarters")addInteriorRoomDetails(room,edges);
  const layout={recipe,plan,width,height,rooms,edges,entry,...(structure?{structure}:{})};
  addInteriorHullWindows(layout);
  const errors=validateInterior(layout);
  if (errors.length) throw new Error(`Interior generation failed: ${errors.join("; ")}`);
  return layout;
}

function connectInteriorRooms(rooms,rng,painted=false,corridorAccessOnly=false) {
  const edges=interiorEdges(rooms), byId=new Map(rooms.map(r=>[r.id,r])), shared=new Map();
  for (const edge of edges) {
    if (edge.rooms.length!==2) { edge.kind="wall"; continue; }
    const pair=edge.rooms.slice().sort().join("/"), rs=edge.rooms.map(id=>byId.get(id));
    edge.kind=rs.every(r=>["corridor","jefferies"].includes(r.kind)) ? "open" : "wall";
    if (!shared.has(pair)) shared.set(pair,[]);
    shared.get(pair).push(edge);
  }
  for (const group of shared.values()) {
    const rs=group[0].rooms.map(id=>byId.get(id));
    if (rs.every(r=>["corridor","jefferies"].includes(r.kind))) continue;
    if(rs.some(r=>r.kind==="jefferies")) {
      const edge=group.slice().sort((a,b)=>Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y)-Math.hypot(a.b.x-a.a.x,a.b.y-a.a.y))[0];
      if(Math.hypot(edge.b.x-edge.a.x,edge.b.y-edge.a.y)>=.8)edge.kind="hatch";
      continue;
    }
    // All compartments connect to circulation. Secondary service doors add alternate routes.
    if (painted || rs.some(r=>r.kind==="corridor") || (!corridorAccessOnly&&rs.every(r=>!["ops","bridge","quarters"].includes(r.kind)) && rng()<.28)) {
      const edge=group.slice().sort((a,b)=>Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y)-Math.hypot(a.b.x-a.a.x,a.b.y-a.a.y))[0];
      if (Math.hypot(edge.b.x-edge.a.x,edge.b.y-edge.a.y)>=1.5) edge.kind="door";
    }
  }
  if(!painted)for(const room of rooms.filter(r=>r.kind==="quarters")) {
    // A private cabin needs one public entrance, not doors into every adjacent corridor.
    // Keep the longest landing; the remaining perimeter can support beds and a bathroom.
    const doors=edges.filter(e=>e.kind==="door"&&e.rooms.includes(room.id)).sort((a,b)=>Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y)-Math.hypot(a.b.x-a.a.x,a.b.y-a.a.y));
    for(const edge of doors.slice(1))edge.kind="wall";
  }
  return edges;
}

/** Used by both export and tests: every compartment must be reachable with doors open. */
export function validateInterior(layout) {
  const errors=[], graph=new Map(layout.rooms.map(r=>[r.id,new Set()]));
  if(!layout.rooms.length)errors.push("Paint at least one room and a passageway.");
  for (const r of layout.rooms) if ([r.polygon,...(r.holes??[])].flat().some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>layout.width||p.y>layout.height)) errors.push(`Invalid bounds: ${r.id}`);
  for (const e of layout.edges) {
    if (e.rooms.length>2) errors.push("Overlapping boundaries");
    if (e.kind!=="wall" && e.rooms.length===2) { graph.get(e.rooms[0]).add(e.rooms[1]); graph.get(e.rooms[1]).add(e.rooms[0]); }
  }
  const seen=new Set(), queue=[layout.rooms[0]?.id];
  while(queue.length) { const id=queue.pop(); if (!id||seen.has(id)) continue; seen.add(id); queue.push(...graph.get(id)); }
  if (seen.size!==layout.rooms.length) errors.push(layout.recipe.brush?"Disconnected compartments: join rooms with passageways sharing at least two squares of wall.":"Disconnected compartments");
  return errors;
}

/** The single source of truth for artwork thresholds and Foundry door/wall segments. */
export function interiorWallSegments(layout) {
  return layout.edges.flatMap(e=>{
    if(e.kind==="open") return [];
    if(e.window) {
      const length=Math.hypot(e.b.x-e.a.x,e.b.y-e.a.y);
      if(length<=1.2)return [{a:e.a,b:e.b,door:false,window:true,hull:true}];
      const count=Math.max(1,Math.floor(length/1.8)),parts=[],at=t=>pt(e.a.x+(e.b.x-e.a.x)*t,e.a.y+(e.b.y-e.a.y)*t);
      let last=0;
      for(let i=0;i<count;i++) {
        const center=(i+.5)/count,half=.45/length,start=center-half,end=center+half;
        parts.push({a:at(last),b:at(start),door:false,hull:true},{a:at(start),b:at(end),door:false,window:true,hull:true});last=end;
      }
      parts.push({a:at(last),b:e.b,door:false,hull:true});return parts;
    }
    if(!["door","hatch"].includes(e.kind)) return [{a:e.a,b:e.b,door:false,...(e.hull?{hull:true}:{})}];
    const length=Math.hypot(e.b.x-e.a.x,e.b.y-e.a.y), half=Math.min(e.kind==="hatch"?.35:.7,length/2-.05), t=half/length;
    const at=t=>pt(e.a.x+(e.b.x-e.a.x)*t,e.a.y+(e.b.y-e.a.y)*t), a=at(.5-t), b=at(.5+t);
    return [{a:e.a,b:a,door:false},{a,b,door:true,...(e.kind==="hatch"?{hatch:true}:{})},{a:b,b:e.b,door:false}];
  }).concat(layout.rooms.flatMap(r=>r.architecture?.walls??[]));
}
