// Revised planning geometry, deliberately separate from the pinned runtime art.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const root=new URL('../',import.meta.url),out=new URL('docs/interior-prefabs/cabin-revisions/',root);
await mkdir(out,{recursive:true});
const old=JSON.parse(await readFile(new URL('docs/interior-prefabs/starter-kit.json',root),'utf8'));
const clone=id=>structuredClone(old.pieces.find(p=>p.id===id));
const rectPoly=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const f=(kind,rect,extra={})=>({kind,rect,...extra});
const square=clone('Q01-A');
Object.assign(square,{id:'Q01-B',name:'Compact square — revised',revisionOf:'Q01-A'});
Object.assign(square.fixtures.find(f=>f.kind==='toilet'),{rect:[4.25,1.45,.65,.5],facing:180,backWall:{a:[5,0],b:[5,2.2]},approach:[3.65,1.6]});
square.fixtures.push(f('wardrobe',[.1,3.65,.65,1.1],{facing:0,approach:[1.3,4.15]}));
square.accessPoints.push([1.3,4.15]);
square.notes='Wardrobe added; cistern against right perimeter, bowl faces left into the bathroom. Square option retained, not the default cabin shape.';
function suite(id,name,bedroomCount){
  const family=bedroomCount>1,common=family?6.5:5.5,closetX=common+bedroomCount*3,headX=closetX+2,width=headX+3;
  const p={id,name,category:'room',zone:'outboard',bedroomCount,
    ...(bedroomCount===1?{revisionOf:'Q03-L2'}:{}),footprint:rectPoly(0,0,width,5),
    ports:[{id:'entry',type:'room',at:[2.7,5],facing:90}],
    windows:[[[.9,0],[2.4,0]],[[3.25,0],[4.9,0]]],
    bathroom:{polygon:rectPoly(headX,0,3,5),tub:true},
    closet:{polygon:rectPoly(closetX,0,2,3.4),bedroom:`bedroom-${bedroomCount}`,private:true,door:{at:[closetX,1.7],width:1.2}},
    bedrooms:[],sections:[
      {name:'DINING',polygon:rectPoly(0,0,2.9,3.15),label:[1.5,2.95],color:'#777060'},
      {name:'LIVING',polygon:rectPoly(2.9,0,2.6,3.15),label:[4.1,2.95],color:'#686d80'},
      {name:'WORK',polygon:rectPoly(0,3.15,2.1,1.85),label:[1,3.25],color:'#657784'}],
    partitions:[{a:[common,0],b:[common,5],door:{at:[common,4.2],width:1.2}},
      {a:[closetX,0],b:[closetX,3.4],door:{at:[closetX,1.7],width:1.2}},
      {a:[closetX,3.4],b:[headX,3.4]},
      {a:[headX,0],b:[headX,5],door:{at:[headX,4.2],width:1.2}}],
    fixtures:[f('dining table',[1.2,1.5,.9,.9]),f('chair',[.5,1.7,.45,.45],{facing:0}),f('chair',[2.35,1.7,.45,.45],{facing:180}),
      f('sofa',[3.65,.25,1.7,.65]),f('table',[4.15,1.7,.85,.5]),
      f('desk',[.2,3.4,1.6,.55],{id:'work-desk'}),f('chair',[.75,4.15,.5,.5],{desk:'work-desk',facing:270,approach:[1.95,4.45]}),
      f('hanging storage',[headX-.5,.25,.4,2.5],{facing:180,approach:[headX-1.1,1.8]}),
      f('shower',[headX+.2,.2,.9,.9]),f('tub',[headX+1.25,.2,1.55,.8]),f('basin',[headX+.2,1.5,.55,.7]),
      f('toilet',[headX+2.25,2,.65,.5],{facing:180,backWall:{a:[width,0],b:[width,5]},approach:[headX+1.6,2.3]})],
    accessPoints:[[2.7,4.4],[3.1,2.8],[5,4.2],[headX-.6,4.2],[headX+1.5,4.2]],
    notes:'Long rectangular suite with dining, living and work areas. The last bedroom is the master, with a private walk-in closet accessed only from that room. All bedrooms and the shared head retain passage entrances; other occupants never cross the master to reach the head.'};
  for(let i=0;i<bedroomCount;i++){
    const master=i===bedroomCount-1,x=common+3*i,room={id:`bedroom-${i+1}`,master,polygon:rectPoly(x,0,3,3.4),door:{at:[x+1.8,3.4],width:1.2},approach:[x+2,1.2]};
    p.bedrooms.push(room);
    if(i>0)p.partitions.push({a:[x,0],b:[x,3.4]});
    p.partitions.push({a:[x,3.4],b:[x+3,3.4],door:room.door});
    p.windows.push([[x+.45,0],[x+2.5,0]]);
    p.fixtures.push(f('bed',[x+.25,.25,master?1.2:1.1,1.4],{bedroom:room.id}),f('wardrobe',[x+.15,2.05,.55,1.2],{bedroom:room.id,facing:0,approach:[x+1.25,2.6]}));
    p.accessPoints.push(room.approach);
  }
  if(family){
    p.sections[0]={name:'FAMILY DINING',polygon:rectPoly(0,0,3.9,3.5),label:[2.4,.65],color:'#777060'};
    p.sections[1]={name:'LIVING',polygon:rectPoly(3.9,0,2.6,3.15),label:[5.1,2.95],color:'#686d80'};
    p.fixtures=p.fixtures.filter(f=>f.kind!=='dining table'&&!(f.kind==='chair'&&!f.desk));
    p.fixtures.push(f('dining table',[1.4,1.9,2,.8]),f('dining bench',[1.4,1.15,2,.45],{seats:3}),f('dining bench',[1.4,2.95,2,.45],{seats:3}));
    p.fixtures.find(f=>f.kind==='sofa').rect[0]+=1;p.fixtures.find(f=>f.kind==='table').rect[0]+=1;
    p.fixtures.find(f=>f.kind==='desk').rect[1]=3.6;
    Object.assign(p.fixtures.find(f=>f.desk),{rect:[.75,4.35,.5,.5],approach:[2.35,4.4]});
    p.windows[1]=[[4.25,0],[5.9,0]];
    p.accessPoints[1]=[4.1,2.8];p.accessPoints[2]=[common-.5,4.2];
  }
  replicator(p,'replicator-wall',[0,0,.5,1.3],[.05,.2,.37,.9],0,[1.1,family?.6:.8]);
  return p;
}
const officer=suite('Q03-R','Officer suite — rectangular',1);
const family2=suite('Q05-F2','Family suite — two bedrooms',2);
const family3=suite('Q05-F3','Family suite — three bedrooms',3);
const rectangular={id:'Q02-R',name:'Rectangular standard',category:'room',zone:'outboard',footprint:rectPoly(0,0,4,6),
  ports:[{id:'entry',type:'room',at:[2,6],facing:90}],windows:[[[.3,0],[1.6,0]]],
  bathroom:{polygon:rectPoly(2,0,2,2.4),tub:false},
  partitions:[{a:[2,0],b:[2,2.4],door:{at:[2,1.3],width:1.2}},{a:[2,2.4],b:[4,2.4]}],
  fixtures:[f('bed',[.15,.25,.75,1.4]),f('desk',[.1,2.8,.5,1.15]),f('chair',[.75,3.2,.45,.45]),
    f('wardrobe',[.1,4.55,.65,1.15],{facing:0,approach:[1.3,5.15]}),f('sofa',[2.45,4.65,1.3,.65]),f('table',[2.5,3.65,1,.5]),
    f('basin',[2.15,.15,.65,.4]),f('shower',[3.05,.15,.8,.8]),
    f('toilet',[3.25,1.6,.65,.5],{facing:180,backWall:{a:[4,0],b:[4,2.4]},approach:[2.65,1.8]})],
  accessPoints:[[1.9,5.45],[1.6,4.65],[1.45,1.3],[2.65,1.5],[1.3,5.15]],
  notes:'6 × 9 m rectangular cabin; wardrobes and bathroom occupy perimeter walls. Default direction for new standard accommodation, not a stretched square image.'};
