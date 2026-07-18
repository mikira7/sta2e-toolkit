/**
 * sta2e-toolkit | star-system-sheet.js
 * Module-owned actor sheet for sector-map star systems.
 */

import { getLcCssVars } from "./lcars-theme.js";
import { pickStarSystemImage, composeStarSystemImage } from "./star-system-images.js";

export const STAR_SYSTEM_FLAG = "starSystem";
export const STAR_SYSTEM_SHEET_ID = "sta2e-toolkit.StarSystemActorSheet";

const MODULE_ID = "sta2e-toolkit";
const DEFAULT_IMG = "icons/svg/planet.svg";

const CLASSIFICATIONS = [
  "Primary Star System",
  "Binary Star System",
  "Trinary Star System",
  "Multiple Star System",
  "Rogue Planet",
  "Deep Space Anomaly",
  "Nebula System",
  "Star Cluster",
  "Station or Colony",
];

const AFFILIATIONS = [
  "Federation",
  "Independent",
  "Unaligned",
  "Klingon Empire",
  "Romulan Free State",
  "Cardassian Union",
  "Breen Confederacy",
  "Ferengi Alliance",
  "Unknown",
];

const SPECTRAL_DESCRIPTIONS = {
  O: "blue-hot massive star",
  B: "blue-white star",
  A: "white star",
  F: "yellow-white star",
  G: "yellow star",
  K: "orange star",
  M: "red star",
  L: "brown dwarf",
  Y: "brown dwarf",
  T: "brown dwarf",
  "White Dwarf": "stellar remnant",
  "T-Tauri": "young variable star",
};

const STAR_TYPE_DESCRIPTIONS = {
  O: "Blue-hot, extremely massive stars with short lifespans. Their systems are rare, intense, and often hostile to stable long-term biospheres.",
  B: "Blue-white high-mass stars that burn quickly and may end in supernovae. Worlds here tend to face harsh radiation and short evolutionary windows.",
  A: "Bright white stars such as Sirius or Vega. They are luminous and young enough that complex life is uncommon without unusual circumstances.",
  F: "Yellow-white stars with a relatively short main-sequence lifetime. Habitable worlds can exist, but complex ecosystems are less common than around cooler stars.",
  G: "Yellow stars like Sol. Stable light and moderate lifespans make them strong candidates for Class-M worlds and settled systems.",
  K: "Orange stars that are common, stable, and long-lived. They are excellent hosts for enduring planetary systems and habitable-zone surveys.",
  M: "Small, cool red stars, by far the most common stellar type. Their long lifespans are balanced by frequent flare activity and tight habitable zones.",
  L: "Brown dwarfs are dim substellar bodies that slowly cool over time. They do not use the standard luminosity sequence and often host cold, compact systems.",
  Y: "Very cool brown dwarfs with faint emissions. Their systems are difficult to detect and rarely support conventional habitable worlds.",
  T: "Methane-rich brown dwarfs that bridge warmer and colder substellar bodies. Worlds nearby are usually dim, cold, and exotic.",
  "White Dwarf": "A dense stellar remnant left after a smaller star sheds its outer layers. It has no luminosity type and its surviving system is often ancient or disrupted.",
  "T-Tauri": "A young variable star that has not settled onto the main sequence. Strong winds, flares, and protoplanetary material make its system volatile.",
};

const STAR_TYPE_DETAILS = {
  M: {
    label: "Type-M Red Star",
    text: "Type-M stars are the smallest and coolest hydrogen-burning stars. Main-sequence examples are dim, extremely long-lived, and very common across the Galaxy. Many Type-M systems experience frequent stellar flares, so radiation storms and compact habitable zones are common survey concerns. Larger aging stars can also cool into Type-M red giant classifications.",
  },
  K: {
    label: "Type-K Orange Star",
    text: "Type-K stars are cool orange stars, generally less massive than Sol but more stable than many Type-M stars. Their long main-sequence lifetimes make them excellent hosts for long-lived planetary systems and careful Class-M surveys. Larger Type-K giants and supergiants are evolved from more massive stars and have much shorter remaining lifespans.",
  },
  G: {
    label: "Type-G Yellow Star",
    text: "Type-G stars are yellow stars like Sol, with main-sequence lifetimes around ten billion years. They are relatively stable and are commonly studied for possible Class-M worlds because they provide enough time and heavy-element abundance for complex ecosystems to develop. Giants and supergiants can also exist in this spectral type, but their planetary systems are usually less stable.",
  },
  F: {
    label: "Type-F Yellow-White Star",
    text: "Type-F stars are hotter and more massive than Type-G stars, and are among the hottest stars still considered plausible hosts for familiar life. Their main-sequence lifetimes are shorter, usually only a few billion years, so complex life is less common but not impossible. Worlds around Type-F stars often face brighter radiation and a narrower evolutionary window.",
  },
  A: {
    label: "Type-A White Star",
    text: "Type-A, Type-B, and Type-O stars are rare, massive, hot stars with short lifespans compared with cooler main-sequence stars. Type-A stars are bright white stars, Type-B stars are blue-white and far more massive, and Type-O stars are the largest blue-hot main-sequence stars. These stars can dominate a region's radiation and space-weather profile, and natural complex biospheres are uncommon because their systems have little time to settle before stellar evolution or supernova end states intervene.",
  },
  B: {
    label: "Type-B Blue-White Star",
    text: "Type-A, Type-B, and Type-O stars are rare, massive, hot stars with short lifespans compared with cooler main-sequence stars. Type-A stars are bright white stars, Type-B stars are blue-white and far more massive, and Type-O stars are the largest blue-hot main-sequence stars. These stars can dominate a region's radiation and space-weather profile, and natural complex biospheres are uncommon because their systems have little time to settle before stellar evolution or supernova end states intervene.",
  },
  O: {
    label: "Type-O Blue-Hot Star",
    text: "Type-A, Type-B, and Type-O stars are rare, massive, hot stars with short lifespans compared with cooler main-sequence stars. Type-A stars are bright white stars, Type-B stars are blue-white and far more massive, and Type-O stars are the largest blue-hot main-sequence stars. These stars can dominate a region's radiation and space-weather profile, and natural complex biospheres are uncommon because their systems have little time to settle before stellar evolution or supernova end states intervene.",
  },
  L: {
    label: "Type-L Brown Dwarf",
    text: "Type-L, Type-Y, and Type-T brown dwarfs are substellar objects rather than ordinary hydrogen-burning stars. They fuse limited deuterium early in their lives and then slowly cool with age, so they do not use spectral subdivision or the normal luminosity table. Their systems are dim, compact, cold, and difficult to survey by ordinary visible-light methods.",
  },
  Y: {
    label: "Type-Y Brown Dwarf",
    text: "Type-L, Type-Y, and Type-T brown dwarfs are substellar objects rather than ordinary hydrogen-burning stars. They fuse limited deuterium early in their lives and then slowly cool with age, so they do not use spectral subdivision or the normal luminosity table. Their systems are dim, compact, cold, and difficult to survey by ordinary visible-light methods.",
  },
  T: {
    label: "Type-T Brown Dwarf",
    text: "Type-L, Type-Y, and Type-T brown dwarfs are substellar objects rather than ordinary hydrogen-burning stars. They fuse limited deuterium early in their lives and then slowly cool with age, so they do not use spectral subdivision or the normal luminosity table. Their systems are dim, compact, cold, and difficult to survey by ordinary visible-light methods.",
  },
  "White Dwarf": {
    label: "White Dwarf",
    text: "White dwarfs are dense stellar remnants left after smaller stars shed their outer layers at the end of their giant phase. They are roughly planetary in size, do not have a luminosity type, and are often surrounded by ancient or disrupted orbital environments. Surviving worlds may be old, stripped, or otherwise changed by the star's earlier life.",
  },
  "T-Tauri": {
    label: "T-Tauri Star",
    text: "T-Tauri stars are young variable stars that have not settled onto the main sequence. Their brightness can vary due to sunspots, accretion material, and active stellar behavior. Strong solar winds, flares, and protoplanetary discs make their systems volatile and unfinished.",
  },
};

const PLANET_TYPE_DESCRIPTIONS = {
  A: "Geologically active rocky worlds with little atmosphere and molten or mineral-rich surfaces. They are poor habitats but can be valuable survey or mining targets.",
  B: "Violently volcanic worlds shaped by intense internal or tidal heating. Mineral wealth may be high, but seismic activity and toxic conditions make operations hazardous.",
  C: "Old icy or geologically inactive worlds whose active past is preserved in frozen surfaces and dead terrain. Atmospheres are usually trace, frozen, or absent.",
  D: "Small barren rocky or icy bodies with little atmosphere. They are common mining, outpost, moon, or starbase-construction candidates.",
  E: "Young primordial worlds in the habitable zone with unstable crusts and temporary atmospheres. They are early precursors to later life-bearing planets.",
  F: "Primordial worlds beginning to solidify with early continents and thicker outgassed atmospheres. Surface water is unstable and conditions remain hostile.",
  G: "Young ocean-forming primordial worlds where simple life may begin. They are chemically rich but hostile compared with mature habitable worlds.",
  H: "Arid worlds with limited surface water and marginal habitability. Life or settlements often survive in protected lowlands, underground, or engineered habitats.",
  I: "Hot gas giants orbiting close to their star. Their atmospheres contain exotic compounds and may trail material from stellar heating.",
  J: "Large Jovian gas giants with hydrogen-helium atmospheres and extensive moon systems. Outer-system examples often dominate local orbital architecture.",
  K: "Adaptable but underdeveloped terrestrial worlds with thin atmospheres or weak magnetic fields. Terraforming is possible but requires long-term maintenance.",
  L: "Marginally habitable worlds with plant life or oxygen-bearing atmospheres, but difficult pressure, CO2, or toxin levels. Surface operations often need equipment.",
  M: "Terrestrial Class-M worlds with liquid water, breathable atmospheres, and complex ecosystems. They are prime candidates for colonies and civilizations.",
  N: "Dense, Venus-like worlds with heavy carbon-dioxide atmospheres and extreme greenhouse conditions. Terraforming is possible only with major effort.",
  O: "Ocean worlds with most of the surface covered by liquid water and oxygen-bearing atmospheres. Life often clusters around seas, islands, and undersea activity.",
  P: "Glaciated water worlds with ice-covered surfaces and subsurface oceans. They may support life and limited surface operations in cold conditions.",
  Q: "Highly elliptical worlds with temporary habitable seasons. Any life tends to be hardy, dormant, or adapted to extreme orbital variation.",
  R: "Rogue worlds traveling outside a star system. Life, if present, usually survives around geothermal sources under hostile surface conditions.",
  S: "Super-Jovian worlds inside the habitable zone, approaching brown-dwarf scale without full deuterium fusion. Their atmospheres are massive and metal-rich.",
  T: "Cold super-Jovian worlds in or beyond the habitable zone. They are helium-rich giants with enormous mass and complex moon environments.",
  Y: "Demon worlds with extreme atmospheres, gravity, weather, and radiation. They are profoundly hostile to most known life.",
  Belt: "An asteroid belt or debris field rather than a single major planet. It may contain mining claims, hazards, ruins, or navigational complications.",
};

