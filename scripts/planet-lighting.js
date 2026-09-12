/** A physical phase angle with a small artistic ambient floor for map readability. */
export function planetLightDirection(recipe) {
  const angle = recipe.phaseAngle * Math.PI / 180;
  return { y: -Math.sin(angle), z: Math.cos(angle) };
}
export function planetIllumination(recipe, lightDot, viewZ) {
  const ambient = recipe.nightBrightness / 100;
  const diffuse = Math.max(0, lightDot);
  const cloudy = recipe.style === "gas" || recipe.style === "greenhouse";
  const reflected = cloudy ? Math.sqrt(diffuse) * (.65 + .35 * Math.pow(viewZ, .25)) : Math.pow(diffuse, .85);
  return ambient + (1 - ambient) * reflected;
}
