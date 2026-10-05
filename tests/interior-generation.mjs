// Run: node --experimental-vm-modules tests/interior-generation.mjs
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import vm from "node:vm";
import { inflateSync } from "node:zlib";
const cache=new Map(),pending=new Map();
async function load(url) {
  if(!pending.has(url.href))pending.set(url.href,readFile(url,"utf8").then(source=>{const mod=new vm.SourceTextModule(source,{identifier:url.href});cache.set(url.href,mod);return mod;}));
  return pending.get(url.href);
}
const mod=await load(new URL("../scripts/interior-scene.js",import.meta.url));
await mod.link((spec,ref)=>load(new URL(spec,ref.identifier)));await mod.evaluate();
const geometry=cache.get(new URL("../scripts/interior-layout.js",import.meta.url).href).namespace;
const art=cache.get(new URL("../scripts/interior-art.js",import.meta.url).href).namespace;
const assets=cache.get(new URL("../scripts/interior-assets.js",import.meta.url).href).namespace;
const brushTools=cache.get(new URL("../scripts/interior-brush.js",import.meta.url).href).namespace;
const kitTools=cache.get(new URL("../scripts/interior-kit.js",import.meta.url).href).namespace;
const {generateInterior,INTERIOR_FACTIONS,INTERIOR_SIZES,INTERIOR_PURPOSES,validateInterior,interiorWallSegments}=geometry;
const polygonArea=poly=>Math.abs(poly.reduce((sum,a,i)=>{const b=poly[(i+1)%poly.length];return sum+a.x*b.y-b.x*a.y;},0))/2;
const onBoundary=(p,poly)=>poly.some((a,i)=>{const b=poly[(i+1)%poly.length],dx=b.x-a.x,dy=b.y-a.y,t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy);return t>=-.001&&t<=1.001&&Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<.002;});
const inside=(p,poly)=>onBoundary(p,poly)||brushTools.pointInInteriorPolygon(p.x,p.y,poly);
let count=0;
// Tests exercise all supported faction/era/type/size/department combinations with multiple seeds.
for(const [faction,profile]of Object.entries(INTERIOR_FACTIONS)) for(const era of profile.eras) for(const type of ["starship","station"])
  for(const size of Object.keys(INTERIOR_SIZES)) for(const purpose of Object.keys(INTERIOR_PURPOSES)) for(const plan of Object.keys(geometry.INTERIOR_PLANS)) for(let i=0;i<4;i++) {
    const recipe={faction,era,type,size,purpose,plan,seed:`test-${i}`};
    let layout;
    try {layout=generateInterior(recipe);}catch(error){throw new Error(`${JSON.stringify(recipe)}: ${error.message}`);}
    assert.deepEqual(validateInterior(layout),[]);
    const segments=interiorWallSegments(layout);
    assert.ok(segments.filter(s=>s.door).length>=layout.rooms.filter(r=>!["corridor","jefferies"].includes(r.kind)).length-1);
    assert.ok(segments.every(s=>Math.hypot(s.b.x-s.a.x,s.b.y-s.a.y)>.01));
    for(const room of layout.rooms.filter(r=>r.kind==="quarters")) {
      const b=room.architecture.bathroom,f=room.frame,angle=f.rotation*Math.PI/180,fit=room.architecture.fit;
      const world=p=>({x:f.x+fit*(p.x*Math.cos(angle)-p.y*Math.sin(angle)),y:f.y+fit*(p.x*Math.sin(angle)+p.y*Math.cos(angle))});
      for(const p of b.polygon)assert.ok(inside(world(p),room.polygon),`${plan} bathroom remains inside its quarters`);
      assert.ok(b.polygon.some((p,i)=>onBoundary(world(p),room.polygon)&&onBoundary(world(b.polygon[(i+1)%b.polygon.length]),room.polygon)),"Bathroom shares the cabin perimeter instead of floating inside it");
      assert.ok(polygonArea(b.usable)>=4.79,"Standard bathroom has at least 10.8 square metres of usable fixture/standing space");
      assert.ok(Math.abs(polygonArea(room.architecture.livingPolygon)+b.area-polygonArea(room.polygon))<.015,"Living area and bathroom divide the entire cabin without gaps");
      assert.ok(room.architecture.furniture.some(f=>f.kind==="bed"),"Every cabin retains a full-size bed");
      for(const fixture of b.fixtures)for(const x of [fixture.x,fixture.x+fixture.w])for(const y of [fixture.y,fixture.y+fixture.h])assert.ok(inside({x,y},b.polygon),"Bathroom fixtures remain inside the wet area");
    }
    // Wall endpoints remain in the map, and door widths accommodate a one-square token.
    assert.ok(segments.filter(s=>s.door).every(s=>Math.hypot(s.b.x-s.a.x,s.b.y-s.a.y)>=(s.hatch?.699:1.099)));
    const data=mod.namespace.interiorSceneData(layout,"worlds/test/interior.webp");
    assert.equal(data.walls.length,segments.length);assert.equal(data.levels[0]._id.length,16);
    assert.ok(data.walls.every(w=>w.c.every(Number.isInteger)&&w.levels[0]===data.levels[0]._id));
    assert.ok(data.walls.every((w,i)=>w.move===20&&w.sight===(segments[i].window?0:20)&&w.light===(segments[i].window?0:20)&&w.sound===20));
    assert.ok(data.lights.every(l=>Number.isFinite(l.x)&&Number.isFinite(l.y)&&l.config.dim>0));
    assert.equal(data.active,false);assert.equal(data.navigation,false);
    count++;
  }