const pair={id:'Q04-P',name:'Paired junior-officer cabins',category:'room',zone:'outboard',footprint:rectPoly(0,0,12,4),
  ports:[{id:'entry-a',type:'room',at:[2,4],facing:90},{id:'entry-b',type:'room',at:[10,4],facing:90}],
  windows:[[[1.3,0],[2.8,0]],[[9.2,0],[10.7,0]]],
  privateCabins:[{id:'a',polygon:rectPoly(0,0,5,4),entry:'entry-a'},{id:'b',polygon:rectPoly(7,0,5,4),entry:'entry-b'}],
  bathroom:{polygon:rectPoly(5,0,2,4),tub:false,shared:true,privacy:'Two private sliding doors; lock both while occupied. Each cabin has its own corridor entrance.'},
  partitions:[{a:[5,0],b:[5,4],door:{at:[5,2.2],width:1.2}},{a:[7,0],b:[7,4],door:{at:[7,2.2],width:1.2}}],
  fixtures:[f('bed',[.25,.25,.85,1.4],{owner:'a'}),f('wardrobe',[.1,2.25,.6,1.45],{owner:'a',facing:0,approach:[1.25,2.9]}),
    f('desk',[2.2,.3,1.3,.5],{owner:'a'}),f('chair',[2.6,.95,.5,.5],{owner:'a'}),f('armchair',[3.35,3.1,.6,.6],{owner:'a'}),
    f('bed',[10.9,.25,.85,1.4],{owner:'b'}),f('wardrobe',[11.3,2.25,.6,1.45],{owner:'b',facing:180,approach:[10.75,2.9]}),
    f('desk',[8.5,.3,1.3,.5],{owner:'b'}),f('chair',[8.9,.95,.5,.5],{owner:'b'}),f('armchair',[7.9,3.1,.6,.6],{owner:'b'}),
    f('shower',[5.1,.15,.8,.8]),f('toilet',[6.05,.15,.55,.65],{facing:90,backWall:{a:[5,0],b:[7,0]},approach:[6.3,1.4]}),f('basin',[5.45,3.4,1.1,.4])],
  accessPoints:[[2,3.4],[1.25,2.9],[4.4,2.2],[5.6,2.2],[6.4,2.2],[7.6,2.2],[10.75,2.9],[10,3.4]],
  notes:'Two 7.5 × 6 m private rooms at opposite ends of a shared 3 × 6 m central bathroom. Both rooms have wardrobes, desks, beds and independent corridor entrances; no route through a bedroom is required.'};
