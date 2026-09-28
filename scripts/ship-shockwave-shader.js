/** Final-detonation energy ring with a turbulent mist wake behind its front. */
import { shipExplosionPalette, rgbToHex } from "./ship-explosion-colors.js";

const VERTEX = `
precision highp float;
attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix, translationMatrix;
varying vec2 vPosition;
void main() {
  vPosition=aVertexPosition;
  gl_Position=vec4((projectionMatrix*translationMatrix*vec3(aVertexPosition,1.)).xy,0.,1.);
}`;
const FRAGMENT = `
precision highp float;
varying vec2 vPosition;
uniform float uTime, uParentAlpha;
uniform vec3 uColor;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
    mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
}
float mistNoise(vec2 p) { return noise(p)*.57+noise(p*2.03+11.)*.29+noise(p*4.07+23.)*.14; }
void main() {
  float t=clamp((uTime-.08)/1.72,0.,1.);
  vec2 p=vPosition;
  float r=length(p), a=atan(p.y,p.x);
  float radius=.035+.89*pow(t,.7);
  float ripple=sin(a*9.+uTime*8.)*.002+sin(a*17.-uTime*11.)*.0015;
  float d=abs(r-radius-ripple);
  float width=mix(.015,.004,t);
  float core=exp(-pow(d/width,2.));
  float halo=exp(-pow(d/(width*4.),2.))*.3;
  // Radial lag confines the fog to the INSIDE of the advancing front.
  // Its expanding depth leaves a broad wake, not a second bright outline.
  float behind=radius-r;
  float tailWidth=.075+.17*t;
  float lag=behind/tailWidth;
  vec2 flow=p*15.+vec2(uTime*.65,-uTime*.45);
  flow+=vec2(noise(flow*.55+uTime),noise(flow*.55+19.-uTime))*.8;
  float billow=mistNoise(flow);
  float drift=sin(a*7.-uTime*2.+billow*4.)*.08;
  float envelope=smoothstep(.004,.026,behind)*(1.-smoothstep(.35,1.,lag+drift));
  float wisps=smoothstep(.16,.72,billow)*(.65+.35*sin(lag*7.+billow*5.-uTime));
  float mist=envelope*(.10+wisps*.37);
  float fade=smoothstep(0.,.065,t)*(1.-smoothstep(.35,1.,t));
  float mistFade=smoothstep(0.,.1,t)*(1.-smoothstep(.5,1.,t));
  float front=(core+halo)*fade;
  mist*=mistFade;
  float alpha=clamp(front+mist,0.,1.);
  vec3 frontColor=mix(uColor,vec3(1.),core*.72);
  vec3 mistColor=mix(uColor,vec3(.64,.72,.79),.55);
  vec3 rgb=frontColor*front+mistColor*mist;
  gl_FragColor=vec4(min(rgb,vec3(alpha)),alpha)*uParentAlpha;
}`;

export function createShipShockwave(size, color = "classic") {
  const palette=shipExplosionPalette(color), renderer=globalThis.canvas?.app?.renderer;
  let mesh,geometry,shader;
  if(Number.parseInt(PIXI.VERSION,10)===7 && renderer?.gl) {
    try {
      geometry=new PIXI.Geometry().addAttribute("aVertexPosition",[-1,-1,1,-1,1,1,-1,1],2).addIndex([0,1,2,0,2,3]);
      shader=PIXI.Shader.from(VERTEX,FRAGMENT,{uTime:0,uParentAlpha:1,uColor:palette.bloom});
      if(!shader.program.glPrograms[renderer.CONTEXT_UID]) renderer.shader.generateProgram(shader);
      const program=shader.program.glPrograms[renderer.CONTEXT_UID]?.program;
      if(!program || !renderer.gl.getProgramParameter(program,renderer.gl.LINK_STATUS)) throw Error("Shockwave shader failed to link");
      shader.update=()=>{shader.uniforms.uParentAlpha=shader.alpha;};
      mesh=new PIXI.Mesh(geometry,shader); mesh.scale.set(size*3.2); mesh.blendMode=PIXI.BLEND_MODES.ADD;
      return {display:mesh,update(t){shader.uniforms.uTime=t;mesh.visible=t>0.08 && t<1.8;},
        destroy(){mesh.destroy();geometry.destroy();shader.destroy();}};
    } catch(error) {
      mesh?.destroy();geometry?.destroy();shader?.destroy();
      console.warn("STA2e Toolkit | Shockwave shader unavailable; using Graphics.",error);
    }
  }
  const g=new PIXI.Graphics(), tint=rgbToHex(palette.bloom);
  const mistTint=rgbToHex(palette.bloom.map((v,i)=>v*.45+[.64,.72,.79][i]*.55));
  g.blendMode=PIXI.BLEND_MODES?.ADD ?? "add";
  return {display:g,update(seconds){
    g.clear(); const t=Math.max(0,Math.min(1,(seconds-.08)/1.72));
    if(t<=0 || t>=1) return;
    const radius=size*3.2*(.035+.89*t**.7), alpha=Math.min(1,t/.065)*(1-t)**1.3;
    const tailWidth=size*3.2*(.075+.17*t);
    // Overlapping soft puffs approximate the shader's trailing annulus.
    for(let i=0;i<72;i++) {
      const angle=i*2.39996+seconds*.075;
      const lag=.18+(i%5)*.13;
      const distance=radius-tailWidth*lag;
      if(distance<=0) continue;
      const puff=tailWidth*(.10+.035*(i%3));
      const x=Math.cos(angle)*distance,y=Math.sin(angle)*distance;
      for(let layer=3;layer>0;layer--) {
        const rx=puff*layer/2,ry=rx,opacity=alpha*.055*(1-lag);
        if(g.beginFill) g.lineStyle(0).beginFill(mistTint,opacity).drawEllipse(x,y,rx,ry).endFill();
        else g.ellipse(x,y,rx,ry).fill({color:mistTint,alpha:opacity});
      }
    }
    for(const [spread,strength] of [[5,.08],[2,.2],[.6,.8]]) {
      const width=Math.max(.6,size*.025*spread);
      if(g.lineStyle) g.lineStyle(width,tint,alpha*strength).drawEllipse(0,0,radius,radius);
      else g.ellipse(0,0,radius,radius).stroke({width,color:tint,alpha:alpha*strength});
    }
  },destroy(){g.destroy();}};
}
