/** Geometry for the next art family. Room walls and doorways belong to one image;
 * artwork joins happen on the corridor floor. This does not replace saved legacy scenes. */
import {puzzleWalls, puzzlePoint, puzzleOverlap} from './interior-prefab-layout.js';

const EPS = 1e-6;
const round = n => Math.round(n * 1e6) / 1e6;
const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const polygon = (x, y, w, h) => rect(w, h).map(p => [p[0] + x, p[1] + y]);

function seams(width, wallY, halfSpan, wallThickness) {
  return [
    {id:'centre', type:'corridor-floor', a:[0, wallY + halfSpan], b:[width, wallY + halfSpan]},
    {id:'west', type:'half-corridor-floor', a:[0, wallY + wallThickness / 2], b:[0, wallY + halfSpan]},
    {id:'east', type:'half-corridor-floor', a:[width, wallY + wallThickness / 2], b:[width, wallY + halfSpan]}
  ];
}

export function roomCorridorModule(catalog, room, {location='interior'} = {}) {
  if (!['interior','hull'].includes(location)) throw new Error('Cabin location must be interior or hull.');
  const width = Math.max(...room.footprint.map(p => p[0]));
  const height = Math.max(...room.footprint.map(p => p[1]));
  if (JSON.stringify(room.footprint) !== JSON.stringify(rect(width, height))) throw new Error('Room-half modules currently require a rectangular approved room.');
  if (room.ports.some(p => p.type !== 'room' || p.facing !== 90 || Math.abs(p.at[1] - height) > EPS)) throw new Error('Every room entrance must face its attached corridor half.');
  const thickness = catalog.wallThickness, halfSpan = 1 + thickness / 2;
  const windows = location === 'hull' ? (room.windows ?? []) : [];
  if (windows.some(pair => pair.some(p => Math.abs(p[1]) > EPS))) throw new Error('Hull windows must lie on the exposed rear wall.');
  const effectiveRoom = {...room, windows};
  const walls = puzzleWalls({...catalog,pieces:[effectiveRoom]}, [{id:room.id,piece:room.id,at:[0,0],rotation:0}]);
  const isRear = w => Math.abs(w.a[1]) < EPS && Math.abs(w.b[1]) < EPS;
  return {
    id:`${room.id}-HC${location === 'interior' ? '-IN' : ''}`, sourceRoom:room.id, name:`${room.name} + corridor half (${location})`, category:'room-half',
    location, baseArtwork:`${room.id}-HC-BASE`,
    frontage:width, roomDepth:height, halfSpan, wallThickness:thickness,
    footprint:rect(width, height + halfSpan), room,
    corridorFloor:polygon(0, height, width, halfSpan),
    clearCorridorFloor:polygon(0, height + thickness / 2, width, 1),
    seams:seams(width, height, halfSpan, thickness),
    // Explicit walls are essential: a floor seam must never become a perimeter wall.
    walls,
    // The base art stops at the rear-wall band. Exactly one wall layer completes it.
    baseWalls:walls.filter(w => !isRear(w)),
    rearWallLayer:{type:location === 'hull' ? 'windowed' : 'solid', profile:'straight',
      band:polygon(0,-thickness/2,width,thickness), windows, walls:walls.filter(isRear)},
    entrances:room.ports.map(p => ({...p, width:catalog.connectors.room.width})),
    artStatus:'awaiting-combined-art'
  };
}

export function blankCorridorHalf(frontage, wallThickness = .1) {
  if (!Number.isFinite(frontage) || frontage <= 0) throw new Error('Blank frontage must be positive.');
  const halfSpan = 1 + wallThickness / 2;
  return {id:`BLANK-HC-${frontage}`, name:'Blank corridor wall + half floor', category:'blank-half', frontage,
    roomDepth:0, halfSpan, wallThickness, footprint:rect(frontage, halfSpan),
    corridorFloor:polygon(0, 0, frontage, halfSpan), clearCorridorFloor:polygon(0, wallThickness / 2, frontage, 1),
    seams:seams(frontage, 0, halfSpan, wallThickness), entrances:[],
    walls:[{a:[0,0], b:[frontage,0], door:false, window:false}], artStatus:'parametric-guide-needs-style-material'};
}