const a=generateInterior({seed:"repeatable"});
assert.deepEqual(a,generateInterior({seed:"repeatable"}));
assert.notDeepEqual(a.rooms,generateInterior({seed:"different"}).rooms);
assert.notDeepEqual(a.rooms,generateInterior({seed:"repeatable",type:"station"}).rooms);
assert.equal(geometry.normalizeInteriorRecipe({faction:"borg",era:"ent"}).era,"tng");
assert.equal(geometry.normalizeInteriorRecipe({gridSize:Infinity,size:"bogus"}).gridSize,100);
const legacy=mod.namespace.interiorSceneData(a,"test.webp",{generation:13});
assert.equal(legacy.background.src,"test.webp");assert.equal(legacy.levels,undefined);assert.ok(legacy.walls.every(w=>!w.levels));
const svg=art.renderInteriorSVG(generateInterior({seed:'<script>"&hello'}));
assert.ok(!svg.includes("<script>"));assert.ok(svg.includes("&lt;script&gt;"));
assert.ok(!art.renderInteriorSVG(a,{labels:false}).includes("MAIN ENGINEERING</text>"));
assert.equal(art.renderInteriorSVG(a),art.renderInteriorSVG(generateInterior({seed:"repeatable"})));
// Curved radial geometry retains shared door landings and gains actual curved outer boundaries.
const angular=generateInterior({plan:"ring",curved:false,seed:"curves"}),curved=generateInterior({plan:"ring",curved:true,seed:"curves"});
assert.ok(curved.rooms[0].polygon.length>angular.rooms[0].polygon.length);
assert.deepEqual(validateInterior(curved),[]);
// Hull sectors size the program before placement and keep exterior glazing off internal walls.
for(const curved of [true,false])for(const type of ["starship","station"]) {
  const section=generateInterior({plan:"section",purpose:"habitat",seed:"hull-cabins",curved,type});
  assert.equal(section.plan,"section");
  if(curved)assert.ok(section.rooms.some(r=>r.polygon.length>4));
  else assert.ok(section.rooms.some(r=>{const [a,b,c]=r.polygon;return Math.abs((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y))>.1;}),"Faceted rooms have angled, non-rectangular footprints");
  assert.ok(new Set(section.rooms.filter(r=>r.kind!=="corridor").map(r=>Math.round(r.frame.w))).size>1);
  assert.ok(section.edges.some(e=>e.window));
  for(const edge of section.edges.filter(e=>e.window)) {
    assert.equal(edge.rooms.length,1);assert.equal(edge.kind,"wall");assert.ok(edge.hull);
    const owner=section.rooms.find(r=>r.id===edge.rooms[0]);
    assert.equal(owner.zone,"outboard");assert.ok(owner.windowEligible);assert.ok(owner.hullBoundary.length>=2);
  }
  for(const edge of section.edges.filter(e=>e.kind==="door"))assert.ok(edge.rooms.some(id=>section.rooms.find(r=>r.id===id).kind==="corridor"),"Private rooms connect through passageways");
  for(const room of section.rooms.filter(r=>!["corridor","jefferies"].includes(r.kind))) {
    const f=room.frame,angle=f.rotation*Math.PI/180;
    for(const x of [-f.w/2,f.w/2])for(const y of [-f.h/2,f.h/2])assert.ok(brushTools.pointInInteriorPolygon(f.x+x*Math.cos(angle)-y*Math.sin(angle),f.y+x*Math.sin(angle)+y*Math.cos(angle),room.polygon),"Furniture frame stays inside the shaped room");
  }
  const sealed=generateInterior({...section.recipe,hullWindows:false});
  assert.deepEqual(sealed.rooms,section.rooms);assert.ok(!interiorWallSegments(sealed).some(e=>e.window));
  assert.ok(!art.renderInteriorSVG(sealed).includes('data-hull-window'));
  assert.deepEqual(generateInterior(JSON.parse(JSON.stringify(section.recipe))),section);
}
assert.ok(!generateInterior({faction:"borg",plan:"section"}).edges.some(e=>e.window));
const serviced=generateInterior({plan:"section",purpose:"habitat",seed:"hull-cabins"});
assert.ok(serviced.rooms.some(r=>r.kind==="jefferies"));
assert.ok(serviced.edges.filter(e=>e.kind==="hatch").length>=2,"Crawlway provides alternate access between compartments");
assert.ok(interiorWallSegments(serviced).some(e=>e.hatch&&e.door));
assert.ok(art.renderInteriorSVG(serviced).includes('data-service-hatch'));
assert.ok(!generateInterior({...serviced.recipe,jefferies:false}).rooms.some(r=>r.kind==="jefferies"));
const paintedServices=generateInterior({brush:brushTools.rasterizeInterior(serviced)});
assert.ok(paintedServices.rooms.some(r=>r.kind==="jefferies"),"Brushing preserves service tube room types");
for(const plan of Object.keys(geometry.INTERIOR_PLANS)) {
  const deck=generateInterior({plan,roomTypes:["lift","quarters","transporter","cargo"],size:"large"});
  for(const lift of deck.rooms.filter(r=>r.kind==="lift")) {
    assert.ok(lift.compactLift);assert.ok(lift.polygon.length>8);
    const xs=lift.polygon.map(p=>p.x),ys=lift.polygon.map(p=>p.y);
    const cap=deck.plan==="habitat"?3.101:2.501;
    assert.ok(Math.max(...xs)-Math.min(...xs)<=cap&&Math.max(...ys)-Math.min(...ys)<=cap,"Lift cabin has no full-room lobby");
    if(deck.plan==="habitat")assert.ok(Math.max(...xs)-Math.min(...xs)>=2.9,"A habitat lift car holds a 2 × 2 block of tokens");
    assert.ok(deck.edges.some(e=>e.kind==="door"&&e.rooms.includes(lift.id)));
  }
}
assert.ok(serviced.rooms.some(r=>r.architecture?.type==="quarters"&&r.architecture.walls.length));
assert.ok(serviced.rooms.filter(r=>r.kind==="quarters").every(r=>r.architecture?.ensuite&&r.architecture.walls.some(w=>w.door)),"Every cabin includes an enclosed bathroom with a native door");
const suites=serviced.rooms.filter(r=>r.kind==="quarters");
assert.ok(suites.some(r=>r.architecture.bathroom.tub),"Large quarters provide a separate tub");
assert.ok(suites.some(r=>!r.architecture.bathroom.tub),"Standard quarters retain the sonic-shower arrangement");
for(const room of suites) {
  const b=room.architecture.bathroom;
  assert.deepEqual(new Set(b.fixtures.map(f=>f.kind)),new Set(b.tub?["shower","sink","toilet","tub"]:["shower","sink","toilet"]));
  const turns=room.architecture.livingPolygon.map((a,i,poly)=>{const b=poly[(i+1)%poly.length],c=poly[(i+2)%poly.length];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
  assert.ok(turns.some(t=>t>.01)&&turns.some(t=>t<-.01),"Corner bathrooms create L-shaped living footprints");
  assert.ok(!room.architecture.walls.some(w=>onBoundary(w.a,room.polygon)&&onBoundary(w.b,room.polygon)),"Internal partitions do not duplicate the cabin perimeter walls");
}
// Compact quarters and selected palettes must obey the same rules as the default program.
for(const plan of Object.keys(geometry.INTERIOR_PLANS))for(const curved of [true,false])for(const roomTypes of [["quarters"],["lift"],["lift","quarters"],["quarters","lift","medical"]])for(let i=0;i<5;i++) {
  const deck=generateInterior({plan,curved,roomTypes,size:"small",seed:`cabin-fix-${i}`,roomKit:"starfleet"});
  const rendered=art.renderInteriorSVG(deck),native=mod.namespace.interiorSceneData(deck,"test.webp");
  for(const room of deck.rooms.filter(r=>r.kind==="quarters")) {
    assert.ok(room.architecture?.bathroom,`${plan} quarters always include a bathroom`);
    assert.ok(rendered.includes(`data-bathroom="${room.id}"`));
    assert.equal(kitTools.interiorRoomKitPlacement(room,deck.recipe),null,"A baked room image cannot hide the bathroom");
    const door=room.architecture.walls.find(w=>w.door),g=deck.recipe.gridSize;
    assert.ok(door&&Math.hypot(door.b.x-door.a.x,door.b.y-door.a.y)>=1.099);
    assert.ok(native.walls.some(w=>w.door===1&&w.c.join() === [door.a.x,door.a.y,door.b.x,door.b.y].map(v=>Math.round(v*g)).join()));
  }
  for(const lift of deck.rooms.filter(r=>r.kind==="lift")) {
    assert.equal(lift.zone,"inboard");assert.ok(!lift.hullBoundary);
    if(deck.plan==="section") {
      const hall=deck.rooms.find(r=>r.kind==="corridor"&&deck.edges.some(e=>e.kind==="door"&&e.rooms.includes(lift.id)&&e.rooms.includes(r.id)));
      const a=hall.frame.rotation*Math.PI/180;
      assert.ok((lift.frame.x-hall.frame.x)*-Math.sin(a)+(lift.frame.y-hall.frame.y)*Math.cos(a)>0,"Lift lies on the inboard side of its passageway");
    }
    if(deck.plan==="ring")assert.ok(Math.hypot(lift.frame.x-deck.width/2,lift.frame.y-deck.height/2)<Math.min(...deck.rooms.filter(r=>r.name==="Promenade").map(r=>Math.hypot(r.frame.x-deck.width/2,r.frame.y-deck.height/2))),"Lift lies inside the ring corridor");
  }
  // A tube network is crawlways only and deliberately ignores the room palette.
  if(deck.plan==="jefferies")assert.equal(deck.rooms.filter(r=>!["corridor","jefferies"].includes(r.kind)).length,0);
  else assert.deepEqual(new Set(deck.rooms.filter(r=>!["corridor","jefferies"].includes(r.kind)).map(r=>r.kind)),new Set(roomTypes));
}
const transporter=generateInterior({plan:"section",roomTypes:["transporter"],jefferies:false}).rooms.find(r=>r.kind==="transporter");
assert.ok(transporter.architecture.pad.x<0&&transporter.architecture.walls.length>=12,"Transporter alcove leaves a separate control and circulation area");
// A hand-painted connected deck with a shaft cutout keeps both walls and furniture out of the void.
const painted={width:32,height:24,cells:Array(32*24).fill(null),kinds:{corridor:"corridor",medical:"medical",office:"office",engineering:"engineering"}};
function fill(x,y,w,h,id){for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)painted.cells[j*32+i]=id;}
fill(14,4,2,16,"corridor");fill(5,4,9,8,"medical");fill(16,4,9,8,"office");fill(5,12,9,8,"engineering");fill(8,14,2,2,null);
const custom=generateInterior({brush:painted});
assert.deepEqual(validateInterior(custom),[]);
assert.equal(custom.rooms.filter(r=>r.kind!=="corridor").length,3);
assert.equal(custom.rooms.find(r=>r.kind==="engineering").holes.length,1);
assert.ok(art.renderInteriorSVG(custom).includes('clip-rule="evenodd"'));
assert.deepEqual(brushTools.rasterizeInterior(custom).cells.map(Boolean),painted.cells.map(Boolean));
for(const room of custom.rooms) {
  assert.ok(brushTools.pointInInteriorPolygon(room.frame.x,room.frame.y,room.polygon));
  assert.ok(!room.holes.some(h=>brushTools.pointInInteriorPolygon(room.frame.x,room.frame.y,h)));
}
assert.deepEqual(generateInterior(JSON.parse(JSON.stringify(custom.recipe))),custom,"Painted recipe round trip");
const customData=mod.namespace.interiorSceneData(custom,"painted.webp");
assert.deepEqual(customData.flags["sta2e-toolkit"].proceduralInterior.recipe.brush,painted);
assert.ok(customData.walls.some(w=>w.door===1));
// Freehand strokes interpolate between distant pointer events; erasing can intentionally disconnect a deck.
const stroke={width:32,height:24,cells:Array(32*24).fill(null),kinds:{corridor:"corridor"}};
brushTools.paintInteriorStroke(stroke,{x:3,y:8},{x:25,y:8},{id:"corridor",size:2});
assert.equal(stroke.cells.filter(Boolean).length,48);
assert.deepEqual(validateInterior(generateInterior({brush:stroke})),[]);
brushTools.paintInteriorStroke(stroke,{x:14,y:7},{x:14,y:10},{id:null,size:2});
assert.ok(validateInterior(generateInterior({brush:stroke})).some(e=>e.includes("Disconnected")));
assert.throws(()=>generateInterior({brush:{width:999,height:999,cells:[]}}),/brush map/);
assert.ok(validateInterior(generateInterior({brush:{...stroke,cells:Array(768).fill(null)}})).some(e=>e.includes("Paint at least")));
// Diagonal notches and concave components reproduce their occupied cells without filling holes.
for(let seed=1;seed<=60;seed++) {
  const input={width:24,height:24,cells:Array(576).fill(null),kinds:{corridor:"corridor",room:"quarters"}};
  for(let i=0;i<12;i++)brushTools.paintInteriorStroke(input,{x:2+(seed*i*7)%18,y:2+(seed+i*5)%18},{x:2+(seed*i*7+5)%18,y:2+(seed+i*5+3)%18},{id:i%3?"corridor":"room",size:2+i%4,shape:i%2?"round":"square"});
  const layout=generateInterior({brush:input}),again=brushTools.rasterizeInterior(layout);
  assert.deepEqual(again.cells.map(Boolean),input.cells.map(Boolean));
  assert.ok(layout.edges.every(e=>e.rooms.length<=2));
  assert.ok(!/NaN|Infinity|width="-/.test(art.renderInteriorSVG(layout)));
}
// Every requested room type occurs, and unchecked types never sneak back in as default bridge/lift rooms.
let palettes=0;
for(const faction of Object.keys(INTERIOR_FACTIONS))for(const plan of Object.keys(geometry.INTERIOR_PLANS)) {
  for(const roomTypes of [...Object.keys(geometry.INTERIOR_ROOM_TYPES).map(k=>[k]),Object.keys(geometry.INTERIOR_ROOM_TYPES),["quarters","medical","lounge"]]) {
    const layout=generateInterior({faction,plan,size:"small",roomTypes});
    if(plan!=="jefferies")assert.deepEqual(new Set(layout.rooms.filter(r=>!["corridor","jefferies"].includes(r.kind)).map(r=>r.kind)),new Set(roomTypes));
    palettes++;
  }
}
assert.throws(()=>generateInterior({roomTypes:[]}),/at least one room/);
assert.deepEqual(geometry.normalizeInteriorRecipe({roomTypes:["quarters","quarters","injected"]}).roomTypes,["quarters"]);
assert.equal(assets.normalizeInteriorAssets({floor:"javascript:alert(1)"}).floor,"auto");
assert.equal(assets.normalizeInteriorAssets({floor:"../private.png"}).floor,"auto");
assert.equal(assets.normalizeInteriorAssets({floor:"worlds/maps/my floor.png"}).floor,"worlds/maps/my floor.png");
assert.ok(assets.interiorAssetPaths({faction:"klingon",era:"tng"}).console.endsWith("console-imperial.png"));
assert.ok(assets.interiorAssetPaths({faction:"federation",era:"tos"}).console.endsWith("console-retro.png"));
assert.equal(assets.interiorAssetPaths({faction:"borg",era:"tng"}).console,null);
const withImages=art.renderInteriorSVG(a,{assets:{console:"data:image/png;base64,TEST"}});
assert.equal(withImages.split("data:image/png;base64,TEST").length-1,1,"Embed each asset only once");
assert.ok(withImages.includes('href="#asset-console"'));
const kitAssets=Object.fromEntries(Object.keys(kitTools.INTERIOR_KIT_IMAGES).map(key=>[key,"data:image/png;base64,KIT"]));
for(const kind of ["bridge","medical","engineering","quarters","lift","lounge","office"]) {
  const layout=generateInterior({plan:"spine",roomTypes:[kind],roomKit:"starfleet"}),rendered=art.renderInteriorSVG(layout,{assets:kitAssets});
  assert.equal(rendered.includes(`data-room-kit="kit-room-${kind}"`),!["lift","quarters"].includes(kind),"Compact lifts and partitioned quarters use furniture matching native walls");
  assert.ok(rendered.includes('href="#asset-kit-corridor-straight"'));
  assert.equal(layout.recipe.roomKit,"starfleet");
  for(const room of layout.rooms) {
    const placement=kitTools.interiorRoomKitPlacement(room,layout.recipe);if(!placement)continue;
    assert.equal(placement.w,placement.h,"Do not distort pre-rendered furniture");
    assert.ok(placement.w<room.frame.w&&placement.h<room.frame.h);
  }
}
assert.equal(geometry.normalizeInteriorRecipe({roomKit:"injected"}).roomKit,"assembled");
assert.deepEqual(kitTools.interiorKitPaths({roomKit:"assembled"}),{});
let roomImages=0;
for(const assetPath of Object.values(kitTools.INTERIOR_KIT_IMAGES)) {
  const png=await readFile(new URL(`../${assetPath.replace("modules/sta2e-toolkit/","")}`,import.meta.url));
  assert.equal(png.toString("hex",0,8),"89504e470d0a1a0a");assert.ok(png.readUInt32BE(16)>=512&&png.readUInt32BE(20)>=512);roomImages++;
}
// Check the actual bundled files, including real transparent alpha on all furniture assets.
let images=0;
for(const [slot,list]of Object.entries(assets.INTERIOR_ASSET_LIBRARY))for(const item of list) {
  const file=new URL(`../${item.path.replace("modules/sta2e-toolkit/","")}`,import.meta.url),png=await readFile(file);
  assert.equal(png.toString("hex",0,8),"89504e470d0a1a0a");
  const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
  assert.ok(width>=512&&height>=512);
  if(item.aspect) {
    assert.equal(item.aspect,width/height,`${item.path} aspect metadata matches the PNG`);
    const layout=generateInterior({plan:"spine",roomTypes:["bridge","quarters","office"],assets:{[slot]:item.path}});
    const svg=art.renderInteriorSVG(layout,{assets:{[slot]:"data:image/png;base64,TEST"}});
    const placements=[...svg.matchAll(new RegExp(`<use href="#asset-${slot}" transform="[^"]*scale\\(([^ ]+) ([^)]+)\\)"`,"g"))];
    assert.ok(placements.length,`${item.path} is used in the assembled preview`);
    for(const placement of placements)assert.ok(Math.abs(Number(placement[1])/Number(placement[2])-item.aspect)<.01,`${item.path} must not stretch`);
  }
  if(!["floor","corridor","jefferies"].includes(slot)) {
    assert.equal(png[25],6,`${item.path} must have an alpha channel`);assert.equal(png[24],8);
    const chunks=[];
    for(let offset=8;offset<png.length;) {const size=png.readUInt32BE(offset);if(png.toString("ascii",offset+4,offset+8)==="IDAT")chunks.push(png.subarray(offset+8,offset+8+size));offset+=size+12;}
    const raw=inflateSync(Buffer.concat(chunks)),stride=width*4;let previous=Buffer.alloc(stride),minAlpha=255,maxAlpha=0;
    const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
    for(let y=0;y<height;y++) {
      const offset=y*(stride+1),filter=raw[offset],row=Buffer.alloc(stride);
      for(let x=0;x<stride;x++) {const left=x>=4?row[x-4]:0,up=previous[x],diag=x>=4?previous[x-4]:0;row[x]=(raw[offset+1+x]+[0,left,up,Math.floor((left+up)/2),paeth(left,up,diag)][filter])&255;}
      for(let x=3;x<stride;x+=4){minAlpha=Math.min(minAlpha,row[x]);maxAlpha=Math.max(maxAlpha,row[x]);}
      previous=row;
    }
    assert.equal(minAlpha,0,`${item.path} needs a transparent background`);assert.ok(maxAlpha>=250,`${item.path} needs a visible opaque surface`);
  }
  images++;
}
// Habitat runs: cabins are rows of full-depth sections with aligned doors, back-to-back closets,
// a hall wherever several rooms share a head, and a slice that ends in sealable corridor cuts.
const habitat=cache.get(new URL("../scripts/interior-habitat.js",import.meta.url).href).namespace;
for(const type of Object.keys(habitat.HABITAT_CABINS))for(const reversed of [false,true]) {
  const plan=habitat.habitatCabinPlan(type,{reversed}),D2=plan.h/2;
  assert.ok(plan.walls.filter(w=>w.door).every(w=>Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y)>=1.099),`${type} doors admit a one-square token`);
  const head=plan.sections.find(s=>s.kind==="head");
  assert.ok(head.x1-head.x0>=1.599,"A head holds shower, toilet and sink");
  assert.deepEqual(new Set(plan.bathroom.fixtures.map(f=>f.kind)),new Set(["shower","toilet","sink"]));
  for(const f of plan.bathroom.fixtures)assert.ok(f.x>=head.x0&&f.x+f.w<=head.x1,"Fixtures stay inside the head");
  plan.sections.forEach((s,i)=>{
    if(s.kind!=="closet")return;
    // Every closet opens into its own bedroom, which sits directly beside it.
    assert.equal(plan.sections[s.owner].kind,"bed");assert.equal(Math.abs(s.owner-i),1);
    const wallX=s.owner<i?s.x0:s.x1;
    assert.ok(plan.walls.some(w=>w.door&&Math.abs(w.a.x-wallX)<1e-9&&Math.abs(w.b.x-wallX)<1e-9),`${type} closet door is on its bedroom wall`);
  });
  for(let i=1;i<plan.sections.length;i++)if(plan.sections[i-1].kind==="closet"&&plan.sections[i].kind==="closet")
    assert.ok(!plan.walls.some(w=>w.door&&Math.abs(w.a.x-plan.sections[i].x0)<1e-9),"Back-to-back closets share a solid wall");
  const doors=plan.walls.filter(w=>w.door);
  if(plan.hall) {
    // Bedrooms, study and head open off the private hall, so nobody walks through a bedroom.
    const hallY=D2-1.1;
    for(const s of plan.sections.filter(s=>["bed","head","study"].includes(s.kind)))
      assert.ok(doors.some(w=>Math.abs(w.a.y-hallY)<1e-9&&Math.abs(w.b.y-hallY)<1e-9&&w.a.x>=s.x0&&w.b.x<=s.x1),`${type} ${s.kind} opens off the hall`);
  } else {
    // Walk-through cabins put every internal door on one shared door line.
    const vertical=doors.filter(w=>Math.abs(w.a.x-w.b.x)<1e-9);
    assert.ok(vertical.length>=2);assert.equal(new Set(vertical.map(w=>`${Math.min(w.a.y,w.b.y)}:${Math.max(w.a.y,w.b.y)}`)).size,1);
  }
}
for(const curved of [true,false])for(const purpose of Object.keys(INTERIOR_PURPOSES))for(let i=0;i<6;i++) {
  const slice=generateInterior({plan:"habitat",purpose,curved,seed:`habitat-${i}`});
  assert.equal(slice.plan,"habitat");assert.deepEqual(validateInterior(slice),[]);
  const cabins=slice.rooms.filter(r=>r.kind==="quarters");
  assert.ok(cabins.length&&cabins.every(r=>r.architecture.type==="habitat-cabin"&&r.habitatCabin));
  const byId=new Map(slice.rooms.map(r=>[r.id,r])),corridor=id=>byId.get(id).kind==="corridor";
  assert.equal(slice.edges.filter(e=>e.kind==="door"&&e.rooms.length===2&&e.rooms.every(corridor)&&!e.rooms.some(id=>byId.get(id).pod)).length,2,"An isolation door seals each cut end of the passageway");
  assert.ok(slice.edges.filter(e=>e.kind==="open"&&e.rooms.length===1).length>=3,"Both passageway ends and the branch leave the map open");
  for(const e of slice.edges.filter(e=>e.window))assert.ok(e.hull&&byId.get(e.rooms[0]).zone==="outboard","Windows only on the hull");
  for(const lift of slice.rooms.filter(r=>r.kind==="lift"))assert.ok(slice.edges.some(e=>e.kind==="door"&&e.rooms.includes(lift.id)&&e.rooms.some(corridor)),"A turbolift opens straight onto the passageway");
  // Small crew cabins may line the inboard side; they are windowless, and the large layouts stay on the hull.
  for(const room of cabins.filter(r=>r.zone==="inboard"))assert.ok(["single","pair"].includes(room.habitatCabin));
  assert.ok(!slice.edges.some(e=>e.window&&byId.get(e.rooms[0]).zone==="inboard"));
  assert.deepEqual(generateInterior(JSON.parse(JSON.stringify(slice.recipe))),slice);
  const svg=art.renderInteriorSVG(slice);
  assert.ok(svg.includes("data-closet=")&&cabins.every(r=>svg.includes(`data-bathroom="${r.id}"`)));
  if(cabins.some(r=>r.architecture.hall))assert.ok(svg.includes("data-cabin-hall="));
  if(slice.rooms.some(r=>r.pod))assert.ok(svg.includes("data-escape-pod="));
}
assert.deepEqual(habitat.HABITAT_CABINS.pair.sections,["bed","head","bed"],"Junior officers share a head without closet rooms");
assert.ok([0,1,2,3,4,5].some(i=>generateInterior({plan:"habitat",seed:`inboard-${i}`}).rooms.some(r=>r.kind==="quarters"&&r.zone==="inboard")),"Crew cabins also line the inboard side");
assert.ok(generateInterior({plan:"habitat",cabinLayout:"officer",seed:"suites"}).rooms.filter(r=>r.kind==="quarters"&&r.zone==="outboard").every(r=>r.habitatCabin==="suite"));
assert.ok(!generateInterior({plan:"habitat",hullWindows:false,seed:"sealed"}).edges.some(e=>e.window));
// Jefferies tube networks: octagonal junctions, tubes meeting faces squarely, ladder access
// points at dead ends, hatches onto deck-access stubs at the map edge.
const tubes=cache.get(new URL("../scripts/interior-jefferies.js",import.meta.url).href).namespace;
let diagonals=0;
for(const size of Object.keys(INTERIOR_SIZES))for(const faction of ["federation","klingon","borg"])for(let i=0;i<12;i++) {
  const net=generateInterior({plan:"jefferies",size,faction,seed:`tubes-${i}`});
  assert.equal(net.plan,"jefferies");assert.deepEqual(validateInterior(net),[]);
  const junctions=net.rooms.filter(r=>r.junction),runs=net.rooms.filter(r=>r.kind==="jefferies"&&!r.junction);
  assert.ok(junctions.length>=4&&junctions.every(r=>r.polygon.length>=8),"Every node is an octagon");
  for(const j of junctions) {
    const v=tubes.jefferiesOctagon({x:0,y:0}),side=Math.hypot(v[1].x-v[0].x,v[1].y-v[0].y);
    assert.ok(side>tubes.JEFFERIES_TUBE,"A tube end fits inside one octagon face");
    const attached=net.edges.filter(e=>e.rooms.includes(j.id)&&e.rooms.length===2).length;
    // A dead end is a ladder access point; one may also carry the tube out to a deck hatch.
    if(attached===1)assert.ok(j.access,"Dead ends are ladder access points");
    if(j.access)assert.ok(attached<=2);
  }
  assert.ok(junctions.some(j=>net.edges.filter(e=>e.rooms.includes(j.id)&&e.rooms.length===2).length>=3),"The network branches");
  for(const t of runs) {
    const [a,b,c]=t.polygon;assert.ok(Math.abs(Math.hypot(c.x-b.x,c.y-b.y)-tubes.JEFFERIES_TUBE)<.001,"Tubes are one crawl width");
    const ends=net.edges.filter(e=>e.kind==="hatch"&&e.exactDoor&&e.rooms.includes(t.id));
    assert.equal(ends.length,2,"A door at each end of every tube");
    assert.ok(ends.every(e=>Math.abs(Math.hypot(e.b.x-e.a.x,e.b.y-e.a.y)-tubes.JEFFERIES_TUBE)<.001),"Tube doors span the full tube width");
    const angle=((Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI)%45+45)%45;assert.ok(angle<.01||angle>44.99,"Tubes run orthogonally or at 45 degrees");
    if(Math.abs(b.x-a.x)>.01&&Math.abs(b.y-a.y)>.01)diagonals++;
  }
  const stubs=net.rooms.filter(r=>r.kind==="corridor");
  assert.ok(stubs.length>=1&&stubs.every(s=>net.edges.some(e=>e.kind==="hatch"&&e.rooms.includes(s.id))&&net.edges.some(e=>e.kind==="open"&&e.rooms.length===1&&e.rooms[0]===s.id)),"Deck access hatches open off the map edge");
  assert.ok(interiorWallSegments(net).filter(w=>w.hatch).every(w=>Math.hypot(w.b.x-w.a.x,w.b.y-w.a.y)>=.699));
  assert.deepEqual(generateInterior(JSON.parse(JSON.stringify(net.recipe))),net);
  const svg=art.renderInteriorSVG(net);assert.ok(svg.includes("data-jefferies-junction=")&&svg.includes("data-service-hatch"));
}
assert.ok(diagonals>0,"Some seeds branch at 45 degrees");
const tubeTexture={jefferies:"data:image/png;base64,TUBE"};
const textured=art.renderInteriorSVG(generateInterior({plan:"jefferies",seed:"tex"}),{assets:tubeTexture});
assert.ok(textured.includes("data-jefferies-texture=")&&textured.includes('href="#asset-jefferies"'),"Straight tubes tile the crawlway texture");
assert.ok(!art.renderInteriorSVG(generateInterior({plan:"habitat",seed:"tex"}),{assets:tubeTexture}).includes("TUBE"),"Maps without tubes do not embed the texture");
assert.ok(assets.interiorAssetPaths({faction:"federation",era:"tng"}).jefferies.endsWith("jefferies-tube.png"));
globalThis.game={user:{isGM:false}};
await assert.rejects(()=>mod.namespace.createInteriorScene({}),/Only a GM/);
// Optional preview artifacts for browser QA, written only to an explicit output directory.
const output=process.argv.find(v=>v.startsWith("--previews="))?.slice(11);
if(output) {
  await mkdir(output,{recursive:true});
  for(const [faction,profile]of Object.entries(INTERIOR_FACTIONS)) for(const type of ["starship","station"]) {
    const layout=generateInterior({faction,type,seed:"deck-47",era:profile.eras.includes("tng")?"tng":profile.eras[0],size:"small"});
    await writeFile(`${output}/${faction}-${type}.svg`,art.renderInteriorSVG(layout).replace(/width="\d+" height="\d+"/,'width="100%" height="100%"'));
  }
}
console.log(`Verified ${count} generated layouts, ${palettes} room palettes, 60 brush maps, ${images} bundled images with furniture transparency, ${roomImages} pre-rendered room/corridor images, connectivity, wall/door geometry, determinism, safe text, and v13/v14 scene data.`);
