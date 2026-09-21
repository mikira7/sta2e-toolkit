/** Resolution-independent deck artwork. No remote assets, fonts, or image services. */
import { interiorStyle, interiorWallSegments, interiorSeedHash } from "./interior-layout.js";
import { loadInteriorAssets, interiorAssetPaths, INTERIOR_ASSET_LIBRARY } from "./interior-assets.js";
import { interiorRoomKitPlacement } from "./interior-kit.js";
export const escapeInteriorText = text => String(text).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const n = x => Number(x.toFixed(3));
const path = points => `M${points.map(p=>`${n(p.x)},${n(p.y)}`).join("L")}Z`;
const roomPath=room=>[room.polygon,...(room.holes??[])].map(path).join("");

/** A printable, top-down battle map; doors are clear thresholds so opening one never leaves a painted leaf. */
export function renderInteriorSVG(layout, { labels = layout.recipe.labels, assets={} } = {}) {
  const { recipe, rooms, width, height } = layout, p=interiorStyle(recipe), out=[];
  const rect=(x,y,w,h,fill,rx=.08,extra="")=>`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${rx}" fill="${fill}" ${extra}/>`;
  const line=(x,y,x2,y2,color,sw=.04,extra="")=>`<path d="M${n(x)},${n(y)}L${n(x2)},${n(y2)}" stroke="${color}" stroke-width="${sw}" fill="none" ${extra}/>`;
  const ellipse=(x,y,rx,ry,fill,extra="")=>`<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}" ${extra}/>`;
  const selectedPaths=interiorAssetPaths(recipe);
  const assetProfiles=Object.fromEntries(Object.entries(INTERIOR_ASSET_LIBRARY).map(([key,list])=>[key,list.find(item=>item.path===selectedPaths[key])]));
  const asset=(key,x,y,w,h)=>{
    const profile=assetProfiles[key];
    // Preserve each room-derived sprite's proportions within its allotted furnishing space.
    // Floors and room/corridor kit images retain their established placement behavior.
    if(profile?.aspect) {
      const fw=Math.min(w,h*profile.aspect),fh=fw/profile.aspect;
      x+=(w-fw)/2;y+=(h-fh)/2;w=fw;h=fh;
    }
    const rotation=profile?.rotation?` rotate(${profile.rotation} ${n(x+w/2)} ${n(y+h/2)})`:"";
    return `<use href="#asset-${key}" transform="${rotation} translate(${n(x)} ${n(y)}) scale(${n(w)} ${n(h)})"/>`;
  };
  const screen=(x,y,w,h)=>{
    let s=rect(x,y,w,h,"#101b26",.04);
    if(p.interface==="lcars") {
      s+=rect(x+.035,y+.04,w*.2,h-.08,p.accent,.05);
      for(let i=0;i<3;i++) s+=rect(x+w*.3,y+.04+i*(h-.08)/3,w*(i===1?.6:.43),(h-.12)/5,i===1?p.screen:p.accent,.015);
    } else if(p.interface==="buttons") {
      for(let i=0;i<6;i++) s+=rect(x+.04+i*(w-.08)/6,y+h*.28,(w-.1)/9,h*.38,[p.screen,p.accent,"#f5dc90"][i%3],.015);
    } else {
      s+=line(x+w*.1,y+h*.7,x+w*.3,y+h*.25,p.screen,.025)+line(x+w*.3,y+h*.25,x+w*.6,y+h*.6,p.screen,.025);
      for(let i=0;i<3;i++) s+=rect(x+w*.7,y+h*(.15+i*.25),w*.2,h*.12,p.accent,.01);
    }
    return s;
  };
  const chair=(x,y,rotation=0)=>assets.chair?`<g transform="translate(${n(x)} ${n(y)}) rotate(${rotation+180})">${asset("chair",-.35,-.36,.7,.72)}</g>`:`<g transform="translate(${n(x)} ${n(y)}) rotate(${rotation})">${ellipse(.04,.06,.3,.34,"#000",'opacity=".35"')}${rect(-.25,-.23,.5,.52,p.metal,.12,'stroke="#161a20" stroke-width=".035"')}${rect(-.27,.1,.54,.16,p.panel,.07)}${line(-.23,-.15,-.23,.15,p.panel,.07)}${line(.23,-.15,.23,.15,p.panel,.07)}</g>`;
  const console=(x,y,w=1.7)=>assets.console?asset("console",x,y,w,.72):rect(x+.06,y+.1,w,.72,"#080b12",.1,'opacity=".45"')+rect(x,y,w,.65,p.panel,.09,'stroke="#111b23" stroke-width=".05"')+screen(x+.09,y+.08,w-.18,.38)+line(x+.13,y+.53,x+w-.13,y+.53,p.metal,.045);
  const bed=(x,y)=>assets.bed?asset("bed",x,y,.9,1.7):rect(x+.07,y+.1,.88,1.65,"#111923",.16)+rect(x,y,.85,1.6,p.panel,.16,'stroke="#26323a" stroke-width=".04"')+rect(x+.07,y+.12,.71,1.16,recipe.faction==="federation"?"#71a7ad":p.floor,.13)+rect(x+.12,y+.16,.61,.3,"#d1d5cb",.1)+screen(x+.12,y+1.35,.6,.15);
  const biobed=(x,y)=>assets.biobed?asset("biobed",x,y,1.1,1.85):rect(x,y,1.1,1.85,p.panel,.2)+rect(x+.15,y+.1,.8,1.65,"#719aab",.18)+screen(x+.02,y+.1,.12,.5);
  const plant=(x,y)=>assets.plant?asset("plant",x,y,.65,.65):ellipse(x+.325,y+.325,.3,.3,"#467b50");
  const couch=(x,y,w=2.1)=>assets.couch?asset("couch",x,y,w,.95):rect(x,y,w,.9,p.panel,.15)+rect(x+.15,y+.2,w-.3,.6,p.floor,.1);
  const coffee=(x,y)=>assets["coffee-table"]?asset("coffee-table",x,y,1.2,.7):ellipse(x+.6,y+.35,.6,.35,p.metal,`stroke="${p.panel}" stroke-width=".04"`);
  const desk=(x,y)=>assets.desk?asset("desk",x,y,1.8,.95):rect(x,y,1.8,.95,p.panel,.2)+screen(x+.12,y+.1,.5,.3);
  const crate=(x,y,w=.9)=>assets.crate?asset("crate",x,y,w,w):rect(x+.07,y+.09,w,w,"#080b12",.05,'opacity=".5"')+rect(x,y,w,w,"url(#metal)",.06,`stroke="${p.panel}" stroke-width=".045"`)+rect(x+.12,y+.12,w-.24,w-.24,p.metal,.03)+line(x+.16,y+.16,x+w-.16,y+w-.16,p.panel,.035)+line(x+w-.16,y+.16,x+.16,y+w-.16,p.panel,.035);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width*recipe.gridSize)}" height="${Math.round(height*recipe.gridSize)}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeInteriorText(p.label)} interior deck map"><defs>
    ${Object.entries(assets).filter(([,src])=>src).map(([key,src])=>`<image id="asset-${escapeInteriorText(key)}" href="${escapeInteriorText(src)}" width="1" height="1" preserveAspectRatio="none"/>`).join("")}
    ${assets.floor?`<pattern id="image-floor" width="2" height="2" patternUnits="userSpaceOnUse">${asset("floor",0,0,2,2)}</pattern>`:""}
    ${assets.corridor?`<pattern id="image-corridor" width="1" height="1" patternUnits="userSpaceOnUse">${asset("corridor",0,0,1,1)}</pattern>`:""}
    <linearGradient id="floor" x2=".8" y2="1"><stop stop-color="${p.floor}"/><stop offset="1" stop-color="${p.metal}"/></linearGradient>
    <linearGradient id="metal" x2=".3" y2="1"><stop stop-color="${p.panel}"/><stop offset=".35" stop-color="${p.metal}"/><stop offset="1" stop-color="${p.floor}"/></linearGradient>
    <radialGradient id="reactor"><stop stop-color="#e7fbff"/><stop offset=".3" stop-color="${p.screen}"/><stop offset=".7" stop-color="${p.metal}"/><stop offset="1" stop-color="#101a23"/></radialGradient>
    <linearGradient id="kit-fade-x"><stop stop-color="black"/><stop offset=".06" stop-color="white"/><stop offset=".94" stop-color="white"/><stop offset="1" stop-color="black"/></linearGradient>
    <linearGradient id="kit-fade-y" x2="0" y2="1"><stop stop-color="black"/><stop offset=".06" stop-color="white"/><stop offset=".94" stop-color="white"/><stop offset="1" stop-color="black"/></linearGradient>
    <mask id="kit-mask-x" maskContentUnits="objectBoundingBox" x="0" y="0" width="1" height="1"><rect width="1" height="1" fill="url(#kit-fade-x)"/></mask>
    <mask id="kit-mask-y" maskContentUnits="objectBoundingBox" x="0" y="0" width="1" height="1"><rect width="1" height="1" fill="url(#kit-fade-y)"/></mask>
    <pattern id="plates" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M0 1V0H1" fill="none" stroke="#d6e3e8" stroke-opacity=".065" stroke-width=".012"/><path d="M.06 .06H.16M.06 .06V.16" stroke="#000" stroke-opacity=".13" stroke-width=".018"/></pattern>
    <pattern id="grate" width=".18" height=".18" patternUnits="userSpaceOnUse"><path d="M0 0L.18 .18M0 .18L.18 0" stroke="#0d151b" stroke-opacity=".6" stroke-width=".035"/></pattern>
    <pattern id="carpet" width=".075" height=".075" patternUnits="userSpaceOnUse"><path d="M0 0H.075" stroke="#c5c1c9" stroke-opacity=".07" stroke-width=".02"/></pattern>
    ${rooms.map(r=>`<clipPath id="clip-${r.id}"><path d="${roomPath(r)}" clip-rule="evenodd"/></clipPath>`).join("")}
  </defs>${rect(0,0,width,height,"#10171e",0)}`);
  if(layout.structure)out.push(`<path d="${path(layout.structure)}" fill="#222a30" stroke="#131b22" stroke-width=".2"/>`);
  for(const r of rooms) {
    const d=roomPath(r), f=r.frame, isHall=r.kind==="corridor",isService=r.kind==="jefferies";
    const kit=interiorRoomKitPlacement(r,recipe),hasKit=kit&&assets[kit.key];
    out.push(`<path d="${d}" fill="${isService?"#242e35":hasKit?kit.floor:"url(#floor)"}" fill-rule="evenodd"/>`);
    out.push(`<g clip-path="url(#clip-${r.id})"><path d="${d}" fill="url(#plates)"/>`);
    if(isHall&&assets.corridor)out.push(`<path d="${d}" fill="url(#image-corridor)"/>`);
    else if(assets.floor&&!hasKit&&!isService)out.push(`<path d="${d}" fill="url(#image-floor)" opacity=".7"/>`);
    if(p.industrial) out.push(`<path d="${d}" fill="url(#grate)" opacity=".35"/>`);
    else out.push(`<path d="${d}" fill="url(#carpet)"/>`);
    if(isService) {
      if(r.centerline)out.push(`<path d="M${r.centerline.map(v=>`${n(v.x)},${n(v.y)}`).join("L")}" fill="none" stroke="#849198" stroke-width=".72" stroke-dasharray=".08 .22"/>`);
    } else if(hasKit) {
      out.push(`<g data-room-kit="${kit.key}" transform="translate(${n(f.x)} ${n(f.y)}) rotate(${n(f.rotation)})"><g mask="url(#kit-mask-x)"><g mask="url(#kit-mask-y)">${asset(kit.key,kit.x,kit.y,kit.w,kit.h)}</g></g></g>`);
    } else if(isHall) {
      if(r.guidePaths) {
        for(const guide of r.guidePaths) {
          const rail=`M${guide.map(v=>`${n(v.x)},${n(v.y)}`).join("L")}`;
          out.push(`<path d="${rail}" fill="none" stroke="${p.metal}" stroke-width=".2" stroke-linejoin="round"/><path d="${rail}" fill="none" stroke="${p.panel}" stroke-width=".07" stroke-linejoin="round"/><path d="${rail}" fill="none" stroke="${p.light}" stroke-width=".025" stroke-dasharray=".55 1.2"/>`);
        }
      } else if(assets["kit-corridor-straight"]) {
        const horizontal=f.w>f.h, length=Math.max(f.w,f.h), breadth=Math.min(f.w,f.h)+(layout.plan==="ring"?.7:recipe.brush?.3:0);
        out.push(`<g transform="translate(${n(f.x)} ${n(f.y)}) rotate(${n(f.rotation+(horizontal?90:0))})">`);
        const tileLength=breadth*3;
        for(let y=-length/2-.5;y<length/2+.5;y+=tileLength)out.push(asset("kit-corridor-straight",-breadth/2,y,breadth,tileLength));
        // Broad access hubs and brush intersections receive an open junction floor panel.
        if(Math.min(f.w,f.h)>2.8&&assets["kit-corridor-junction"])out.push(asset("kit-corridor-junction",-breadth/2,-breadth/2,breadth,breadth));
        out.push("</g>");
      }
      // Deck ribs and directional floor markings run down the circulation axis.
      out.push(`<g transform="translate(${n(f.x)} ${n(f.y)}) rotate(${n(f.rotation)})">`);
      if(!r.guidePaths&&f.w<3) for(let y=-f.h/2+.6;y<f.h/2;y+=2) out.push(line(-f.w/2+.2,y,f.w/2-.2,y,p.panel,.07,'opacity=".3"'));
      if(!r.guidePaths&&f.h<3) for(let x=-f.w/2+.6;x<f.w/2;x+=2) out.push(line(x,-f.h/2+.2,x,f.h/2-.2,p.panel,.07,'opacity=".3"'));
      out.push(`<path d="M-.18 .2L0 0L.18 .2M-.18 .35L0 .15L.18 .35" stroke="${p.light}" stroke-width=".045" fill="none" opacity=".65"/></g>`);
    } else {
      const quarters=r.architecture?.type==="quarters"?r.architecture:null;
      const w=quarters?.w??Math.max(4,f.w-.9), h=quarters?.h??Math.max(4,f.h-.9), left=-w/2, top=-h/2, fit=quarters?1:Math.min(1,(f.w-.2)/w,(f.h-.2)/h);
      out.push(`<g transform="translate(${n(f.x)} ${n(f.y)}) rotate(${n(f.rotation)}) scale(${n(Math.max(.05,fit))})">`);
      // A frame fits entirely inside its compartment; keep the bottom approach clear.
      if(layout.plan!=="section")out.push(rect(left,top,w,h,"none",recipe.faction==="borg"?0:.25,`stroke="${p.panel}" stroke-width=".025" opacity=".3"`));
      if(["bridge","ops"].includes(r.kind)&&recipe.faction==="borg") {
        out.push(rect(-1,-1,2,2,p.metal,0,`stroke="${p.panel}" stroke-width=".12"`),rect(-.65,-.65,1.3,1.3,"url(#grate)",0));
        for(const side of [-1,1])out.push(line(side,0,side*w/2,0,p.panel,.15),line(0,side,0,side*h/2,p.panel,.15));
        out.push(screen(-.7,-.5,1.4,.6),console(left+.2,top+.2,Math.min(2,w-.4)));
      } else if(["bridge","ops"].includes(r.kind)) {
        out.push(rect(left+.3,top+.18,w-.6,.2,"#0d1b26",.06),line(left+.4,top+.23,-left-.4,top+.23,p.screen,.05));
        const cw=Math.min(2.3,(w-1)/2);
        out.push(console(-cw-.15,top+.75,cw),console(.15,top+.75,cw),chair(-cw/2,top+1.7),chair(cw/2,top+1.7));
        out.push(ellipse(0,.45,Math.min(1.5,w*.27),1.2,p.metal,`stroke="${p.panel}" stroke-width=".045"`),chair(0,.45));
        if(w>6) out.push(`<g transform="translate(${n(left+.35)} -.7) rotate(-90)">${console(-1,0,2)}</g><g transform="translate(${n(-left-.35)} -.7) rotate(90)">${console(-1,0,2)}</g>`);
      } else if(["engineering","reactor"].includes(r.kind)) {
        const radius=Math.min(1.3,w*.22,h*.22);
        out.push(rect(-radius-.4,top+.3,(radius+.4)*2,h-1,"url(#grate)",.1));
        out.push(line(-radius-.8,-.2,radius+.8,-.2,p.panel,.25),line(0,top+.3,0,-top-.7,p.panel,.22));
        out.push(ellipse(0,-.2,radius+.18,radius+.18,p.metal,`stroke="${p.accent}" stroke-width=".06"`),ellipse(0,-.2,radius,radius,"url(#reactor)"));
        for(let i=0;i<8;i++) { const a=i/8*Math.PI*2; out.push(line(Math.cos(a)*radius*.4,Math.sin(a)*radius*.4-.2,Math.cos(a)*radius*.8,Math.sin(a)*radius*.8-.2,p.panel,.07)); }
        if(assets.core)out.push(asset("core",-radius-.2,-radius-.4,(radius+.2)*2,(radius+.2)*2));
        // Paired power transfer trunks and clear service paths flank the reaction chamber.
        for(const side of [-1,1])out.push(line(side*(radius+.55),top+.35,side*(radius+.55),-top-.55,p.metal,.22),line(side*(radius+.55),top+.35,side*(radius+.55),-top-.55,p.screen,.04));
        if(w>4) out.push(console(left+.2,top+.3,1.4),console(-left-1.6,top+.3,1.4));
      } else if(r.kind==="transporter") {
        const pad=r.architecture?.pad??{x:0,y:-.35,r:Math.min(1.65,w*.35,h*.35)},radius=pad.r;
        out.push(ellipse(pad.x,pad.y,radius,radius,p.metal,`stroke="${p.panel}" stroke-width=".1"`));
        for(let i=0;i<6;i++) {const a=i/6*Math.PI*2; out.push(ellipse(pad.x+Math.cos(a)*radius*.62,pad.y+Math.sin(a)*radius*.62,.2,.2,p.panel),ellipse(pad.x+Math.cos(a)*radius*.62,pad.y+Math.sin(a)*radius*.62,.14,.14,p.screen,'opacity=".6"'));}
        if(r.architecture)out.push(`<g transform="translate(${n(-left-.3)} ${n(top+1.3)}) rotate(90)">${console(-.9,0,1.8)}</g>`,chair(-left-1.45,top+1.3,90));
        else out.push(console(left+.1,top+.15,Math.min(1.7,w-.2)));
      } else if(r.kind==="medical") {
        const rows=Math.max(1,Math.min(2,Math.floor((h-.7)/2.3)));
        for(let i=0;i<rows;i++)out.push(biobed(left+.2,top+.3+i*2.3),biobed(-left-1.3,top+.3+i*2.3));
        out.push(console(-left-1.6,-top-.8,1.4));
      } else if(r.kind==="quarters") {
        if(quarters) {
          const b=quarters.bathroom;
          out.push(`<g data-bathroom="${r.id}" data-bathroom-style="${b.tub?"suite":"standard"}"><path d="${path(b.polygon)}" fill="#637b80"/>`);
          for(const fixture of b.fixtures) {
            const {x,y,w,h,kind}=fixture;
            out.push(`<g data-fixture="${kind}">`);
            if(kind==="shower")out.push(rect(x,y,w,h,p.panel,.12),rect(x+.08,y+.08,w-.16,h-.16,p.metal,.1),line(x+.15,y+h-.12,x+w-.15,y+h-.12,p.screen,.04),ellipse(x+w/2,y+h/2,.09,.09,"#849ea3"));
            if(kind==="sink")out.push(rect(x,y,w,h,p.panel,.08),ellipse(x+w/2,y+h*.56,w*.32,h*.28,p.metal),line(x+w*.5,y+.05,x+w*.5,y+.15,p.screen,.04));
            if(kind==="toilet")out.push(rect(x+.04,y,w-.08,h*.3,p.panel,.06),ellipse(x+w/2,y+h*.6,w*.48,h*.4,p.panel),ellipse(x+w/2,y+h*.6,w*.27,h*.24,p.metal));
            if(kind==="tub")out.push(rect(x,y,w,h,p.panel,.23),rect(x+.12,y+.1,w-.24,h-.2,"#3c565e",.21),ellipse(x+w-.28,y+h/2,.05,.05,p.metal),line(x+.13,y+h*.33,x+.13,y+h*.67,p.screen,.05));
            out.push("</g>");
          }
          out.push("</g>");
          out.push(`<g data-living-area="${r.id}">`);
          for(const item of quarters.furniture) {
            if(item.kind==="bed")out.push(bed(item.x,item.y));
            if(item.kind==="desk")out.push(desk(item.x,item.y),chair(item.x+.9,item.y+1.4));
            if(item.kind==="couch")out.push(couch(item.x,item.y,item.w));
            if(item.kind==="coffee")out.push(coffee(item.x,item.y));
          }
          out.push("</g>");
        } else {
          out.push(bed(left+.2,top+.25));
          out.push(console(left+.2,Math.max(.4,top+2.2),Math.min(w-.4,1.7)));
          if(w>3)out.push(desk(-left-2,top+.25),chair(-left-1.1,top+1.7));
          if(h>5)out.push(couch(-left-2.3,.5),coffee(-left-1.8,1.7),plant(left+.2,-top-.9));
        }
      } else if(r.kind==="office" || r.kind==="lounge") {
        out.push(couch(left+.3,top+.35),coffee(left+.7,top+1.65));
        if(r.kind==="office"||w<=5)out.push(plant(-left-.85,top+.25));
        if(r.kind==="office")out.push(desk(-.2,Math.max(.3,top+2.7)),chair(.7,Math.max(-.35,top+2.1),180));
        else if(w>5)out.push(`<g transform="translate(${n(-left-.2)} ${n(top+1.3)}) rotate(180)">${couch(0,0)}</g>`,coffee(-left-1.85,top+1.65));
        if(h>5)out.push(console(left+.25,-top-.9,1.7),plant(-left-.9,-top-.9));
      } else if(r.kind==="briefing") {
        const tw=Math.min(2.4,w-.7), th=Math.min(1.2,h*.27);
        if(assets.table)out.push(asset("table",-tw/2,-th/2,tw,th));
        else out.push(rect(-tw/2+.06,-th/2+.09,tw,th,"#080e18",.35),rect(-tw/2,-th/2,tw,th,p.panel,.35),rect(-tw/2+.08,-th/2+.08,tw-.16,th-.16,p.floor,.3));
        for(const x of [-tw/3,tw/3]) out.push(chair(x,-th/2-.5,180),chair(x,th/2+.5));
        out.push(console(left+.15,top+.15,Math.min(2,w-.3)));
      } else if(r.kind==="lift") {
        const radius=Math.min(w,h)*.38;
        out.push(ellipse(0,-.15,radius,radius,p.metal),ellipse(0,-.15,radius-.18,radius-.18,p.floor));
        // Open-front circular cabin: curved handrail and control strips, no painted door leaf.
        out.push(`<path d="M${n(-radius*.55)} ${n(-.15+radius*.835)}A${n(radius)} ${n(radius)} 0 1 1 ${n(radius*.55)} ${n(-.15+radius*.835)}" fill="none" stroke="${p.panel}" stroke-width=".13"/>`);
        out.push(line(-radius*.8,-.2,-radius*.8,.35,p.light,.06),screen(radius*.58,-.35,.2,.6));
      } else if(r.kind==="airlock") {
        out.push(rect(left+.25,top+.25,w-.5,Math.min(h-1,2),p.metal,.3,`stroke="${p.panel}" stroke-width=".1"`));
        out.push(line(left+.45,top+.55,-left-.45,top+.55,p.light,.06));
        out.push(`<path d="M-.35 -.1L0 -.4L.35 -.1M-.35 .2L0 .5L.35 .2" fill="none" stroke="${p.panel}" stroke-width=".1"/>`);
      } else if(["regeneration","assimilation"].includes(r.kind)) {
        for(let x=left+.15;x< -left-.8;x+=1.1) {
          out.push(rect(x,top+.15,.85,1.55,"#131c18",0,`stroke="${p.panel}" stroke-width=".08"`),ellipse(x+.42,top+.6,.25,.3,p.metal),line(x+.1,top+.3,x+.1,top+1.45,p.screen,.04));
        }
        out.push(line(left+.2,.6,-left-.2,.6,p.metal,.17),console(left+.2,1,Math.min(1.8,w-.4)));
      } else if(["cargo","workshop"].includes(r.kind)) {
        if(r.architecture) {
          for(const x of [left+.25,-left-1.25]) {
            out.push(rect(x-.1,top+.2,1.15,h-1.4,p.metal,.04,`stroke="${p.panel}" stroke-width=".045"`));
            for(let y=top+.35;y<-top-1.6;y+=1.15)out.push(crate(x,y,.85));
          }
          out.push(console(-left-1.8,-top-.95,1.5));
        } else {
          for(let x=left+.2;x<-.3;x+=1.15) for(let y=top+.3;y<Math.min(1,-top-1);y+=1.2) out.push(crate(x,y));
          out.push(console(Math.max(.35,left+.2),top+.2,Math.min(1.7,w/2-.5)));
        }
      } else {
        out.push(console(left+.2,top+.2,Math.min(2.4,w-.4)),chair(0,top+1.25));
        if(w>3.7) out.push(console(-left-1.6,.25,1.4));
        if(r.kind==="security") out.push(rect(left+.2,.2,1.2,1.4,p.metal,.06,`stroke="${p.screen}" stroke-width=".04"`));
      }
      // Faction-specific structure: Cardassian braces, Klingon ribs, Borg service pipes.
      if(["cardassian","klingon"].includes(recipe.faction)) {
        for(const side of [-1,1]) out.push(`<path d="M${n(side*w/2)} ${n(top)}L${n(side*(w/2-.35))} ${n(top+.4)}V${n(-top-.3)}" stroke="${p.panel}" stroke-width=".13" fill="none"/>`);
      }
      if(recipe.faction==="borg" || recipe.era==="ent") for(let i=0;i<3;i++) out.push(line(left+.08+i*.08,top+.15,left+.08+i*.08,-top-.15,i===1?p.accent:p.panel,.035));
      out.push("</g>");
    }
    out.push("</g>");
  }
  const wallSegments=interiorWallSegments(layout);
  for(const [color,weight]of [["#060b12",.58],[p.metal,.46]])for(const {a,b,hull}of wallSegments)
    if(hull)out.push(line(a.x,a.y,b.x,b.y,color,weight,'stroke-linecap="round"'));
  // Draw complete wall layers in passes so sampled curves do not acquire dark seams at every segment.
  for(const [color,weight]of [["#060b12",.32],[p.metal,.2],[p.panel,.085]])for(const {a,b,door}of wallSegments)
    if(!door)out.push(line(a.x,a.y,b.x,b.y,color,weight,'stroke-linecap="round"'));
  for(const wall of wallSegments) {
    const {a,b,door,window,hatch}=wall;
    if(window) {
      const angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI,length=Math.hypot(b.x-a.x,b.y-a.y);
      out.push(`<g data-hull-window="true" transform="translate(${n(a.x)} ${n(a.y)}) rotate(${n(angle)})">${rect(0,-.17,length,.34,p.metal,.03)}${rect(.03,-.08,length-.06,.16,"#163345",.03)}${line(.04,-.07,length-.04,-.07,"#a5d8ed",.035)}${assets.window?asset("window",-.04,-.45,length+.08,.9):""}</g>`);
    }
    if(door) {
      const angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI, length=Math.hypot(b.x-a.x,b.y-a.y);
      out.push(`<g transform="translate(${n(a.x)} ${n(a.y)}) rotate(${n(angle)})">${rect(0,-.12,length,.24,p.metal,.015)}${line(0,-.16,length,-.16,p.panel,.035)}${line(0,.16,length,.16,p.panel,.035)}${rect(-.06,-.21,.12,.42,p.light,.025)}${rect(length-.06,-.21,.12,.42,p.light,.025)}</g>`);
      if(hatch)out.push(`<g data-service-hatch="true" transform="translate(${n(a.x)} ${n(a.y)}) rotate(${n(angle)})">${rect(-.08,-.2,.13,.4,"#e4aa56",.02)}${rect(length-.05,-.2,.13,.4,"#e4aa56",.02)}${line(.05,0,length-.05,0,"#adbcc2",.05)}</g>`);
      else if(assets.threshold)out.push(`<g transform="translate(${n(a.x)} ${n(a.y)}) rotate(${n(angle)})">${asset("threshold",0,-.4,length,.8)}</g>`);
    }
  }
  if(labels) for(const r of rooms.filter(r=>!["corridor","jefferies"].includes(r.kind))) {
    const f=r.frame, fs=Math.max(.08,Math.min(.24,(f.w-.2)/(r.name.length*.75))), y=Math.max(0,f.h/2-.2);
    const angle=f.rotation*Math.PI/180,rotation=((f.rotation+90)%180+180)%180-90;
    out.push(`<text transform="translate(${n(f.x-y*Math.sin(angle))} ${n(f.y+y*Math.cos(angle))}) rotate(${n(rotation)})" x="0" y="0" font-family="sans-serif" font-size="${n(fs)}" font-weight="600" letter-spacing=".015" text-anchor="middle" fill="#e8eef1" stroke="#18232d" stroke-width=".055" paint-order="stroke">${escapeInteriorText(r.name.toUpperCase())}</text>`);
  }
  out.push(`<text x="${width/2}" y="1.5" text-anchor="middle" font-family="sans-serif" font-size=".3" letter-spacing=".1" fill="${p.panel}">${escapeInteriorText(p.label.toUpperCase())} / ${recipe.type==="station"?"STATION":"STARSHIP"} INTERIOR</text>`);
  out.push(`<text x="${width/2}" y="${height-1}" text-anchor="middle" font-family="sans-serif" font-size=".2" letter-spacing=".04" fill="${p.panel}" opacity=".7">${escapeInteriorText(recipe.era.toUpperCase())} · ${escapeInteriorText(recipe.seed)} · 1 GRID = 1.5 METERS</text></svg>`);
  return out.join("");
}

/** Encode once for a persisted background. The SVG and scene retain the same aspect and coordinates. */
export async function renderInteriorBlob(layout) {
  const assets=await loadInteriorAssets(layout.recipe);
  const svg=renderInteriorSVG(layout,{assets}), url=URL.createObjectURL(new Blob([svg],{type:"image/svg+xml"})), img=new Image();
  const canvas=document.createElement("canvas");
  try {
    img.src=url; await img.decode();
    const scale=Math.min(layout.recipe.gridSize,8192/Math.max(layout.width,layout.height));
    canvas.width=Math.round(layout.width*scale); canvas.height=Math.round(layout.height*scale);
    canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",.96));
    if(!blob) throw new Error("Could not encode interior artwork.");
    return blob;
  } finally { URL.revokeObjectURL(url); canvas.width=canvas.height=0; }
}

export function interiorArtKey(layout) {
  return `v${layout.recipe.version}-${interiorSeedHash(JSON.stringify(layout.recipe)).toString(16)}`;
}
