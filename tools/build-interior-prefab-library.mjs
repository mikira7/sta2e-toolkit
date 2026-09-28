import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),art=new URL('assets/interiors/prefabs/starfleet-tng/',root);
const kit=JSON.parse(await readFile(new URL('docs/interior-prefabs/starter-kit.json',root),'utf8'));
const report=JSON.parse(await readFile(new URL('registration-report.json',art),'utf8'));
const pieces=kit.pieces.map(p=>{const registered=report.pieces.find(r=>r.id===p.id);return {...p,art:{file:registered.file,sha256:registered.sha256,canvas:registered.canvas,registration:registered.registration}};});
for(const p of pieces)if(createHash('sha256').update(await readFile(new URL(p.art.file,art))).digest('hex')!==p.art.sha256)throw new Error(`Stale art for ${p.id}`);
await writeFile(new URL('assembly-library.json',art),JSON.stringify({id:'habitation-puzzle-v1',schemaVersion:1,metresPerUnit:kit.metresPerUnit,wallThickness:kit.wallThickness,connectors:kit.connectors,pieces,corridorFinish:{...report.corridorFinish,file:'../../floor-room-carpet.png'}},null,2)+'\n');
console.log('Packaged nine fitted puzzle masters for runtime assembly.');
