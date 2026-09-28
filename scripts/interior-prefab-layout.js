/** Deterministic assembly of the proven straight-hull habitation family. */
const EPS=1e-6;
const round=n=>Math.round(n*1e6)/1e6;
const key=p=>p.map(round).join(',');
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
export function puzzlePoint(p,place){const r=place.rotation*Math.PI/180;return[round(place.at[0]+p[0]*Math.cos(r)-p[1]*Math.sin(r)),round(place.at[1]+p[0]*Math.sin(r)+p[1]*Math.cos(r))];}
export function normalizePuzzleRecipe(input={}) {
  const recipe={kit:'habitation-puzzle-v1',seed:String(input.seed??'habitation').slice(0,100),cabins:Number(input.cabins??3),mix:input.mix??'mixed',shape:input.shape??'bent',rotation:Number(input.rotation??0),gridSize:Number(input.gridSize??100)};
  if(!Number.isInteger(recipe.cabins)||recipe.cabins<2||recipe.cabins>6)throw new Error('Choose between two and six cabins.');
  if(!['mixed','standard','officer'].includes(recipe.mix)||!['straight','bent'].includes(recipe.shape))throw new Error('Unsupported cabin mix or corridor shape.');
  if(![0,90,180,270].includes(recipe.rotation)||![70,100,140].includes(recipe.gridSize))throw new Error('Unsupported orientation or grid resolution.');
  return recipe;
}
const rng=seed=>{let s=2166136261;for(const c of seed)s=Math.imul(s^c.charCodeAt(0),16777619);return()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};};
function inside(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
// All current masters are convex except the two orthogonal L shapes. Split those
// at every vertex coordinate into exact interior rectangles for overlap checks.
function cells(poly){
  const xs=[...new Set(poly.map(p=>p[0]))].sort((a,b)=>a-b),ys=[...new Set(poly.map(p=>p[1]))].sort((a,b)=>a-b);
  const orthogonal=poly.every((p,i)=>{const q=poly[(i+1)%poly.length];return Math.abs(p[0]-q[0])<EPS||Math.abs(p[1]-q[1])<EPS;});
  if(!orthogonal)return[poly];
  const result=[];for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++)if(inside([(xs[i]+xs[i-1])/2,(ys[j]+ys[j-1])/2],poly))result.push([[xs[i-1],ys[j-1]],[xs[i],ys[j-1]],[xs[i],ys[j]],[xs[i-1],ys[j]]]);return result;
}
function convexOverlap(a,b){for(const poly of [a,b])for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],axis=[p[1]-q[1],q[0]-p[0]],project=v=>v[0]*axis[0]+v[1]*axis[1],aa=a.map(project),bb=b.map(project);if(Math.min(Math.max(...aa),Math.max(...bb))-Math.max(Math.min(...aa),Math.min(...bb))<=EPS)return false;}return true;}
export function puzzleOverlap(a,b){return cells(a).some(x=>cells(b).some(y=>convexOverlap(x,y)));}
export function puzzlePorts(library,placements){return placements.flatMap(place=>library.pieces.find(p=>p.id===place.piece).ports.map(port=>({...port,owner:place.id,at:puzzlePoint(port.at,place),facing:(port.facing+place.rotation)%360})));}
function along(p,a,b){const len=distance(a,b);return Math.abs(distance(a,p)+distance(p,b)-len)<EPS?((p[0]-a[0])*(b[0]-a[0])+(p[1]-a[1])*(b[1]-a[1]))/len**2:null;}

