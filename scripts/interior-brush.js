/** Grid painting and polygon extraction. No Foundry or DOM dependencies. */
export function normalizeInteriorBrush(value, roomTypes) {
  if(value==null)return null;
  const {width,height,cells,kinds}=value;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||width>128||height>128||!Array.isArray(cells)||cells.length!==width*height)
    throw new Error("The brush map must be 8–128 squares on each side.");
  const safeKinds=Object.fromEntries(Object.entries(kinds??{}).filter(([id,kind])=>/^[a-zA-Z0-9_-]{1,40}$/.test(id)&&(kind==="corridor"||Object.hasOwn(roomTypes,kind))));
  return {width,height,kinds:safeKinds,cells:cells.map(id=>typeof id==="string"&&Object.hasOwn(safeKinds,id)?id:null)};
}
export function pointInInteriorPolygon(x,y,polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
export function rasterizeInterior(layout) {
  const width=Math.ceil(layout.width),height=Math.ceil(layout.height),cells=Array(width*height).fill(null),kinds={};
  for(const room of layout.rooms) {
    const id=room.kind==="corridor"?"corridor":room.id;kinds[id]=room.kind;
    const xs=room.polygon.map(p=>p.x),ys=room.polygon.map(p=>p.y);
    for(let y=Math.max(0,Math.floor(Math.min(...ys)));y<Math.min(height,Math.ceil(Math.max(...ys)));y++)
      for(let x=Math.max(0,Math.floor(Math.min(...xs)));x<Math.min(width,Math.ceil(Math.max(...xs)));x++)
        if(pointInInteriorPolygon(x+.5,y+.5,room.polygon)&&!(room.holes??[]).some(h=>pointInInteriorPolygon(x+.5,y+.5,h)))cells[y*width+x]=id;
  }
  return {width,height,cells,kinds};
}
/** Interpolate along a stroke so fast pointer motion cannot leave gaps. */
export function paintInteriorStroke(brush,from,to,{id=null,size=2,shape="square"}={}) {
  const steps=Math.max(Math.abs(to.x-from.x),Math.abs(to.y-from.y),1);
  size=Math.max(1,Math.min(8,Math.round(size)));
  for(let i=0;i<=steps;i++) {
    const cx=Math.round(from.x+(to.x-from.x)*i/steps),cy=Math.round(from.y+(to.y-from.y)*i/steps),offset=Math.floor((size-1)/2);
    for(let j=0;j<size;j++)for(let k=0;k<size;k++) {
      if(shape==="round"&&Math.hypot(k-(size-1)/2,j-(size-1)/2)>size/2)continue;
      const x=cx+k-offset,y=cy+j-offset;
      if(x>=1&&y>=2&&x<brush.width-1&&y<brush.height-2)brush.cells[y*brush.width+x]=id;
    }
  }
}
const key=p=>`${p.x},${p.y}`;
const area=loop=>loop.reduce((sum,p,i)=>{const q=loop[(i+1)%loop.length];return sum+p.x*q.y-q.x*p.y;},0)/2;
function outline(cells,width) {
  const edges=new Map();
  for(const index of cells) {
    const x=index%width,y=Math.floor(index/width),corners=[{x,y},{x:x+1,y},{x:x+1,y:y+1},{x,y:y+1}];
    for(let i=0;i<4;i++) {
      const a=corners[i],b=corners[(i+1)%4],forward=`${key(a)}/${key(b)}`,reverse=`${key(b)}/${key(a)}`;
      if(edges.has(reverse))edges.delete(reverse);else edges.set(forward,{a,b,dir:i});
    }
  }
  const starts=new Map();for(const edge of edges.values()){const k=key(edge.a);if(!starts.has(k))starts.set(k,[]);starts.get(k).push(edge);}
  const unused=new Set(edges.values()),loops=[];
  while(unused.size) {
    const first=unused.values().next().value,loop=[];let edge=first;
    do {
      loop.push(edge.a);unused.delete(edge);
      if(key(edge.b)===key(first.a))break;
      const next=(starts.get(key(edge.b))??[]).filter(e=>unused.has(e));
      // Turn right at a corner where a cutout touches another boundary.
      next.sort((a,b)=>[1,0,3,2].indexOf((a.dir-edge.dir+4)%4)-[1,0,3,2].indexOf((b.dir-edge.dir+4)%4));
      edge=next[0];if(!edge)throw new Error("The painted boundary could not be closed.");
    }while(unused.size);
    const simplified=loop.filter((p,i)=>{const a=loop[(i+loop.length-1)%loop.length],b=loop[(i+1)%loop.length];return (p.x-a.x)*(b.y-p.y)!==(p.y-a.y)*(b.x-p.x);});
    loops.push(simplified);
  }
  loops.sort((a,b)=>Math.abs(area(b))-Math.abs(area(a)));
  return {polygon:loops[0],holes:loops.slice(1)};
}
/** Largest fully occupied rectangle keeps furniture and labels out of concave walls and cutouts. */
function frameFor(cells,width,height) {
  const occupied=new Set(cells),heights=Array(width).fill(0);let best={x:0,y:0,w:1,h:1},bestArea=0;
  for(let y=0;y<height;y++) {
    for(let x=0;x<width;x++)heights[x]=occupied.has(y*width+x)?heights[x]+1:0;
    const stack=[];
    for(let x=0;x<=width;x++) {
      const h=x===width?0:heights[x];let start=x;
      while(stack.length&&stack.at(-1).h>h) {
        const prev=stack.pop(),w=x-prev.start;start=prev.start;
        if(w*prev.h>bestArea){bestArea=w*prev.h;best={x:prev.start+w/2,y:y+1-prev.h/2,w,h:prev.h};}
      }
      if(h&&(!stack.length||stack.at(-1).h<h))stack.push({start,h});
    }
  }
  return {...best,w:Math.max(.5,best.w-.3),h:Math.max(.5,best.h-.3),rotation:0};
}
export function interiorBrushRooms(brush,roomTypes) {
  const {width,height,cells,kinds}=brush,seen=new Set(),rooms=[];
  for(let start=0;start<cells.length;start++) {
    if(!cells[start]||seen.has(start))continue;
    const id=cells[start],component=[],queue=[start];seen.add(start);
    while(queue.length) {
      const i=queue.pop();component.push(i);const x=i%width,y=Math.floor(i/width);
      for(const next of [x>0?i-1:-1,x<width-1?i+1:-1,y>0?i-width:-1,y<height-1?i+width:-1])
        if(next>=0&&cells[next]===id&&!seen.has(next)){seen.add(next);queue.push(next);}
    }
    const kind=kinds[id];
    rooms.push({id:`paint-${rooms.length+1}`,kind,name:roomTypes[kind]??"Passageway",...outline(component,width),frame:frameFor(component,width,height),
      // Local lights cover bends as well as the largest furnishing rectangle.
      lightPoints:component.filter(i=>(i%width)%4===0&&Math.floor(i/width)%4===0).map(i=>({x:i%width+.5,y:Math.floor(i/width)+.5}))});
  }
  return rooms;
}