const PLANET_TYPE_DETAILS = {
  A: {
    label: "Class-A Geothermal World",
    text: "Class-A worlds are rocky or metallic geologically active bodies with little to no atmosphere and areas of molten surface material. Any atmosphere is usually outgassed from molten regions, often carbon dioxide, sulphur compounds, or other volcanic gases. They have little life or colonization potential but can contain excellent mineral reserves and unusual subsurface chemical environments.",
  },
  B: {
    label: "Class-B Geomorteus World",
    text: "Class-B worlds are intensely volcanic and geologically active, often shaped by internal heating, tidal stress, or close stellar proximity. They have little potential for life and are difficult to exploit despite major mineral wealth. Constant tremors, eruptions, molten flows, and toxic or minimal atmospheres make surface operations hazardous.",
  },
  C: {
    label: "Class-C Icy Geoinactive World",
    text: "Class-C worlds were once active but have long since lost the energy needed for volcanism or plate tectonics. Their surfaces may preserve ancient lava flows, rifts, dead volcanoes, and frozen atmospheres. They are usually too small or too cold for a dense gas envelope, though impacts or close stellar passages can briefly reactivate activity.",
  },
  D: {
    label: "Class-D Barren World",
    text: "Class-D worlds are small airless rocky or icy bodies with little lasting geological activity. Inner-system examples tend to be rock and metal, while colder examples may include ammonia, methane, nitrogen, oxygen, or water ices. They are common as moons, mining bodies, outpost sites, habitats, or starbase-construction candidates.",
  },
  E: {
    label: "Class-E Geoplastic World",
    text: "Class-E worlds are young primordial bodies in a star's habitable zone. Their surfaces have not fully cooled and solidified, and their atmospheres are temporary products of interior outgassing. They are early precursors to later life-bearing planets but remain unstable and hostile.",
  },
  F: {
    label: "Class-F Primordial World",
    text: "Class-F worlds have begun to solidify, with permanent landforms and early continents forming. Surface water remains transitory, and rain may fall only to vaporize again. Their thicker primordial atmospheres are commonly dominated by carbon dioxide, nitrogen, and sulphur dioxide.",
  },
  G: {
    label: "Class-G Developing World",
    text: "Class-G worlds resemble very young ocean-forming terrestrial planets. They may have solid crust, oceans, dissolved complex chemicals, and enough energy for simple carbon-based life to begin. Free oxygen is not present in significant quantities, so any life is usually simple, chemical, or photosynthetic.",
  },
  H: {
    label: "Class-H Desert World",
    text: "Class-H worlds are arid bodies with limited surface or crustal water. Their magnetic fields can help maintain atmospheres, and life may exist around lowlands, small lakes, underground reservoirs, or protected seasonal habitats. Terraforming is possible but water import and long-term maintenance are major challenges.",
  },
  I: {
    label: "Class-I Hot Jupiter",
    text: "Class-I worlds are gas giants orbiting close to their stars, inside or near the inner system. Their atmospheres are hydrogen-helium based but enriched by exotic compounds such as sulphur dioxide, hydrochloric acid, and ionized metals. Close stellar heating can strip atmosphere and trail gas behind the planet like a comet tail.",
  },
  J: {
    label: "Class-J Jovian World",
    text: "Class-J worlds are large gas giants found in habitable zones and outer systems. Their hydrogen-helium atmospheres can include water, methane, ammonia, and hydrocarbons, producing wide color bands and complex weather. They often dominate local orbital architecture and may host large moons with atmospheres and class traits of their own.",
  },
  K: {
    label: "Class-K Adaptable World",
    text: "Class-K worlds are bodies in a habitable zone that are too small or weakly shielded to hold dense atmospheres over long timescales. They usually have thin or absent atmospheres, little surface water, and lifeless surfaces, though protected subsurface life is possible. Terraforming can work but requires continual maintenance.",
  },
  L: {
    label: "Class-L Marginal World",
    text: "Class-L worlds are barely habitable. They may have water, plant life, and oxygen, but pressure, carbon dioxide, or trace toxins commonly require breathing apparatus or pressure gear. Colonies and survey teams can function on the surface, but conditions are uncomfortable and regionally uneven.",
  },
  M: {
    label: "Class-M Terrestrial World",
    text: "Class-M worlds are prime life-bearing planets with stable liquid water, breathable atmospheres, complex ecosystems, and comfortable gravity for many humanoids. They support varied climates, water-based weather, and broad biological diversity. Tidally locked Class-M variants and Class-M moons around gas giants can exist as important subtypes.",
  },
  N: {
    label: "Class-N Reducing World",
    text: "Class-N worlds are Venus-like rocky planets with extremely dense atmospheres and runaway greenhouse conditions. Their atmospheres are typically carbon dioxide rich, with volcanic gases such as sulphur dioxide plus traces of methane and water vapor. They are possible terraforming targets only with enormous effort.",
  },
  O: {
    label: "Class-O Pelagic/Ocean World",
    text: "Class-O worlds are water worlds with most of their surface covered by liquid ocean and an oxygen-bearing atmosphere. Life often clusters around limited landmasses, islands, coastlines, and undersea volcanic regions. Some Class-O worlds are tidally locked eyeball worlds, while super-Earth versions may have extreme depth, gravity, dense air, and harsh weather.",
  },
  P: {
    label: "Class-P Glaciated World",
    text: "Class-P worlds are ice-covered water worlds with liquid water beneath the surface ice and oxygen-bearing atmospheres in many cases. Rocky outcroppings, islands, or landmasses may exist but are rare. Subclasses include tidally locked eyeball worlds and massive icy super-Earths with heavy gravity and severe weather.",
  },
  Q: {
    label: "Class-Q Variable World",
    text: "Class-Q worlds follow highly elliptical orbits that bring them through habitable conditions only temporarily. Life, if present, is adapted to hibernation, dormancy, or extreme seasonal change. Breathable atmospheres and mild surface conditions may be temporary or localized.",
  },
  R: {
    label: "Class-R Rogue World",
    text: "Class-R worlds drift outside normal star systems. Most resemble cold barren bodies, but geothermal activity can support life around vents or deep subsurface habitats. Surface atmospheres are usually unbreathable, and survivable temperatures are restricted to local heat sources.",
  },
  S: {
    label: "Class-S Super-Jovian World",
    text: "Class-S worlds are massive gas giants approaching brown dwarf scale without normal deuterium fusion as a star. They are helium rich, metal rich, and often orbit inside or near habitable zones. Their gravity, atmosphere, and moon environments can be extreme and strategically significant.",
  },
  T: {
    label: "Class-T Super-Jovian World",
    text: "Class-T worlds are cold super-Jovians in the habitable zone or outer system. They are helium-rich giants with enormous mass and complex weather, often hosting major moons and many smaller captured moonlets. Their major moons can resemble smaller Class-C, Class-D, or Class-P bodies depending on orbit and heating.",
  },
  Y: {
    label: "Class-Y Demon World",
    text: "Class-Y worlds are profoundly hostile planets with extreme atmospheres, gravity, weather, radiation, and dangerous chemistry. They can contain heavy elements, intense storms, toxic pressure conditions, and natural radiation hazards. Only exotic life is likely, and routine surface operations are exceptionally dangerous.",
  },
  Belt: {
    label: "Asteroid Belt",
    text: "An asteroid belt is a debris field or collection of smaller orbital bodies rather than one major planet. Belts can contain mining claims, hazards, ruins, navigational problems, or construction resources. In generator results, they occupy an orbital slot and should be treated as a terrain feature of the system.",
  },
};

const MOON_TYPE_DETAILS = {
  general: {
    label: "Moon Type Guidance",
    text: "Moons use the same planetary class language as worlds, but at smaller scale. A single moon around a non-Jovian world is usually a large Luna-like Class-D or Class-C body, while multiple moons are generally smaller asteroid-like Class-D/Class-C bodies. Their mass and radius should be interpreted in lunar terms, and their details depend strongly on the host planet and zone.",
  },
  nonJovian: {
    label: "Non-Jovian Moons",
    text: "Non-Jovian worlds usually have one large moon or several smaller captured moons. A single moon is often a Luna-scale Class-D barren body or Class-C icy body; multiple moons tend to be asteroid-scale Class-D/Class-C moonlets. Inner worlds and Type-M primary systems tend to have fewer stable moons because close orbits destabilize moon formation and retention.",
  },
  hotJupiter: {
    label: "Hot Jupiter Moons",
    text: "Class-I hot Jupiters normally have fewer moons than outer gas giants. Their major moons are usually captured, stripped, or small bodies: Class-D barren/captured moonlets or occasional Class-C icy moons at small moon scale. Close stellar heating, tidal stress, and atmospheric loss make stable large moons less common.",
  },
  jovianPrimary: {
    label: "Habitable-Zone Jovian Moons",
    text: "A Jovian in the habitable zone may have major moons that share planetary class traits at moon scale. Class-K moons are adaptable but thin-atmosphere bodies, Class-L moons are marginally habitable, Class-M moons may be true life-bearing terrestrial moons, and Class-D moons are barren Luna-scale companions. These moons can be survey highlights because they may hold atmospheres, surface water, ecosystems, or colony potential despite orbiting a gas giant.",
  },
  jovianOuter: {
    label: "Outer Jovian Moons",
    text: "Outer-system Jovians and Super-Jovians can have several major moons plus many smaller moonlets. Their major moons commonly share smaller-scale Class-C icy, Class-D barren, or Class-P glaciated traits, shaped by ice, tidal heating, capture history, and distance from the star. Class-T hosts can support especially cold and massive moon systems.",
  },
};

const ATMOSPHERE_DETAIL_DESCRIPTIONS = {
  "none or trace": "No meaningful breathable envelope. Surface activity usually requires pressure suits, radiation protection, and careful thermal planning.",
  "trace or frozen": "Atmospheric gases are mostly absent, frozen onto the surface, or present only as a thin inert layer.",
  "thin volcanic outgassing": "A weak atmosphere fed by molten regions or interior activity, often rich in carbon dioxide, sulphur compounds, and other irritants.",
  "temporary outgassing": "The atmosphere is unstable and mostly produced by active geology. Surface pressure and composition can change quickly over geologic time.",
  "thin breathable or marginal": "A survivable but fragile envelope. Long surface operations may need masks, filters, or pressure support depending on local conditions.",
  "marginal; breathing apparatus common": "Oxygen may be present, but pressure, carbon dioxide, or trace toxins make breathing gear normal for humanoid visitors.",
  "Class-M breathable": "A stable nitrogen-oxygen atmosphere with liquid water support. Standard humanoid surface operations are usually possible.",
  "oxygen-bearing humid": "A wet oxygen atmosphere shaped by extensive oceans. Expect heavy weather, salt corrosion, and dense cloud systems.",
  "oxygen-bearing cold": "A breathable or near-breathable cold atmosphere over ice and subsurface water. Exposure and weather remain serious hazards.",
  "dense carbon dioxide": "A high-pressure greenhouse atmosphere dominated by carbon dioxide, often with sulphur compounds or water vapor.",
  "toxic volcanic": "A corrosive volcanic atmosphere with hazardous gases, ash, and seismic instability.",
  "extreme toxic": "A lethal atmosphere with severe weather, radiation, and chemically dangerous surface conditions.",
  "hydrogen/helium": "A deep gas-giant atmosphere dominated by hydrogen and helium, with no solid surface and intense pressure below the cloud layers.",
  "hydrogen/helium with exotic compounds": "A hot giant atmosphere with hydrogen, helium, and strong traces of sulphur, acids, metals, or ionized material.",
  "helium-rich metallic": "A massive, metal-rich giant atmosphere with helium enrichment and extreme pressure gradients.",
  "helium-rich cold giant": "A cold super-Jovian atmosphere, helium rich and massive, with complex outer-system weather bands.",
  "thin or none": "A low-pressure or absent atmosphere caused by weak gravity, poor magnetic shielding, or long-term atmospheric loss.",
};

const SPECTRAL_RANK = { L: 0, Y: 0, T: 0, M: 1, K: 2, G: 3, F: 4, A: 5, B: 6, O: 7 };

const SPECTRAL_TABLE = [
  { min: 1, max: 12, value: "M" },
  { min: 13, max: 16, value: "K" },
  { min: 17, max: 18, value: "G" },
  { min: 19, max: 19, value: "F" },
  { min: 20, max: 20, value: "special" },
];

const SPECIAL_SPECTRAL_TABLE = [
  { min: 1, max: 2, value: "A" },
  { min: 3, max: 4, value: "B" },
  { min: 5, max: 6, value: "O" },
  { min: 7, max: 12, value: "brown-dwarf" },
  { min: 13, max: 14, value: "white-or-ttauri" },
  { min: 15, max: 20, value: "phenomena" },
];

const LUMINOSITY_TABLE = [
  { min: 1, max: 2, value: "VI" },
  { min: 3, max: 16, value: "V" },
  { min: 17, max: 18, value: "IV" },
  { min: 19, max: 19, value: "III" },
  { min: 20, max: 20, value: () => pick(["II", "Ib", "Ia"]) },
];

const MULTIPLE_STARS_TABLE = [
  { min: 1, max: 6, value: 1 },
  { min: 7, max: 17, value: 2 },
  { min: 18, max: 19, value: 3 },
  { min: 20, max: 20, value: 4 },
];

const NUMBER_OF_PLANETS_TABLE = [
  { min: -99, max: 1, value: 1 },
  { min: 2, max: 5, value: 3 },
  { min: 6, max: 8, value: 5 },
  { min: 9, max: 15, value: 7 },
  { min: 16, max: 17, value: 9 },
  { min: 18, max: 19, value: 10 },
  { min: 20, max: 99, value: 11 },
];

const INNER_WORLD_TABLE = [
  { min: 1, max: 1, value: () => pick(["Class-A (Geothermal)", "Class-Y (Demon)"]) },
  { min: 2, max: 3, value: "Class-B (Geomorteus)" },
  { min: 4, max: 6, value: "Class-N (Reducing)" },
  { min: 7, max: 10, value: "Class-I (Hot Jupiter)" },
  { min: 11, max: 17, value: () => pick(["Class-D (Barren)", "Asteroid Belt"]) },
  { min: 18, max: 19, value: "Class-H (Desert)" },
  { min: 20, max: 20, value: () => pick(["Class-L (Marginal)", "Class-K (Adaptable)", "Class-M (Terrestrial)"]) },
];

