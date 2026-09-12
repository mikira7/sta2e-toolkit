export * from './weapon-browser-stubs.js';
export const TRACTOR_FACTION_COLORS={};
export const getShipTractorBeamSettings=t=>t.tractorOptions??{};
export const getClosestShipTractorEmitterPoint=t=>t.emitter??null;
export const resolveTractorFactionColorHex=()=> '#44bbff';
export const maskReads={target:0,loads:0};
export const tokenTextureSource=t=>{if(t.id?.startsWith('target'))maskReads.target++;return t.mask?'fixture-mask':null;};
export const mask={width:80,height:80,opaque:[],opaqueSet:new Set()};
for(let y=0;y<80;y++)for(let x=0;x<80;x++)if(((x-40)/28)**2+((y-40)/36)**2<1){mask.opaque.push({x,y});mask.opaqueSet.add(y*80+x);}
export const getTokenAlphaMask=async()=>{maskReads.loads++;return mask;};
