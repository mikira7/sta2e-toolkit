/** Compact energy volumes and curved charge trails. No owned ticker or filter;
 * callers drive time and destroy their containers, including the owned meshes.
 */
const VERT = `
attribute vec2 aVertexPosition;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
void main() {
  vUv = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;
const HEAD = `
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uCoreColor;
uniform float uAlpha;
uniform float uTime;
uniform float uSeed;
uniform vec4 uRadii;
uniform vec4 uLight;
uniform vec2 uInner;
uniform float uEnergy;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0)),f.x),f.y);
}
float bell(float x) { return exp(-x*x); }
void emitLight(float density,float hot) {
  float a=(1.0-exp(-max(0.0,density)*uEnergy))*clamp(uAlpha,0.0,1.0);
  gl_FragColor=vec4(mix(uColor,uCoreColor,clamp(hot,0.0,1.0))*a,a);
}`;
const ORB = `${HEAD}
void main() {
  vec2 p=(vUv-0.5)*2.0;float r=length(p);
  float n=noise(p*6.0+vec2(uTime*.8,uSeed));
  float fine=noise(p*13.0+vec2(-uTime*1.1,n*1.8));
  float core=bell(r/max(.001,uRadii.x)*1.9)*step(.00001,uRadii.x);
  float inner=bell(r/max(.001,uInner.x)*1.9)*step(.00001,uInner.x);
  float corona=bell(r/max(.001,uRadii.y)*(2.0+(n-.5)*.5))*step(.00001,uRadii.y);
  float ring=bell((r-uRadii.z)/max(.005,uRadii.w))*step(.00001,uRadii.w)*step(.00001,uRadii.z);
  float threads=pow(max(0.0,1.0-abs(fine-.52)*5.0),4.0);
  float edge=1.0-smoothstep(.76,1.0,r);
  float lens=bell(p.y/.022)*bell(p.x/.64)+bell(p.x/.03)*bell(p.y/.34)*.3;
  float density=core*uLight.x+inner*uInner.y+corona*uLight.y*(.55+threads*.8)
              +ring*uLight.z*(.35+.65*n)+lens*uLight.w;
  emitLight(density*edge,core*.92+ring*.18);
}`;
const TRAIL_VERT=VERT.replace('uniform mat3 translationMatrix;', 'attribute vec2 aTextureCoord;\nuniform mat3 translationMatrix;').replace('vUv = aVertexPosition;', 'vUv = aTextureCoord;');
const TRAIL = `${HEAD}
void main() {
  float v=abs(vUv.y*2.0-1.0);
  float taper=smoothstep(0.0,.12,vUv.x);
  float core=bell(v/max(.015,uRadii.x)*1.8);
  float n=noise(vec2(vUv.x*8.0-uTime*3.0,v*4.0+uSeed));
  float body=pow(max(0.0,1.0-v),2.3)*(.65+n*.65);
  emitLight((body*mix(uLight.z,uLight.y,vUv.x)+core*mix(uLight.w,uLight.x,vUv.x))*taper,core*.9);
}`;
// A travelling radial front with a fading ionised interior, rather than a
// scaled explosion sprite. uProgress is normalised to the blast lifetime.
const SHOCKWAVE = `${HEAD}
uniform float uProgress;
void main() {
  vec2 p=(vUv-.5)*2.0;
  float r=length(p);
  float front=.05+.83*(1.0-pow(1.0-uProgress,2.0));
  float n=noise(p*15.0+vec2(uTime*2.0,uSeed));
  float ripple=noise(p*32.0-vec2(uTime*3.0));
  float ring=bell((r-front+(n-.5)*.022)/(.016+.025*uProgress));
  float echo=bell((r-front*.78)/.024)*.28;
  float wake=(1.0-smoothstep(front-.06,front,r))*smoothstep(0.0,.16,r);
  float flash=bell(r/.2)*exp(-uProgress*18.0);
  float edge=1.0-smoothstep(.9,1.0,r);
  emitLight((ring*(1.2+n*.7)+echo+wake*ripple*.18+flash*3.0)*edge,
    ring*.8+flash);
}`;
const classes = new Map();
let failed = false;
const rgb = c => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];

function makeClass(type) {
  const Base = globalThis.foundry?.canvas?.rendering?.shaders?.AbstractBaseShader;
  if (!Base) return null;
  if (!classes.has(type)) {
    class EnergyShader extends Base {
      static _createVertexShader() { return type === "trail" ? TRAIL_VERT : VERT; }
      static _createFragmentShader() { return type === "trail" ? TRAIL : type === "shockwave" ? SHOCKWAVE : ORB; }
      static defaultUniforms = {
        // Include the matrix before the first bind builds PIXI's uniform sync.
        translationMatrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        uColor: [1, 0.5, 0.1], uCoreColor: [1, 0.95, 0.8],
        uAlpha: 1, uTime: 0, uSeed: 0, uEnergy: 1, uProgress: 0,
        uRadii: [0.2, 0.6, 0.3, 0.02], uLight: [1, 0.3, 0.2, 0.1], uInner: [0, 0],
      };
      _preRender(mesh) { this.uniforms.uAlpha = mesh.worldAlpha; }
    }
    classes.set(type, EnergyShader);
  }
  return classes.get(type);
}
function available() {
  const gl = globalThis.canvas?.app?.renderer?.gl;
  return !failed && gl && !gl.isContextLost() && globalThis.foundry?.canvas?.containers?.QuadMesh;
}

function configure(mesh, color, coreColor, blend) {
  mesh.blendMode = blend;
  const u = mesh.shader.uniforms;
  u.uColor = rgb(color); u.uCoreColor = rgb(coreColor); u.uSeed = Math.random() * 20;
  const renderer = canvas.app.renderer;
  renderer.shader.bind(mesh.shader);
  const program = mesh.shader.program.glPrograms[renderer.CONTEXT_UID]?.program;
  if (!program || !renderer.gl.getProgramParameter(program, renderer.gl.LINK_STATUS)) {
    throw new Error("Weapon energy GLSL did not link");
  }
  return u;
}

function fail(mesh, err) {
  try { mesh?.destroy({ children: true }); } catch { /* partially constructed */ }
  failed = true;
  console.warn("STA2e Toolkit | Weapon energy shader unavailable; using native graphics.", err);
  return null;
}

export function createWeaponEnergyOrb(parent,{color=0xff9a33,coreColor=0xfff2c0,blend=1,
  radius=24,coreRadius=4,haloRadius=15,ringRadius=8,ringWidth=1,
  coreAlpha=1,haloAlpha=.3,ringAlpha=.2,flareAlpha=.12,innerRadius=0,innerAlpha=0}={}) {
  if(!parent||!available())return null;
  let mesh;
  try{
    mesh=new foundry.canvas.containers.QuadMesh(makeClass('orb'));
    const u=configure(mesh,color,coreColor,blend);
    radius=Math.max(1,radius);mesh.pivot.set(.5,.5);mesh.scale.set(radius*2);
    u.uRadii=[coreRadius/radius,haloRadius/radius,ringRadius/radius,ringWidth/radius];
    u.uLight=[coreAlpha,haloAlpha,ringAlpha,flareAlpha];
    u.uInner=[innerRadius/radius,innerAlpha];
    parent.addChild(mesh);
    return {mesh,update(time,energy=1){if(mesh.destroyed)return;u.uTime=time;u.uEnergy=Math.max(0,energy);}};
  }catch(err){return fail(mesh,err);}
}

export function createWeaponEnergyShockwave(parent, { color=0x65caff, coreColor=0xe4faff, blend=1, radius=150 }={}) {
  if (!parent || !available()) return null;
  let mesh;
  try {
    mesh = new foundry.canvas.containers.QuadMesh(makeClass("shockwave"));
    const u = configure(mesh, color, coreColor, blend);
    mesh.pivot.set(.5, .5);
    mesh.scale.set(Math.max(1, radius) * 2 / .88);
    parent.addChild(mesh);
    return { mesh, update(time, progress) {
      if (mesh.destroyed) return;
      u.uTime = time;
      u.uProgress = Math.max(0, Math.min(1, progress));
    } };
  } catch (err) { return fail(mesh, err); }
}

/** One reusable mesh per curved trail, with a fixed vertex budget. */
export function createWeaponEnergyTrail(parent,{color,coreColor,blend=1,width=16,coreWidth=4,alpha=.32,coreAlpha=.72,alphaStart=.08,coreAlphaStart=.22}={}) {
  if(!parent||!available())return null;
  let mesh;
  try{
    const steps=64,positions=new Float32Array((steps+1)*4),uvs=new Float32Array((steps+1)*4),indices=[];
    for(let i=0;i<=steps;i++){uvs.set([i/steps,0,i/steps,1],i*4);if(i<steps){const k=i*2;indices.push(k,k+1,k+2,k+1,k+3,k+2);}}
    const geometry=new PIXI.Geometry().addAttribute('aVertexPosition',positions,2).addAttribute('aTextureCoord',uvs,2).addIndex(indices);
    const Shader=makeClass('trail');
    mesh=new PIXI.Mesh(geometry,Shader.create());
    const u=configure(mesh,color,coreColor,blend);u.uRadii[0]=Math.max(.01,coreWidth/Math.max(1,width));u.uLight=[coreAlpha,alpha,alphaStart,coreAlphaStart];
    // PIXI.Mesh does not call AbstractBaseShader._preRender (QuadMesh does).
    const render=mesh._render.bind(mesh);mesh._render=renderer=>{u.uAlpha=mesh.worldAlpha;render(renderer);};
    parent.addChild(mesh);mesh.visible=false;
    return {mesh,update(sample,from,to,time){
      if(mesh.destroyed)return;
      mesh.visible=Math.abs(to-from)>.0001;u.uTime=time;
      for(let i=0;i<=steps;i++){
        const t=from+(to-from)*i/steps,p=sample(t),q=sample(Math.min(1,t+.0005)),a=sample(Math.max(0,t-.0005));
        const dx=q.x-a.x,dy=q.y-a.y,len=Math.max(.001,Math.hypot(dx,dy));
        const half=Math.max(0,width)*.5*(.16+.84*i/steps),nx=-dy/len*half,ny=dx/len*half;
        positions.set([p.x+nx,p.y+ny,p.x-nx,p.y-ny],i*4);
      }
      geometry.getBuffer('aVertexPosition').update();
    }};
  }catch(err){return fail(mesh,err);}
}
globalThis.Hooks?.on('canvasReady',()=>{failed=false;});