const PRIMARY_WORLD_TABLE = [
  { min: 1, max: 1, value: "Class-J (Jovian)" },
  { min: 2, max: 5, value: () => pick(["Class-L (Marginal)", "Class-E (Geoplastic)"]) },
  { min: 6, max: 12, value: "Class-M (Terrestrial)" },
  { min: 13, max: 18, value: "Class-K (Adaptable)" },
  { min: 19, max: 20, value: () => pick(["Class-O (Pelagic/Ocean)", "Class-P (Glaciated)"]) },
];

const FORCE_HABITABLE_TABLE = [
  { min: 1, max: 10, value: "Class-M (Terrestrial)" },
  { min: 11, max: 14, value: "Class-L (Marginal)" },
  { min: 15, max: 17, value: "Class-O (Pelagic/Ocean)" },
  { min: 18, max: 20, value: "Class-P (Glaciated)" },
];

const WORLD_ZONE_OPTIONS = ["Inner Worlds", "Primary World", "Outer Worlds"];

const WORLD_TYPE_OPTIONS = [
  "Class-A (Geothermal)",
  "Class-B (Geomorteus)",
  "Class-C (Icy Geoinactive)",
  "Class-D (Barren)",
  "Class-D (Icy/Rocky Barren)",
  "Class-E (Geoplastic)",
  "Class-H (Desert)",
  "Class-I (Hot Jupiter)",
  "Class-J (Jovian)",
  "Class-J (Jovian; Gas Giant)",
  "Class-K (Adaptable)",
  "Class-L (Marginal)",
  "Class-M (Terrestrial)",
  "Class-N (Reducing)",
  "Class-O (Pelagic/Ocean)",
  "Class-P (Glaciated)",
  "Class-T (Super Jovian)",
  "Class-Y (Demon)",
  "Asteroid Belt",
];

const ATMOSPHERE_OPTIONS = [
  "none or trace",
  "trace or frozen",
  "thin volcanic outgassing",
  "temporary outgassing",
  "thin breathable or marginal",
  "marginal; breathing apparatus common",
  "Class-M breathable",
  "oxygen-bearing humid",
  "oxygen-bearing cold",
  "dense carbon dioxide",
  "toxic volcanic",
  "extreme toxic",
  "hydrogen/helium",
  "hydrogen/helium with exotic compounds",
  "helium-rich metallic",
  "helium-rich cold giant",
];

const RING_OPTIONS = ["", "No", "Yes"];
const MOON_RECORD_FIELDS = ["id", "orbit", "name", "type", "atmosphere", "population", "rings", "mass", "radius", "gravity", "notes", "image"];

const OUTER_WORLD_TABLE = [
  { min: 1, max: 1, value: "Class-L (Marginal)" },
  { min: 2, max: 5, value: "Class-C (Icy Geoinactive)" },
  { min: 6, max: 14, value: "Class-J (Jovian; Gas Giant)" },
  { min: 15, max: 18, value: () => pick(["Class-D (Icy/Rocky Barren)", "Asteroid Belt"]) },
  { min: 19, max: 19, value: "Class-T (Super Jovian)" },
  { min: 20, max: 20, value: "Class-P (Glaciated)" },
];

const NUMBER_OF_MOONS_TABLE = [
  { min: -99, max: 10, value: 1 },
  { min: 11, max: 15, value: 2 },
  { min: 16, max: 17, value: 3 },
  { min: 18, max: 19, value: 4 },
  { min: 20, max: 99, value: 5 },
];

const MASS_SIZE_TABLE = [
  { min: 1, max: 1, value: { mass: 0.6, radius: 0.80 } },
  { min: 2, max: 3, value: { mass: 0.7, radius: 0.85 } },
  { min: 4, max: 6, value: { mass: 0.8, radius: 0.90 } },
  { min: 7, max: 10, value: { mass: 0.9, radius: 0.95 } },
  { min: 11, max: 14, value: { mass: 1.0, radius: 1.00 } },
  { min: 15, max: 17, value: { mass: 1.1, radius: 1.05 } },
  { min: 18, max: 19, value: { mass: 1.25, radius: 1.10 } },
  { min: 20, max: 20, value: { mass: 1.5, radius: 1.15 } },
];

const PHENOMENA_TABLE = {
  low: [
    { min: 1, max: 3, value: "Radiation Storm / Stellar Flare Type II" },
    { min: 4, max: 8, value: "Radiation Storm Type I" },
    { min: 9, max: 13, value: "Ion Storm Type I" },
    { min: 14, max: 17, value: "Nebula Type I" },
    { min: 18, max: 20, value: "Stellar Flare Type III" },
  ],
  kg: [
    { min: 1, max: 3, value: "Stellar Flare Type I" },
    { min: 4, max: 8, value: "Ion Storm Type I" },
    { min: 9, max: 13, value: "Radiation Storm Type I" },
    { min: 14, max: 17, value: "Ion Storm Type II" },
    { min: 18, max: 20, value: "Stellar Flare Type I" },
  ],
  f: [
    { min: 1, max: 3, value: "Radiation Storm Type II" },
    { min: 4, max: 8, value: "Ion Storm Type II" },
    { min: 9, max: 13, value: "Radiation Storm Type I" },
    { min: 14, max: 17, value: "Ion Storm Type III" },
    { min: 18, max: 20, value: "Radiation Storm Type II" },
  ],
  a: [
    { min: 1, max: 3, value: "Nebula Type I" },
    { min: 4, max: 8, value: "Radiation Storm Type III" },
    { min: 9, max: 13, value: "Gravity Waves Type I" },
    { min: 14, max: 17, value: "Stellar Flare Type II" },
    { min: 18, max: 20, value: "Ion Storm Type III" },
  ],
  high: [
    { min: 1, max: 3, value: "Radiation / Ion Storm Type IV" },
    { min: 4, max: 8, value: "Radiation / Ion Storm Type III" },
    { min: 9, max: 13, value: () => pick(["Gravity Waves Type II", "Gravity Waves Type III"]) },
    { min: 14, max: 17, value: "Stellar Flare Type IV" },
    { min: 18, max: 20, value: "Radiation / Ion Storm Type IV" },
  ],
};

