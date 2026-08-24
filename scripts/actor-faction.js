/**
 * sta2e-toolkit | actor-faction.js
 *
 * Guesses which faction an actor belongs to, for the VFX layers that dress
 * themselves differently per power — engine trails, tractor beams, point
 * defence, shield impacts, and the warp effect registry's faction variants.
 *
 * Deliberately a leaf module: it imports nothing. It was split out of
 * ship-vfx-anchors.js so warp-effect-styles.js can gate on faction without
 * importing the anchors editor, which imports the style registry right back.
 */

/** Accepts an Actor, a Token or a TokenDocument. */
function _resolveActor(actorOrToken) {
  if (!actorOrToken) return null;
  if (actorOrToken.documentName === "Actor") return actorOrToken;
  return actorOrToken.actor ?? actorOrToken.document?.actor ?? null;
}

/**
 * Ordered because the first hit wins — a "Klingon-Cardassian" name resolves to
 * whichever appears earlier here, and there is no better answer available.
 */
const FACTION_TESTS = [
  { key: "klingon", test: /klingon/ },
  { key: "romulan", test: /romulan/ },
  { key: "cardassian", test: /cardassian/ },
  { key: "borg", test: /\bborg\b/ },
  { key: "dominion", test: /dominion|jem'?hadar|founder/ },
  { key: "ferengi", test: /ferengi/ },
  { key: "tos", test: /\b(tos|constitution|enterprise nx|nx-0|tos[- ]?era)\b/ },
];

// Guesses a ship's faction from its name, its traits text field and any child
// trait Items. Returns null for Federation / anything unrecognised.
export function resolveActorFactionKey(actorOrToken) {
  const actor = _resolveActor(actorOrToken);
  if (!actor) return null;
  const traitItems = [];
  for (const item of actor.items ?? []) {
    if (item?.type === "trait" && item.name) traitItems.push(item.name);
  }
  const haystack = [actor.name, actor.system?.traits, ...traitItems]
    .filter(Boolean).join(" ").toLowerCase();

  for (const faction of FACTION_TESTS) {
    if (faction.test.test(haystack)) return faction.key;
  }
  return null;
}
