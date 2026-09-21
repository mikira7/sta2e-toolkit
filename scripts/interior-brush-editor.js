import { rasterizeInterior, paintInteriorStroke } from "./interior-brush.js";
import { INTERIOR_ROOM_TYPES } from "./interior-layout.js";

export const interiorBrushControls=`<details class="interior-brush-tools"><summary>Layout brush</summary>
  <p class="interior-help">Paint rooms, passageways, or empty space. Brushing converts the deck to square cells; the generated radial mode retains smooth curves. A stroke starting inside a matching room extends it. Start in empty space to make a separate room.</p>
  <div class="interior-row"><button type="button" data-brush-toggle>Brush this layout</button><button type="button" data-brush-blank>Blank deck</button></div>
  <label class="interior-field"><span>Paint</span><select data-brush-kind><option value="corridor">Passageway</option><option value="jefferies">Jefferies tube</option>${Object.entries(INTERIOR_ROOM_TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}<option value="erase">Erase floor</option></select></label>
  <div class="interior-row"><label class="interior-field"><span>Brush size</span><select data-brush-size><option value="1">1 square</option><option value="2" selected>2 squares</option><option value="4">4 squares</option><option value="8">8 squares</option></select></label>
    <label class="interior-field"><span>Brush shape</span><select data-brush-shape><option value="square">Square</option><option value="round">Round</option></select></label></div>
  <div class="interior-row"><button type="button" data-brush-undo disabled>Undo stroke</button><button type="button" data-brush-reset>Return to generated layout</button></div>
  <p class="interior-help" data-brush-status aria-live="polite">Passageways need two squares of contact with each room for a sliding door.</p>
</details>`;

/** Paint locally in the dialog; only Create Scene persists the recipe. */
export function bindInteriorBrushEditor(root,{initial=null,getLayout,onChange}) {
  let brush=initial?structuredClone(initial):null,editing=false,stroke=null,serial=0;
  // DialogV2 sanitizes canvas tags out of string content; create the drawing surface at render time.
  const history=[],canvas=document.createElement("canvas"),preview=root.querySelector(".interior-preview");
  canvas.dataset.brushCanvas="";canvas.setAttribute("aria-label","Paint interior layout");canvas.hidden=true;
  root.querySelector(".interior-map-area").prepend(canvas);
  const context=canvas.getContext("2d");
  const field=key=>root.querySelector(`[data-brush-${key}]`),colors=["#8b7785","#8a805f","#657f8f","#6d8d81","#817396","#927663"];
  const remember=()=>{history.push(brush?structuredClone(brush):null);if(history.length>40)history.shift();};
  const draw=()=>{
    canvas.hidden=!editing;preview.hidden=editing;
    field("toggle").textContent=editing?"Show artwork":brush?"Edit painted layout":"Brush this layout";
    field("undo").disabled=!history.length;
    root.querySelector("[data-zoom]").disabled=editing;
    root.querySelectorAll("[data-room-all],[data-room-clear]").forEach(el=>el.disabled=!!brush);
    for(const name of ["plan","size","purpose","seed","chooseRooms","curved"]){const el=root.querySelector(`[name="${name}"]`);if(el)el.disabled=!!brush;}
    root.querySelector("[data-reroll]").disabled=!!brush;
    if(!editing||!brush)return;
    const unit=20;canvas.width=brush.width*unit;canvas.height=brush.height*unit;
    context.fillStyle="#10171e";context.fillRect(0,0,canvas.width,canvas.height);
    const ids=Object.keys(brush.kinds);
    for(let y=0;y<brush.height;y++)for(let x=0;x<brush.width;x++) {
      const id=brush.cells[y*brush.width+x];if(!id)continue;
      context.fillStyle=brush.kinds[id]==="corridor"?"#b6bcbf":colors[ids.indexOf(id)%colors.length];context.fillRect(x*unit,y*unit,unit,unit);
      context.strokeStyle="#10171e";context.lineWidth=2;
      for(const [nx,ny,ax,ay,bx,by] of [[x-1,y,x,y,x,y+1],[x+1,y,x+1,y,x+1,y+1],[x,y-1,x,y,x+1,y],[x,y+1,x,y+1,x+1,y+1]]) {
        const other=nx<0||ny<0||nx>=brush.width||ny>=brush.height?null:brush.cells[ny*brush.width+nx];
        if(other!==id){context.beginPath();context.moveTo(ax*unit,ay*unit);context.lineTo(bx*unit,by*unit);context.stroke();}
      }
    }
    context.strokeStyle="#cedce522";context.lineWidth=1;context.beginPath();
    for(let x=0;x<=brush.width;x++){context.moveTo(x*unit,0);context.lineTo(x*unit,canvas.height);}
    for(let y=0;y<=brush.height;y++){context.moveTo(0,y*unit);context.lineTo(canvas.width,y*unit);}context.stroke();
    field("status").textContent=`Painting ${brush.width} × ${brush.height} squares. Light gray is passageway. Switch to Show artwork to inspect furnishings and doors.`;
  };
  const changed=()=>{draw();onChange();};
  field("toggle").addEventListener("click",()=>{
    if(!brush){remember();brush=rasterizeInterior(getLayout());}editing=!editing;changed();
  });
  field("blank").addEventListener("click",()=>{
    const layout=getLayout();remember();brush={width:Math.ceil(layout.width),height:Math.ceil(layout.height),cells:Array(Math.ceil(layout.width)*Math.ceil(layout.height)).fill(null),kinds:{corridor:"corridor"}};editing=true;changed();
  });
  field("reset").addEventListener("click",()=>{remember();brush=null;editing=false;changed();});
  field("undo").addEventListener("click",()=>{if(!history.length)return;brush=history.pop();if(!brush)editing=false;changed();});
  const position=event=>{
    const box=canvas.getBoundingClientRect(),scale=Math.min(box.width/brush.width,box.height/brush.height);
    return {x:Math.floor((event.clientX-box.left-(box.width-brush.width*scale)/2)/scale),y:Math.floor((event.clientY-box.top-(box.height-brush.height*scale)/2)/scale)};
  };
  const paint=pos=>{paintInteriorStroke(brush,stroke.last,pos,stroke);stroke.last=pos;draw();};
  canvas.addEventListener("pointerdown",event=>{
    if(!editing||!brush||event.button!==0)return;
    const pos=position(event);if(pos.x<0||pos.y<0||pos.x>=brush.width||pos.y>=brush.height)return;
    event.preventDefault();remember();const kind=field("kind").value,current=brush.cells[pos.y*brush.width+pos.x];let id=null;
    if(kind!=="erase") {
      id=kind==="corridor"?"corridor":brush.kinds[current]===kind?current:null;
      if(!id){do{id=`stroke-${++serial}`;}while(Object.hasOwn(brush.kinds,id));}brush.kinds[id]=kind;
    }
    stroke={last:pos,id,size:Number(field("size").value),shape:field("shape").value};canvas.setPointerCapture(event.pointerId);paint(pos);
  });
  canvas.addEventListener("pointermove",event=>{if(stroke)paint(position(event));});
  const finish=()=>{if(!stroke)return;stroke=null;changed();};
  canvas.addEventListener("pointerup",finish);canvas.addEventListener("pointercancel",finish);canvas.addEventListener("lostpointercapture",finish);
  draw();
  return {getBrush:()=>brush,setBrush:value=>{brush=value?structuredClone(value):null;history.length=0;editing=false;draw();},refresh:draw};
}
