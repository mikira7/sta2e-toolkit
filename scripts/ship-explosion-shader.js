/** A small ray-marched volume: fire illuminates expanding smoke from within. */
import { shipExplosionPalette, rgbToHex } from "./ship-explosion-colors.js";
const VERTEX = `
precision highp float;
attribute vec2 aVertexPosition;
uniform mat3 projectionMatrix, translationMatrix;
varying vec2 vPosition;
void main() {
  vPosition = aVertexPosition;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.)).xy, 0., 1.);
}`;
const FRAGMENT = `
precision highp float;
varying vec2 vPosition;
uniform float uTime, uSeed, uParentAlpha;
uniform vec4 uLobes[6];
uniform vec2 uBlueAxis;
uniform vec3 uFireLow, uFireHigh, uPlasmaLow, uPlasmaHigh, uBloom, uFlash;
float hash(vec3 p) {
  p=fract(p*.1031); p+=dot(p,p.yzx+33.33);
  return fract((p.x+p.y)*p.z);
}
float noise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p) { return noise(p)*.53+noise(p*2.07+11.)*.27+noise(p*4.13+29.)*.14+noise(p*8.21+47.)*.06; }
void main() {
  float t=uTime;
  vec2 p=vPosition;
  vec3 rgb=vec3(0.);
  float alpha=0.;
  float life=smoothstep(0.,.025,t)*(1.-smoothstep(.65,1.48,t));
  float heat=1.-smoothstep(.18,1.05,t);
  // Fixed budget. Integrate through actual depth, so foreground smoke
  // obscures the luminous interior instead of embossing noise onto a disk.
  for(int stepIndex=0;stepIndex<20;stepIndex++) {
    vec3 pos=vec3(p,.76-float(stepIndex)*.08);
    float distance=2.;
    vec3 normal=vec3(0.,0.,1.);
    for(int j=0;j<6;j++) {
      vec3 delta=pos-uLobes[j].xyz;
      float d=length(delta)-uLobes[j].w;
      float weight=clamp(.5+.5*(distance-d)/.12,0.,1.);
      distance=mix(distance,d,weight)-.12*weight*(1.-weight);
      normal=mix(normal,delta/max(length(delta),.001),weight);
    }
    if(distance>.13) continue;
    vec3 flow=pos*9.0+vec3(uSeed*.013,t*.65,-t*1.2);
    flow.xy+=vec2(sin(pos.z*5.+t*2.),cos(pos.x*4.-t*1.6))*.28;
    float n=fbm(flow);
    float surface=distance+(n-.48)*.32;
    float structure=smoothstep(.24,.68,n);
    float density=(1.-smoothstep(-.05,.025,surface))*(.18+structure*1.4)*life;
    if(density<.005) continue;
    float opacity=1.-exp(-density*.85);
    float light=clamp(dot(normal,normalize(vec3(-.4,-.5,.8)))*.5+.5,0.,1.);
    float interior=1.-smoothstep(-.21,.045,surface);
    float ignition=heat*(.3+1.4*smoothstep(.34,.73,n))*(.6+interior*.4);
    vec2 blueOffset=pos.xy-uBlueAxis*.34;
    float blue=exp(-dot(blueOffset,blueOffset)*13.)*.95;
    float shadow=exp(-max(0.,fbm(flow+vec3(-.6,-.8,1.1))-.32)*3.);
    vec3 ash=mix(vec3(.045,.037,.033),vec3(.37,.34,.31),light*shadow);
    vec3 warm=mix(uFireLow,uFireHigh,smoothstep(.32,.95,ignition));
    vec3 cold=mix(uPlasmaLow,uPlasmaHigh,smoothstep(.32,.95,ignition));
    vec3 fire=mix(warm,cold,blue);
    vec3 color=mix(ash,fire,clamp(ignition*1.25,0.,1.));
    float transmission=1.-alpha;
    rgb+=transmission*opacity*color;
    alpha+=transmission*opacity;
    if(alpha>.985) break;
  }
  // Broad photographic bloom plus a very brief white-hot ignition.
  float flash=exp(-dot(p,p)*22.)*exp(-t*13.)*smoothstep(0.,.008,t)*1.8;
  float bloom=exp(-dot(p,p)*5.)*heat*life*.15;
  rgb+=uFlash*flash+uBloom*bloom;
  alpha=clamp(alpha+flash+bloom,0.,1.);
  gl_FragColor=vec4(min(rgb,vec3(alpha)),alpha)*uParentAlpha;
}`;

