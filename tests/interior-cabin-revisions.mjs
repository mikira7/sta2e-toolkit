import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),kit=JSON.parse(await readFile(new URL('docs/interior-prefabs/cabin-revisions/catalog.json',root),'utf8'));
const mod=new vm.SourceTextModule(await readFile(new URL('scripts/interior-prefab-layout.js',root),'utf8'));await mod.link(()=>{});await mod.evaluate();
const {puzzleWalls}=mod.namespace;
const edges=poly=>poly.map((a,i)=>[a,poly[(i+1)%poly.length]]),dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function lineDistance(p,a,b){const len2=(b[0]-a[0])**2+(b[1]-a[1])**2,t=Math.max(0,Math.min(1,((p[0]-a[0])*(b[0]-a[0])+(p[1]-a[1])*(b[1]-a[1]))/len2));return dist(p,a.map((v,i)=>v+t*(b[i]-v)));}
function inside(p,poly){if(edges(poly).some(([a,b])=>lineDistance(p,a,b)<1e-6))return true;let yes=false;for(const [a,b]of edges(poly))if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;return yes;}
const corners=([x,y,w,h])=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const rectDistance=(p,[x,y,w,h])=>Math.hypot(p[0]-Math.max(x,Math.min(x+w,p[0])),p[1]-Math.max(y,Math.min(y+h,p[1])));
function reachable(piece,walls,start,restriction=()=>true){
  const radius=.5,step=.05;
  const clear=p=>inside(p,piece.footprint)&&restriction(p)&&walls.every(w=>lineDistance(p,w.a,w.b)>=radius+kit.wallThickness/2-1e-6)&&[...piece.fixtures,...(piece.serviceWalls??[])].every(f=>rectDistance(p,f.rect)>=radius-1e-6);
  const snap=p=>p.map(v=>Math.round(v/step)),key=p=>snap(p).join(',');
  assert.ok(clear(start),`${piece.id} initial standing clearance ${start}`);
  const pending=[snap(start)],seen=new Set([key(start)]),w=Math.max(...piece.footprint.map(p=>p[0]))/step,h=Math.max(...piece.footprint.map(p=>p[1]))/step;
  while(pending.length){const [x,y]=pending.pop();for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const a=x+dx,b=y+dy,k=`${a},${b}`;if(a<0||b<0||a>w||b>h||seen.has(k)||!clear([a*step,b*step]))continue;seen.add(k);pending.push([a,b]);}}
  return {has:p=>seen.has(key(p)),clear};
}
for(const piece of kit.pieces){
  const structural=[...edges(piece.footprint),...piece.partitions.map(p=>[p.a,p.b])];
  const overlaps=(a,b)=>Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0])>1e-6&&Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1])>1e-6;
  for(const s of piece.serviceWalls){
    const poly=corners(s.rect);
    assert.ok(poly.every(p=>inside(p,piece.footprint)),`${piece.id} service wall stays in footprint`);
    assert.ok(edges(poly).some(([a,b])=>structural.some(([c,d])=>lineDistance(a,c,d)<1e-6&&lineDistance(b,c,d)<1e-6)),`${piece.id} thick wall joins structural wall`);
    assert.equal(s.depth,kit.serviceWallDepth);
    assert.ok(piece.fixtures.filter(f=>f.kind!=='food replicator').every(f=>!overlaps(f.rect,s.rect)),`${piece.id} service wall clear of furniture`);
    const openings=[...piece.ports.map(p=>({...p,width:kit.connectors[p.type].width})),...piece.partitions.filter(p=>p.door).map(p=>p.door)];
    assert.ok(openings.every(d=>rectDistance(d.at,s.rect)>=d.width/2-1e-6),`${piece.id} service wall clear of door opening`);
  }
  if(piece.closet){
    assert.ok(edges(piece.closet.polygon).some(([a,b])=>edges(piece.bathroom.polygon).some(([c,d])=>lineDistance(a,c,d)<1e-6&&lineDistance(b,c,d)<1e-6)),`${piece.id} closet shares a wall with the head`);
    for(const p of piece.partitions)for(const end of [p.a,p.b])assert.ok(edges(piece.footprint).some(([a,b])=>lineDistance(end,a,b)<1e-6)||piece.partitions.some(q=>q!==p&&lineDistance(end,q.a,q.b)<1e-6),`${piece.id} partition end meets another wall`);
  }
  for(const f of piece.fixtures){assert.ok(corners(f.rect).every(p=>inside(p,piece.footprint)),`${piece.id} fixture inside`);
    if(['shower','basin','toilet','tub'].includes(f.kind))assert.ok(corners(f.rect).every(p=>inside(p,piece.bathroom.polygon)),`${piece.id} fixture in bathroom`);
    if(f.kind==='food replicator'){
      const service=piece.serviceWalls.find(s=>s.id===f.serviceWall);
      assert.ok(f.recessed&&service,`${piece.id} replicator assigned to service wall`);
      assert.ok(corners(f.rect).every(p=>inside(p,corners(service.rect))),`${piece.id} appliance recessed within wall thickness`);
      const [x,y,w,h]=f.rect,dir=f.facing*Math.PI/180;
      assert.ok((f.approach[0]-x-w/2)*Math.cos(dir)+(f.approach[1]-y-h/2)*Math.sin(dir)>.5,`${piece.id} replicator faces its standing approach`);
    }
    if(f.kind==='toilet'){
      assert.ok([0,90,180,270].includes(f.facing));const [x,y,w,h]=f.rect,c=[x+w/2,y+h/2],a=f.facing*Math.PI/180,d=[Math.cos(a),Math.sin(a)],depth=f.facing%180===0?w:h;
      const back=c.map((v,i)=>v-d[i]*depth/2),front=c.map((v,i)=>v+d[i]*depth/2),probe=front.map((v,i)=>v+d[i]*.35);
      assert.ok(lineDistance(back,f.backWall.a,f.backWall.b)<=.16,`${piece.id} cistern backs onto declared wall`);
      assert.ok(inside(probe,piece.bathroom.polygon),`${piece.id} toilet faces usable bathroom floor`);
      assert.ok(piece.fixtures.filter(other=>other!==f).every(other=>rectDistance(probe,other.rect)>.1),`${piece.id} toilet front unobstructed`);
    }
  }
  for(let i=0;i<piece.fixtures.length;i++)for(const other of piece.fixtures.slice(i+1)){
    const a=piece.fixtures[i].rect,b=other.rect;assert.ok(Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0])<=1e-6||Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1])<=1e-6,`${piece.id} fixtures do not overlap`);
  }
  const walls=puzzleWalls(kit,[{id:'cabin',piece:piece.id,at:[0,0],rotation:0}]).filter(w=>!w.door);
  const route=reachable(piece,walls,piece.accessPoints[0]);
  if(piece.bedrooms){
    assert.equal(piece.footprint.length,4,`${piece.id} rectangular envelope`);
    assert.equal(piece.bedrooms.length,piece.bedroomCount);
    const circulation=reachable(piece,walls,piece.accessPoints[0],p=>!piece.bedrooms.some(b=>inside(p,b.polygon)));
    for(const bedroom of piece.bedrooms){
      const owned=piece.fixtures.filter(f=>f.bedroom===bedroom.id);
      assert.equal(owned.filter(f=>f.kind==='bed').length,1);
      assert.ok(owned.every(f=>corners(f.rect).every(p=>inside(p,bedroom.polygon))));
      assert.ok(circulation.has([bedroom.door.at[0],bedroom.door.at[1]+.6]),`${piece.id} bedroom entrance reachable without crossing another bedroom`);
    }
    assert.ok(circulation.has(piece.fixtures.find(f=>f.kind==='toilet').approach),`${piece.id} head reachable without crossing a bedroom`);
    const masters=piece.bedrooms.filter(b=>b.master);assert.equal(masters.length,1,`${piece.id} exactly one master bedroom`);
    const master=masters[0],storage=piece.fixtures.find(f=>f.kind==='hanging storage');
    assert.equal(piece.closet.bedroom,master.id);
    assert.ok(piece.closet.private);
    assert.ok(!circulation.has(storage.approach),`${piece.id} closet is private to master, no passage shortcut`);
    assert.ok(edges(master.polygon).some(([a,b])=>lineDistance(piece.closet.door.at,a,b)<1e-6),`${piece.id} closet door opens from master bedroom`);
    const privateRoute=reachable(piece,walls,master.approach,p=>inside(p,master.polygon)||inside(p,piece.closet.polygon));
    assert.ok(privateRoute.has(storage.approach),`${piece.id} master reaches closet without returning to passage`);
    const chair=piece.fixtures.find(f=>f.desk),desk=piece.fixtures.find(f=>f.id===chair.desk);
    const centre=r=>[r[0]+r[2]/2,r[1]+r[3]/2],cc=centre(chair.rect),dc=centre(desk.rect),angle=chair.facing*Math.PI/180;
    assert.ok((dc[0]-cc[0])*Math.cos(angle)+(dc[1]-cc[1])*Math.sin(angle)>.3,`${piece.id} desk chair faces desk`);
    assert.ok(Math.abs((dc[0]-cc[0])*Math.sin(angle)-(dc[1]-cc[1])*Math.cos(angle))<.1,`${piece.id} chair centred at working edge`);
    assert.ok(route.has(chair.approach),`${piece.id} desk chair approach accessible`);
  }
  for(const p of piece.accessPoints)assert.ok(route.has(p),`${piece.id} one-square token reaches ${p}`);
  for(const f of piece.fixtures.filter(f=>f.kind==='toilet'))assert.ok(route.has(f.approach),`${piece.id} toilet standing approach reachable`);
  assert.equal(piece.fixtures.filter(f=>f.kind==='food replicator').length,piece.privateCabins?.length??1);
  for(const f of piece.fixtures.filter(f=>f.kind==='food replicator'))assert.ok(route.has(f.approach),`${piece.id} food replicator reachable`);
  for(const f of piece.fixtures.filter(f=>['wardrobe','hanging storage'].includes(f.kind))){assert.ok(f.approach);assert.ok(route.has(f.approach),`${piece.id} storage reachable`);}
  assert.ok(piece.fixtures.some(f=>['wardrobe','hanging storage'].includes(f.kind)));
  // A perimeter bathroom must share external wall segments, not float inside a cabin.
  assert.ok(edges(piece.bathroom.polygon).some(([a,b])=>edges(piece.footprint).some(([c,d])=>lineDistance(a,c,d)<1e-6&&lineDistance(b,c,d)<1e-6)));
  if(piece.privateCabins){
    assert.equal(piece.ports.length,2);assert.equal(piece.partitions.filter(p=>p.door).length,2);
    assert.equal(piece.ports[1].at[0]-piece.ports[0].at[0],8,'entrances match two room bays with a spacer');
    for(const room of piece.privateCabins){
      const owned=piece.fixtures.filter(f=>f.owner===room.id);for(const kind of ['bed','desk','wardrobe'])assert.ok(owned.some(f=>f.kind===kind));
      assert.ok(owned.every(f=>corners(f.rect).every(p=>inside(p,room.polygon))));
      const entry=piece.ports.find(p=>p.id===room.entry),start=[entry.at[0],entry.at[1]-.6];
      const privateRoute=reachable(piece,walls,start,p=>inside(p,room.polygon));
      assert.ok(privateRoute.has(owned.find(f=>f.kind==='wardrobe').approach),'each wardrobe reachable without entering bathroom or other cabin');
      assert.ok(privateRoute.has(owned.find(f=>f.kind==='food replicator').approach),'each replicator reachable without entering bathroom or other cabin');
    }
  }
}
assert.equal(kit.defaultNewCabin,'Q02-R');
const rectangle=kit.pieces.find(p=>p.id==='Q02-R');assert.equal(Math.max(...rectangle.footprint.map(p=>p[1]))/Math.max(...rectangle.footprint.map(p=>p[0])),1.5);
assert.deepEqual(kit.pieces.filter(p=>p.bedrooms).map(p=>p.bedroomCount),[1,2,3]);
assert.ok(!kit.pieces.some(p=>p.id==='Q03-L2'||p.id==='Q03-L'));
console.log('PASS: six cabin plans; officer/family master bedrooms with private walk-in closets; shared heads independently accessible; desk-chair alignment; connected walls; recessed replicators; fixture containment and one-square routes.');