const REGION_ADJECTIVES = [
  "Aster", "Briar", "Calypso", "Deneb", "Erebus", "Frontier", "Galen",
  "Hawking", "Izanami", "Janus", "Kepler", "Lysander", "Meridian", "Nereid",
  "Orpheus", "Praxis", "Quirinus", "Relay", "Sagan", "Tarsus", "Vega",
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollD20(modifier = 0) {
  return randomInt(1, 20) + modifier;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function rollTable(table, roll = rollD20()) {
  const entry = table.find(row => roll >= row.min && roll <= row.max) ?? table.at(-1);
  return typeof entry?.value === "function" ? entry.value(roll) : entry?.value;
}

function uid() {
  return foundry?.utils?.randomID?.(8) ?? Math.random().toString(36).slice(2, 10);
}

function clampText(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function normalizeRows(value, fallback = []) {
  if (Array.isArray(value)) return value.filter(row => row && Object.values(row).some(v => String(v ?? "").trim()));
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort((a, b) => Number(a) - Number(b))
      .map(key => value[key])
      .filter(row => row && Object.values(row).some(v => String(v ?? "").trim()));
  }
  return fallback;
}

function numberText(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return String(Math.round(num * (10 ** digits)) / (10 ** digits));
}

function worldClass(value) {
  const match = String(value ?? "").match(/Class-([A-Z])/i);
  return match ? match[1].toUpperCase() : String(value ?? "").includes("Asteroid Belt") ? "Belt" : "";
}

function isGasGiantWorld(value) {
  return ["I", "J", "S", "T"].includes(worldClass(value));
}

function isSolidWorld(value) {
  const cls = worldClass(value);
  return !!cls && cls !== "Belt" && !isGasGiantWorld(value);
}

function isHabitableWorld(value) {
  return ["M", "L", "O", "P"].includes(worldClass(value));
}

function numberedRows(rows) {
  return rows.map((row, index) => ({ ...row, index }));
}

function optionRows(options, selected) {
  const selectedText = String(selected ?? "");
  const fullOptions = selectedText && !options.includes(selectedText)
    ? [selectedText, ...options]
    : options;
  return fullOptions.map(option => ({
    value: option,
    label: option || "Blank",
    selected: option === selectedText,
  }));
}

function worldContextRows(rows) {
  return numberedRows(rows).map(row => ({
    ...row,
    zoneOptions: optionRows(WORLD_ZONE_OPTIONS, row.zone),
    typeOptions: optionRows(WORLD_TYPE_OPTIONS, row.type),
    atmosphereOptions: optionRows(ATMOSPHERE_OPTIONS, row.atmosphere),
    ringOptions: optionRows(RING_OPTIONS, row.rings),
    moonRecords: moonContextRows(row.moonRecords),
  }));
}

function moonContextRows(rows) {
  return numberedRows(rows ?? []).map(row => ({
    ...row,
    typeOptions: optionRows(WORLD_TYPE_OPTIONS, row.type),
    atmosphereOptions: optionRows(ATMOSPHERE_OPTIONS, row.atmosphere),
    ringOptions: optionRows(RING_OPTIONS, row.rings),
  }));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function displayText(value, fallback = "Unknown") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function chatDetail(label, value, fallback = "Unknown") {
  return `
    <div class="sta2e-ss-chat-detail">
      <span class="sta2e-ss-chat-label">${escapeHtml(label)}</span>
      <span class="sta2e-ss-chat-value">${escapeHtml(displayText(value, fallback))}</span>
    </div>`;
}

function chatDetailHtml(label, html, fallback = "Unknown") {
  return `
    <div class="sta2e-ss-chat-detail">
      <span class="sta2e-ss-chat-label">${escapeHtml(label)}</span>
      <span class="sta2e-ss-chat-value">${html || escapeHtml(fallback)}</span>
    </div>`;
}

function starTypeKey(starOrType) {
  const source = typeof starOrType === "string"
    ? starOrType
    : starOrType?.spectralType || starOrType?.classification || "";
  const text = String(source ?? "").trim();
  if (/white\s+dwarf/i.test(text)) return "White Dwarf";
  if (/t-?tauri/i.test(text)) return "T-Tauri";
  if (STAR_TYPE_DESCRIPTIONS[text]) return text;
  const match = text.match(/^[A-Z]/i);
  return match ? match[0].toUpperCase() : "";
}

function starTypeDescription(starOrType) {
  const key = starTypeKey(starOrType);
  return STAR_TYPE_DESCRIPTIONS[key] ?? "Unusual or custom stellar classification. Use the listed survey notes and local hazards as the source of truth.";
}

function planetTypeDescription(type) {
  const cls = worldClass(type);
  return PLANET_TYPE_DESCRIPTIONS[cls] ?? "Custom planetary classification. Use the listed atmosphere, gravity, notes, and local conditions as the source of truth.";
}

function typeInfoLink(kind, key, label) {
  const safeKey = String(key ?? "").trim();
  const safeLabel = displayText(label, "Unknown");
  if (!safeKey) return escapeHtml(safeLabel);
  return `<button type="button" class="sta2e-ss-type-link" data-ss-type-info="${escapeHtml(kind)}" data-ss-type-key="${escapeHtml(safeKey)}">${escapeHtml(safeLabel)}</button>`;
}

function starInfoLink(starOrType, label = null) {
  const key = starTypeKey(starOrType);
  const text = label ?? (typeof starOrType === "string" ? starOrType : starOrType?.classification || starSummary(starOrType));
  return typeInfoLink("star", key, text || key);
}

function planetInfoLink(type, label = null) {
  const key = worldClass(type);
  return typeInfoLink("planet", key, label ?? type ?? key);
}

function savedImage(value) {
  return clampText(value);
}

function starImageForType(starOrType) {
  return pickStarSystemImage("star", starTypeKey(starOrType));
}

/**
 * Portrait/token image for a star system. Single-star systems use that star's
 * image; multi-star systems get a composite of all star images (primary large,
 * companions arranged around it). Falls back to the primary star image when
 * the composite can't be built (missing art, no upload permission, error).
 */
async function resolveStarSystemPortraitImage(starSystem, { knownPath = "" } = {}) {
  const starImages = (starSystem?.stars ?? []).map(s => savedImage(s?.image)).filter(Boolean);
  if (!starImages.length) return "";
  if (starImages.length === 1) return starImages[0];
  const composite = await composeStarSystemImage(starImages, knownPath);
  return composite || starImages[0];
}

function planetImageForType(type) {
  return pickStarSystemImage("planet", worldClass(type));
}

function promptImageHtml(src, label) {
  const path = savedImage(src);
  if (!path) return "";
  return `
    <figure class="sta2e-ss-prompt-image">
      <img src="${escapeHtml(path)}" alt="${escapeHtml(label || "")}" />
    </figure>`;
}

function sheetImagePreviewHtml(src, label) {
  const path = savedImage(src);
  if (!path) return "";
  return `<img class="sta2e-ss-inline-preview" src="${escapeHtml(path)}" alt="${escapeHtml(label || "")}" />`;
}

function moonInfoKey(world) {
  const cls = worldClass(world?.type);
  const zone = String(world?.zone ?? "");
  if (cls === "I") return "hotJupiter";
  if (["J", "S", "T"].includes(cls) && zone === "Primary World") return "jovianPrimary";
  if (["J", "S", "T"].includes(cls) && zone === "Outer Worlds") return "jovianOuter";
  if (["J", "S", "T"].includes(cls)) return "jovianOuter";
  return "nonJovian";
}

function moonInfoLinks(world) {
  const summary = escapeHtml(moonTypeSummary(world)).replaceAll("; ", "<br>");
  const key = moonInfoKey(world);
  return `<span>${summary}</span><span class="sta2e-ss-inline-links">${typeInfoLink("moon", key, "Moon types info")}</span>`;
}

function moonDetailsHtml(world) {
  return `
    <span class="sta2e-ss-moon-count">${escapeHtml(displayText(world?.moons, "0"))}</span>
    <span class="sta2e-ss-moon-detail">${moonInfoLinks(world)}</span>`;
}

function typeInfoEntry(kind, key) {
  const cleanKind = String(kind ?? "").trim();
  const cleanKey = String(key ?? "").trim();
  if (cleanKind === "star") return STAR_TYPE_DETAILS[cleanKey] ?? null;
  if (cleanKind === "planet") return PLANET_TYPE_DETAILS[cleanKey] ?? null;
  if (cleanKind === "moon") return MOON_TYPE_DETAILS[cleanKey] ?? MOON_TYPE_DETAILS.general;
  return null;
}

export async function openStarSystemTypeInfoPrompt(kind, key) {
  const entry = typeInfoEntry(kind, key);
  const title = entry?.label ?? "Unknown Type";
  const text = entry?.text ?? "No Exploration-book entry is available for this custom or unknown type. Use the generated system notes and GM context as the source of truth.";
  const content = `
    <section class="sta2e-ss-type-info-dialog">
      <header>
        <div class="sta2e-ss-chat-kicker">EXPLORATION REFERENCE</div>
        <h3>${escapeHtml(title)}</h3>
      </header>
      <p>${escapeHtml(text)}</p>
    </section>`;
  await foundry.applications.api.DialogV2.wait({
    window: { title: `Type Info: ${title}`.slice(0, 120) },
    content,
    buttons: [
      { action: "ok", label: "OK", icon: "fas fa-check", default: true },
    ],
  });
}

function atmosphereDetail(world) {
  const atmosphere = String(world?.atmosphere ?? "").trim();
  if (ATMOSPHERE_DETAIL_DESCRIPTIONS[atmosphere]) return ATMOSPHERE_DETAIL_DESCRIPTIONS[atmosphere];
  const cls = worldClass(world?.type);
  if (cls === "F") return "A thick primordial atmosphere, mainly carbon dioxide, nitrogen, and sulphur dioxide. Rain may occur but surface water remains unstable.";
  if (cls === "G") return "A young ocean-world atmosphere with little free oxygen. Life, if present, is usually simple and chemically driven.";
  if (cls === "Q") return "Breathable conditions may be seasonal or localized, appearing only while the world passes through the habitable zone.";
  if (cls === "R") return "Any surface atmosphere is unbreathable; life is most plausible around geothermal sources or beneath the surface.";
  if (atmosphere) return "Custom atmosphere entry. Use the listed atmosphere value and notes as the source of truth for surface operations.";
  return "No atmosphere detail logged.";
}

function moonTypeSummary(world) {
  if (normalizeRows(world?.moonRecords).length) return moonRecordsToMoonTypes(world);
  const logged = String(world?.moonTypes ?? "").trim();
  if (logged) return logged;
  const count = Math.max(0, Number(world?.moons) || 0);
  const cls = worldClass(world?.type);
  const zone = String(world?.zone ?? "");
  if (cls === "Belt") return "No major moons; this orbit is an asteroid belt or debris field.";
  if (count <= 0) return "No major moons logged.";
  if (cls === "I") {
    return count === 1
      ? "One major inner giant moon, likely a captured Class-D barren or asteroid-sized body."
      : `${count} inner giant moons, usually small captured Class-D or asteroid-like bodies.`;
  }
  if (["J", "S", "T"].includes(cls)) {
    if (zone === "Primary World") {
      return `${count} major moon${count === 1 ? "" : "s"}; habitable-zone giants may have Class-K, Class-L, or Class-M candidate moons.`;
    }
    if (zone === "Outer Worlds") {
      return `${count} major moon${count === 1 ? "" : "s"} plus smaller moonlets; likely Class-C, Class-D, Class-P, or asteroid-like bodies.`;
    }
    return `${count} major gas-giant moon${count === 1 ? "" : "s"} with many smaller captured moonlets possible.`;
  }
  if (count === 1) return "One large Luna-like moon, probably a Class-D barren rocky body unless notes say otherwise.";
  return `${count} moons, typically smaller Class-D or asteroid-like bodies with unstable or captured origins.`;
}

function generateMoonTypes({ type, zone, moons }) {
  const count = Math.max(0, Number(moons) || 0);
  const cls = worldClass(type);
  if (cls === "Belt" || count <= 0) return "";
  const candidates = moonTypeCandidates({ type, zone, moons });
  const types = [];
  for (let i = 1; i <= count; i += 1) {
    types.push(`${romanNumeral(i)}: ${pick(candidates)}`);
  }
  return types.join("; ");
}

function inferMoonTypes(world) {
  const count = Math.max(0, Number(world?.moons) || 0);
  if (worldClass(world?.type) === "Belt" || count <= 0) return "";
  const candidates = moonTypeCandidates(world);
  const types = [];
  for (let i = 1; i <= count; i += 1) {
    types.push(`${romanNumeral(i)}: ${candidates[(i - 1) % candidates.length]}`);
  }
  return types.join("; ");
}

function moonTypeCandidates({ type, zone, moons }) {
  const count = Math.max(0, Number(moons) || 0);
  const cls = worldClass(type);
  if (cls === "I") {
    return [
      "Class-D barren moon (asteroid-scale)",
      "Class-D captured moonlet (asteroid-scale)",
      "Class-C icy moon (small moon-scale)",
    ];
  }
  if (["J", "S", "T"].includes(cls) && zone === "Primary World") {
    return [
      "Class-K adaptable moon (moon-scale)",
      "Class-L marginal moon (moon-scale)",
      "Class-M terrestrial moon (moon-scale)",
      "Class-D barren moon (Luna-scale)",
    ];
  }
  if (["J", "S", "T"].includes(cls)) {
    return [
      "Class-C icy moon (moon-scale)",
      "Class-D barren moon (moon-scale)",
      "Class-P glaciated moon (moon-scale)",
      "Class-D captured moonlet (asteroid-scale)",
    ];
  }
  if (count === 1) {
    return [
      "Class-D barren moon (Luna-scale)",
      "Class-C icy moon (Luna-scale)",
    ];
  }
  return [
    "Class-D moonlet (asteroid-scale)",
    "Class-D captured moonlet (asteroid-scale)",
    "Class-C icy moonlet (asteroid-scale)",
  ];
}

function planetTypeForClass(cls) {
  const key = String(cls ?? "").trim();
  if (key === "Belt") return "Asteroid Belt";
  return WORLD_TYPE_OPTIONS.find(option => worldClass(option) === key) ?? "";
}

function moonTypeTextEntries(world) {
  const source = clampText(world?.moonTypes) || inferMoonTypes(world);
  return source
    .split(";")
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => entry.replace(/^[IVXLCDM]+\s*:\s*/i, "").trim());
}

function moonTypeFromSummary(summary) {
  const cls = worldClass(summary);
  return planetTypeForClass(cls);
}

function moonScaleFromSummary(summary) {
  const text = String(summary ?? "");
  if (/asteroid/i.test(text)) return "asteroid-scale";
  if (/small moon/i.test(text)) return "small moon-scale";
  if (/luna/i.test(text)) return "Luna-scale";
  return "moon-scale";
}

function moonMassSize(summary) {
  const scale = moonScaleFromSummary(summary);
  const sizes = {
    "asteroid-scale": { mass: 0.0001, radius: 0.03 },
    "small moon-scale": { mass: 0.002, radius: 0.12 },
    "Luna-scale": { mass: 0.012, radius: 0.27 },
    "moon-scale": { mass: 0.008, radius: 0.22 },
  };
  const size = sizes[scale] ?? sizes["moon-scale"];
  return {
    mass: `${numberText(size.mass, 4)} Earth mass`,
    radius: `${numberText(size.radius, 2)} Earth radius`,
    gravity: `${numberText(size.mass / (size.radius ** 2), 2)}g`,
  };
}

function moonPopulationForType(type) {
  const cls = worldClass(type);
  if (["M", "L", "O", "P", "K"].includes(cls)) return pick(["none", "survey camp", "outpost"]);
  if (cls === "D") return pick(["none", "mining site", "automated station"]);
  return "none";
}

function createMoonRecord({ hostWorld = {}, index = 0, summary = "", randomize = false, useConfiguredImage = false } = {}) {
  const candidates = moonTypeCandidates({
    type: hostWorld.type,
    zone: hostWorld.zone,
    moons: hostWorld.moons,
  });
  const moonSummary = summary || (randomize ? pick(candidates) : candidates[index % candidates.length] ?? "Class-D barren moon (moon-scale)");
  const type = moonTypeFromSummary(moonSummary) || planetTypeForClass("D");
  const size = moonMassSize(moonSummary);
  const orbit = romanNumeral(index + 1);
  const image = useConfiguredImage ? planetImageForType(type) : "";
  return {
    id: uid(),
    orbit,
    name: `${displayText(hostWorld.name, "Moon")} ${orbit}`,
    type,
    atmosphere: atmosphereForWorld(type),
    population: moonPopulationForType(type),
    rings: "No",
    mass: size.mass,
    radius: size.radius,
    gravity: size.gravity,
    notes: moonSummary,
    image,
  };
}

function inferMoonRecords(world, { useConfiguredImages = false } = {}) {
  const count = Math.max(0, Number(world?.moons) || 0);
  if (count <= 0 || worldClass(world?.type) === "Belt") return [];
  const entries = moonTypeTextEntries(world);
  const records = [];
  for (let i = 0; i < count; i += 1) {
    records.push(createMoonRecord({ hostWorld: world, index: i, summary: entries[i] ?? "", useConfiguredImage: useConfiguredImages }));
  }
  return records;
}

function normalizeMoonRecord(row = {}, hostWorld = {}, index = 0) {
  const fallback = createMoonRecord({ hostWorld, index, summary: row.notes });
  return {
    id: row.id || uid(),
    orbit: clampText(row.orbit, fallback.orbit),
    name: clampText(row.name, fallback.name),
    type: clampText(row.type, fallback.type),
    atmosphere: clampText(row.atmosphere, fallback.atmosphere),
    population: clampText(row.population, fallback.population),
    rings: clampText(row.rings, fallback.rings),
    mass: clampText(row.mass, fallback.mass),
    radius: clampText(row.radius, fallback.radius),
    gravity: clampText(row.gravity, fallback.gravity),
    notes: clampText(row.notes, fallback.notes),
    image: savedImage(row.image),
  };
}

function moonRecordsToMoonTypes(world) {
  const records = normalizeRows(world?.moonRecords);
  return records
    .map((moon, index) => `${clampText(moon.orbit, romanNumeral(index + 1))}: ${displayText(moon.notes || moon.type, "Moon")}`)
    .join("; ");
}

function syncMoonSummary(world) {
  if (!world) return world;
  const records = normalizeRows(world.moonRecords);
  world.moonRecords = records;
  world.moons = String(records.length);
  world.moonTypes = records.length ? moonRecordsToMoonTypes(world) : "";
  return world;
}

function reindexMoonRecords(world) {
  const records = normalizeRows(world?.moonRecords);
  records.forEach((moon, index) => {
    if (!moon.orbit || /^[IVXLCDM]+$/i.test(String(moon.orbit))) moon.orbit = romanNumeral(index + 1);
  });
  return world;
}

function chatPill(label, value, fallback = "Unknown") {
  return `<span class="sta2e-ss-chat-pill"><b>${escapeHtml(label)}</b>${escapeHtml(displayText(value, fallback))}</span>`;
}

function chatPillHtml(label, html, fallback = "Unknown") {
  return `<span class="sta2e-ss-chat-pill"><b>${escapeHtml(label)}</b>${html || escapeHtml(fallback)}</span>`;
}

function systemStarRows(data, { compact = false, showImages = false, summary = false } = {}) {
  const rows = data.stars.length
    ? data.stars
    : [{ role: "Primary", classification: data.primaryStar, spectralType: starTypeKey(data.primaryStar), notes: "" }];
  return rows.map(star => {
    const classification = star.classification || starSummary(star) || data.primaryStar || "Unknown star";
    return `
      <article class="sta2e-ss-chat-row sta2e-ss-chat-row--star">
        <div class="sta2e-ss-chat-row-title">
          <strong>${escapeHtml(displayText(star.role, "Star"))}</strong>
          <span>${starInfoLink(star, classification)}</span>
        </div>
        ${showImages ? promptImageHtml(star.image, classification) : ""}
        ${compact || summary ? "" : `<p>${escapeHtml(starTypeDescription(star))}</p>`}
        ${!compact && star.notes ? `<p class="sta2e-ss-chat-note">${escapeHtml(star.notes)}</p>` : ""}
      </article>`;
  }).join("");
}

function systemWorldRows(worlds, { compact = false, showImages = false, summary = false } = {}) {
  if (summary) return systemWorldSummaryRows(worlds);
  if (!worlds.length) return '<div class="sta2e-ss-chat-empty">None logged</div>';
  return worlds.map(world => `
    <article class="sta2e-ss-chat-row sta2e-ss-chat-row--planet">
      <div class="sta2e-ss-chat-row-title">
        <strong>${escapeHtml(displayText(world.name, `Orbit ${displayText(world.orbit, "?")}`))}</strong>
        <span>${planetInfoLink(world.type, displayText(world.type, "Unknown type"))}</span>
      </div>
      ${showImages ? promptImageHtml(world.image, world.name || world.type) : ""}
      ${compact || summary ? "" : `<p>${escapeHtml(planetTypeDescription(world.type))}</p>`}
      <div class="sta2e-ss-chat-pills">
        ${chatPill("Orbit", world.orbit, "Unassigned")}
        ${chatPill("Zone", world.zone, "Unassigned")}
        ${summary ? chatPill("Moons", world.moons, "0") : chatPillHtml("Moons", moonDetailsHtml(world), "None logged")}
        ${summary ? "" : chatPill("Atmosphere", world.atmosphere)}
        ${summary ? "" : chatPill("Rings", world.rings, "No")}
        ${summary ? chatPill("Gravity", world.gravity) : compact ? chatPill("Gravity", world.gravity) : `${chatPill("Mass", world.mass)}${chatPill("Radius", world.radius)}${chatPill("Gravity", world.gravity)}`}
      </div>
      ${!compact && world.notes ? `<p class="sta2e-ss-chat-note">${escapeHtml(world.notes)}</p>` : ""}
      ${summary ? "" : moonRecordsChatHtml(world, { compact, showImages })}
    </article>`).join("");
}

function systemWorldSummaryRows(worlds) {
  if (!worlds.length) return '<div class="sta2e-ss-chat-empty">None logged</div>';
  return `
    <div class="sta2e-ss-chat-compact-list sta2e-ss-chat-compact-list--world-summary">
      ${worlds.map(world => {
        const orbit = displayText(world.orbit, "?");
        const name = displayText(world.name, `Orbit ${orbit}`);
        const type = displayText(world.type, "Unknown type");
        const moons = displayText(world.moons, "0");
        return `
          <span class="sta2e-ss-chat-world-summary-row">
            <span class="sta2e-ss-chat-world-main"><b>${escapeHtml(orbit)}</b><span>${escapeHtml(name)}</span>${planetInfoLink(type, type)}</span>
            <span class="sta2e-ss-chat-world-moons">Moons ${escapeHtml(moons)}</span>
          </span>`;
      }).join("")}
    </div>`;
}

function moonRecordsChatHtml(world, { compact = false, showImages = false } = {}) {
  const records = normalizeRows(world?.moonRecords);
  if (!records.length) return "";
  const rows = records.map((moon, index) => `
    <div class="sta2e-ss-chat-moon-row">
      <div class="sta2e-ss-chat-row-title">
        <strong>${escapeHtml(displayText(moon.name, `Moon ${romanNumeral(index + 1)}`))}</strong>
        <span>${escapeHtml(displayText(moon.orbit, romanNumeral(index + 1)))} - ${planetInfoLink(moon.type, displayText(moon.type, "Unknown moon"))}</span>
      </div>
      ${showImages ? promptImageHtml(moon.image, moon.name || moon.type) : ""}
      <div class="sta2e-ss-chat-pills">
        ${chatPill("Atmosphere", moon.atmosphere)}
        ${chatPill("Rings", moon.rings, "No")}
        ${chatPill("Gravity", moon.gravity)}
        ${compact ? "" : `${chatPill("Mass", moon.mass)}${chatPill("Radius", moon.radius)}${chatPill("Population", moon.population)}`}
      </div>
      ${!compact && moon.notes ? `<p class="sta2e-ss-chat-note">${escapeHtml(moon.notes)}</p>` : ""}
    </div>`).join("");
  return `
    <div class="sta2e-ss-chat-moons">
      <h5>Moons</h5>
      ${rows}
    </div>`;
}

function compactRows(rows, emptyText, formatter) {
  const items = rows.map(formatter).filter(Boolean);
  if (!items.length) return `<div class="sta2e-ss-chat-empty">${escapeHtml(emptyText)}</div>`;
  return `<div class="sta2e-ss-chat-compact-list">${items.join("")}</div>`;
}

export function defaultStarSystemData(overrides = {}) {
  return {
    isStarSystem: true,
    designation: "",
    classification: "Primary Star System",
    sector: "",
    region: "",
    coordinates: { x: 0, y: 0, z: 0 },
    affiliation: "Unaligned",
    travelCode: "Open",
    strategicValue: "Standard",
    primaryStar: "G yellow main sequence",
    stellarAge: "4.8 billion years",
    orbitalBodies: 5,
    habitableWorlds: 1,
    population: "None recorded",
    surveyStatus: "Unsurveyed",
    lastUpdated: "",
    notes: "",
    stars: [],
    worlds: [],
    features: [],
    hazards: [],
    ...overrides,
    coordinates: {
      x: Number(overrides?.coordinates?.x ?? overrides?.x ?? 0) || 0,
      y: Number(overrides?.coordinates?.y ?? overrides?.y ?? 0) || 0,
      z: Number(overrides?.coordinates?.z ?? overrides?.z ?? 0) || 0,
    },
  };
}

export function getStarSystemData(actor) {
  const raw = actor?.getFlag?.(MODULE_ID, STAR_SYSTEM_FLAG) ?? {};
  return normalizeStarSystemData(raw);
}

export function normalizeStarSystemData(raw = {}) {
  const data = defaultStarSystemData(raw);
  data.designation = clampText(data.designation);
  data.classification = clampText(data.classification, "Primary Star System");
  data.sector = clampText(data.sector);
  data.region = clampText(data.region);
  data.affiliation = clampText(data.affiliation, "Unaligned");
  data.travelCode = clampText(data.travelCode, "Open");
  data.strategicValue = clampText(data.strategicValue, "Standard");
  data.primaryStar = clampText(data.primaryStar, "G yellow main sequence");
  data.stellarAge = clampText(data.stellarAge);
  data.orbitalBodies = Math.max(0, Number(data.orbitalBodies) || 0);
  data.habitableWorlds = Math.max(0, Number(data.habitableWorlds) || 0);
  data.population = clampText(data.population, "None recorded");
  data.surveyStatus = clampText(data.surveyStatus, "Unsurveyed");
  data.lastUpdated = clampText(data.lastUpdated);
  data.notes = String(data.notes ?? "");
  data.stars = normalizeRows(data.stars).map(row => ({
    id: row.id || uid(),
    role: clampText(row.role),
    spectralType: clampText(row.spectralType),
    subdivision: clampText(row.subdivision),
    luminosityType: clampText(row.luminosityType),
    classification: clampText(row.classification),
    notes: clampText(row.notes),
    image: savedImage(row.image),
  }));
  data.worlds = normalizeRows(data.worlds).map(row => {
    const world = {
      id: row.id || uid(),
      orbit: clampText(row.orbit),
      zone: clampText(row.zone),
      name: clampText(row.name),
      type: clampText(row.type),
      atmosphere: clampText(row.atmosphere),
      population: clampText(row.population),
      moons: clampText(row.moons),
      moonTypes: clampText(row.moonTypes) || inferMoonTypes(row),
      rings: clampText(row.rings),
      mass: clampText(row.mass),
      radius: clampText(row.radius),
      gravity: clampText(row.gravity),
      notes: clampText(row.notes),
      image: savedImage(row.image),
    };
    const hasMoonRecords = Object.prototype.hasOwnProperty.call(row, "moonRecords");
    const moonRows = hasMoonRecords ? normalizeRows(row.moonRecords) : inferMoonRecords(world);
    world.moonRecords = moonRows.map((moon, index) => normalizeMoonRecord(moon, world, index));
    return world;
  });
  data.features = normalizeRows(data.features).map(row => ({
    id: row.id || uid(),
    name: clampText(row.name),
    category: clampText(row.category),
    notes: clampText(row.notes),
  }));
  data.hazards = normalizeRows(data.hazards).map(row => ({
    id: row.id || uid(),
    name: clampText(row.name),
    severity: clampText(row.severity),
    notes: clampText(row.notes),
  }));
  return data;
}

export function isStarSystemActor(actor) {
  return !!actor?.getFlag?.(MODULE_ID, STAR_SYSTEM_FLAG)?.isStarSystem;
}

export function generateStarSystemData(seed = {}, options = {}) {
  const suffix = randomInt(100, 999);
  const designation = `${pick(REGION_ADJECTIVES)}-${suffix}`;
  const primaryStar = generateStar({ role: "Primary" });
  const starCount = rollTable(MULTIPLE_STARS_TABLE);
  const stars = [primaryStar];
  for (let i = 2; i <= starCount; i += 1) {
    stars.push(generateStar({
      role: `Companion ${i - 1}`,
      maxRank: Math.max(1, (SPECTRAL_RANK[primaryStar.spectralType] ?? 2) - 1),
    }));
  }

  const orbitalBodies = generatePlanetCount(primaryStar, starCount);
  const primaryOrbit = Math.min(orbitalBodies, Math.max(1, Math.ceil(rollD20() / 4)));
  const worlds = [];
  for (let orbit = 1; orbit <= orbitalBodies; orbit += 1) {
    const zone = orbit < primaryOrbit ? "Inner Worlds" : orbit === primaryOrbit ? "Primary World" : "Outer Worlds";
    const table = zone === "Inner Worlds" ? INNER_WORLD_TABLE : zone === "Primary World" ? PRIMARY_WORLD_TABLE : OUTER_WORLD_TABLE;
    const type = zone === "Primary World" && options.forceHabitable
      ? rollTable(FORCE_HABITABLE_TABLE)
      : rollTable(table);
    worlds.push(generateWorld({ designation, orbit, zone, type, primaryStar }));
  }

  const hazards = primaryStar.rollPhenomena ? [generateSpatialPhenomenon(primaryStar)] : [];
  const habitableWorlds = worlds.filter(world => isHabitableWorld(world.type)).length;

  return defaultStarSystemData({
    ...seed,
    designation,
    classification: starCount === 1 ? "Primary Star System"
      : starCount === 2 ? "Binary Star System"
        : starCount === 3 ? "Trinary Star System"
          : "Multiple Star System",
    sector: seed.sector || `${pick(REGION_ADJECTIVES)} Sector`,
    region: seed.region || pick(["Coreward", "Rimward", "Spinward", "Trailing", "Borderland", "Expanse"]),
    coordinates: {
      x: Number(seed?.coordinates?.x ?? randomInt(-12, 12)) || 0,
      y: Number(seed?.coordinates?.y ?? randomInt(-12, 12)) || 0,
      z: Number(seed?.coordinates?.z ?? randomInt(-3, 3)) || 0,
    },
    affiliation: pick(AFFILIATIONS),
    travelCode: pick(["Open", "Restricted", "Caution", "Survey Required", "Quarantine"]),
    strategicValue: pick(["Low", "Standard", "High", "Critical", "Unknown"]),
    primaryStar: starSummary(primaryStar),
    stellarAge: stellarAgeEstimate(primaryStar),
    orbitalBodies,
    habitableWorlds,
    population: habitableWorlds > 0 ? pick(["outpost", "colony", "millions", "billions", "pre-warp society", "frontier settlements"]) : "None recorded",
    surveyStatus: pick(["Unsurveyed", "Long-range scan", "Partial survey", "Charted", "Classified"]),
    lastUpdated: new Date().toISOString().slice(0, 10),
    notes: `Generated using STA 2e Exploration star-system tables. Primary world orbit: ${primaryOrbit}.`,
    stars,
    worlds,
    features: stars.map(star => ({
      id: uid(),
      name: starSummary(star),
      category: "stellar",
      notes: star.notes,
    })),
    hazards,
  });
}

function generateStar({ role = "Primary", maxRank = null } = {}) {
  let rollPhenomena = false;
  let spectralType = rollTable(SPECTRAL_TABLE);
  if (spectralType === "special") {
    const special = rollTable(SPECIAL_SPECTRAL_TABLE);
    if (special === "phenomena") {
      rollPhenomena = true;
      spectralType = rollSpectralIgnoringPhenomena();
    } else if (special === "brown-dwarf") {
      spectralType = pick(["L", "Y", "T"]);
    } else if (special === "white-or-ttauri") {
      spectralType = pick(["White Dwarf", "T-Tauri"]);
    } else {
      spectralType = special;
    }
  }

  const rank = SPECTRAL_RANK[spectralType] ?? (["White Dwarf", "T-Tauri"].includes(spectralType) ? 1 : 99);
  if (maxRank !== null && rank > maxRank) {
    const allowed = Object.entries(SPECTRAL_RANK)
      .filter(([_type, rank]) => rank <= maxRank && rank > 0)
      .map(([type]) => type);
    spectralType = pick(allowed.length ? allowed : ["M"]);
  }

  const hasLuminosity = !["L", "Y", "T", "White Dwarf"].includes(spectralType);
  const subdivision = hasLuminosity && spectralType !== "T-Tauri" ? spectralSubdivision() : "";
  const luminosityType = hasLuminosity && spectralType !== "T-Tauri" ? rollTable(LUMINOSITY_TABLE) : "";
  const classification = `${spectralType}${subdivision}${luminosityType ? luminosityType : ""}`;
  const notes = starNotes(spectralType, luminosityType, rollPhenomena);
  const image = starImageForType(spectralType);
  return { id: uid(), role, spectralType, subdivision, luminosityType, classification, notes, image, rollPhenomena };
}

function rollSpectralIgnoringPhenomena() {
  for (let i = 0; i < 12; i += 1) {
    const spectral = rollTable(SPECTRAL_TABLE);
    if (spectral !== "special") return spectral;
    const special = rollTable(SPECIAL_SPECTRAL_TABLE);
    if (special === "brown-dwarf") return pick(["L", "Y", "T"]);
    if (special === "white-or-ttauri") return pick(["White Dwarf", "T-Tauri"]);
    if (special !== "phenomena") return special;
  }
  return "M";
}

function spectralSubdivision() {
  const roll = rollD20();
  return String(roll % 10);
}

function starSummary(star) {
  if (!star) return "";
  const label = star.classification || star.spectralType;
  const description = SPECTRAL_DESCRIPTIONS[star.spectralType] ?? "star";
  return `${label} ${description}`.trim();
}

function starNotes(spectralType, luminosityType, rollPhenomena) {
  const notes = [];
  if (["L", "Y", "T"].includes(spectralType)) notes.push("Brown dwarf; no luminosity roll.");
  else if (spectralType === "White Dwarf") notes.push("White dwarf; no luminosity roll.");
  else if (spectralType === "T-Tauri") notes.push("Young variable star; no luminosity roll.");
  else if (["II", "Ib", "Ia"].includes(luminosityType)) notes.push("Bright or supergiant star; stable planets are rare.");
  else if (luminosityType === "III") notes.push("Giant star; planetary systems tend to be depleted.");
  else if (spectralType === "M") notes.push("Type-M stars commonly suffer stellar flares.");
  if (rollPhenomena) notes.push("Special spectral roll triggered notable spatial phenomena.");
  return notes.join(" ");
}

function stellarAgeEstimate(star) {
  if (!star) return "";
  if (["L", "Y", "T"].includes(star.spectralType)) return "Slowly cooling; age uncertain";
  if (star.spectralType === "White Dwarf") return "Ancient stellar remnant";
  if (star.spectralType === "T-Tauri") return "Very young protostar";
  if (star.spectralType === "M") return `${randomInt(1, 900)} billion years potential lifespan`;
  if (star.spectralType === "K") return `${randomInt(10, 70)} billion years potential lifespan`;
  if (star.spectralType === "G") return `${randomInt(1, 10)} billion years`;
  if (star.spectralType === "F") return `${randomInt(2, 4)} billion years main-sequence lifespan`;
  return "Tens to hundreds of millions of years";
}

function generatePlanetCount(primaryStar, starCount) {
  let modifier = 0;
  const type = primaryStar?.spectralType;
  if (type === "M") modifier -= 3;
  if (type === "K") modifier -= 2;
  if (type === "F") modifier += 1;
  if (["A", "B", "O"].includes(type)) modifier += 2;
  if (primaryStar?.luminosityType === "III") modifier -= 3;
  if (["II", "Ib", "Ia"].includes(primaryStar?.luminosityType)) modifier -= 5;
  if (["L", "Y", "T"].includes(type)) modifier -= 1;
  if (["T-Tauri", "White Dwarf"].includes(type)) modifier -= 5;
  if (starCount > 1) modifier -= 3;
  if (starCount > 2) modifier -= starCount - 2;
  return rollTable(NUMBER_OF_PLANETS_TABLE, rollD20(modifier));
}

function generateWorld({ designation, orbit, zone, type, primaryStar }) {
  const moons = generateMoonCount({ type, zone, primaryStar });
  const moonTypes = generateMoonTypes({ type, zone, moons });
  const rings = generateRings({ type, zone, moons });
  const size = generateMassSize({ type, zone, primaryStar });
  const image = planetImageForType(type);
  const world = {
    id: uid(),
    orbit: String(orbit),
    zone,
    name: `${designation} ${romanNumeral(orbit)}`,
    type,
    atmosphere: atmosphereForWorld(type),
    population: populationForWorld(type),
    moons: String(moons),
    moonTypes,
    rings,
    mass: size.mass,
    radius: size.radius,
    gravity: size.gravity,
    notes: worldNotes(type, zone),
    image,
  };
  world.moonRecords = inferMoonRecords(world, { useConfiguredImages: true });
  return world;
}

function randomizeWorld(existing = {}, primaryStar = null) {
  const orbit = Number(existing.orbit) || 1;
  const zone = WORLD_ZONE_OPTIONS.includes(existing.zone) ? existing.zone : pick(WORLD_ZONE_OPTIONS);
  const table = zone === "Inner Worlds" ? INNER_WORLD_TABLE : zone === "Primary World" ? PRIMARY_WORLD_TABLE : OUTER_WORLD_TABLE;
  const type = rollTable(table);
  return generateWorld({
    designation: existing.name?.replace(/\s+[IVXLCDM]+$/i, "") || "Custom",
    orbit,
    zone,
    type,
    primaryStar: primaryStar ?? { spectralType: "G", luminosityType: "V" },
  });
}

function generateMoonCount({ type, zone, primaryStar }) {
  if (worldClass(type) === "Belt") return 0;
  if (["J", "T"].includes(worldClass(type)) && zone === "Outer Worlds") return Math.ceil(rollD20() / 4);
  if (worldClass(type) === "I") return Math.max(0, Math.ceil(rollD20() / 4) - 1);

  let modifier = 0;
  if (zone === "Inner Worlds") modifier -= 1;
  if (primaryStar?.spectralType === "M" && zone !== "Outer Worlds") modifier -= 1;
  return rollTable(NUMBER_OF_MOONS_TABLE, rollD20(modifier));
}

function generateRings({ type, moons }) {
  if (worldClass(type) === "Belt") return "";
  if (isGasGiantWorld(type)) return rollD20() === 1 ? "No" : "Yes";
  return Number(moons) >= 3 && rollD20() <= 5 ? "Yes" : "No";
}

function generateMassSize({ type, zone, primaryStar }) {
  if (worldClass(type) === "Belt") return { mass: "", radius: "", gravity: "" };
  const massBase = rollTable(MASS_SIZE_TABLE).mass;
  const radiusBase = rollTable(MASS_SIZE_TABLE).radius;
  let massModifier = 0;
  if (primaryStar?.spectralType === "M") massModifier -= 0.1;
  if (primaryStar?.spectralType === "K") massModifier -= 0.05;
  if (["B", "O"].includes(primaryStar?.spectralType)) massModifier += 0.05;
  const radiusModifier = zone === "Primary World" ? 0 : -0.05;
  let mass = Math.max(0.05, massBase + massModifier);
  const radius = Math.max(0.1, radiusBase + radiusModifier);
  if (["S", "T"].includes(worldClass(type))) mass *= rollD20() + rollD20();
  const units = isGasGiantWorld(type) ? "Jupiter" : "Earth";
  const gravity = isSolidWorld(type) ? `${numberText(mass / (radius ** 2), 2)}g` : "N/A";
  return {
    mass: `${numberText(mass, 2)} ${units} mass`,
    radius: `${numberText(radius, 2)} ${units} radius`,
    gravity,
  };
}

function atmosphereForWorld(type) {
  const cls = worldClass(type);
  const atmosphere = {
    A: "thin volcanic outgassing",
    B: "toxic volcanic",
    C: "trace or frozen",
    D: "none or trace",
    E: "temporary outgassing",
    H: "thin breathable or marginal",
    I: "hydrogen/helium with exotic compounds",
    J: "hydrogen/helium",
    K: "thin or none",
    L: "marginal; breathing apparatus common",
    M: "Class-M breathable",
    N: "dense carbon dioxide",
    O: "oxygen-bearing humid",
    P: "oxygen-bearing cold",
    S: "helium-rich metallic",
    T: "helium-rich cold giant",
    Y: "extreme toxic",
  };
  return atmosphere[cls] ?? "";
}

function populationForWorld(type) {
  const cls = worldClass(type);
  if (cls === "M") return pick(["uninhabited", "outpost", "colony", "pre-warp civilization", "millions", "billions"]);
  if (["L", "O", "P"].includes(cls)) return pick(["uninhabited", "survey camp", "frontier colony", "native biosphere"]);
  if (["D", "K"].includes(cls)) return pick(["none", "mining site", "automated station"]);
  return "none";
}

function worldNotes(type, zone) {
  const cls = worldClass(type);
  if (cls === "Belt") return `${zone}; generated from a planet table asteroid-belt result.`;
  if (isGasGiantWorld(type)) return `${zone}; gas giant moon systems may contain notable secondary worlds.`;
  if (isHabitableWorld(type)) return `${zone}; counts as a habitable or marginally habitable world.`;
  return zone;
}

function generateSpatialPhenomenon(primaryStar) {
  const key = phenomenaKey(primaryStar?.spectralType);
  const name = rollTable(PHENOMENA_TABLE[key]);
  const potencyMatch = String(name).match(/Type\s+([IV]+)/i);
  return {
    id: uid(),
    name,
    severity: potencyMatch ? potencyMatch[1].toUpperCase() : "I",
    notes: phenomenaNotes(name),
  };
}

function phenomenaKey(spectralType) {
  if (["M", "L", "Y", "T", "White Dwarf"].includes(spectralType)) return "low";
  if (["K", "G"].includes(spectralType)) return "kg";
  if (spectralType === "F") return "f";
  if (spectralType === "A") return "a";
  return "high";
}

function phenomenaNotes(name) {
  if (/Nebula/i.test(name)) return "Sensors and Weapons tasks increase Difficulty and complication range by potency.";
  if (/Gravity/i.test(name)) return "Conn and Engines tasks increase Difficulty and complication range by potency.";
  return "Sensors, Structure, and transporter tasks increase Difficulty and complication range by potency.";
}

function romanNumeral(value) {
  return ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][value - 1] ?? String(value);
}

function actorTypes() {
  const types = game.system?.documentTypes?.Actor ?? Object.keys(CONFIG.Actor?.dataModels ?? {});
  return Array.isArray(types) && types.length ? types : ["character"];
}

function defaultActorType() {
  const types = actorTypes();
  const preferred = ["scenetraits", "npc", "supportingcharacter", "character", "starship", "spacecraft2e"];
  return preferred.find(type => types.includes(type)) ?? types[0];
}

export function registerStarSystemActorSheet() {
  if (globalThis.Actors?.registerSheet) {
    Actors.registerSheet(MODULE_ID, StarSystemActorSheet, {
      types: actorTypes(),
      makeDefault: false,
      label: "STA2e Star System",
    });
  } else {
    console.warn("STA2e Toolkit | Actors.registerSheet not available; star system sheet can still be opened from the Toolkit API.");
  }
}

export function registerStarSystemActorDirectoryHooks() {
  Hooks.on("renderActorDirectory", addStarSystemDirectoryButton);
  Hooks.on("getActorDirectoryEntryContext", starSystemEntryContextHook);
  Hooks.on("getActorContextOptions", starSystemEntryContextHook);
  Hooks.on("getDocumentDirectoryEntryContext", starSystemEntryContextHook);
}

export async function createStarSystemActor({ folderId = null, data = null } = {}) {
  if (!game.user?.isGM) {
    ui.notifications.warn("STA2e Toolkit: Only the GM can create star system actors.");
    return null;
  }

  const starSystem = normalizeStarSystemData(data ?? generateStarSystemData());
  const primaryImage = (await resolveStarSystemPortraitImage(starSystem)) || DEFAULT_IMG;
  const actorData = {
    name: starSystem.designation || "New Star System",
    type: defaultActorType(),
    img: primaryImage,
    folder: folderId,
    prototypeToken: {
      name: starSystem.designation || "New Star System",
      texture: { src: primaryImage },
    },
    flags: {
      core: { sheetClass: STAR_SYSTEM_SHEET_ID },
      [MODULE_ID]: { [STAR_SYSTEM_FLAG]: starSystem },
    },
  };

  const actor = await Actor.create(actorData);
  actor?.sheet?.render?.(true);
  return actor;
}

export async function markActorAsStarSystem(actor, data = null) {
  if (!game.user?.isGM) {
    ui.notifications.warn("STA2e Toolkit: Only the GM can convert actors to Star System sheets.");
    return null;
  }
  if (!actor) {
    return null;
  }

  const current = getStarSystemData(actor);
  const next = normalizeStarSystemData({
    ...current,
    ...(data ?? {}),
    isStarSystem: true,
    designation: data?.designation || current.designation || actor.name,
  });
  await actor.update({ "flags.core.sheetClass": STAR_SYSTEM_SHEET_ID });
  await actor.setFlag(MODULE_ID, STAR_SYSTEM_FLAG, next);
  return next;
}

export function openStarSystemSheet(actor) {
  if (!actor) return;
  new StarSystemActorSheet(actor).render(true);
}

export class StarSystemActorSheet extends ActorSheet {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["sta2e-toolkit", "sta2e-star-system-window"],
      template: "modules/sta2e-toolkit/templates/star-system-sheet.hbs",
      width: 820,
      height: 760,
      resizable: true,
      tabs: [{ navSelector: ".sta2e-ss-tabs", contentSelector: ".sta2e-ss-body", initial: "overview" }],
    });
  }

  get title() {
    const data = getStarSystemData(this.actor);
    return `${data.designation || this.actor.name} - Star System`;
  }

  async getData(options = {}) {
    const context = await super.getData(options);
    const starSystem = getStarSystemData(this.actor);
    return {
      ...context,
      cssVars: getLcCssVars("ss"),
      isGM: game.user?.isGM,
      classificationOptions: CLASSIFICATIONS,
      affiliationOptions: AFFILIATIONS,
      starSystem: {
        ...starSystem,
        stars: numberedRows(starSystem.stars),
        worlds: worldContextRows(starSystem.worlds),
        features: numberedRows(starSystem.features),
        hazards: numberedRows(starSystem.hazards),
      },
      coordinateLabel: `${starSystem.coordinates.x}, ${starSystem.coordinates.y}, ${starSystem.coordinates.z}`,
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    root.querySelectorAll("[data-ss-action]").forEach(button => {
      button.addEventListener("click", event => this._handleAction(event));
    });
  }

  async _handleAction(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const action = button.dataset.ssAction;
    const form = button.closest("form");
    const gmOnlyActions = new Set(["generate", "add-world", "add-feature", "add-hazard", "add-moon", "randomize-world", "randomize-moon", "remove-moon", "remove-row"]);
    if (gmOnlyActions.has(action) && !game.user?.isGM) {
      ui.notifications.warn("STA2e Toolkit: Only the GM can modify generated star system records.");
      return;
    }

    if (action === "generate") {
      const current = form ? this._dataFromForm(form).starSystem : getStarSystemData(this.actor);
      const generated = generateStarSystemData({
        sector: current.sector,
        region: current.region,
        coordinates: current.coordinates,
      }, {
        forceHabitable: !!form?.querySelector?.("[data-force-habitable]")?.checked,
      });
      const generatedName = generated.designation || this.actor.name;
      const generatedImage = (await resolveStarSystemPortraitImage(generated)) || this.actor.img || DEFAULT_IMG;
      await this.actor.update({
        name: generatedName,
        img: generatedImage,
        "prototypeToken.name": generatedName,
        "prototypeToken.texture.src": generatedImage,
      });
      await this.actor.setFlag(MODULE_ID, STAR_SYSTEM_FLAG, generated);
      this.render(false);
      return;
    }

    if (action === "post-chat" || action === "prompt-system") {
      if (form) await this._saveForm(form);
      if (action === "post-chat") await this._postChatSummary();
      else await this._promptSystemSummary();
      return;
    }

    if (action === "post-world" || action === "whisper-world" || action === "prompt-world") {
      const data = form ? this._dataFromForm(form).starSystem : getStarSystemData(this.actor);
      await this.actor.setFlag(MODULE_ID, STAR_SYSTEM_FLAG, normalizeStarSystemData(data));
      const world = data.worlds[Number(button.dataset.index)];
      if (!world) return;
      if (action === "post-world") await this._postWorldSummary(world);
      else if (action === "whisper-world") await this._whisperWorldSummary(world);
      else await this._promptWorldSummary(world);
      return;
    }

    if (["add-world", "add-feature", "add-hazard", "add-moon", "randomize-world", "randomize-moon", "remove-moon", "remove-row"].includes(action)) {
      const data = form ? this._dataFromForm(form).starSystem : getStarSystemData(this.actor);
      if (action === "add-world") {
        data.worlds.push({
          id: uid(),
          orbit: String((data.worlds?.length ?? 0) + 1),
          zone: "",
          name: "",
          type: "",
          atmosphere: "",
          population: "",
          moons: "",
          moonTypes: "",
          rings: "",
          mass: "",
          radius: "",
          gravity: "",
          notes: "",
          moonRecords: [],
        });
      }
      if (action === "add-feature") data.features.push({ id: uid(), name: "", category: "", notes: "" });
      if (action === "add-hazard") data.hazards.push({ id: uid(), name: "", severity: "Moderate", notes: "" });
      if (action === "add-moon") {
        const index = Number(button.dataset.index);
        const world = data.worlds?.[index];
        if (world) {
          world.moonRecords = normalizeRows(world.moonRecords);
          world.moonRecords.push(createMoonRecord({ hostWorld: world, index: world.moonRecords.length, randomize: true, useConfiguredImage: true }));
          syncMoonSummary(world);
        }
      }
      if (action === "randomize-world") {
        const index = Number(button.dataset.index);
        const primaryStar = data.stars?.[0] ?? { spectralType: "G", luminosityType: "V" };
        if (Array.isArray(data.worlds) && Number.isInteger(index) && data.worlds[index]) {
          const randomized = randomizeWorld(data.worlds[index], primaryStar);
          data.worlds[index] = {
            ...randomized,
            id: data.worlds[index].id || randomized.id,
            name: data.worlds[index].name || randomized.name,
          };
        }
      }
      if (action === "randomize-moon") {
        const worldIndex = Number(button.dataset.index);
        const moonIndex = Number(button.dataset.moonIndex);
        const world = data.worlds?.[worldIndex];
        const moon = world?.moonRecords?.[moonIndex];
        if (world && moon) {
          const randomized = createMoonRecord({ hostWorld: world, index: moonIndex, randomize: true, useConfiguredImage: true });
          world.moonRecords[moonIndex] = {
            ...randomized,
            id: moon.id || randomized.id,
            orbit: moon.orbit || randomized.orbit,
            name: moon.name || randomized.name,
          };
          syncMoonSummary(world);
        }
      }
      if (action === "remove-moon") {
        const worldIndex = Number(button.dataset.index);
        const moonIndex = Number(button.dataset.moonIndex);
        const world = data.worlds?.[worldIndex];
        if (world?.moonRecords && Number.isInteger(moonIndex)) {
          world.moonRecords.splice(moonIndex, 1);
          reindexMoonRecords(world);
          syncMoonSummary(world);
        }
      }
      if (action === "remove-row") {
        const collection = button.dataset.collection;
        const index = Number(button.dataset.index);
        if (Array.isArray(data[collection]) && Number.isInteger(index)) data[collection].splice(index, 1);
      }
      await this.actor.setFlag(MODULE_ID, STAR_SYSTEM_FLAG, normalizeStarSystemData(data));
      this.render(false);
      return;
    }
  }

  async _updateObject(event, _formData) {
    const form = this._resolveForm(event);
    if (!form) return;
    await this._saveForm(form);
  }

  async _saveForm(form) {
    if (!form) return;
    const data = this._dataFromForm(form);
    const actorName = data.actorName || this.actor.name;
    const starSystem = normalizeStarSystemData(data.starSystem);
    const primaryImage = await resolveStarSystemPortraitImage(starSystem, { knownPath: this.actor.img });
    const actorUpdate = {
      name: actorName,
      "prototypeToken.name": actorName,
      "flags.core.sheetClass": STAR_SYSTEM_SHEET_ID,
    };
    if (primaryImage) {
      actorUpdate.img = primaryImage;
      actorUpdate["prototypeToken.texture.src"] = primaryImage;
    }
    await this.actor.update(actorUpdate);
    await this.actor.setFlag(MODULE_ID, STAR_SYSTEM_FLAG, starSystem);
  }

  _dataFromForm(form) {
    const formData = new FormData(form);
    const value = (name, fallback = "") => {
      const found = formData.get(name);
      return found == null ? fallback : found;
    };
    const numberValue = (name, fallback = 0) => {
      const found = Number(value(name, fallback));
      return Number.isFinite(found) ? found : fallback;
    };
    const rowsFor = (collection, fields) => {
      const rows = new Map();
      const prefix = `starSystem.${collection}.`;
      for (const [name, fieldValue] of formData.entries()) {
        if (!name.startsWith(prefix)) continue;
        const match = name.slice(prefix.length).match(/^(\d+)\.(.+)$/);
        if (!match) continue;
        const index = Number(match[1]);
        const field = match[2];
        if (!fields.includes(field)) continue;
        if (!rows.has(index)) rows.set(index, {});
        rows.get(index)[field] = fieldValue;
      }
      return Array.from(rows.entries())
        .sort(([a], [b]) => a - b)
        .map(([_index, row]) => row);
    };
    const nestedRowsFor = (parentCollection, childCollection, fields) => {
      const groups = new Map();
      const prefix = `starSystem.${parentCollection}.`;
      const pattern = new RegExp(`^(\\d+)\\.${childCollection}\\.(\\d+)\\.(.+)$`);
      for (const [name, fieldValue] of formData.entries()) {
        if (!name.startsWith(prefix)) continue;
        const match = name.slice(prefix.length).match(pattern);
        if (!match) continue;
        const parentIndex = Number(match[1]);
        const childIndex = Number(match[2]);
        const field = match[3];
        if (!fields.includes(field)) continue;
        if (!groups.has(parentIndex)) groups.set(parentIndex, new Map());
        const rows = groups.get(parentIndex);
        if (!rows.has(childIndex)) rows.set(childIndex, {});
        rows.get(childIndex)[field] = fieldValue;
      }
      return new Map(Array.from(groups.entries()).map(([parentIndex, rows]) => [
        parentIndex,
        Array.from(rows.entries())
          .sort(([a], [b]) => a - b)
          .map(([_index, row]) => row),
      ]));
    };

    const worlds = rowsFor("worlds", ["id", "orbit", "zone", "name", "type", "atmosphere", "population", "moons", "moonTypes", "rings", "mass", "radius", "gravity", "notes", "image"]);
    const moonRecords = nestedRowsFor("worlds", "moonRecords", MOON_RECORD_FIELDS);
    worlds.forEach((world, index) => {
      world.moonRecords = moonRecords.get(index) ?? [];
    });

    const starSystem = normalizeStarSystemData({
      isStarSystem: true,
      designation: value("starSystem.designation"),
      classification: value("starSystem.classification"),
      sector: value("starSystem.sector"),
      region: value("starSystem.region"),
      coordinates: {
        x: numberValue("starSystem.coordinates.x"),
        y: numberValue("starSystem.coordinates.y"),
        z: numberValue("starSystem.coordinates.z"),
      },
      affiliation: value("starSystem.affiliation"),
      travelCode: value("starSystem.travelCode"),
      strategicValue: value("starSystem.strategicValue"),
      primaryStar: value("starSystem.primaryStar"),
      stellarAge: value("starSystem.stellarAge"),
      orbitalBodies: numberValue("starSystem.orbitalBodies"),
      habitableWorlds: numberValue("starSystem.habitableWorlds"),
      population: value("starSystem.population"),
      surveyStatus: value("starSystem.surveyStatus"),
      lastUpdated: value("starSystem.lastUpdated"),
      notes: value("starSystem.notes"),
      stars: rowsFor("stars", ["id", "role", "spectralType", "subdivision", "luminosityType", "classification", "notes", "image"]),
      worlds,
      features: rowsFor("features", ["id", "name", "category", "notes"]),
      hazards: rowsFor("hazards", ["id", "name", "severity", "notes"]),
    });

    return {
      actorName: clampText(value("actorName")),
      starSystem,
    };
  }

  _resolveForm(event = null) {
    const fromEvent = event?.currentTarget?.closest?.("form")
      ?? event?.target?.closest?.("form")
      ?? (event?.currentTarget instanceof HTMLFormElement ? event.currentTarget : null)
      ?? (event?.target instanceof HTMLFormElement ? event.target : null);
    if (fromEvent) return fromEvent;

    if (this.form instanceof HTMLFormElement) return this.form;
    const element = this.element instanceof HTMLElement ? this.element : this.element?.[0] ?? null;
    return element?.querySelector?.("form") ?? null;
  }

  async _postChatSummary() {
    const data = getStarSystemData(this.actor);
    const html = this._systemSummaryHtml(data, { compact: true, summary: true });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: html,
    });
  }

  _systemSummaryHtml(data = getStarSystemData(this.actor), { compact = false, showImages = false, summary = false } = {}) {
    const primaryStar = data.stars[0] ?? { classification: data.primaryStar, spectralType: starTypeKey(data.primaryStar) };
    const features = compactRows(data.features, "None logged", row => {
      const name = displayText(row.name, "");
      if (!name) return "";
      const meta = [row.category, row.notes].map(value => String(value ?? "").trim()).filter(Boolean).join(": ");
      return `<span class="sta2e-ss-chat-compact"><b>${escapeHtml(name)}</b>${meta ? ` ${escapeHtml(meta)}` : ""}</span>`;
    });
    const hazards = compactRows(data.hazards, "None logged", row => {
      const name = displayText(row.name, "");
      if (!name) return "";
      const severity = displayText(row.severity, "I");
      const notes = String(row.notes ?? "").trim();
      return `<span class="sta2e-ss-chat-compact"><b>${escapeHtml(name)}</b> Severity ${escapeHtml(severity)}${notes ? `: ${escapeHtml(notes)}` : ""}</span>`;
    });
    return `
      <section class="sta2e-ss-chat sta2e-ss-chat--system${compact ? " sta2e-ss-chat--compact" : ""}${summary ? " sta2e-ss-chat--summary" : ""}">
        <header class="sta2e-ss-chat-header">
          <div class="sta2e-ss-chat-kicker">STAR SYSTEM REPORT</div>
          <h3>${escapeHtml(data.designation || this.actor.name)}</h3>
          <div class="sta2e-ss-chat-subtitle">${escapeHtml(displayText(data.classification, "Unclassified"))}</div>
        </header>
        ${showImages ? promptImageHtml(primaryStar.image, data.primaryStar || data.designation) : ""}
        <div class="sta2e-ss-chat-grid">
          ${chatDetail("Sector", `${displayText(data.sector, "Unassigned")} [${data.coordinates.x}, ${data.coordinates.y}, ${data.coordinates.z}]`)}
          ${chatDetailHtml("Primary Star", starInfoLink(primaryStar, data.primaryStar))}
          ${chatDetail("Planets", summary ? `${data.orbitalBodies} total; ${data.habitableWorlds} habitable` : `${data.orbitalBodies} total; ${data.habitableWorlds} habitable or marginally habitable`)}
          ${summary ? "" : chatDetail("Survey Status", data.surveyStatus)}
          ${summary ? "" : chatDetail("Star Notes", starTypeDescription(primaryStar))}
          ${summary ? "" : chatDetail("Affiliation", data.affiliation)}
        </div>
        <div class="sta2e-ss-chat-section${summary ? " sta2e-ss-chat-section--empty-compact" : ""}">
          <h4>Stars</h4>
          ${systemStarRows(data, { compact, showImages, summary })}
        </div>
        <div class="sta2e-ss-chat-section">
          <h4>Planets</h4>
          <div class="sta2e-ss-chat-planet-list">${systemWorldRows(data.worlds, { compact, showImages, summary })}</div>
        </div>
        <div class="sta2e-ss-chat-section${(compact && !data.features.length) || summary ? " sta2e-ss-chat-section--empty-compact" : ""}">
          <h4>Features</h4>
          ${features}
        </div>
        <div class="sta2e-ss-chat-section${(compact && !data.hazards.length) || summary ? " sta2e-ss-chat-section--empty-compact" : ""}">
          <h4>Hazards</h4>
          ${hazards}
        </div>
      </section>`;
  }

  async _postWorldSummary(world, whisper = null) {
    if (!world) return;
    const html = this._worldSummaryHtml(world, { compact: true, summary: true });
    const messageData = {
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: html,
    };
    if (Array.isArray(whisper) && whisper.length) messageData.whisper = whisper;
    await ChatMessage.create(messageData);
  }

  async _whisperWorldSummary(world) {
    if (!game.user?.isGM) return;
    const selectedUserIds = await this._selectActivePlayers({
      title: "Whisper Planet",
      prompt: `Select players to receive <strong>${escapeHtml(world.name || world.type || "this world")}</strong>.`,
      actionLabel: "Whisper",
      icon: "fas fa-comment-dots",
      emptyWarning: "STA2e Toolkit: No active players available to whisper.",
    });
    if (!selectedUserIds.length) return;
    await this._postWorldSummary(world, selectedUserIds);
  }

  async _promptSystemSummary() {
    if (!game.user?.isGM) return;
    const data = getStarSystemData(this.actor);
    await this._promptReport({
      title: `System Report: ${data.designation || this.actor.name}`,
      subject: data.designation || this.actor.name,
      reportKind: "system",
      content: this._systemSummaryHtml(data, { compact: true, showImages: true }),
    });
  }

  async _promptWorldSummary(world) {
    if (!game.user?.isGM || !world) return;
    await this._promptReport({
      title: `Planet Report: ${world.name || world.type || "Planet"}`,
      subject: world.name || world.type || "this planet",
      reportKind: "planet",
      content: this._worldSummaryHtml(world, { compact: true, showImages: true }),
    });
  }

  async _promptReport({ title, subject, reportKind, content }) {
    if (!game.user?.isGM) return;
    const selectedUserIds = await this._selectActivePlayers({
      title: "Prompt Players",
      prompt: `Select players to receive <strong>${escapeHtml(subject || "this report")}</strong> as a popup prompt.`,
      actionLabel: "Prompt",
      icon: "fas fa-bell",
      emptyWarning: "STA2e Toolkit: No active players available to prompt.",
    });
    if (!selectedUserIds.length) return;

    game.socket.emit(`module.${MODULE_ID}`, {
      action: "starSystemPrompt",
      targetUserIds: selectedUserIds,
      title,
      reportKind,
      actorName: this.actor.name,
      systemName: getStarSystemData(this.actor).designation || this.actor.name,
      senderUserId: game.user.id,
      content,
    });
    ui.notifications.info(`STA2e Toolkit: Prompt sent to ${selectedUserIds.length} player${selectedUserIds.length === 1 ? "" : "s"}.`);
  }

  async _selectActivePlayers({ title, prompt, actionLabel, icon, emptyWarning }) {
    if (!game.user?.isGM) return [];
    const users = game.users
      .filter(user => !user.isGM && user.active)
      .map(user => ({ id: user.id, name: user.name }));
    if (!users.length) {
      ui.notifications.warn(emptyWarning || "STA2e Toolkit: No active players available.");
      return [];
    }

    const options = users
      .map(user => `<label class="sta2e-ss-whisper-option"><input type="checkbox" name="users" value="${escapeHtml(user.id)}" checked /> <span>${escapeHtml(user.name)}</span></label>`)
      .join("");
    const content = `<form class="sta2e-ss-whisper-form"><p>${prompt}</p>${options}</form>`;
    let selectedUserIds = [];
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title },
      content,
      buttons: [
        {
          action: "send",
          label: actionLabel,
          icon,
          default: true,
          callback: (_event, _button, dialog) => {
            selectedUserIds = Array.from(dialog.element.querySelectorAll('input[name="users"]:checked')).map(input => input.value);
            return "send";
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });
    return result === "send" ? selectedUserIds : [];
  }

  _worldSummaryHtml(world, { compact = false, showImages = false, summary = false } = {}) {
    return `
      <section class="sta2e-ss-chat sta2e-ss-chat--planet${compact ? " sta2e-ss-chat--compact" : ""}${summary ? " sta2e-ss-chat--summary" : ""}">
        <header class="sta2e-ss-chat-header">
          <div class="sta2e-ss-chat-kicker">PLANETARY REPORT</div>
          <h3>${escapeHtml(world.name || "Planet")}</h3>
          <div class="sta2e-ss-chat-subtitle">${escapeHtml(displayText(world.type, "Unknown type"))}</div>
        </header>
        ${showImages ? promptImageHtml(world.image, world.name || world.type) : ""}
        ${summary ? "" : `<p class="sta2e-ss-chat-description">${escapeHtml(planetTypeDescription(world.type))}</p>`}
        <div class="sta2e-ss-chat-grid">
          ${chatDetail("Orbit", world.orbit, "Unassigned")}
          ${chatDetail("Zone", world.zone, "Unassigned")}
          ${chatDetailHtml("Type", planetInfoLink(world.type, displayText(world.type, "Unknown")))}
          ${chatDetail("Atmosphere", world.atmosphere)}
          ${summary ? chatDetail("Moons", world.moons, "0") : chatDetailHtml("Moons", moonDetailsHtml(world), "None logged")}
          ${chatDetail("Rings", world.rings, "No")}
          ${chatDetail("Gravity", world.gravity)}
          ${summary ? "" : chatDetail("Atmosphere Detail", atmosphereDetail(world), "None logged")}
          ${summary ? "" : chatDetail("Population", world.population)}
          ${summary ? "" : chatDetail("Mass", world.mass)}
          ${summary ? "" : chatDetail("Radius", world.radius)}
          ${summary ? "" : chatDetail("Notes", world.notes, "None logged")}
        </div>
        ${summary ? "" : moonRecordsChatHtml(world, { compact, showImages })}
      </section>`;
  }
}

