// Read-only raster analysis plus a generated HTML review; does not modify PNGs.
// Pass a Sharp module path when it is not installed in the project.
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),sharp=require(process.argv[2]??'sharp');
const root=new URL('../',import.meta.url);
const art=new URL('assets/interiors/prefabs/starfleet-tng/',root);
const read=async url=>JSON.parse(await readFile(url,'utf8'));
const catalog=await read(new URL('catalog.json',art));
const kit=await read(new URL('docs/interior-prefabs/starter-kit.json',root));
const guides=await read(new URL('docs/interior-prefabs/art-guides/manifest.json',root));
const prompts=await read(new URL('prompts.json',art));
const corrections=await read(new URL('correction-prompts.json',art));
assert.equal(catalog.pieces.length,kit.pieces.length);
const report={status:'not-production-approved',method:'Opaque bounds at alpha >= 240; dimensions are diagnostic, not seam acceptance.',pieces:[]};
for(const item of catalog.pieces){
  const source=item.promptFile==='correction-prompts.json'?corrections:prompts;
  assert.ok(source.requests.some(p=>p.id===item.promptId),`${item.id}: exact prompt exists`);
  const file=fileURLToPath(new URL(item.file,art)),meta=await sharp(file).metadata();
  assert.ok(meta.hasAlpha,`${item.id}: alpha channel`);
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let left=info.width,top=info.height,right=-1,bottom=-1,transparent=0,opaque=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const alpha=data[(y*info.width+x)*info.channels+info.channels-1];
    if(alpha===0)transparent++;
    if(alpha>=240){opaque++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  }
  assert.ok(transparent>0&&opaque>0,`${item.id}: actual transparent exterior and opaque content`);
  const piece=kit.pieces.find(p=>p.id===item.id),guide=guides.pieces.find(p=>p.id===item.id);
  const xs=piece.footprint.map(p=>p[0]),ys=piece.footprint.map(p=>p[1]);
  const expectedRatio=(Math.max(...xs)-Math.min(...xs))/(Math.max(...ys)-Math.min(...ys));
  report.pieces.push({...item,name:piece.name,canvas:[meta.width,meta.height],opaqueBounds:[left,top,right+1,bottom+1],transparentPixelFraction:transparent/(info.width*info.height),envelopeAspectErrorPercent:100*((right-left+1)/(bottom-top+1)/expectedRatio-1),guide,geometry:piece});
}
await writeFile(new URL('fit-report.json',art),JSON.stringify(report,null,2)+'\n');
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
// Preview placement uses one uniform scale from opaque width, never stretches axes
// independently. Residual errors remain visible; this is not an accepted export.
const assembly=kit.assembly.placements.map(place=>{
  const p=report.pieces.find(p=>p.id===place.piece),[l,t,r]=p.opaqueBounds;
  const xs=p.geometry.footprint.map(v=>v[0]),ys=p.geometry.footprint.map(v=>v[1]);
  const unitScale=(Math.max(...xs)-Math.min(...xs))/(r-l);
  const x=Math.min(...xs)-l*unitScale,y=Math.min(...ys)-t*unitScale;
  const points=p.geometry.footprint.map(v=>v.join(',')).join(' ');
  return `<g transform="translate(${place.at}) rotate(${place.rotation})"><image href="${p.file}" x="${x}" y="${y}" width="${p.canvas[0]*unitScale}" height="${p.canvas[1]*unitScale}"/><g class="overlay"><polygon points="${points}" fill="none" stroke="#68e4d0" stroke-width=".025"/></g></g>`;
}).join('');
const cards=report.pieces.map(p=>{
  const pts=p.guide.footprintPixels.map(v=>v.join(',')).join(' ');
  const ports=p.guide.ports.map(v=>{const angle=(v.facing+90)*Math.PI/180,h=v.widthPixels/2,dx=Math.cos(angle)*h,dy=Math.sin(angle)*h;return `<path d="M${v.pixels[0]-dx},${v.pixels[1]-dy}L${v.pixels[0]+dx},${v.pixels[1]+dy}" stroke="#ffb65c" stroke-width="12"/>`;}).join('');
  return `<article><header><span>${esc(p.id)}</span><h2>${esc(p.name)}</h2></header><a class="art" href="${p.file}" aria-label="Open ${esc(p.name)} image"><svg viewBox="0 0 1536 1536"><image href="${p.file}" width="1536" height="1536"/><g class="overlay"><polygon points="${pts}" fill="none" stroke="#68e4d0" stroke-width="5"/>${ports}</g></svg></a><p>${esc(p.note)}</p><details><summary>Fit details</summary><p>Actual canvas: ${p.canvas.join(' × ')} px. Envelope aspect difference: ${p.envelopeAspectErrorPercent.toFixed(1)}%. This measures the outer bounds only, not door or furniture alignment.</p><a href="../../../../docs/interior-prefabs/art-guides/${p.id}-guide.png">Drawing guide</a></details></article>`;
}).join('\n');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Starfleet TNG — first prefab art pass</title><style>
*{box-sizing:border-box}body{margin:0;background:#111820;color:#ebedf0;font:16px/1.55 system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:38px 28px}h1{font-size:clamp(28px,4vw,46px);line-height:1.1;margin:12px 0}h2{font-size:19px;margin:4px 0}p{color:#b7c3cd}.intro{max-width:900px}.eyebrow{color:#9bc6df;letter-spacing:.14em;font-size:12px}.status{color:#ffd28d}.controls{display:flex;align-items:center;gap:20px;flex-wrap:wrap;margin:26px 0}button{border:1px solid #586b7b;border-radius:8px;background:#283846;color:#eef5fa;font:inherit;padding:10px 18px;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #68e4d0;outline-offset:4px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}article{background:#1b2630;border:1px solid #34434f;border-radius:12px;overflow:hidden}header,article>p,details{padding:0 20px}header{padding-top:18px}header span{color:#91bdd8;font-size:12px;letter-spacing:.08em}.art{display:block;background:repeating-conic-gradient(#1c232b 0% 25%,#222b34 0% 50%) 50%/24px 24px;margin:14px 0}.art svg{display:block;width:100%;aspect-ratio:1}.overlay{display:none;pointer-events:none}.show-outlines .overlay{display:block}article p{font-size:14px}details{padding-bottom:20px;font-size:14px}details p{font-size:13px}summary{cursor:pointer}a{color:#9ed9fa}.legend{font-size:14px;color:#9eb5c5}footer{padding-top:30px;font-size:14px;color:#9baebb}
</style><main><div class="eyebrow">STARFLEET / TNG / MODULAR INTERIORS</div><h1>The first habitation set</h1><p class="intro">Nine pre-rendered artwork candidates: standard and L-shaped officer quarters with perimeter bathrooms, a compact inboard lift, five corridor pieces, and sealed structural infill.</p><p class="status">Art review · connection fitting still in progress · not enabled in the scene generator</p><div class="controls"><button id="outlines" aria-pressed="false">Show intended outlines</button><span class="legend">Teal = intended footprint · amber = connection opening</span></div><h2>Assembly study</h2><p class="intro">Hull side above; compact lift inboard below. Each image is positioned using one uniform scale, with no separate horizontal or vertical stretching. Remaining gaps and overlaps are visible. This is a fitting study, not a playable scene.</p><svg style="display:block;width:100%;background:#151d25;border:1px solid #34434f;border-radius:12px;margin:20px 0 36px" viewBox="-2 -7 20 13" role="img" aria-label="Assembled habitation art fitting study">${assembly}</svg><h2>Individual artwork</h2><p class="intro">Here the overlay uses the requested canvas framing without moving or stretching the artwork. Differences are visible on purpose. Click any image to inspect its original transparent PNG.</p><section class="grid">${cards}</section><footer>Created with the built-in image generator. <a href="prompts.json">Exact prompts and references</a> · <a href="catalog.json">Asset catalog and remaining fit work</a> · <a href="../../../../docs/interior-prefabs/README.md">Geometry proof</a></footer></main><script>document.getElementById('outlines').addEventListener('click',function(){const visible=document.body.classList.toggle('show-outlines');this.setAttribute('aria-pressed',String(visible));this.textContent=visible?'Hide intended outlines':'Show intended outlines';});</script></html>`;
const fittedSection=`<h2>Fitted assembly</h2><p class="intro">Smaller cabin furnishings, corrected corridor shapes, continuous corridor carpet, and separate open/closed doors. The art is clipped to the fixed room outlines at a uniform physical scale. This remains a fitting proof; room wall thickness and live Foundry behavior still need validation.</p><div class="controls"><button id="door-state" aria-pressed="false">Show closed doors</button><a href="registered-assembly.png">Open full-size map</a><a href="registered-assembly-closed.png">Closed-door map</a></div><img id="fitted-map" src="registered-assembly.png" alt="Fitted habitation section with two cabins and an inboard lift, doors open" style="display:block;width:100%;border:1px solid #34434f;border-radius:12px;margin:20px 0 36px"><details><summary>Compare the uncorrected placement</summary>`;
const fittedHTML=html.replace('<h2>Assembly study</h2>',fittedSection).replace('<h2>Individual artwork</h2>','</details><h2>Individual artwork</h2>').replace('<a href="prompts.json">Exact prompts and references</a>','<a href="prompts.json">Original prompts</a> · <a href="correction-prompts.json">Correction prompts</a> · <a href="registration-report.json">Fitting measurements</a>').replace('</script></html>',`document.getElementById('door-state').addEventListener('click',function(){const closed=this.getAttribute('aria-pressed')!=='true';this.setAttribute('aria-pressed',String(closed));this.textContent=closed?'Show open doors':'Show closed doors';const img=document.getElementById('fitted-map');img.src=closed?'registered-assembly-closed.png':'registered-assembly.png';img.alt='Fitted habitation section, doors '+(closed?'closed':'open');});</script></html>`);
await writeFile(new URL('index.html',art),fittedHTML);
console.log(JSON.stringify(report.pieces.map(p=>({id:p.id,canvas:p.canvas,aspectErrorPercent:Number(p.envelopeAspectErrorPercent.toFixed(1)),transparentPercent:Number((p.transparentPixelFraction*100).toFixed(1))})),null,2));
console.log('Verified nine candidate PNGs, real alpha, guide coverage and prompt provenance. Art fitting remains pending.');
