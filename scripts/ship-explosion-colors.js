/** Shared palettes for the volume, glow, particles, fallback, and UI. */
export const SHIP_EXPLOSION_COLORS = Object.freeze({
  classic: { label: "Classic — orange / blue", low: [.85,.14,.018], high: [1,.84,.48],
    plasmaLow: [.035,.23,.68], plasmaHigh: [.58,.85,1], bloom: [1,.42,.12], spark: 0xffa43c, core: 0xfff1ce },
  green: { label: "Borg — green", low: [.035,.48,.012], high: [.67,1,.34],
    plasmaLow: [.01,.28,.08], plasmaHigh: [.53,1,.72], bloom: [.25,1,.08], spark: 0x71ff36, core: 0xe0ffd0 },
  blue: { label: "Blue plasma", low: [.018,.15,.74], high: [.42,.82,1],
    plasmaLow: [.01,.38,.52], plasmaHigh: [.63,1,1], bloom: [.1,.48,1], spark: 0x48bdff, core: 0xdbf8ff },
  red: { label: "Red plasma", low: [.68,.018,.008], high: [1,.46,.24],
    plasmaLow: [.38,.015,.045], plasmaHigh: [1,.58,.48], bloom: [1,.09,.035], spark: 0xff5736, core: 0xffded0 },
  purple: { label: "Violet plasma", low: [.27,.025,.63], high: [.83,.52,1],
    plasmaLow: [.44,.018,.36], plasmaHigh: [1,.64,.9], bloom: [.65,.18,1], spark: 0xc773ff, core: 0xf5dfff },
});

export function normalizeShipExplosionColor(value) {
  return Object.hasOwn(SHIP_EXPLOSION_COLORS, value) ? value : "classic";
}

export function shipExplosionPalette(value) {
  return SHIP_EXPLOSION_COLORS[normalizeShipExplosionColor(value)];
}

export function rgbToHex(rgb) {
  return (Math.round(rgb[0]*255)<<16) | (Math.round(rgb[1]*255)<<8) | Math.round(rgb[2]*255);
}