export function jefferiesCorridorHalf(wallThickness = .1) {
  if (Math.abs(wallThickness - .1) > EPS) throw new Error('The measured alcove currently uses 0.1-unit walls.');
  const width = 4, depth = 1.1, halfSpan = 1.05;
  const segments = [ [[.95,0],[3.05,0]], [[.95,0],[.95,depth]], [[3.05,0],[3.05,depth]],
    [[0,depth],[.95,depth]], [[3.05,depth],[width,depth]] ];
  return {id:'J01-HC', name:'Jefferies alcove + corridor half', category:'alcove-half', zone:'inboard',
    frontage:width, roomDepth:depth, halfSpan, wallThickness,
    footprint:[[.95,0],[3.05,0],[3.05,depth],[width,depth],[width,depth+halfSpan],[0,depth+halfSpan],[0,depth],[.95,depth]],
    corridorFloor:polygon(0, depth, width, halfSpan), clearCorridorFloor:polygon(0, depth+.05, width, 1),
    alcoveClearFloor:polygon(1,.05,2,1),
    seams:seams(width, depth, halfSpan, wallThickness), entrances:[],
    walls:segments.map(([a,b]) => ({a,b,door:false,window:false})),
    hatch:{at:[2,0], width:.8, state:'closed', exportDoor:false, requires:'A connected maintenance route or vertical destination'},
    artStatus:'awaiting-combined-art'};
}

