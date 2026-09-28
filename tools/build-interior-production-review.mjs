// Read-only inventory. Combined art must pass registration before runtime promotion.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),sharp=require(process.argv[2]??'sharp');
const root=new URL('../',import.meta.url),out=new URL('assets/interiors/prefabs/production/',root);
const hash=data=>createHash('sha256').update(data).digest('hex');
const source=await readFile(new URL('docs/interior-prefabs/room-corridor-halves/catalog.json',root));
const catalog=JSON.parse(source);
const styleGuidePath='docs/interior-prefabs/cabin-style-guide.md';
const styleGuide={path:styleGuidePath,sha256:hash(await readFile(new URL(styleGuidePath,root))),version:3};
const requests=JSON.parse(await readFile(new URL('prompts.json',out),'utf8')).prompts;
const combined=JSON.parse(await readFile(new URL('combined-requests.json',out),'utf8'));
const manifest={schemaVersion:2,status:'combined-art-candidates-need-correction',
  architecture:'room-and-half-corridor',geometrySha256:hash(source),cabinStyleGuide:styleGuide,
  promotionRequirements:['True transparent exterior','Uniform registration to combined walls, doors and floor seams','Fixture scale and clearances match approved cabin','Cabin style guide visual review: glass/wood tables, seating, plants, lights, sonic showers and tub variants','Door leaves separate','Joined floor proof and native Foundry validation'],
  items:[],supportTasks:[],legacyRoomOnlyCandidates:[]};
for(const style of ['galaxy','intrepid']){
  for(const module of catalog.modules.filter(m=>m.category==='alcove-half'||m.category==='room-half'&&m.location==='interior')){
    const candidates=[];
    for(const request of combined.requests.filter(r=>r.style===style&&r.piece===(module.baseArtwork??module.id)&&r.status!=='planned')){
      const requestGuide=request.guide??combined.guide;
      const bytes=await readFile(new URL(request.file,out));
      const [meta,stats]=await Promise.all([sharp(bytes).metadata(),sharp(bytes).stats()]);
      candidates.push({file:request.file,promptId:request.id,sha256:hash(bytes),canvas:[meta.width,meta.height],
        hasTransparency:Boolean(meta.hasAlpha&&!stats.isOpaque),status:request.status,review:request.review,
        styleGuideSha256:requestGuide.sha256,geometrySha256:combined.geometrySha256,
        currentBrief:requestGuide.sha256===styleGuide.sha256&&combined.geometrySha256===hash(source),runtimeReady:false});
    }
    const corrected=candidates.findLast(c=>c.status==='appearance-corrected-registration-pending'&&c.hasTransparency&&c.currentBrief);
    manifest.items.push({id:style+'/'+(module.baseArtwork??module.id),style,piece:module.id,name:module.name,
      artwork:module.baseArtwork??module.id,rearWallSeparate:module.category==='room-half',
      ...(module.category==='room-half'?{styleGuideSha256:styleGuide.sha256,styleReview:corrected?'floor-and-desk-corrections-reviewed':candidates.length?'needs-correction':'pending-art'}:{}),
      ...(corrected?{appearancePreview:corrected.file}:{}),
      geometrySha256:hash(JSON.stringify(module)),status:corrected?'registration-pending':candidates.length?'needs-correction':'awaiting-combined-art',runtimeReady:false,candidates});
  }
  for(const task of catalog.supportArtwork)manifest.supportTasks.push({...task,style,status:task.status??'awaiting-art',runtimeReady:false});
  for(const file of (await readdir(new URL(style+'/',out))).filter(f=>/^Q03-R-v\d+\.png$/.test(f)).sort()){
    const path=style+'/'+file,bytes=await readFile(new URL(path,out));
    const [meta,stats]=await Promise.all([sharp(bytes).metadata(),sharp(bytes).stats()]);
    const request=requests.find(r=>r.file===path);
    manifest.legacyRoomOnlyCandidates.push({file:path,sha256:hash(bytes),canvas:[meta.width,meta.height],
      hasTransparency:Boolean(meta.hasAlpha&&!stats.isOpaque),promptId:request?.id??null,
      provenance:request?'recorded':'prompt-record-missing',status:'appearance-reference-only',runtimeReady:false});
  }
}
manifest.counts={combinedMasters:manifest.items.length,supportTasks:manifest.supportTasks.length,
  combinedCandidates:manifest.items.reduce((n,i)=>n+i.candidates.length,0),legacyRoomOnlyCandidates:manifest.legacyRoomOnlyCandidates.length,runtimeReady:0};
await writeFile(new URL('manifest.json',out),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest.counts));
