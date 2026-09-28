// Code-native art-direction guides, generated from approved geometry. No raster edits.
import {readFile,writeFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url),out=new URL('docs/interior-prefabs/room-corridor-halves/',root);
const kit=JSON.parse(await readFile(new URL('catalog.json',out),'utf8'));
const module=kit.modules.find(m=>m.sourceRoom==='Q03-R'&&m.location==='interior');
const source=await readFile(new URL('Q03-R-HC-BASE-guide.svg',out),'utf8');
const colors=new Set(['#646c7a','#697889','#746652',...module.room.sections.map(s=>s.color)]);
const palettes={galaxy:{floor:'#806e78',runner:'#63515e',edge:'#96887b',accent:'#bd969d',wall:'#c8baa5',base:'#4c443e',rail:'#674333',light:'#ffe7b0'},
  intrepid:{floor:'#506679',runner:'#40576a',edge:'#323b43',accent:'#abb3bb',wall:'#b8c1c7',base:'#3c444d',rail:'#596572',light:'#edf4fc'}};
const doors=module.walls.filter(w=>w.door);
const anchors=doors.flatMap((w,i)=>[{name:`door-${i}-a`,units:w.a},{name:`door-${i}-b`,units:w.b}]);
for(const [style,p]of Object.entries(palettes)){
  let svg=source;
  for(const color of colors)svg=svg.replaceAll(`fill="${color}"`,`fill="${p.floor}"`);
  svg=svg.replaceAll('fill="#907d89"',`fill="${p.runner}"`);
  svg=svg.replace(/<path[^>]*stroke="#74e8ca"[^>]*\/>/g,'');
  // Flattened overhead wall ornamentation stays entirely in the existing wall band.
  let face='';
  const r=(x,y,w,h,fill)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  for(const wall of module.walls.filter(w=>!w.door&&Math.abs(w.a[1]-5)<1e-5&&Math.abs(w.b[1]-5)<1e-5)){
    const lo=Math.min(wall.a[0],wall.b[0]),hi=Math.max(wall.a[0],wall.b[0]);
    face+=r(lo,4.95,hi-lo,.1,p.wall)+r(lo,5.025,hi-lo,.025,p.base);
    for(let a=lo+.03;a<hi-.05;a+=.7){
      const width=Math.min(.64,hi-a-.025);
      if(width<=.02)continue;
      face+=r(a,4.965,width,.04,p.base)+r(a+.012,4.97,Math.max(.005,width-.024),.025,p.wall);
      face+=r(a,5.01,width,.012,p.rail);
      face+=r(a,4.953,.025,.092,p.base)+r(a+.006,4.966,.013,.036,p.light);
    }
  }
  const finish=r(0,5.05,module.frontage,.1,p.edge)+r(0,5.15,module.frontage,.15,p.accent);
  // Tiny amber control beside the entrance, inside the existing wall; never in its opening.
  face+=r(3.38,4.96,.10,.07,p.base)+r(3.39,4.971,.04,.018,'#ffb54f');
  svg=svg.replace(/<\/svg>\s*$/,finish+face+'</svg>');
  await writeFile(new URL(`Q03-R-HC-${style}-wall-guide.svg`,out),svg);
}
await writeFile(new URL('officer-wall-guide-contract.json',out),JSON.stringify({piece:module.id,
  canvas:[1507,688],pixelsPerUnit:110,origin:[11,11],footprint:module.footprint,
  entranceWallY:5,halfCorridorFloor:[5.05,6.05],wallBand:[4.95,5.05],
  floorBands:[{from:5.05,to:5.15,role:'neutral border'},{from:5.15,to:5.3,role:'accent'},{from:5.3,to:6.05,role:'runner'}],
  note:'Visible ribs, seams and lamps are shallow overhead details inside the existing wall band; no tilted camera or corridor-width loss.',
  anchors},null,2)+'\n');
console.log('Built Galaxy and Intrepid officer guides with exact walls, continuous floor and corridor finish.');