// Local service bulkheads deepen inward without moving the puzzle boundary or door ports.
// Replicators are recessed appliances within these solids, not freestanding floor furniture.
function replicator(piece,id,rect,appliance,facing,approach,owner){
  (piece.serviceWalls??=[]).push({id,rect,depth:.5,purpose:'Recessed food replicator and services'});
  piece.fixtures.push(f('food replicator',appliance,{recessed:true,serviceWall:id,facing,approach,...(owner?{owner}:{})}));
}
Object.assign(square.fixtures.find(f=>f.kind==='table'),{rect:[3.4,3.3,1,.5]});
Object.assign(square.fixtures.find(f=>f.kind==='sofa'),{rect:[3.15,4.1,1.55,.65]});
replicator(square,'replicator-wall',[4.5,2.2,.5,1.35],[4.58,2.4,.37,.9],180,[3.9,2.75]);
replicator(rectangular,'replicator-wall',[3.5,2.4,.5,1.1],[3.58,2.55,.37,.8],180,[2.9,3]);
replicator(pair,'replicator-wall-a',[4.5,0,.5,1.4],[4.58,.3,.37,.9],180,[3.9,1.2],'a');
replicator(pair,'replicator-wall-b',[7,0,.5,1.4],[7.05,.3,.37,.9],0,[8.1,1.2],'b');
const catalog={schemaVersion:5,status:'revised-measured-guides-not-runtime-art',metresPerUnit:1.5,wallThickness:.1,serviceWallDepth:.5,connectors:{room:{width:1.2}},
  orientationConvention:'Toilet facing is the bowl/front direction: 0 east/right, 90 south/down, 180 west/left, 270 north/up; the cistern/rear edge opposes facing.',
  defaultNewCabin:'Q02-R',retiredPieces:['Q03-L','Q03-L2'],pieces:[square,rectangular,pair,officer,family2,family3]};
await writeFile(new URL('catalog.json',out),JSON.stringify(catalog,null,2)+'\n');
await writeFile(new URL('scripts/interior-cabin-plans.js',root),'// Generated from the approved SVG guide catalog by tools/build-interior-cabin-revisions.mjs. Do not edit by hand.\nexport const CABIN_PLAN_CATALOG = '+JSON.stringify(catalog)+';\n');

