/** Pre-rendered room interiors complement the individually placed furniture library. */
const BASE="modules/sta2e-toolkit/assets/interiors/";
export const INTERIOR_ROOM_KITS={assembled:"Individual furniture assets",starfleet:"Pre-rendered Starfleet TNG kit"};
export const INTERIOR_KIT_IMAGES=Object.fromEntries(["room-bridge","room-medical","room-engineering","room-quarters","room-lift","room-lounge","room-office","corridor-straight","corridor-junction"].map(id=>[`kit-${id}`,`${BASE}${id}.png`]));
const ROOM_IMAGES={bridge:"bridge",ops:"bridge",medical:"medical",engineering:"engineering",reactor:"engineering",quarters:"quarters",lift:"lift",lounge:"lounge",office:"office"};
// Mean RGB of the four 40px corner samples from each original PNG, used for surrounding deck material.
const FLOORS={bridge:"#343330",medical:"#4c4647",engineering:"#544f52",quarters:"#61595c",lift:"#544d4d",lounge:"#47423f",office:"#423d39"};
export function interiorKitPaths(recipe) {return recipe.roomKit==="starfleet"?INTERIOR_KIT_IMAGES:{};}
export function interiorRoomKitPlacement(room,recipe) {
  if(room.compactLift||room.architecture)return null;
  const kind=ROOM_IMAGES[room.kind];if(recipe.roomKit!=="starfleet"||!kind)return null;
  // Uniform scale preserves furniture proportions; a clear border separates the kit from native doors.
  const size=Math.min(6,room.frame.w-.7,room.frame.h-.7);
  if(size<2.5)return null;
  return {key:`kit-room-${kind}`,x:-size/2,y:-size/2,w:size,h:size,floor:FLOORS[kind]};
}
