export const settings = { enabled: true,
  impulse: { width: 12, glowSize: 14, lengthPx: 150, fade: 600, alpha: .8, blendMode: 'add' },
  warp: { width: 9, glowSize: 18, alpha: .85, chargeMode: 'flood' },
};
export const getShipEngineTrailSettings = () => settings;
export const normalizeShipEngineTrailSettings = v => v;
export const resolveEngineTrailColorHex = (_token, kind) => kind === 'warp' ? '#369dff' : '#ff572e';
export const getShipEngineEmitters = () => [{x:0,y:0,kind:'impulse'}];
export const shipEngineEmitterToCanvasPoint = t => t.center;
export const shipEngineFacingToCanvasDeg = () => 90;
export const getShipWarpCurves = t => t.curves;
export const tokenArrayCurveToCanvasCurve = (t, c) => c.map(p => ({x:p.x+t.center.x,y:p.y+t.center.y}));
export const sampleShipArrayCurve = c => c;
export const warpCurveAftIsEnd = c => !c.reversed;
export const getWarpEffectStyle = () => ({});
export const normalizeWarpEffectStyleId = v => v;
export const resolveWarpSoundKey = v => v;
