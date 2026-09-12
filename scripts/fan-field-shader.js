/** Volumetric ground phaser and tractor fields. The caller owns time and lifetime.
 * The mesh ends on the supplied contour, including every hull corner; no filter
 * rectangle or full-screen pass is needed. Coordinates are local to the parent.
 */
const VERT = `
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
void main() {
  vUv=aTextureCoord;
  gl_Position=vec4((projectionMatrix*translationMatrix*vec3(aVertexPosition,1.0)).xy,0.0,1.0);
}`;
const FRAG = `
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uCore;
uniform float uAlpha;
uniform float uOpacity;
uniform float uTime;
uniform float uSeed;
uniform float uKind;
uniform vec2 uSize;
uniform vec4 uRays;
uniform vec3 uMotion;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),f.y);
}
float bell(float x) { return exp(-x*x); }
void main() {
  float r=vUv.x, v=vUv.y;
  float span=max(1.0,uSize.y*r);
  float lateral=min(v,1.0-v)*span;
  float sides=smoothstep(0.0,max(1.2,min(12.0,span*.12)),lateral);
  float endWidth=mix(.22,clamp(8.0/max(1.0,uSize.x),.008,.12),uKind);
  float ends=smoothstep(0.0,.035,r)*(1.0-smoothstep(1.0-endWidth,1.0,r));
  float flow=uTime*uMotion.x*mix(-1.0,.65,uKind);
  float n=noise(vec2(r*uSize.x/85.0+flow,v*7.0+uSeed));
  float fine=noise(vec2(r*uSize.x/32.0+flow*1.5,v*24.0+uSeed));
  float strands=pow(max(0.0,1.0-abs(fine-.54)*3.0),4.0);
  float body=(.33+.22*n+.16*strands)*mix(1.0,.65,r);
  float ray=0.0,halo=0.0;
  // Fixed upper bound is portable to WebGL 1; disabled rays cost no strokes.
  for(int i=0;i<24;i++) {
    if(float(i)>=uRays.x) break;
    float lane=(float(i)+1.0)/(uRays.x+1.0);
    float distance=(v-lane)*span;
    float width=max(.25,uRays.y*.5);
    float breath=.72+.28*sin(uTime*uMotion.x*6.283185-float(i)*1.7);
    float reach=mix(.80+hash(vec2(float(i),uSeed))*.18,1.0,uKind);
    float tip=1.0-smoothstep(max(.05,reach-.15),reach,r);
    ray+=bell(distance/width)*breath*tip;
    halo+=bell(distance/(width*(1.0+uRays.w*3.5)))*breath*tip;
  }
  ray*=step(.001,uRays.y)*uRays.z;
  halo*=step(.001,uRays.y)*uRays.z*uRays.w*.22;
  float pulse=.9+.1*sin(uTime*uMotion.y*6.283185);
  // Tractor compression fronts blend into a soft capture volume at the target.
  float fronts=pow(.5+.5*sin(r*uSize.x/70.0+flow*6.283185),12.0);
  float contact=bell((r-(1.0-endWidth*.6))/(endWidth*.65))*(.6+.4*n);
  body+=uKind*(fronts*.15+contact*.16);
  float density=body*uOpacity+ray*mix(.68,uOpacity*uMotion.z,uKind)+halo*uOpacity;
  float a=(1.0-exp(-density*1.65))*sides*ends*pulse*clamp(uAlpha,0.0,1.0);
  vec3 color=mix(uColor,uCore,clamp(ray*.65+uKind*contact*.26,0.0,.8));
  gl_FragColor=vec4(color*a,a);
}`;
let ShaderClass;
let failed=false;
const rgb=c=>[((c>>16)&255)/255,((c>>8)&255)/255,(c&255)/255];

function shaderClass() {
  const Base=globalThis.foundry?.canvas?.rendering?.shaders?.AbstractBaseShader;
  if(!Base)return null;
  return ShaderClass??=class FanFieldShader extends Base {
    static _createVertexShader(){return VERT;}
    static _createFragmentShader(){return FRAG;}
    static defaultUniforms={
      translationMatrix:[1,0,0,0,1,0,0,0,1],uColor:[1,.6,.2],uCore:[1,.95,.8],
      uAlpha:1,uOpacity:.34,uTime:0,uSeed:0,uKind:0,uSize:[300,160],
      uRays:[6,2.4,.85,.7],uMotion:[2.2,1.35,1],
    };
  };
}

