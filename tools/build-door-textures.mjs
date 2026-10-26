// Export generated door art for Foundry's default 200 px texture grid.
// Usage: node tools/build-door-textures.mjs [absolute path to sharp]
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url), sharp=require(process.argv[2]??'sharp');
const root=new URL('../',import.meta.url), out=new URL('assets/doors/',root), docs=new URL('docs/door-textures/',root);
await mkdir(out,{recursive:true});
const manifest={textureGridSize:200,width:400,assets:[]};
const registration=JSON.parse(await readFile(new URL('handle-registration.json',docs),'utf8'));
const layers=[];
const width=1100,height=780;
const labels=[`<text x="36" y="43" font-size="26" fill="#eee">Animated door textures</text>`, `<text x="235" y="78" fill="#b9c0c5">THIN · 0.10 grid</text>`, `<text x="680" y="78" fill="#b9c0c5">THICK · 0.20 grid</text>`];
for(const [row,material] of ['wood','stone','metal','jail'].entries()){
  labels.push(`<text x="36" y="${145+row*155}" fill="#ddd" font-size="19">${material.toUpperCase()}</text>`);
  for(const [column,weight] of ['thin','thick'].entries()){
    const key=`${material}-${weight}`, source=new URL(`sources/${key}.png`,docs);
    const {data,info}=await sharp(fileURLToPath(source)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let x0=info.width,y0=info.height,x1=-1,y1=-1;
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
      if(data[(y*info.width+x)*4+3]<=12)continue;
      x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
    }
    assert.ok(x1>x0&&y1>y0,`${key}: empty art`);
    // Crop only the transparent surround; keep original alpha, including jail gaps.
    const crop={left:x0,top:y0,width:x1-x0+1,height:y1-y0+1};
    const leafHeight=weight==='thin'?20:40;
    let h=leafHeight;
    const handles=material==='wood'||material==='metal';
    if(handles){
      // Register to the original leaf so handles do not shrink its depth
      // or shift the center away from Foundry's wall/hinge line.
      const reference=registration.assets.find(a=>a.material===material&&a.weight===weight).crop;
      const center=reference.top+reference.height/2;
      const radius=Math.ceil(Math.max(center-y0,y1+1-center));
      crop.top=Math.floor(center-radius);crop.height=2*radius;
      assert.ok(crop.top>=0&&crop.top+crop.height<=info.height,`${key}: handle crop outside canvas`);
      h=2*Math.ceil(radius*leafHeight/reference.height);
    }
    const bytes=await sharp(fileURLToPath(source)).extract(crop).resize(400,h,{fit:'fill'}).webp({lossless:true}).toBuffer();
    const file=new URL(`${key}.webp`,out);
    await writeFile(file,bytes);
    const meta=await sharp(bytes).metadata(), stats=await sharp(bytes).stats();
    assert.equal(meta.width,400);assert.equal(meta.height,h);assert.equal(meta.hasAlpha,true);
    assert.ok(stats.channels[3].min===0&&stats.channels[3].max===255,`${key}: expected transparent and opaque pixels`);
    manifest.assets.push({material,weight,file:`modules/sta2e-toolkit/assets/doors/${key}.webp`,width:400,height:h,leafHeight,handles,crop,source:`docs/door-textures/sources/${key}.png`});
    layers.push({input:bytes,left:230+column*435,top:125+row*155+(40-h)/2});
    labels.push(`<text x="${230+column*435}" y="${195+row*155}" fill="#9da9b1" font-size="15">${key}.webp</text>`);
  }
}
const background=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="24" height="24" fill="#242b30"/><rect width="12" height="12" fill="#2b333a"/><rect x="12" y="12" width="12" height="12" fill="#2b333a"/></pattern></defs><rect width="100%" height="100%" fill="url(#grid)"/><g font-family="Arial,sans-serif" font-size="17">${labels.join('')}<text x="36" y="750" fill="#9da9b1">Transparent WebP · overhead single leaves · Foundry animates the texture</text></g></svg>`);
await sharp(background).composite(layers).png().toFile(fileURLToPath(new URL('preview.png',docs)));
await writeFile(new URL('catalog.json',out),JSON.stringify(manifest,null,2)+'\n');
console.log(`Exported and checked ${manifest.assets.length} transparent door textures; 20/40 px leaves with room for handles.`);
