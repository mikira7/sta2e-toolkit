/** Full-hull capture light using the token's live texture alpha. No readback,
 * silhouette tracing, owned token textures, ticker, or interaction handlers.
 */
const VERT = `
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vUv;
void main(){vUv=aTextureCoord;gl_Position=vec4((projectionMatrix*translationMatrix*vec3(aVertexPosition,1.0)).xy,0.0,1.0);}`;
const FRAG = `
varying vec2 vUv;
uniform sampler2D uHullTexture;
uniform vec3 uColor;
uniform vec2 uTexel;
uniform vec4 uFrame;
uniform float uTime;
uniform float uSpeed;
uniform float uAlpha;
float hull(vec2 uv){
  float inside=step(uFrame.x,uv.x)*step(uFrame.y,uv.y)*step(uv.x,uFrame.z)*step(uv.y,uFrame.w);
  return texture2D(uHullTexture,uv).a*inside;
}
void main(){
  float mask=hull(vUv);
  // Broad opaque regions receive a stronger lock than narrow extremities.
  float interior=(hull(vUv+vec2(uTexel.x,0.0))+hull(vUv-vec2(uTexel.x,0.0))
    +hull(vUv+vec2(0.0,uTexel.y))+hull(vUv-vec2(0.0,uTexel.y)))*.25;
  vec2 p=(vUv-uFrame.xy)/max(vec2(.0001),uFrame.zw-uFrame.xy);
  float flow=pow(.5+.5*sin(p.y*29.0+p.x*7.0+uTime*uSpeed*4.0),7.0);
  float shimmer=.9+.1*sin(uTime*1.7+p.x*12.0);
  float a=mask*(.23+.14*interior+.14*flow)*shimmer*uAlpha;
  gl_FragColor=vec4(uColor*a,a);
}`;
let ShaderClass;
let failed=false;
const rgb=c=>[((c>>16)&255)/255,((c>>8)&255)/255,(c&255)/255];

export function createTractorHullLock(parent, token, {color=0x44bbff,opacity=.55,speed=.8}={}) {
  const renderer=globalThis.canvas?.app?.renderer;
  const Base=globalThis.foundry?.canvas?.rendering?.shaders?.AbstractBaseShader;
  if(failed||!parent||!Base||!renderer?.gl||renderer.gl.isContextLost())return null;
  let mesh;
  try {
    ShaderClass??=class TractorHullShader extends Base {
      static _createVertexShader(){return VERT;}
      static _createFragmentShader(){return FRAG;}
      static defaultUniforms={translationMatrix:[1,0,0,0,1,0,0,0,1],uHullTexture:null,
        uColor:[.27,.73,1],uTexel:[.02,.02],uFrame:[0,0,1,1],uTime:0,uSpeed:.8,uAlpha:1};
    };
    const positions=new Float32Array(8),uvs=new Float32Array(8);
    const geometry=new PIXI.Geometry().addAttribute('aVertexPosition',positions,2)
      .addAttribute('aTextureCoord',uvs,2).addIndex([0,1,2,0,2,3]);
    mesh=new PIXI.Mesh(geometry,ShaderClass.create());mesh.eventMode='none';mesh.blendMode=PIXI.BLEND_MODES.ADD;
    const u=mesh.shader.uniforms;Object.assign(u,{uHullTexture:PIXI.Texture.WHITE,uColor:rgb(color),uSpeed:speed});
    renderer.shader.bind(mesh.shader);
    const program=mesh.shader.program.glPrograms[renderer.CONTEXT_UID]?.program;
    if(!program||!renderer.gl.getProgramParameter(program,renderer.gl.LINK_STATUS))throw Error('Tractor hull shader did not link');
    parent.addChild(mesh);
    const point=new PIXI.Point(),local=new PIXI.Point();
    const ready=()=>{
      const art=token?.mesh;
      return !!(art&&!art.destroyed&&art.texture?.valid&&art.calculateVertices&&art.worldTransform);
    };
    const sync=()=>{
      if(!ready())return false;
      const art=token.mesh;art.calculateVertices();
      const vertices=art.vertexData,coords=art.uvs??art.texture._uvs?.uvsFloat32;
      if(!vertices||!coords)return false;
      for(let i=0;i<4;i++){
        point.set(vertices[i*2],vertices[i*2+1]);parent.worldTransform.applyInverse(point,local);
        positions[i*2]=local.x;positions[i*2+1]=local.y;
      }
      if(!positions.every(Number.isFinite))return false;
      const a=positions[2]-positions[0],b=positions[3]-positions[1],c=positions[6]-positions[0],d=positions[7]-positions[1];
      if(Math.abs(a*d-b*c)<.001)return false;
      uvs.set(coords);geometry.getBuffer('aVertexPosition').update();geometry.getBuffer('aTextureCoord').update();
      u.uHullTexture=art.texture;
      u.uFrame=[Math.min(coords[0],coords[2],coords[4],coords[6]),Math.min(coords[1],coords[3],coords[5],coords[7]),
        Math.max(coords[0],coords[2],coords[4],coords[6]),Math.max(coords[1],coords[3],coords[5],coords[7])];
      u.uTexel=[(u.uFrame[2]-u.uFrame[0])*.035,(u.uFrame[3]-u.uFrame[1])*.035];
      u.uAlpha=mesh.worldAlpha*opacity;
      return true;
    };
    const render=mesh._render.bind(mesh);mesh._render=r=>{if(sync())render(r);};
    return {mesh,update(time){if(mesh.destroyed)return false;u.uTime=time;return ready();}};
  }catch(error){mesh?.destroy({children:true});failed=true;console.warn('STA2e Toolkit | Hull capture shader unavailable; using soft grab.',error);return null;}
}
globalThis.Hooks?.on('canvasReady',()=>{failed=false;});
