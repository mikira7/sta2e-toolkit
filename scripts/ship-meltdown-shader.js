/** Token-art filter: spreading hull breaches, molten lips and charred burn-through. */
import { shipExplosionPalette } from "./ship-explosion-colors.js";

const FRAGMENT = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize,inputClamp,outputFrame,uBounds;
uniform float uProgress,uSeed;
uniform vec3 uHeat,uCore,uPlasma;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+uSeed)*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);
}
float fbm(vec2 p){return noise(p)*.57+noise(p*2.03+13.)*.29+noise(p*4.07+29.)*.14;}
vec4 art(vec2 p){
  vec2 uv=(uBounds.xy+p*uBounds.zw-outputFrame.xy)*inputSize.zw;
  float inside=step(inputClamp.x,uv.x)*step(inputClamp.y,uv.y)*step(uv.x,inputClamp.z)*step(uv.y,inputClamp.w);
  return texture2D(uSampler,clamp(uv,inputClamp.xy,inputClamp.zw))*inside;
}
// Fixed ignition sites grow into connected wounds. Noise roughens their borders
// without making the whole ship dissolve into unrelated speckles at once.
float field(vec2 p){
  vec2 warp=vec2(fbm(p*9.),fbm(p*9.+31.))-.5;
  vec2 q=p+warp*.075;
  vec2 offset=vec2(hash(vec2(2,9)),hash(vec2(7,4)))-.5;
  float d=length((q-vec2(.45,.31)-offset*.12)*vec2(1.,1.25));
  d=min(d,length((q-vec2(.60,.49)+offset*.10)*vec2(1.2,.9))+.095);
  d=min(d,length((q-vec2(.31,.69)-offset*.08)*vec2(.95,1.1))+.20);
  return .105+d*.98+(fbm(p*32.)-.5)*.055;
}
void main(){
  float t=clamp(uProgress,0.,1.);
  if(t>=1.){gl_FragColor=vec4(0.);return;}
  vec2 p=(vTextureCoord*inputSize.xy+outputFrame.xy-uBounds.xy)/uBounds.zw;
  float advance=t*.91+smoothstep(.76,1.,t)*.5;
  float age=advance-field(p);
  float burned=smoothstep(-.008,.018,age);
  float heat=exp(-abs(age)*23.)*smoothstep(0.,.12,t);
  // Only the heated edge sags; intact plating keeps its original detail.
  vec2 molten=vec2(sin(p.y*31.+t*9.),cos(p.x*27.-t*7.))*.003*heat;
  molten.y-=.007*heat;
  vec4 base=art(p+molten);
  float grain=fbm(p*64.);
  float ridges=pow(1.-abs(noise(p*49.)*2.-1.),8.);
  float flicker=.8+.2*sin(t*69.+p.x*49.+p.y*37.);
  // The charred cavity remains visible before it opens into empty space.
  float erosion=age-.26-(grain-.5)*.11;
  float matter=1.-smoothstep(.0,.07,erosion);
  float lip=exp(-abs(age-.007)*155.)*smoothstep(0.,.12,t);
  float innerLip=exp(-abs(erosion-.025)*100.)*burned;
  vec3 charred=base.rgb*.085+base.a*uHeat*(.018+grain*.075+ridges*.12);
  vec3 rgb=mix(base.rgb,charred,burned);
  rgb+=base.a*uHeat*(heat*.20+lip*1.3)*flicker;
  rgb+=base.a*uCore*pow(lip,3.)*.48;
  float plasma=smoothstep(.57,.77,fbm(p*26.+vec2(t*.35,-t*.6)));
  plasma*=burned*(1.-smoothstep(.12,.29,age));
  rgb+=base.a*uPlasma*plasma*(.6+ridges)*1.5;
  rgb=(rgb+base.a*uHeat*innerLip*.65)*matter;
  float alpha=base.a*matter;
  // A faint local bloom follows the burning region, not the whole outline.
  float halo=0.;
  for(int i=0;i<12;i++){
    float a=float(i)*6.283185/12.;
    vec2 ray=vec2(cos(a),sin(a));
    vec2 aspect=min(uBounds.z,uBounds.w)/uBounds.zw;
    halo+=art(p+ray*aspect*.022).a*.045+art(p+ray*aspect*.05).a*.018;
  }
  halo*=heat*(1.-base.a)*matter*(1.-smoothstep(.8,1.,t));
  rgb+=uHeat*halo;alpha=max(alpha,halo);
  // Embers lift off the source silhouette as each patch erodes.
  float embers=0.;
  for(int i=0;i<32;i++){
    float id=float(i);
    vec2 origin=vec2((mod(id,8.)+.15+hash(vec2(id,3.))*.7)/8.,(floor(id/8.)+.15+hash(vec2(id,7.))*.7)/4.);
    float emberAge=advance-field(origin)-.20;
    if(emberAge<0. || emberAge>.3)continue;
    vec2 direction=normalize(origin-.5+vec2(.0001));
    vec2 delta=(p-origin-direction*emberAge*.36)*uBounds.zw/min(uBounds.z,uBounds.w);
    float light=exp(-dot(delta,delta)/.000065);
    embers+=light*art(origin).a*(1.-emberAge/.3)*smoothstep(.0,.015,emberAge);
  }
  embers*=1.-smoothstep(.92,1.,t);
  rgb+=uCore*embers;alpha=max(alpha,min(1.,embers));
  gl_FragColor=vec4(min(rgb,vec3(alpha)),alpha);
}`;

export function createShipMeltdownFilter(mesh, color = "classic", seed = 1) {
  const renderer=globalThis.canvas?.app?.renderer;
  if(Number.parseInt(globalThis.PIXI?.VERSION,10)!==7 || !renderer?.gl) return null;
  const palette=shipExplosionPalette(color);
  let filter;
  try {
    filter=new PIXI.Filter(undefined,FRAGMENT,{uProgress:0,uSeed:seed,uBounds:[0,0,1,1],
      uHeat:palette.bloom,uCore:palette.high.map(v=>.7+v*.3),uPlasma:palette.plasmaLow.map(v=>Math.min(1,v*1.8))});
    filter.resolution=Math.min(renderer.resolution ?? 1,1);
    if(!filter.program.glPrograms?.[renderer.CONTEXT_UID])renderer.shader.generateProgram(filter);
    const program=filter.program.glPrograms[renderer.CONTEXT_UID]?.program;
    if(!program || !renderer.gl.getProgramParameter(program,renderer.gl.LINK_STATUS))throw Error("Hull meltdown shader failed to link");
    const bounds=()=>{
      const b=mesh.getBounds();filter.uniforms.uBounds=[b.x,b.y,Math.max(1,b.width),Math.max(1,b.height)];
      filter.padding=Math.ceil(Math.max(b.width,b.height)*.16);
    };
    bounds();
    filter.apply=(manager,input,output,clearMode)=>{bounds();manager.applyFilter(filter,input,output,clearMode);};
    return {filter,update(progress){filter.uniforms.uProgress=Math.max(0,Math.min(1,progress));bounds();},destroy(){filter.destroy();}};
  } catch(error){filter?.destroy();console.warn("STA2e Toolkit | Hull meltdown shader unavailable:",error);return null;}
}
