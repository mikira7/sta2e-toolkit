/** Visual defaults for the toolkit's survey catalog, shared by planets and moons. */
export const PLANET_CLASS_DEFAULTS = {
  A: { style: "volcanic", texture: "fissures", palette: "basalt" },
  B: { style: "volcanic", texture: "calderas", palette: "sulfur" },
  C: { style: "ice", texture: "fractured", palette: "blue" },
  D: { style: "barren", texture: "cratered", palette: "grey" },
  E: { style: "primordial", texture: "magma", palette: "molten", water: 0, clouds: 15 },
  F: { style: "primordial", texture: "crust", palette: "cooling", water: 5, clouds: 55 },
  G: { style: "primordial", texture: "developing", palette: "young", water: 45, clouds: 40 },
  H: { style: "desert", texture: "dunes", water: 0 },
  I: { style: "gas", texture: "hot", palette: "ember" },
  J: { style: "gas", texture: "banded" },
  K: { style: "desert", texture: "badlands", water: 3, rivers: 12 },
  L: { style: "terrestrial", texture: "continental", water: 35, clouds: 55 },
  M: { style: "terrestrial", texture: "continental" },
  N: { style: "greenhouse", texture: "venus", palette: "venus", clouds: 100 },
  O: { style: "ocean", texture: "archipelago", water: 92 },
  P: { style: "ice", texture: "glacial", palette: "white" },
  Q: { style: "terrestrial", texture: "seasonal", water: 40, clouds: 30 },
  R: { style: "barren", texture: "frozen", palette: "frozen" },
  S: { style: "gas", texture: "turbulent", palette: "gold" },
  T: { style: "gas", texture: "smooth", palette: "azure" },
  Y: { style: "greenhouse", texture: "toxic", palette: "demon", clouds: 100 },
  Belt: { style: "asteroid", texture: "silicate", palette: "stone", rings: false },
};

export const STELLAR_TEXTURES = {
  O: "Type-O blue-hot", B: "Type-B blue-white", A: "Type-A white",
  F: "Type-F yellow-white", G: "Type-G yellow", K: "Type-K orange", M: "Type-M red",
  L: "Type-L brown dwarf", T: "Type-T brown dwarf", Y: "Type-Y brown dwarf",
  "White Dwarf": "White dwarf", "T-Tauri": "T-Tauri young star",
};
export const STELLAR_COLORS = {
  O: ["#608dd8", "#d0e5ff"], B: ["#839ddf", "#e2eeff"], A: ["#b1b9d5", "#f4f5ff"],
  F: ["#c6aa77", "#fff4d7"], G: ["#bb6e21", "#ffe8a3"], K: ["#a44219", "#ffb55f"],
  M: ["#651f16", "#f27742"], L: ["#31131a", "#be5533"],
  T: ["#19151c", "#794335"], Y: ["#151720", "#4d4346"],
  "White Dwarf": ["#9daed5", "#f0f6ff"], "T-Tauri": ["#7e321e", "#ffd388"],
};

export function proceduralBodyDefaults(body = {}) {
  if (body.spectralType || (!body.type && body.classification)) {
    const source = String(body.spectralType || body.classification);
    const texture = /white\s+dwarf/i.test(source) ? "White Dwarf" : /t-?tauri/i.test(source) ? "T-Tauri" : source.charAt(0).toUpperCase();
    return { style: "star", texture: Object.hasOwn(STELLAR_TEXTURES, texture) ? texture : "G", palette: "spectral", rings: false };
  }
  const type = String(body.type ?? "");
  const cls = /Asteroid Belt/i.test(type) ? "Belt" : type.match(/Class-([A-Z])/i)?.[1]?.toUpperCase();
  const notes = `${type} ${body.notes ?? ""}`;
  if ((["C", "D"].includes(cls) && /asteroid[- ]scale/i.test(notes)) || (!cls && /asteroid|moonlet/i.test(type))) {
    const icy = cls === "C" || /icy/i.test(notes);
    return { style: "asteroid", texture: icy ? "icy" : "silicate", palette: icy ? "frost" : "stone", rings: false };
  }
  if (cls === "D" && /icy/i.test(type)) return { style: "ice", texture: "cratered", palette: "blue" };
  return { ...(PLANET_CLASS_DEFAULTS[cls] ?? PLANET_CLASS_DEFAULTS.D) };
}
