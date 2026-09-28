/** Purpose-specific internal architecture, shared by artwork and native Foundry walls. */
import { buildQuartersArchitecture } from "./interior-quarters.js";
import { buildMeasuredCabinArchitecture } from "./interior-measured-cabins.js";
const point=(x,y)=>({x:Math.round(x*10000)/10000,y:Math.round(y*10000)/10000});
export function addInteriorRoomDetails(room,edges=[],recipe={}) {
  if(!["quarters","transporter","cargo"].includes(room.kind))return;
  if(room.cabinPlan){room.architecture=buildMeasuredCabinArchitecture(room);return;}
  if(room.kind==="quarters"){room.architecture=buildQuartersArchitecture(room,edges,recipe);return;}
  const f=room.frame,w=Math.max(4,f.w-.9),h=Math.max(4,f.h-.9),fit=Math.max(.05,Math.min(1,(f.w-.2)/w,(f.h-.2)/h));
  const angle=f.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  const toWorld=(x,y)=>point(f.x+fit*(x*c-y*s),f.y+fit*(x*s+y*c));
  const walls=[],wall=(a,b)=>walls.push({a:toWorld(a.x,a.y),b:toWorld(b.x,b.y),door:false,partition:true});
  const details={type:room.kind,w,h,fit,walls};
  if(room.kind==="transporter") {
    details.pad={x:-w/2+Math.min(1.3,w*.23,h*.25)+.35,y:-h/2+Math.min(1.3,w*.23,h*.25)+.4,r:Math.min(1.3,w*.23,h*.25)};
    const p=details.pad,arc=Array.from({length:17},(_,i)=>{const a=Math.PI/3+i/16*Math.PI*4/3;return {x:p.x+Math.cos(a)*(p.r+.2),y:p.y+Math.sin(a)*(p.r+.2)};});
    for(let i=1;i<arc.length;i++)wall(arc[i-1],arc[i]);
  }
  room.architecture=details;
}