function mergeWalls(input) {
  const groups = new Map();
  for (const w of input) {
    const horizontal = Math.abs(w.a[1] - w.b[1]) < EPS, axis = horizontal ? 0 : 1;
    const key = `${axis}/${round(w.a[1-axis])}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({...w, axis, lo:Math.min(w.a[axis],w.b[axis]), hi:Math.max(w.a[axis],w.b[axis])});
  }
  const result = [];
  for (const group of groups.values()) {
    const cuts = [...new Set(group.flatMap(w => [round(w.lo),round(w.hi)]))].sort((a,b) => a-b);
    for (let i=1; i<cuts.length; i++) {
      const mid = (cuts[i-1] + cuts[i]) / 2, owners = group.filter(w => mid > w.lo-EPS && mid < w.hi+EPS);
      if (!owners.length) continue;
      if (owners.some(w => w.door !== owners[0].door || w.window !== owners[0].window)) throw new Error('An aperture meets an incompatible neighbouring wall.');
      const sample = owners[0], point = n => sample.axis === 0 ? [n,sample.a[1]] : [sample.a[0],n];
      result.push({a:point(cuts[i-1]),b:point(cuts[i]),door:sample.door,window:sample.window,owners:[...new Set(owners.map(w=>w.owner))]});
    }
  }
  return result;
}

/** Two contiguous banks may have completely different room widths. Their common
 * centre seam is split at the union of bank boundaries rather than pairing rooms. */
export function assembleRoomCorridor({north, south, style='galaxy', rotation=0, hullBank='north'}) {
  if (!['galaxy','intrepid'].includes(style) || ![0,90,180,270].includes(rotation)) throw new Error('Unsupported style or rotation.');
  if (![null,'north','south'].includes(hullBank)) throw new Error('Unsupported hull bank.');
  if (!north?.length || !south?.length) throw new Error('Both corridor halves need coverage.');
  const length = north.reduce((n,m) => n+m.frontage,0), southLength = south.reduce((n,m) => n+m.frontage,0);
  if (Math.abs(length-southLength) > EPS) throw new Error('Corridor banks have unequal coverage; add an explicit blank half to fill the gap.');
  const thickness = north[0].wallThickness, halfSpan = 1+thickness/2;
  if ([...north,...south].some(m => Math.abs(m.halfSpan-halfSpan)>EPS || Math.abs(m.wallThickness-thickness)>EPS)) throw new Error('Incompatible corridor widths.');
  for (const [bank,modules] of [['north',north],['south',south]]) {
    if (bank === hullBank && modules.some(m=>m.zone==='inboard')) throw new Error('Inboard service modules cannot occupy the hull bank.');
    if (modules.some(m=>m.location==='hull') && bank !== hullBank) throw new Error('Windowed cabins require an exposed hull bank.');
    if (bank === hullBank && modules.some(m=>m.category==='room-half')) {
      const rooms=modules.filter(m=>m.category==='room-half');
      if (rooms.some(m=>Math.abs(m.roomDepth-rooms[0].roomDepth)>EPS)) throw new Error('A straight hull row requires matching cabin depths; use a measured hull adapter for a stepped boundary.');
    }
  }
  const placed = [], walls = [], bankIntervals = {north:[],south:[]};
  for (const [bank,modules] of [['north',north],['south',south]]) {
    let x = 0;
    for (const [i,module] of modules.entries()) {
      const transform = bank === 'north' ? {at:[x,-module.roomDepth-halfSpan],rotation:0} : {at:[x+module.frontage,module.roomDepth+halfSpan],rotation:180};
      const point = p => puzzlePoint(p,transform), id = `${bank}-${i}`;
      placed.push({id,bank,module:module.id,location:module.location,baseArtwork:module.baseArtwork,
        rearWallLayer:module.rearWallLayer ? {...module.rearWallLayer,band:module.rearWallLayer.band.map(point),
          windows:module.rearWallLayer.windows.map(pair=>pair.map(point)),
          walls:module.rearWallLayer.walls.map(w=>({...w,a:point(w.a),b:point(w.b)}))} : undefined,
        transform,footprint:module.footprint.map(point),corridorFloor:module.corridorFloor.map(point)});
      bankIntervals[bank].push({id,start:x,end:x+module.frontage});
      walls.push(...module.walls.map(w => ({...w,a:point(w.a),b:point(w.b),owner:id})));
      x += module.frontage;
    }
  }
  for (let i=0; i<placed.length; i++) for (const b of placed.slice(i+1)) if (puzzleOverlap(placed[i].footprint,b.footprint)) throw new Error('Room-half footprints overlap.');
  for (const x of [0,length]) walls.push({a:[x,-halfSpan],b:[x,halfSpan],door:false,window:false,owner:'end-cap'});
  const joins = [];
  for (const a of bankIntervals.north) for (const b of bankIntervals.south) {
    const lo = Math.max(a.start,b.start), hi = Math.min(a.end,b.end);
    if (hi-lo > EPS) joins.push({a:[lo,0],b:[hi,0],owners:[a.id,b.id],kind:'floor-only'});
  }
  const vertices = placed.flatMap(p=>p.footprint).map(p=>puzzlePoint(p,{at:[0,0],rotation}));
  const min = [0,1].map(i=>Math.min(...vertices.map(p=>p[i]))-1), max = [0,1].map(i=>Math.max(...vertices.map(p=>p[i]))+1);
  const world = p => puzzlePoint(p,{at:[0,0],rotation}).map((v,i)=>round(v-min[i]));
  return {id:'room-corridor-halves-v2',status:'geometry-proof-awaiting-combined-art',style,rotation,hullBank,
    width:max[0]-min[0],height:max[1]-min[1],length,wallThickness:thickness,clearCorridorWidth:2,
    centreLine:{a:world([0,0]),b:world([length,0])},
    floorSeams:joins.map(j=>({...j,a:world(j.a),b:world(j.b)})),
    centreFinish:{width:.1,material:style==='galaxy'?'mauve-carpet-centre':'slate-carpet-centre',nativeWall:false},
    placements:placed.map(p=>({...p,footprint:p.footprint.map(world),corridorFloor:p.corridorFloor.map(world),
      rearWallLayer:p.rearWallLayer ? {...p.rearWallLayer,band:p.rearWallLayer.band.map(world),
        windows:p.rearWallLayer.windows.map(pair=>pair.map(world)),
        walls:p.rearWallLayer.walls.map(w=>({...w,a:world(w.a),b:world(w.b)}))} : undefined})),
    walls:mergeWalls(walls).map((w,i)=>({...w,key:`half-wall-${i}`,a:world(w.a),b:world(w.b)})),
    coordinateTransform:{rotation,offset:min.map(v=>-v)}
  };
}
