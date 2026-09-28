// Pure placement helpers: generated PNGs stay immutable. All transforms are uniform.
export function fitRegistration(anchors) {
  if(!Array.isArray(anchors)||anchors.length<2)throw new Error('At least two registration anchors are required.');
  for(const a of anchors)if(![a.units,a.pixels].every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))throw new Error('Invalid registration anchor.');
  const mean=key=>[0,1].map(i=>anchors.reduce((sum,a)=>sum+a[key][i],0)/anchors.length);
  const u=mean('units'),p=mean('pixels');let numerator=0,denominator=0;
  for(const a of anchors)for(let i=0;i<2;i++){numerator+=(a.units[i]-u[i])*(a.pixels[i]-p[i]);denominator+=(a.units[i]-u[i])**2;}
  const pixelsPerUnit=numerator/denominator;
  if(!Number.isFinite(pixelsPerUnit)||pixelsPerUnit<=0)throw new Error('Registration must have positive, non-degenerate scale.');
  const origin=p.map((v,i)=>v-u[i]*pixelsPerUnit);
  const residuals=anchors.map(a=>Math.hypot(...a.units.map((v,i)=>(a.pixels[i]-origin[i])/pixelsPerUnit-v)));
  return {origin,pixelsPerUnit,maxResidualUnits:Math.max(...residuals),residuals};
}
export function placePoint(point,placement) {
  const radians=placement.rotation*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  return [placement.at[0]+point[0]*c-point[1]*s,placement.at[1]+point[0]*s+point[1]*c];
}
export function rasterPlacement(registration,canvas) {
  const {origin,pixelsPerUnit}=registration;
  return {x:-origin[0]/pixelsPerUnit,y:-origin[1]/pixelsPerUnit,width:canvas[0]/pixelsPerUnit,height:canvas[1]/pixelsPerUnit};
}
export const polygonPath=points=>'M'+points.map(p=>p.join(',')).join('L')+'Z';
export function corridorFinishGeometry(kit) {
  const polygons=[],walls=[];
  for(const placement of kit.assembly.placements){
    const piece=kit.pieces.find(p=>p.id===placement.piece);if(piece.category!=='corridor')continue;
    polygons.push(piece.footprint.map(p=>placePoint(p,placement)));
    piece.footprint.forEach((a,i)=>{
      const b=piece.footprint[(i+1)%piece.footprint.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
      const at=t=>placePoint([a[0]+dx*t,a[1]+dy*t],placement);
      const holes=piece.ports.filter(p=>Math.abs(Math.hypot(p.at[0]-a[0],p.at[1]-a[1])+Math.hypot(p.at[0]-b[0],p.at[1]-b[1])-length)<1e-6).map(p=>{
        const mid=((p.at[0]-a[0])*dx+(p.at[1]-a[1])*dy)/length**2,half=kit.connectors[p.type].width/(length*2);return[mid-half,mid+half];
      }).sort((a,b)=>a[0]-b[0]);
      let start=0;
      for(const [lo,hi]of [...holes,[1,1]]){if(lo-start>1e-6)walls.push({a:at(start),b:at(lo)});start=hi;}
    });
  }
  return{polygons,walls};
}
export function doorSegments(kit) {
  const byId=new Map(kit.pieces.map(p=>[p.id,p])),doors=new Map();
  const key=p=>p.map(v=>Math.round(v*1e6)/1e6).join(',');
  const add=(a,b,id)=>{const signature=[key(a),key(b)].sort().join('/');if(!doors.has(signature))doors.set(signature,{id,a,b});};
  for(const placement of kit.assembly.placements){
    const piece=byId.get(placement.piece);
    for(const port of piece.ports.filter(p=>p.type==='room')){
      const angle=(port.facing+90)*Math.PI/180,half=kit.connectors.room.width/2;
      const ends=[-1,1].map(sign=>placePoint([port.at[0]+sign*half*Math.cos(angle),port.at[1]+sign*half*Math.sin(angle)],placement));
      add(...ends,`${placement.id}/${port.id}`);
    }
    for(const part of piece.partitions??[])if(part.door){
      const length=Math.hypot(part.b[0]-part.a[0],part.b[1]-part.a[1]);
      const ends=[-1,1].map(sign=>placePoint(part.door.at.map((v,i)=>v+sign*part.door.width/2*(part.b[i]-part.a[i])/length),placement));
      add(...ends,`${placement.id}/bathroom`);
    }
  }
  return [...doors.values()];
}
export function renderDoorLayer(doors,{closed=false}={}) {
  if(!closed)return '';
  return doors.map(({a,b,id})=>`<g data-door="${id}"><path d="M${a}L${b}" stroke="#20272d" stroke-width=".09"/><path d="M${a}L${b}" stroke="#b0b5b8" stroke-width=".055"/></g>`).join('');
}