export function createFanField(parent,{kind="ground",color=0xff9a33,core=0xfff2c0,
  opacity=.34,blend=1,rayCount=6,rayWidth=2.4,rayAlpha=.85,rayFeather=.7,
  raySpeed=2.2,pulseSpeed=1.35,rayShade=1}={}) {
  const renderer=globalThis.canvas?.app?.renderer;
  if(failed||!parent||!renderer?.gl||renderer.gl.isContextLost()||!shaderClass())return null;
  let mesh;
  try {
    const geometry=new PIXI.Geometry().addAttribute('aVertexPosition',new Float32Array(0),2)
      .addAttribute('aTextureCoord',new Float32Array(0),2).addIndex(new Uint16Array(0));
    mesh=new PIXI.Mesh(geometry,ShaderClass.create());mesh.blendMode=blend;
    const u=mesh.shader.uniforms;
    Object.assign(u,{uColor:rgb(color),uCore:rgb(core),uOpacity:Math.max(0,opacity),
      uKind:kind==='tractor'?1:0,uSeed:Math.random()*20,
      uRays:[Math.min(24,Math.max(0,rayCount)),rayWidth,rayAlpha,rayFeather],
      uMotion:[raySpeed,pulseSpeed,rayShade]});
    // Mesh, unlike QuadMesh, does not invoke AbstractBaseShader._preRender.
    const render=mesh._render.bind(mesh);
    mesh._render=r=>{u.uAlpha=mesh.worldAlpha;render(r);};
    renderer.shader.bind(mesh.shader);
    const program=mesh.shader.program.glPrograms[renderer.CONTEXT_UID]?.program;
    if(!program||!renderer.gl.getProgramParameter(program,renderer.gl.LINK_STATUS))throw Error('Fan field GLSL did not link');
    parent.addChild(mesh);mesh.visible=false;
    const rows=16;
    let columns=0,positions,uvs,lengths;
    return {mesh,setTime(time){if(!mesh.destroyed)u.uTime=time;},update(source,contour,time){
      if(mesh.destroyed)return;
      const count=contour?.length??0;
      mesh.visible=count>=2&&count<=2048;
      if(!mesh.visible)return;
      if(count!==columns){
        columns=count;positions=new Float32Array(count*(rows+1)*2);uvs=new Float32Array(positions.length);lengths=new Float32Array(count);
        const indices=new Uint16Array((count-1)*rows*6);let k=0;
        for(let row=0;row<rows;row++)for(let col=0;col<count-1;col++){
          const a=row*count+col,b=a+count;
          indices.set([a,b,a+1,a+1,b,b+1],k);k+=6;
        }
        geometry.getIndex().update(indices);
      }
      let distance=0;
      for(let col=0;col<count;col++){
        const p=contour[col],prior=contour[col-1];
        lengths[col]=col?lengths[col-1]+Math.hypot(p.x-prior.x,p.y-prior.y):0;
        distance+=Math.hypot(p.x-source.x,p.y-source.y);
      }
      const span=lengths[count-1];
      mesh.visible=span>.01&&distance/count>.01;
      u.uTime=time;u.uSize=[distance/count,span];
      for(let row=0;row<=rows;row++)for(let col=0;col<count;col++){
        const r=row/rows,p=contour[col],k=(row*count+col)*2;
        positions[k]=source.x+(p.x-source.x)*r;positions[k+1]=source.y+(p.y-source.y)*r;
        uvs[k]=r;uvs[k+1]=lengths[col]/Math.max(.001,span);
      }
      geometry.getBuffer('aVertexPosition').update(positions);
      geometry.getBuffer('aTextureCoord').update(uvs);
    }};
  } catch(error) {
    mesh?.destroy({children:true});failed=true;
    console.warn('STA2e Toolkit | Fan shader unavailable; using native graphics.',error);
    return null;
  }
}
globalThis.Hooks?.on('canvasReady',()=>{failed=false;});