/** Split every edge at apertures, then split/merge collinear overlaps once. */
export function puzzleWalls(library,placements){
  const raw=[];
  for(const place of placements){
    const piece=library.pieces.find(p=>p.id===place.piece);
    const add=(a,b,holes=[])=>{
      const len=distance(a,b),intervals=holes.map(h=>{const t=along(h.at,a,b);return t===null?null:{lo:t-h.width/len/2,hi:t+h.width/len/2,kind:h.kind};}).filter(Boolean);
      const cuts=[...new Set([0,1,...intervals.flatMap(h=>[h.lo,h.hi])].map(round))].sort((a,b)=>a-b);
      for(let i=1;i<cuts.length;i++){const lo=cuts[i-1],hi=cuts[i];if(hi-lo<EPS)continue;const kind=intervals.find(h=>(lo+hi)/2>h.lo&&(lo+hi)/2<h.hi)?.kind??'solid';if(kind==='open')continue;
        const at=t=>puzzlePoint(a.map((v,j)=>v+t*(b[j]-v)),place);raw.push({a:at(lo),b:at(hi),kind,owner:place.id});}
    };
    const openings=piece.ports.map(p=>({at:p.at,width:library.connectors[p.type].width,kind:p.type==='room'?'door':'open'}));
    for(const [a,b]of piece.windows??[])openings.push({at:a.map((v,i)=>(v+b[i])/2),width:distance(a,b),kind:'window'});
    piece.footprint.forEach((a,i)=>add(a,piece.footprint[(i+1)%piece.footprint.length],openings));
    for(const p of piece.partitions??[])add(p.a,p.b,p.door?[{...p.door,kind:'door'}]:[]);
  }
  const merged=new Map();
  for(const wall of raw){
    const cuts=[0,1];for(const other of raw)for(const p of [other.a,other.b]){const t=along(p,wall.a,wall.b);if(t!==null)cuts.push(round(t));}
    const sorted=[...new Set(cuts)].sort((a,b)=>a-b);
    for(let i=1;i<sorted.length;i++){if(sorted[i]-sorted[i-1]<EPS)continue;const point=t=>wall.a.map((v,j)=>round(v+t*(wall.b[j]-v))),ends=[point(sorted[i-1]),point(sorted[i])].sort((a,b)=>key(a).localeCompare(key(b))),id=ends.map(key).join('/'),old=merged.get(id);
      if(old&&old.kind!==wall.kind)throw new Error('An aperture meets a solid wall. No compatible layout can be exported.');
      merged.set(id,{a:ends[0],b:ends[1],kind:wall.kind});}
  }
  return [...merged.values()].map((w,i)=>({key:`puzzle-${i}`,a:w.a,b:w.b,door:w.kind==='door',window:w.kind==='window'}));
}

export function validatePuzzle(library,placements){
  const errors=[],polys=placements.map(p=>library.pieces.find(k=>k.id===p.piece).footprint.map(v=>puzzlePoint(v,p)));
  const passageTop=Math.min(...placements.flatMap((p,i)=>library.pieces.find(k=>k.id===p.piece).category==='corridor'?polys[i].map(v=>v[1]):[]));
  for(let i=0;i<polys.length;i++)for(let j=i+1;j<polys.length;j++)if(puzzleOverlap(polys[i],polys[j]))errors.push(`Pieces overlap: ${placements[i].id}, ${placements[j].id}`);
  const ports=puzzlePorts(library,placements),edges=[];
  for(const p of ports){const peers=ports.filter(q=>q.owner!==p.owner&&distance(p.at,q.at)<EPS&&q.type===p.type&&(q.facing-p.facing+360)%360===180);if(peers.length!==1)errors.push(`Unmatched connector: ${p.owner}/${p.id}`);else edges.push([p.owner,peers[0].owner]);}
  const walkable=placements.filter(p=>library.pieces.find(k=>k.id===p.piece).category!=='structure');
  const reached=new Set(walkable.length?[walkable[0].id]:[]);let changed=true;while(changed){changed=false;for(const [a,b]of edges)if(reached.has(a)&&!reached.has(b)){reached.add(b);changed=true;}}
  if(walkable.some(p=>!reached.has(p.id)))errors.push('Disconnected walkable pieces.');
  for(const p of placements){const piece=library.pieces.find(k=>k.id===p.piece);
    if(piece.zone==='inboard'&&piece.footprint.some(v=>puzzlePoint(v,p)[1]<passageTop+2.1-EPS))errors.push('Turbolift must remain inboard.');
    for(const [a,b]of piece.windows??[]){const mid=puzzlePoint(a.map((v,i)=>(v+b[i])/2),p);
      // The supported hull edge faces north before whole-scene rotation.
      if(p.rotation!==0||placements.some((q,i)=>q.id!==p.id&&polys[i].some(v=>v[1]<mid[1]+EPS)&&Math.min(...polys[i].map(v=>v[0]))<mid[0]&&Math.max(...polys[i].map(v=>v[0]))>mid[0]))errors.push('Hull window faces another piece.');
    }
  }
  return errors;
}