const S=110,esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const point=p=>p.map(v=>v*S),path=p=>'M'+p.map(v=>point(v).join(',')).join('L')+'Z';
const line=(a,b,stroke,width)=>`<path d="M${point(a)}L${point(b)}" stroke="${stroke}" stroke-width="${width*S}" fill="none"/>`;
const text=(x,y,label,size=14,fill='#e7edf3')=>`<text x="${x*S}" y="${y*S}" font-size="${size}" fill="${fill}" text-anchor="middle">${esc(label)}</text>`;
const rect=(r,fill)=>`<rect x="${r[0]*S}" y="${r[1]*S}" width="${r[2]*S}" height="${r[3]*S}" rx="3" fill="${fill}" stroke="#1a2630" stroke-width="2"/>`;
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function wall(a,b,doors=[]){let start=0,result='';const len=distance(a,b),at=t=>a.map((v,i)=>v+t*(b[i]-v));
  const spans=doors.map(d=>{const t=distance(a,d.at)/len;return[t-d.width/len/2,t+d.width/len/2];}).sort((a,b)=>a[0]-b[0]);
  for(const [lo,hi]of [...spans,[1,1]]){if(lo>start)result+=line(at(start),at(lo),'#e0dcd5',.1);if(hi>lo)result+=line(at(lo),at(hi),'#e8a95b',.024);start=hi;}return result;
}
function draw(piece){
  let svg=`<path d="${path(piece.footprint)}" fill="#646c7a"/>`;
  for(const s of piece.sections??[])svg+=`<path d="${path(s.polygon)}" fill="${s.color}"/>`;
  for(const b of piece.bedrooms??[])svg+=`<path d="${path(b.polygon)}" fill="#697889"/>`;
  svg+=`<path d="${path(piece.bathroom.polygon)}" fill="#a6aba6"/>`;
  if(piece.closet)svg+=`<path d="${path(piece.closet.polygon)}" fill="#746652"/>`;
  for(const s of piece.serviceWalls??[])svg+=`<rect x="${s.rect[0]*S}" y="${s.rect[1]*S}" width="${s.rect[2]*S}" height="${s.rect[3]*S}" fill="#e0dcd5"/>`;
  for(let i=0;i<piece.footprint.length;i++){const a=piece.footprint[i],b=piece.footprint[(i+1)%piece.footprint.length];svg+=wall(a,b,piece.ports.filter(p=>Math.abs(distance(a,p.at)+distance(p.at,b)-distance(a,b))<1e-6).map(p=>({...p,width:1.2})));}
  for(const p of piece.partitions)svg+=wall(p.a,p.b,p.door?[p.door]:[]);
  for(const [a,b]of piece.windows)svg+=line(a,b,'#6fcee0',.07);
  for(const f of piece.fixtures){const [x,y,w,h]=f.rect;
    if(f.kind==='food replicator'){
      svg+=rect(f.rect,'#203645');
      const cx=(x+w/2)*S,cy=(y+h/2)*S;
      svg+=`<g transform="translate(${cx} ${cy}) rotate(${w<h?-90:0})"><rect x="-35" y="-13" width="70" height="26" rx="3" fill="none" stroke="#70dfdb" stroke-width="2"/><text x="0" y="4" font-size="11" fill="#b9f5ee" text-anchor="middle">REPLICATOR</text></g>`;
    }else if(f.kind==='toilet'){
      const cx=(x+w/2)*S,cy=(y+h/2)*S,len=(f.facing%180===0?w:h)*S,wide=(f.facing%180===0?h:w)*S;
      svg+=`<g transform="translate(${cx} ${cy}) rotate(${f.facing})"><rect x="${-len/2}" y="${-wide/2}" width="${len*.25}" height="${wide}" rx="3" fill="#e6ebe9" stroke="#35454d" stroke-width="2"/><ellipse cx="${len*.1}" cy="0" rx="${len*.34}" ry="${wide*.4}" fill="#f8faf8" stroke="#35454d" stroke-width="2"/><path d="M${len*.35} 0h${S*.3}l-7 -5m7 5l-7 5" fill="none" stroke="#873c23" stroke-width="2"/></g>`;
    }else{
      const storage=['wardrobe','hanging storage'].includes(f.kind);svg+=rect(f.rect,storage?'#c5a269':['bed','sofa','chair','armchair'].includes(f.kind)?'#87a7c2':'#d5dadb');
      if(storage){const cx=x+w/2;svg+=line([cx,y+.07],[cx,y+h-.07],'#71502a',.018);svg+=text(x+w/2,y+h/2+.04,'STOR',11,'#293846');}
      else svg+=text(x+w/2,y+h/2+.04,({shower:'SH',basin:'BASIN',armchair:'SEAT'})[f.kind]??f.kind.toUpperCase(),11,'#24333c');
      if(f.kind==='chair'&&Number.isFinite(f.facing)){
        const a=f.facing*Math.PI/180,c=[x+w/2,y+h/2],back=c.map((v,i)=>v-[Math.cos(a),Math.sin(a)][i]*.2),t=[-Math.sin(a)*.19,Math.cos(a)*.19];
        svg+=line(back.map((v,i)=>v-t[i]),back.map((v,i)=>v+t[i]),'#24333c',.045);
      }
    }
  }
  if(piece.closet)svg+=text(piece.closet.polygon[0][0]+1,2.95,'PRIVATE CLOSET',12);
  for(const s of piece.sections??[])svg+=text(...s.label,s.name,13);
  for(const [i,b]of (piece.bedrooms??[]).entries())svg+=text(b.polygon[0][0]+1.8,2.25,b.master?'MASTER BEDROOM':`BEDROOM ${i+1}`,11);
  if(piece.bedrooms){svg+=text(piece.bathroom.polygon[0][0]+1.5,3.3,'HEAD',13,'#24333c');svg+=text((piece.bedrooms[0].polygon[0][0]+piece.bathroom.polygon[0][0])/2,4.75,'PRIVATE PASSAGE',12);}
  if(piece.bathroom.shared){svg+=text(6,2.2,'SHARED',12,'#26343e');svg+=text(6,2.4,'BATH',12,'#26343e');}
  return svg;
}
const productionGuides=[];
for(const p of catalog.pieces){const w=Math.max(...p.footprint.map(v=>v[0])),h=Math.max(...p.footprint.map(v=>v[1]));
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${(w+1)*S}" height="${(h+1.5)*S}"><rect width="100%" height="100%" fill="#16212b"/><g font-family="Arial"><text x="${(w+1)*S/2}" y="30" fill="#e7edf3" text-anchor="middle" font-size="19">${p.id} · ${esc(p.name)}</text><g transform="translate(${S/2} 65)">${draw(p)}</g><text x="${(w+1)*S/2}" y="${(h+1.5)*S-24}" fill="#b6c6d3" text-anchor="middle" font-size="13">${w*1.5} × ${h*1.5} m envelope · Orange: sliding openings · WC arrow: bowl faces this way</text></g></svg>`;
  await writeFile(new URL(`${p.id}-guide.svg`,out),svg);
  // Tight geometry input for raster generation: no title/footer margins to distort aspect.
  const margin=.1*S,canvas=[Math.round((w+.2)*S),Math.round((h+.2)*S)];
  const body=draw(p).replace(/<text\b[^>]*>[\s\S]*?<\/text>/g,'');
  await writeFile(new URL(`${p.id}-production-guide.svg`,out),`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas[0]}" height="${canvas[1]}"><g transform="translate(${margin} ${margin})">${body}</g></svg>`);
  productionGuides.push({id:p.id,canvas,origin:[margin,margin],pixelsPerUnit:S,file:`${p.id}-production-guide.png`,geometry:p});
}
await writeFile(new URL('production-guides.json',out),JSON.stringify({status:'approved-geometry-generation-input',pieces:productionGuides},null,2)+'\n');
function sheet(pieces,positions,width,height,title){return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#16212b"/><g font-family="Arial"><text x="${width/2}" y="42" text-anchor="middle" font-size="27" fill="#e7edf3">${title}</text>${pieces.map((p,i)=>`<g transform="translate(${positions[i]})"><text x="0" y="-22" fill="#e7edf3" font-size="19">${p.id} · ${p.name} · ${Math.max(...p.footprint.map(v=>v[0]))*1.5} × ${Math.max(...p.footprint.map(v=>v[1]))*1.5} m</text>${draw(p)}</g>`).join('')}<text x="${width/2}" y="${height-25}" text-anchor="middle" fill="#b6c6d3" font-size="18">Tan = storage · Cyan recess = replicator · Orange = sliding door · Chair back shown opposite desk</text></g></svg>`;}
await writeFile(new URL('cabin-revisions.svg',out),sheet(catalog.pieces,[[60,110],[750,110],[60,880],[60,1450],[60,2110],[60,2770]],2400,3400,'CABIN PLANS · RECTANGULAR OFFICER AND FAMILY SUITES'));
await writeFile(new URL('suite-revisions.svg',out),sheet([officer,family2,family3],[[60,110],[60,770],[60,1430]],2400,2060,'OFFICER AND FAMILY SUITES · MASTER BEDROOM WITH PRIVATE WALK-IN CLOSET'));
console.log('Built six cabin plans, including rectangular officer and two/three-bedroom family suites.');
