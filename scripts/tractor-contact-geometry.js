/** Cached broad-hull analysis plus bounded ray contacts. Never traces a polygon;
 * failed/empty samples return null so playback can retain its soft fallback.
 */
const profiles = new WeakMap();
function profile(mask) {
  if (profiles.has(mask)) return profiles.get(mask);
  const {width:w,height:h}=mask;
  if (!(w>0&&h>0&&w*h<=1048576)) return null;
  const solid=new Uint8Array(w*h),depth=new Float32Array(w*h);
  for(const p of mask.opaque??[])if(p.x>=0&&p.y>=0&&p.x<w&&p.y<h)solid[p.y*w+p.x]=1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;
    depth[i]=solid[i]?1+Math.min(x?depth[i-1]:0,y?depth[i-w]:0):0;
  }
  let max=0;
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
    const i=y*w+x;
    if(solid[i])depth[i]=Math.min(depth[i],1+Math.min(x<w-1?depth[i+1]:0,y<h-1?depth[i+w]:0));
    max=Math.max(max,depth[i]);
  }
  if(!max){profiles.set(mask,null);return null;}
  // Select the largest connected thick region, avoiding tiny lights and thin
  // pylons. This is done once per cached mask, not once per token rotation.
  const seen=new Uint8Array(w*h);let largest=[];
  const threshold=Math.max(1,max*.35);
  for(let i=0;i<depth.length;i++){
    if(seen[i]||depth[i]<threshold)continue;
    const group=[i];seen[i]=1;
    for(let j=0;j<group.length;j++){
      const k=group[j],x=k%w,y=Math.floor(k/w);
      for(const n of [x?k-1:-1,x<w-1?k+1:-1,y?k-w:-1,y<h-1?k+w:-1]){
        if(n>=0&&!seen[n]&&depth[n]>=threshold){seen[n]=1;group.push(n);}
      }
    }
    if(group.length>largest.length)largest=group;
  }
  const points=[];let cx=0,cy=0,weight=0;
  const stride=Math.max(1,Math.ceil(largest.length/2048));
  for(let j=0;j<largest.length;j++){
    const i=largest[j],x=i%w+.5,y=Math.floor(i/w)+.5,d=depth[i];
    cx+=x*d;cy+=y*d;weight+=d;
    if(j%stride===0)points.push({x,y});
  }
  const result={w,h,solid,points,center:{x:cx/weight,y:cy/weight}};
  profiles.set(mask,result);return result;
}

export function sampleTractorHullContact(mask,source,toCanvas,count=33) {
  if(!mask)return null;
  const p=profile(mask);if(!p)return null;
  // toCanvas takes pixel centers. Derive one affine transform for all samples.
  const o=toCanvas({x:-.5,y:-.5}),x=toCanvas({x:.5,y:-.5}),y=toCanvas({x:-.5,y:.5});
  const a=x.x-o.x,b=x.y-o.y,c=y.x-o.x,d=y.y-o.y,det=a*d-b*c;
  if(![a,b,c,d,det,source.x,source.y].every(Number.isFinite)||Math.abs(det)<1e-8)return null;
  const world=q=>({x:o.x+a*q.x+c*q.y,y:o.y+b*q.x+d*q.y});
  const center=world(p.center),bearing=Math.atan2(center.y-source.y,center.x-source.x);
  if(Math.hypot(center.x-source.x,center.y-source.y)<1)return null;
  const angles=p.points.map(q=>{const v=world(q);return Math.atan2(Math.sin(Math.atan2(v.y-source.y,v.x-source.x)-bearing),Math.cos(Math.atan2(v.y-source.y,v.x-source.x)-bearing));}).sort((a,b)=>a-b);
  const lo=angles[Math.floor((angles.length-1)*.02)],hi=angles[Math.ceil((angles.length-1)*.98)];
  if(!(hi-lo>.001&&hi-lo<Math.PI*.9))return null;
  const sx=(d*(source.x-o.x)-c*(source.y-o.y))/det,sy=(-b*(source.x-o.x)+a*(source.y-o.y))/det;
  const at=(u,v)=>u>=0&&v>=0&&u<p.w&&v<p.h&&p.solid[Math.floor(v)*p.w+Math.floor(u)];
  if(at(sx,sy))return null;
  const contour=[];
  for(let i=0;i<count;i++){
    const angle=bearing+lo+(hi-lo)*i/(count-1),wx=Math.cos(angle),wy=Math.sin(angle);
    let vx=(d*wx-c*wy)/det,vy=(-b*wx+a*wy)/det;
    const length=Math.hypot(vx,vy);vx/=length;vy/=length;
    let enter=0,leave=Infinity;
    for(const [s,v,max]of [[sx,vx,p.w],[sy,vy,p.h]]){
      if(Math.abs(v)<1e-9){if(s<0||s>=max){leave=-1;break;}continue;}
      const t0=-s/v,t1=(max-s)/v;enter=Math.max(enter,Math.min(t0,t1));leave=Math.min(leave,Math.max(t0,t1));
    }
    let contact=null;
    // Half-pixel steps avoid skipping thin hull features. Bound the walk even
    // for pathological input; an unusable ray cannot terminate the live lock.
    const steps=Math.min(2048,Math.ceil(Math.max(0,leave-enter)*2));
    for(let j=0;j<=steps;j++){
      const t=enter+j*.5,u=sx+vx*t,v=sy+vy*t;
      if(t>leave)break;
      if(!at(u,v))continue;
      // A small inset joins the glow without driving the fan through the ship.
      let end=t;
      for(let n=1;n<=4;n++)if(at(sx+vx*(t+n*.5),sy+vy*(t+n*.5)))end=t+n*.5;else break;
      contact=world({x:sx+vx*end,y:sy+vy*end});break;
    }
    if(!contact)return null;
    contour.push(contact);
  }
  return {contour,center};
}
