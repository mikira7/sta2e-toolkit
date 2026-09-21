// node --experimental-vm-modules tests/trek-fx.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const hooks=new Map(), ticks=new Set();
const timers=new Map();let serial=0;
const documents=new Map();
const scene={tokens:{get:id=>documents.get(id),[Symbol.iterator]:()=>documents.values()}};
class Filter {
  constructor(v,f,uniforms){this.uniforms=uniforms;this.program={glPrograms:{0:{program:{}}}};}
  destroy(){this.destroyed=true;}
}
const ticker={add:fn=>ticks.add(fn),remove:fn=>ticks.delete(fn)};
const game={user:{id:'gm',isGM:true},users:{activeGM:{id:'gm'}},scenes:[scene],time:{serverTime:12000}};
const canvas={app:{ticker,renderer:{resolution:2,CONTEXT_UID:0,shader:{generateProgram(){}},gl:{LINK_STATUS:1,getProgramParameter:()=>true}}},tokens:{placeables:[]}};
const context=vm.createContext({console,game,canvas,PIXI:{Filter},
  setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:game.time.serverTime+ms});return id;},
  clearTimeout:id=>timers.delete(id),
  Hooks:{on:(name,fn)=>{const a=hooks.get(name)??[];a.push(fn);hooks.set(name,a);}}});
const mod=new vm.SourceTextModule(await readFile(new URL('../scripts/trek-fx.js',import.meta.url),'utf8'),{context});
await mod.link(()=>{});await mod.evaluate();const fx=mod.namespace;
const fire=(event,...args)=>{for(const fn of hooks.get(event)??[])fn(...args);};
function token(id='token',persisted=false) {
  let saved={};
  const mesh={filters:[],getBounds:()=>({x:120,y:40,width:80,height:160})};
  const doc={getFlag:()=>saved,async update(changes){for(const [path,v]of Object.entries(changes))saved[path.split('.').at(-1)]=v;},async unsetFlag(){saved={};}};
  const token={id,mesh,document:doc};doc.object=token;
  if(persisted){doc.id=id;doc.parent=scene;doc.deletions=0;doc.delete=async()=>{doc.deletions++;documents.delete(id);fire('deleteToken',doc);};documents.set(id,doc);}
  return token;
}
async function advance(ms){const end=game.time.serverTime+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;game.time.serverTime=next[1].at;timers.delete(next[0]);await next[1].fn();}game.time.serverTime=end;for(const tick of ticks)tick();}
fx.registerTrekFx();fx.registerTrekFx();
assert.equal(hooks.get('drawToken').length,1);
const real=token(), foreign={foreign:true};real.mesh.filters=[foreign];canvas.tokens.placeables=[real];
await fx.setTrekFx(real,'blueHaze',true);
assert.equal(ticks.size,1);assert.equal(real.mesh.filters.length,2);
const first=real.mesh.filters[1];
await fx.setTrekFx(real,'particleStorm',true);
assert.equal(real.mesh.filters[1],first);assert.deepEqual(Array.from(first.uniforms.uEffects),[1,1,0]);
await fx.setTrekFx(real,'blueDissolve',true);
assert.equal(first.uniforms.uTime,0);
game.time.serverTime+=2500;for(const tick of ticks)tick();assert.equal(first.uniforms.uTime,2.5);
assert.equal(first.padding,144);
const preview=token();await fx.setTrekFx(preview,'blueHaze',true);
fire('destroyToken',preview);assert.equal(real.mesh.filters[1],first);assert.equal(ticks.size,1);
const old=real.mesh;real.mesh={...old,filters:[]};fire('drawToken',real);
assert.equal(first.destroyed,true);assert.deepEqual(Array.from(old.filters),[foreign]);
assert.equal(real.mesh.filters.length,1);assert.equal(ticks.size,1);
const replacement=real.mesh.filters[0];real.mesh.filters.push(foreign);
await fx.clearTrekFx(real);assert.equal(replacement.destroyed,true);assert.deepEqual(Array.from(real.mesh.filters),[foreign]);assert.equal(ticks.size,0);
await fx.setTrekFx(real,'blueHaze',true);fire('canvasTearDown');
assert.equal(ticks.size,0);assert.deepEqual(Array.from(real.mesh.filters),[foreign]);
fire('canvasReady');assert.equal(ticks.size,1);assert.equal(real.mesh.filters.length,2);
fire('deleteToken',real.document);assert.equal(ticks.size,0);
game.user.isGM=false;await assert.rejects(()=>fx.setTrekFx(real,'blueHaze',true),/Only the GM/);
await assert.rejects(()=>fx.clearTrekFx(real),/Only the GM/);
game.user.isGM=true;await assert.rejects(()=>fx.setTrekFx(real,'invalid',true),/Unknown/);
const dissolving=token('dissolving',true);
await fx.setTrekFx(dissolving,'blueDissolve',true);
await advance(6499);assert.equal(dissolving.document.deletions,0);
await advance(1);assert.equal(dissolving.document.deletions,1);assert.equal(timers.size,0);
assert.equal(ticks.size,0);
const cancelled=token('cancelled',true);
await fx.setTrekFx(cancelled,'blueDissolve',true);await advance(2000);
await fx.setTrekFx(cancelled,'blueDissolve',false);await advance(7000);
assert.equal(cancelled.document.deletions,0);assert.equal(timers.size,0);
await fx.setTrekFx(cancelled,'blueDissolve',true);await advance(2000);
await fx.clearTrekFx(cancelled);await advance(7000);assert.equal(cancelled.document.deletions,0);
const restarted=token('restarted',true);
await fx.setTrekFx(restarted,'blueDissolve',true);await advance(3000);
await fx.setTrekFx(restarted,'blueDissolve',true);await advance(3500);
assert.equal(restarted.document.deletions,0);await advance(3000);assert.equal(restarted.document.deletions,1);
const offscene=token('offscene',true);
await fx.setTrekFx(offscene,'blueDissolve',true);fire('canvasTearDown');
await advance(6500);assert.equal(offscene.document.deletions,1);
const takeover=token('takeover',true);await fx.setTrekFx(takeover,'blueDissolve',true);
game.users.activeGM={id:'other'};await advance(6500);assert.equal(takeover.document.deletions,0);
game.users.activeGM={id:'gm'};await advance(1000);assert.equal(takeover.document.deletions,1);
const reload=token('reload',true);
await reload.document.update({'blueDissolve':true,'startedAt':game.time.serverTime-7000});
fire('ready');await advance(0);assert.equal(reload.document.deletions,1);
const clone=token('clone');clone.document.parent=scene;clone.document.id=cancelled.id;
await fx.setTrekFx(clone,'blueDissolve',true);await advance(7000);
assert.equal(cancelled.document.deletions,0);assert.equal(timers.size,0);fire('destroyToken',clone);
const player=token('player',true);await player.document.update({'blueDissolve':true,'startedAt':game.time.serverTime});
game.user.isGM=false;fire('updateToken',player.document);await advance(7000);
assert.equal(player.document.deletions,0);assert.equal(timers.size,0);fire('canvasTearDown');
assert.equal(ticks.size,0);
console.log('PASS: existing FX lifecycle plus 6.5-second removal, cancellation, clear, restart, scene changes, GM election/takeover, reload recovery, preview isolation, and player deletion prevention.');