function addStarSystemDirectoryButton(_app, html) {
  if (!game.user?.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? html;
  if (!root || root.querySelector(".sta2e-create-star-system-directory")) return;

  const actions = root.querySelector(".directory-header .header-actions")
    ?? root.querySelector(".header-actions")
    ?? root.querySelector(".directory-header");
  if (!actions) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "sta2e-create-star-system-directory";
  button.innerHTML = '<i class="fas fa-sun"></i><span>Star System</span>';
  button.title = "Create STA2e Star System";
  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    createStarSystemActor();
  });
  actions.appendChild(button);
}

function starSystemEntryContextHook(...args) {
  const options = args.find(arg => Array.isArray(arg));
  if (!options) return;
  if (options.some(option => option?.label === "Open Star System Sheet" || option?.name === "Open Star System Sheet")) return;

  options.push({
    name: "Open Star System Sheet",
    label: "Open Star System Sheet",
    icon: '<i class="fas fa-sun"></i>',
    condition: element => isStarSystemActor(actorFromContextElement(element)),
    visible: element => isStarSystemActor(actorFromContextElement(element)),
    callback: element => openStarSystemSheet(actorFromContextElement(element)),
    onClick: (_event, element) => openStarSystemSheet(actorFromContextElement(element)),
  });

  options.push({
    name: "Convert to Star System",
    label: "Convert to Star System",
    icon: '<i class="fas fa-map"></i>',
    condition: element => {
      const actor = actorFromContextElement(element);
      return !!actor && game.user?.isGM && !isStarSystemActor(actor);
    },
    visible: element => {
      const actor = actorFromContextElement(element);
      return !!actor && game.user?.isGM && !isStarSystemActor(actor);
    },
    callback: async element => {
      const actor = actorFromContextElement(element);
      if (!actor) return;
      await markActorAsStarSystem(actor, { designation: actor.name });
      openStarSystemSheet(actor);
    },
    onClick: async (_event, element) => {
      const actor = actorFromContextElement(element);
      if (!actor) return;
      await markActorAsStarSystem(actor, { designation: actor.name });
      openStarSystemSheet(actor);
    },
  });
}

function actorFromContextElement(element) {
  const root = element instanceof HTMLElement ? element : element?.[0] ?? element;
  const item = root?.closest?.("[data-document-id], [data-entry-id], [data-actor-id], .directory-item")
    ?? root;
  const id = item?.dataset?.documentId
    ?? item?.dataset?.entryId
    ?? item?.dataset?.actorId
    ?? item?.dataset?.id
    ?? "";
  return game.actors?.get(id) ?? null;
}