export function generatePuzzle(library,input={}) {
  if(library.id!=='habitation-puzzle-v1')throw new Error('Unsupported puzzle library.');
  const recipe=normalizePuzzleRecipe(input),random=rng(recipe.seed),placements=[];
  const get=id=>{const p=library.pieces.find(p=>p.id===id);if(!p)throw new Error(`Missing required piece: ${id}`);return p;};
  const add=(piece,at,rotation=0)=>{get(piece);const p={id:`piece-${placements.length}`,piece,at:at.map(round),rotation};placements.push(p);return p;};
  const port=(place,id)=>{const p=get(place.piece).ports.find(p=>p.id===id);if(!p)throw new Error(`Missing connector ${id}`);return {...p,at:puzzlePoint(p.at,place),facing:(p.facing+place.rotation)%360};};
  const attach=(from,fromPort,piece,toPort)=>{
    const a=port(from,fromPort),b=get(piece).ports.find(p=>p.id===toPort);if(!b||a.type!==b.type)throw new Error('Incompatible puzzle ports.');
    const rotation=(a.facing+180-b.facing+360)%360,offset=puzzlePoint(b.at,{at:[0,0],rotation});
    const candidate={id:`piece-${placements.length}`,piece,rotation,at:a.at.map((v,i)=>round(v-offset[i]))};
    const poly=get(piece).footprint.map(v=>puzzlePoint(v,candidate));
    if(placements.some(p=>puzzleOverlap(poly,get(p.piece).footprint.map(v=>puzzlePoint(v,p)))))throw new Error('No collision-free placement for the requested piece.');
    placements.push(candidate);return candidate;
  };
  const liftIndex=Math.floor(random()*recipe.cabins);
  const cabinTypes=Array.from({length:recipe.cabins},()=>recipe.mix==='officer'||recipe.mix==='mixed'&&random()<.5?'Q03-L':'Q01-A');
  if(recipe.mix==='mixed'&&new Set(cabinTypes).size===1)cabinTypes[cabinTypes.length-1]=cabinTypes[0]==='Q03-L'?'Q01-A':'Q03-L';
  let first,last;
  for(let i=0;i<recipe.cabins;i++){
    const hall=i===liftIndex?'H09-A':'H08-A';
    if(!last)last=first=add(hall,[0,0]);else{
      // At least one spacer keeps the 5–6-square cabins from overlapping.
      last=attach(last,'east','H02-A','west');
      last=attach(last,'east',hall,'west');
    }
    const type=cabinTypes[i];
    const cabin=attach(last,'north-room',type,'entry');
    if(type==='Q03-L')add('F01-A',puzzlePoint([4,0],cabin),cabin.rotation);
    if(i===liftIndex)attach(last,'south-room','T01-A','entry');
  }
  attach(first,'west','H07-A','north');
  if(recipe.shape==='bent'){
    last=attach(last,'east','H04-A','west');let exit='south';
    const tail=Math.floor(random()*3);for(let i=0;i<tail;i++){last=attach(last,exit,'H02-A','west');exit='east';}
    attach(last,exit,'H07-A','north');
  }else attach(last,'east','H07-A','north');
  const errors=validatePuzzle(library,placements);if(errors.length)throw new Error(errors.join(' '));
  const vertices=placements.flatMap(p=>get(p.piece).footprint.map(v=>puzzlePoint(v,p))),min=[0,1].map(i=>Math.floor(Math.min(...vertices.map(v=>v[i])))-1),max=[0,1].map(i=>Math.ceil(Math.max(...vertices.map(v=>v[i])))+1);
  const walls=puzzleWalls(library,placements),lights=[];
  for(const p of placements){const piece=get(p.piece);if(piece.category==='structure')continue;
    const points=piece.category==='corridor'?(piece.id==='H04-A'?[[1,1],[3.05,3]]:[[piece.footprint[1][0]/2,.7]]):piece.id==='Q01-A'?[[2,3],[4,1]]:piece.id==='Q03-L'?[[3.5,4],[1.2,1.4]]:[[1.5,1.2]];
    for(const point of points)lights.push({at:puzzlePoint(point,p),radius:piece.category==='corridor'?7:6});
  }
  const shift=p=>p.map((v,i)=>round(v-min[i]));
  return {schemaVersion:1,id:library.id,status:'procedural-habitation',recipe,width:max[0]-min[0],height:max[1]-min[1],metresPerUnit:1.5,
    entry:shift(puzzlePoint([2,1.05],first)),walls:walls.map(w=>({...w,a:shift(w.a),b:shift(w.b)})),lights:lights.map(l=>({...l,at:shift(l.at)})),
    placements:placements.map(p=>({...p,at:shift(p.at)})),pieces:library.pieces.map(p=>({id:p.id,file:p.art.file,sha256:p.art.sha256})),background:{sha256:'assembled-from-pinned-pieces'}};
}
