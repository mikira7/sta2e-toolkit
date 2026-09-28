// User-authorized image processing: immutable generated furnishings + exact architectural layers.
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),sharp=require(process.argv[2]??'sharp');
const root=new URL('../',import.meta.url),out=new URL('assets/interiors/prefabs/production/',root);
const catalogBytes=await readFile(new URL('docs/interior-prefabs/room-corridor-halves/catalog.json',root));
const kit=JSON.parse(catalogBytes),m=kit.modules.find(p=>p.sourceRoom==='Q03-R'&&p.location==='interior');
const S=128,margin=.1,W=Math.ceil((m.frontage+2*margin)*S),H=Math.ceil((m.roomDepth+m.halfSpan+2*margin)*S);
const hash=b=>createHash('sha256').update(b).digest('hex');
const fixtures=m.room.fixtures;
const recipes={
  galaxy:{source:'galaxy/Q03-R-HC-BASE-v6.png',panelSource:'galaxy/Q03-R-HC-BASE-v8.png',panel:[246,630,175,43],carpet:[350,330,170,100],head:[1550,470,140,110],
    wall:'#c8baa5',dark:'#4b4037',rail:'#734a30',lamp:'#ffe6ac',edge:'#978679',accent:'#ba969d',runner:'#66515e',
    crops:[[144,207,130,146],[70,235,70,90],[286,235,70,90],[470,47,245,118],[549,219,128,91],[51,447,214,85],[106,523,78,88],[1313,54,69,341],[1415,48,137,135],[1554,48,244,133],[1426,207,79,116],[1706,273,96,85],[766,50,175,224],[763,282,70,158],null]},
  intrepid:{source:'intrepid/Q03-R-HC-BASE-v5.png',panelSource:'intrepid/Q03-R-HC-BASE-v6.png',panel:[119,663, eightyFive(),35],carpet:[420,330,170,100],head:[1550,470,140,110],
    wall:'#bcc5cc',dark:'#343d46',rail:'#576775',lamp:'#eef6ff',edge:'#35404a',accent:'#aeb8c0',runner:'#485f72',
    crops:[[183,180,131,181],[98,225,80,91],[317,227,80,91],[481,48,242,119],[552,220,125,80],[49,462,201,82],[110,542,76,75],[1303,51,64,343],[1408,57,128,150],[1543,61,228,125],[1408,240,74,94],[1670,272,99,90],[782,50,168,249],[783,307,54,148],null]}
};
function eightyFive(){return 85;}
const rect=(x,y,w,h,fill,more='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${more}/>`;
const path=points=>'M'+points.map(p=>p.join(',')).join('L')+'Z';
const wrap=body=>`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><g transform="translate(${S*margin} ${S*margin}) scale(${S})">${body}</g></svg>`;
const image=(bytes,x,y,w,h)=>`<image href="data:image/png;base64,${bytes.toString('base64')}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
const metadata={schemaVersion:1,status:'registered-composite-review',method:'Authorized precise wall layers and image-processing assembly',
  geometrySha256:hash(catalogBytes),styleGuideSha256:hash(await readFile(new URL('docs/interior-prefabs/cabin-style-guide.md',root))),
  canvas:[W,H],pixelsPerUnit:S,origin:[margin*S,margin*S],piece:m.id,items:[]};
for(const [style,p] of Object.entries(recipes)){
  const bytes=await readFile(new URL(p.source,out));
  const panelBytes=await readFile(new URL(p.panelSource,out));
  const panel=await sharp(panelBytes).extract({left:p.panel[0],top:p.panel[1],width:p.panel[2],height:p.panel[3]}).png().toBuffer();
  const crop=async r=>sharp(bytes).extract({left:r[0],top:r[1],width:r[2],height:r[3]}).png().toBuffer();
  const carpet=await crop(p.carpet),head=await crop(p.head);
  const texture=(id,b)=>`<pattern id="${id}" width="2" height="2" patternUnits="userSpaceOnUse">${image(b,0,0,1,1)}<g transform="translate(2 0) scale(-1 1)">${image(b,0,0,1,1)}</g><g transform="translate(0 2) scale(1 -1)">${image(b,0,0,1,1)}</g><g transform="translate(2 2) scale(-1 -1)">${image(b,0,0,1,1)}</g></pattern>`;
  const bathroom=m.room.bathroom.polygon;
  let floor=`<defs>${texture('carpet',carpet)}${texture('head',head)}</defs>`;
  floor+=rect(0,.05,m.frontage,m.roomDepth-.05,'url(#carpet)');
  floor+=`<path d="${path(bathroom)}" fill="url(#head)"/>`;
  floor+=rect(0,5,m.frontage,1.05,p.runner)+rect(0,5.05,m.frontage,.1,p.edge)+rect(0,5.15,m.frontage,.15,p.accent);
  floor+=rect(0,5.05,m.frontage,1,'url(#carpet)','opacity=".15"');
  const floorBuffer=await sharp(Buffer.from(wrap(floor))).png().toBuffer();
  const layers=[],placements=[];
  for(const [i,f]of fixtures.entries()){
    const r=p.crops[i];if(!r)continue;
    const [x,y,w,h]=f.rect,tw=Math.max(1,Math.floor(w*S)),th=Math.max(1,Math.floor(h*S));
    // Contain preserves each object's aspect ratio within its measured fixture envelope.
    const scaled=await sharp(await crop(r)).resize({width:tw,height:th,fit:'inside'}).ensureAlpha().png().toBuffer();
    const meta=await sharp(scaled).metadata(),fw=meta.width,fh=meta.height;
    const feather=Math.max(2,Math.min(fw,fh)*.075);
    const mask=`<svg width="${fw}" height="${fh}"><defs><filter id="soft"><feGaussianBlur stdDeviation="${feather/2}"/></filter></defs><rect x="${feather/2}" y="${feather/2}" width="${fw-feather}" height="${fh-feather}" rx="${feather}" fill="white" filter="url(#soft)"/></svg>`;
    const sprite=await sharp(scaled).composite([{input:Buffer.from(mask),blend:'dest-in'}]).png().toBuffer();
    const left=Math.round((x+margin)*S+(tw-fw)/2),top=Math.round((y+margin)*S+(th-fh)/2);
    layers.push({input:sprite,left,top});
    placements.push({kind:f.kind,sourcePixels:r,approvedRect:f.rect,destinationPixels:[left,top,fw,fh]});
  }
  let walls=`<defs><linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e7e3d9"/><stop offset=".35" stop-color="${p.wall}"/><stop offset="1" stop-color="${p.dark}"/></linearGradient></defs>`;
  for(const w of m.baseWalls.filter(w=>!w.door)){
    const horizontal=Math.abs(w.a[1]-w.b[1])<1e-5;
    const x=Math.min(w.a[0],w.b[0]),y=Math.min(w.a[1],w.b[1]);
    const width=horizontal?Math.abs(w.a[0]-w.b[0]):.1,height=horizontal?.1:Math.abs(w.a[1]-w.b[1]);
    walls+=rect(x-(horizontal?0:.05),y-(horizontal?.05:0),width,height,'url(#wall)');
    const a=w.a,b=w.b;
    walls+=`<path d="M${a}L${b}" fill="none" stroke="${p.wall}" stroke-width=".033"/>`;
  }
  for(const w of m.baseWalls.filter(w=>!w.door&&Math.abs(w.a[1]-5)<1e-5&&Math.abs(w.b[1]-5)<1e-5)){
    const lo=Math.min(w.a[0],w.b[0]),hi=Math.max(w.a[0],w.b[0]);
    // A flattened face projects inward to 4.8: it ends at the side-door jambs,
    // leaves the entire 1-square corridor clear, and never changes wall/door anchors.
    walls+=rect(lo,4.8,hi-lo,.25,'url(#wall)');
    walls+=rect(lo,4.814,hi-lo,.022,p.wall)+rect(lo,5.025,hi-lo,.022,p.dark);
    for(let x=lo+.03;x<hi-.06;x+=1.1){
      const width=Math.min(1.02,hi-x-.02);if(width<.04)continue;
      walls+=image(panel,x,4.83,width,.19);
      walls+=`<path d="M${x-.02},4.8h.075l.015,.03v.19l-.015,.03h-.075l-.015,-.03v-.19Z" fill="url(#wall)"/>`;
      if(width>.2)walls+=style==='galaxy'?rect(x+.004,4.856,.023,.11,p.lamp,'rx=".01"'):rect(x+.17,4.908,Math.min(.21,width-.2),.02,p.lamp,'rx=".008"');
    }
  }
  walls+=rect(3.42,4.85,.10,.14,p.dark,'rx=".007"')+rect(3.43,4.862,.04,.031,'#eaa34a')+rect(3.48,4.862,.026,.076,'#849bcc')+rect(3.43,4.947,.06,.02,p.lamp);
  // Recessed serving niche lives inside the approved thick service wall, facing right.
  for(const s of m.room.serviceWalls)walls+=rect(...s.rect,'url(#wall)');
  const appliance=fixtures.find(f=>f.kind==='food replicator').rect;
  const [rx,ry,rw,rh]=appliance;
  walls+=rect(rx,ry,rw,rh,p.dark,'rx=".035"')+rect(rx+.045,ry+.07,rw-.09,rh-.14,'#182329','rx=".025"');
  walls+=rect(rx+.075,ry+.22,rw-.15,rh-.4,'#879098');
  walls+=`<ellipse cx="${rx+rw/2}" cy="${ry+rh/2}" rx=".075" ry=".105" fill="#e6e4db" stroke="#a9a89f" stroke-width=".016"/>`;
  walls+=rect(rx+.03,ry+.06,.018,rh-.12,p.lamp)+rect(rx+.09,ry+rh-.11,.06,.024,'#e9b359');
  // White inset lights sit inside existing side walls and never create desk partitions.
  for(const y of [1.5,3.1])walls+=rect(-.012,y,.024,.18,p.lamp,'rx=".01"');
  const wallBuffer=await sharp(Buffer.from(wrap(walls))).png().toBuffer();
  const file=`${style}/Q03-R-HC-BASE-assembled-v1.png`;
  await writeFile(new URL(`${style}/Q03-R-HC-walls-v1.svg`,out),wrap(walls));
  await writeFile(new URL(`${style}/Q03-R-HC-walls-v1.png`,out),wallBuffer);
  await sharp(floorBuffer).composite([...layers,{input:wallBuffer,left:0,top:0}]).png().toFile(new URL(file,out).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
  metadata.items.push({style,file,source:p.source,sourceSha256:hash(bytes),wallLayer:`${style}/Q03-R-HC-walls-v1.png`,
    panelSource:p.panelSource,panelSourceSha256:hash(panelBytes),panelSourcePixels:p.panel,
    fixtures:placements,walls:m.baseWalls,corridorWallIllustrationBand:[4.8,5.05],
    illustrationNote:'Flattened corridor face projects inward from the structural band; all collision and aperture anchors stay on the approved lines. Side-door jambs end at 4.8.',
    registration:'constructed-at-approved-coordinates',runtimeReady:false});
}
await writeFile(new URL('registered-composites.json',out),JSON.stringify(metadata,null,2)+'\n');
console.log('Built two officer composites with exact wall layers and bounded furniture placement.');