export function createShipFireball(size, seed = 1, color = "classic") {
  const palette = shipExplosionPalette(color);
  const renderer = globalThis.canvas?.app?.renderer;
  const random = n => { const v = Math.sin(n*127.1+seed)*43758.5453; return v-Math.floor(v); };
  const lobes = new Float32Array(24);
  function updateLobes(t) {
    for(let i=0;i<6;i++) {
      const age=Math.max(0,t-(i===0 ? 0 : .025+random(i)*.11));
      const angle=i*2.39996+seed*.07;
      const distance=i===0 ? 0 : (.22+random(i)*.22)*(1-Math.exp(-age*4.5));
      const radius=(i===0 ? .34 : .23+random(i+31)*.085)*(1-Math.exp(-age*10));
      lobes.set([Math.cos(angle)*distance, Math.sin(angle)*distance,
        age>0 ? (random(i+53)-.5)*.24 : -10, radius],i*4);
    }
  }
  let geometry, shader, mesh;
  if (Number.parseInt(PIXI.VERSION, 10) === 7 && renderer?.gl) {
    try {
      geometry = new PIXI.Geometry().addAttribute("aVertexPosition", [-1,-1, 1,-1, 1,1, -1,1], 2)
        .addIndex([0,1,2, 0,2,3]);
      updateLobes(0);
      shader = PIXI.Shader.from(VERTEX, FRAGMENT, { uTime: 0, uSeed: seed, uParentAlpha: 1,
        uFireLow: palette.low, uFireHigh: palette.high, uPlasmaLow: palette.plasmaLow,
        uPlasmaHigh: palette.plasmaHigh, uBloom: palette.bloom, uFlash: palette.high.map(v => .8+v*.2),
        uLobes: lobes, uBlueAxis: [Math.cos(seed*.07), Math.sin(seed*.07)] });
      if (!shader.program.glPrograms[renderer.CONTEXT_UID]) renderer.shader.generateProgram(shader);
      const program = shader.program.glPrograms[renderer.CONTEXT_UID]?.program;
      if (!program || !renderer.gl.getProgramParameter(program, renderer.gl.LINK_STATUS)) throw new Error("Fireball shader failed to link");
      shader.update = () => { shader.uniforms.uParentAlpha = shader.alpha; };
      mesh = new PIXI.Mesh(geometry, shader);
      mesh.scale.set(size * 1.9);
      // Normal premultiplied blending lets ash shade the scene as the fire cools.
      mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
      return {
        display: mesh,
        update(seconds) { shader.uniforms.uTime = seconds; updateLobes(seconds); mesh.visible = seconds < 1.5; },
        destroy() { mesh.destroy(); geometry.destroy(); shader.destroy(); },
      };
    } catch (error) {
      mesh?.destroy(); geometry?.destroy(); shader?.destroy();
      console.warn("STA2e Toolkit | Fireball shader unavailable; using native Graphics.", error);
    }
  }
  const g = new PIXI.Graphics();
  g.blendMode = PIXI.BLEND_MODES?.NORMAL ?? "normal";
  return {
    display: g,
    update(t) {
      g.clear();
      updateLobes(t);
      for (let lobe=0; lobe<6; lobe++) {
        const age=t-(lobe===0 ? 0 : .025+random(lobe)*.11);
        if(age<=0 || age>=1.3) continue;
        const fade=Math.min(1,age/.045)*Math.min(1,(1.3-age)/.75);
        const radius=lobes[lobe*4+3]*size*1.9;
        for(let i=6;i>0;i--) {
          const blue=random(lobe+47)>.64;
          const color=age>.6 ? 0x786f6b : rgbToHex(blue
            ? (i>3 ? palette.plasmaLow : palette.plasmaHigh) : (i>3 ? palette.low : palette.high));
          const x=lobes[lobe*4]*size*1.9, y=lobes[lobe*4+1]*size*1.9;
          if(g.beginFill) g.beginFill(color,fade*.2).drawCircle(x,y,radius*i/6).endFill();
          else g.circle(x,y,radius*i/6).fill({color,alpha:fade*.2});
        }
      }
    },
    destroy() { g.destroy(); },
  };
}
