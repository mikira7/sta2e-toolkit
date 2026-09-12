// Isolate the VFX from the anchor editor's application/import graph.
export const settings = { enabled: true,
  chargeGlow: { alpha:.85,blendMode:'add',width:3,durationMs:2600,radiusPx:420,coneDeg:44,coneAlpha:.14,rate:200,glowSize:22 },
  pulse: { alpha:.9,blendMode:'add',width:18,durationMs:1400,radiusPx:60,arcDeg:120,ringCount:1,expandTo:2,tailLength:4,tailAlpha:.5,glowSize:20 },
  beam: { alpha:.95,blendMode:'add',width:10,durationMs:1400,beamCount:3,spreadDeg:7,rampMs:180,fadeMs:320,glowSize:26 },
  stream: { alpha:.75,blendMode:'add',width:78,durationMs:1800,bodyAlpha:.22,moteSize:12,rate:200,speedPxPerSec:900,glowSize:18 },
};
export const getShipDeflectorSettings = () => settings;
export const normalizeShipDeflectorSettings = s => s;
export const getShipDeflectorEmitters = () => [{facingDeg:90,layer:'above'}];
export const shipDeflectorEmitterToCanvasPoint = token => ({...token.center,layer:'above'});
export const shipEngineFacingToCanvasDeg = (_token, deg) => deg - 90;
export const resolveDeflectorColorHex = (_token,type) => type==='beam' ? '#57ff9a' : '#6fb6ff';
