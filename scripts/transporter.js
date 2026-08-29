/**
 * sta2e-toolkit | transporter.js
 * Transporter Control — LCARS UI, cross-scene beam buffer, JB2A effects.
 *
 * Replaces the standalone Transporter macro. Exposes openTransporter() which
 * is registered on game.sta2eToolkit and called by the Combat HUD button.
 *
 * Beam buffer is stored as a world-level game setting (scope:"world") so any
 * GM can see and restore patterns regardless of who beamed them out.
 *
 * JB2A tier is detected from the sta2e-toolkit jb2aTier setting. Patron paths
 * are used when available; free-tier paths with .tint() are used otherwise.
 */

import {
  swColumns, swPanel, swGrid, swField, swSelect, swInput, swKey,
} from "./spawn-chrome.js";
import {
  formatStardate, formatCalendarDate,
  formatKlingonDate, formatRomulanDate,
} from "./stardate-calc.js";
import { TransporterVFX } from "./transporter-vfx.js";
import { SPAWN_PATTERNS } from "./spawn-patterns.js";
import { getWildcardImage, buildSpawnTokenData, protoHalfSize } from "./token-spawn-utils.js";
import { centreToTopLeft, pickSpawnCentres } from "./spawn-picker.js";
import { buildLocationOptions, parseLocation } from "./spawn-regions.js";
import { registerSpawnTab, openSpawnWindow, getSpawnPref, setSpawnPref } from "./spawn-window.js";
import {
  addBufferGroup,
  buildBufferHTML,
  getBufferGroups,
  makeBufferGroup,
  removeBufferGroup,
  wireBufferButtons,
} from "./spawn-buffer.js";
import { buildQueueHTML, renderQueue, wireQueue } from "./spawn-queue.js";

const MODULE = "sta2e-toolkit";
const TAB_ID = "transporter";

/**
 * Where the last beam-in was aimed, remembered across window opens. A GM running
 * a ship with a fixed transporter room picks their pads once, not every session.
 * A site that does not exist on the current scene falls back to Canvas Click,
 * since the option simply is not in the rebuilt list.
 */
const BEAM_SITE_PREF = "transporterLocation";

// ── Current date label ────────────────────────────────────────────────────────
// Returns the appropriate date string for the active campaign era/theme,
// replacing the old random stardate generator.

function _getCurrentDateLabel() {
  try {
    const store    = game?.sta2eToolkit?.campaignStore;
    const campaign = store?.getActiveCampaign?.();
    if (!campaign) return null;

    const era   = campaign.era;
    const theme = campaign.theme ?? (() => {
      try { return game.settings.get(MODULE, "hudTheme"); } catch { return "lcars-tng"; }
    })();

    const isKlingon = era === "klingon" || theme === "klingon";
    const isRomulan = era === "romulan" || theme === "romulan";
    const isENT     = era === "ent"     || theme === "ent-panel";
    const isTOS     = era === "tos"     || theme === "tos-panel";
    const isTMP     = era === "tmp"     || theme === "tmp-console";

    if (isKlingon && campaign.calendarDate) return formatKlingonDate(campaign.calendarDate);
    if (isRomulan && campaign.calendarDate) return formatRomulanDate(campaign.calendarDate);
    if (isENT     && campaign.calendarDate) return formatCalendarDate(campaign.calendarDate);
    if (isTOS     && campaign.stardate   ) return `STARDATE ${formatStardate(campaign.stardate)}`;
    if (isTMP     && campaign.stardate   ) return `SD ${formatStardate(campaign.stardate)}`;
    if (campaign.stardate) return `STARDATE ${formatStardate(campaign.stardate)}`;
    if (campaign.calendarDate) return formatCalendarDate(campaign.calendarDate);
  } catch { /* fall through */ }
  return null;
}

// ── Sound helper ─────────────────────────────────────────────────────────────
// Reads from module settings; returns empty string if unset (no sound played).

function _tSound(settingKey) {
  try { return game.settings.get(MODULE, settingKey) ?? ""; }
  catch { return ""; }
}

// ── Transporter effect configurations ────────────────────────────────────────
// Patron stacks use the colour-correct JB2A Patreon assets per faction.
// Free stacks use the confirmed-free blue assets for all factions;
// faction colour is applied via .tint() in _playEffect.

// Blue stack — confirmed available in JB2A free (JB2A_DnD5e)
const _BLUE_STACK = [
  { file: "jb2a.token_border.circle.static.blue.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
  { file: "jb2a.particle_burst.01.circle.bluepurple",  scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
  { file: "jb2a.markers.light.outro.blue",             scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
  { file: "jb2a.teleport.01.blue",                     scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
];

// Hex colors for the beam-in cursor indicator, one per transporter type.
// voyFed/tngFed have no freeTint so use their canonical blue.
const _TRANSPORTER_COLORS = {
  voyFed:     0x4488ff,
  tngFed:     0x4488ff,
  tmpFed:     0xDDEEFF,   // cool silver-white for TMP / film era
  tosFed:     0xFFD700,
  klingon:    0xCC2200,
  cardassian: 0xCC7700,
  romulan:    0x00CC55,
  ferengi:    0xFF8800,
  borg:       0x44BB22,
};

function _buildTransporterEffects() {
  return {
    voyFed: {
      name: "Voyager",
      sound: _tSound("sndTransporterVoyFed"),
      patronEffects: _BLUE_STACK,   // blue is correct for Voyager on both tiers
      freeEffects:   _BLUE_STACK,
    },
    tngFed: {
      name: "TNG",
      sound: _tSound("sndTransporterTngFed"),
      patronEffects: _BLUE_STACK,   // blue is correct for TNG on both tiers
      freeEffects:   _BLUE_STACK,
    },
    tosFed: {
      name: "TOS",
      sound: _tSound("sndTransporterTosFed"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.orange.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.yellow",       scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.yellow",            scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.yellow",                    scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 3000 },
      ],
      freeEffects: _BLUE_STACK,
      freeTint:    "#FFD700",
    },
    // TMP = Star Trek II–VI film era — silver-white transporter column.
    // Only jb2a.teleport.01.white is confirmed to exist; the border, burst,
    // and marker layers fall back to the blue stack tinted to silver-white.
    tmpFed: {
      name: "TMP / Films",
      sound: _tSound("sndTransporterTmpFed"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.blue.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.bluepurple",  scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.blue",             scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.white",                    scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
      ],
      patronTint:  "#DDEEFF",   // tints the blue layers to silver-white
      freeEffects: _BLUE_STACK,
      freeTint:    "#DDEEFF",
    },
    klingon: {
      name: "Klingon",
      sound: _tSound("sndTransporterKlingon"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.dark_red.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.orangepink",     scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.red",                 scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.greenorange",                 scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
      ],
      freeEffects: _BLUE_STACK,
      freeTint:    "#CC2200",
    },
    cardassian: {
      name: "Cardassian",
      sound: _tSound("sndTransporterCardassian"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.orange.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.yellow",       scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.yellow02",          scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.yellow",                    scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
      ],
      freeEffects: _BLUE_STACK,
      freeTint:    "#CC7700",
    },
    romulan: {
      name: "Romulan",
      sound: _tSound("sndTransporterRomulan"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.green.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.green",       scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.green",            scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.green",                    scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
      ],
      freeEffects: _BLUE_STACK,
      freeTint:    "#00CC55",
    },
    ferengi: {
      name: "Ferengi",
      sound: _tSound("sndTransporterFerengi"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.orange.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.yellow",       scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.yellow02",          scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.yellow",                    scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
      ],
      freeEffects: _BLUE_STACK,
      freeTint:    "#FF8800",
    },
    borg: {
      name: "Borg",
      sound: _tSound("sndTransporterBorg"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.green.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.green",       scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.green",            scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.green",                    scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
      ],
      freeEffects: _BLUE_STACK,
      freeTint:    "#44BB22",
    },
  };
}

// ── JB2A tier detection ───────────────────────────────────────────────────────

function _isPatronJb2a() {
  try {
    const setting = game.settings.get(MODULE, "jb2aTier");
    if (setting) return setting === "patron";
  } catch { /* fall through */ }
  return game.modules.get("jb2a_patreon")?.active ?? false;
}

// ── VFX engine selector ───────────────────────────────────────────────────────

function _isNativeVFX() {
  try { return game.settings.get(MODULE, "vfxEngine") === "native"; }
  catch { return false; }
}

// ── VFX playback ──────────────────────────────────────────────────────────────
// Uses patron effect stack when jb2aTier === "patron", otherwise falls back
// to the free blue stack with a faction tint applied to each layer.

function _playEffect(token, transporterType, effects) {
  if (!game.modules.get("sequencer")?.active) {
    ui.notifications.warn("STA2e Toolkit: Sequencer module is not active.");
    return;
  }
  const config = effects[transporterType];
  if (!config) return;

  const patron = _isPatronJb2a();
  const stack  = patron ? config.patronEffects : config.freeEffects;
  const tint   = patron ? (config.patronTint ?? null) : (config.freeTint ?? null);

  const seq = new Sequence();
  stack.forEach(e => {
    let step = seq.effect().file(e.file).atLocation(token);
    if (e.scale)        step = step.scale(e.scale);
    if (e.fadeIn)       step = step.fadeIn(e.fadeIn);
    if (e.fadeOut)      step = step.fadeOut(e.fadeOut);
    if (e.delay)        step = step.delay(e.delay);
    if (e.playbackRate) step = step.playbackRate(e.playbackRate);
    if (e.belowTokens)  step = step.belowTokens();
    if (tint)           step = step.tint(tint);
  });
  seq.play();
}

function _playSound(soundSrc) {
  if (!soundSrc) return;
  const AudioHelper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
  AudioHelper.play({ src: soundSrc, volume: 0.8, autoplay: true, loop: false }, true);
}

// ── TokenMagic transporter effect ────────────────────────────────────────────

/**
 * Apply an old-film grain + faction-coloured glow via TokenMagic to a token
 * during transport.  No-ops gracefully when TokenMagic is not installed/active.
 * @param {Token} token           The canvas Token placeable.
 * @param {string} transporterType  Key into _TRANSPORTER_COLORS.
 */
function _applyTransporterMagic(token, transporterType) {
  if (!game.modules.get("tokenmagic")?.active) return;
  const TM = globalThis.TokenMagic;
  if (!TM) return;
  const color = _TRANSPORTER_COLORS[transporterType] ?? 0x4488ff;
  TM.addFilters(token, [
    // Flowing faction-coloured liquid distortion rippling over the token
    {
      filterType:   "liquid",
      filterId:     "sta2e-tp",
      color,
      scale:        1,
      intensity:    3,
      blend:        4,        // lighten — preserves token image beneath
      spectral:     false,
      alphaDiscard: false,
      animated: {
        time: { active: true, speed: 0.003, loopDuration: 3000, animType: "cosOscillation" },
      },
    },
    // Glowing particle rain — globes creates floating sparkle orbs that drift
    // over the token, matching the TNG transporter shimmer look.
    {
      filterType:   "globes",
      filterId:     "sta2e-tp",
      color,
      scale:        40,
      distortion:   0.2,
      alphaDiscard: false,
      animated: {
        time: { active: true, speed: 0.05, animType: "move", loopDuration: 3000 },
      },
    },
    // Bloom — makes the sparkle orbs flare brighter, adds the "dissolving
    // into light" look.  No colour param; amplifies existing bright pixels.
    {
      filterType:  "xbloom",
      filterId:    "sta2e-tp",
      threshold:   0.4,
      bloomScale:  1.5,
      brightness:  1.2,
      blur:        4,
      quality:     4,
      animated: {
        bloomScale: {
          active:       true,
          loopDuration: 900,
          val1:         1.0,
          val2:         2.2,
          animType:     "cosOscillation",
        },
      },
    },
    // Faction-coloured pulsing outer glow that ties everything together
    {
      filterType:    "glow",
      filterId:      "sta2e-tp",
      distance:      12,
      outerStrength: 2.0,
      innerStrength: 0.8,
      color,
      quality:  0.5,
      knockout: false,
      animated: {
        outerStrength: {
          active:       true,
          loopDuration: 700,
          val1:         0.5,
          val2:         3.5,
          animType:     "cosOscillation",
        },
      },
    },
  ]);
}

/**
 * Remove the transporter TokenMagic filters from a token.
 * @param {Token} token  The canvas Token placeable.
 */
function _removeTransporterMagic(token) {
  if (!game.modules.get("tokenmagic")?.active) return;
  const TM = globalThis.TokenMagic;
  if (!TM) return;
  TM.deleteFilters(token, "sta2e-tp");
}

// ── Beam buffer (world setting) ───────────────────────────────────────────────
// Stored as a JSON string in a world-scoped module setting so any GM client
// can read and restore patterns, not just the one who beamed them out.

const BUFFER_SETTING = "transporterBeamBuffer";

// Storage, markup and wiring are shared with the Q tab's hold buffer — see
// spawn-buffer.js. Only the setting key and what a group is called differ.
const _getBeamGroups   = () => getBufferGroups(BUFFER_SETTING);
const _removeBeamGroup = groupId => removeBufferGroup(BUFFER_SETTING, groupId);

// Wildcard image resolution lives in token-spawn-utils.js — shared with the
// ship spawner, which builds tokens from prototypes the same way.

// ── Beam out ──────────────────────────────────────────────────────────────────

async function _beamOutSelected(transporterType, effects) {
  const controlled = canvas.tokens.controlled;
  if (!controlled?.length) {
    ui.notifications.warn("No tokens selected. Select tokens to beam out.");
    return;
  }
  if (controlled.length > 6) {
    ui.notifications.error(`Transporter Malfunction — ${controlled.length} patterns detected. Starfleet regulations limit transport to 6 personnel simultaneously.`);
    return;
  }

  const config  = effects[transporterType];
  const entries = controlled
    .filter(t => t.actor)
    .map(t => ({
      actorId:      t.actor.id,
      name:         t.actor.name,
      img:          t.document.texture?.src ?? t.actor.img,
      resolvedImg:  t.document.texture?.src ?? t.actor.img,
      wildcardPath: t.actor.prototypeToken?.texture?.src ?? t.actor.prototypeToken?.img,
      isLinked:     t.document.actorLink,
      isWildcard:   t.actor.prototypeToken?.randomImg ?? false,
      quantity:     1,
    }));

  if (entries.length) {
    const effectName = effects[transporterType]?.name ?? transporterType;
    // transporterType rides along so a restore replays the emitter it left on,
    // whatever the panel is set to now.
    const newGroup = makeBufferGroup(effectName, entries, { transporterType });
    await addBufferGroup(BUFFER_SETTING, newGroup);
    ui.notifications.info(`Transporter buffer: "${newGroup.label}" — ${entries.length} pattern${entries.length > 1 ? "s" : ""} held.`);
  }

  _playSound(config.sound);

  for (const token of controlled) {
    if (_isNativeVFX()) {
      TransporterVFX.beamOut(token, transporterType);
    } else {
      _playEffect(token, transporterType, effects);
      _applyTransporterMagic(token, transporterType);
    }
    setTimeout(async () => {
      try {
        await token.document.update({ alpha: 0 }, { animate: true, animation: { duration: 1800 } });
        setTimeout(async () => { try { await token.document.delete(); } catch { /**/ } }, 1000);
      } catch (e) { console.error("Transporter beam-out error:", e); }
    }, 3200);
  }
}

// ── Beam in ───────────────────────────────────────────────────────────────────
//
// A beam-in and a buffer restore are the same operation with a different source
// of names, so they share one pair of steps: work out where everyone lands, then
// materialise them. The canvas picking itself lives in spawn-picker.js, shared
// with the ship spawner.

/**
 * One person to materialise.
 *
 * `radius` is only for the placement preview; `halfW`/`halfH` are what turn a
 * centre point into the top-left a TokenDocument wants. Reading the footprint
 * from the prototype means a mounted or large actor no longer lands half a cell
 * off the pattern the GM saw.
 */
function _beamItem({ actor, displayName, isWildcard, wildcardPath, resolvedImg }) {
  const { halfW, halfH } = protoHalfSize(actor);
  return {
    actor, displayName, isWildcard, wildcardPath, resolvedImg,
    halfW, halfH,
    radius: Math.max(Math.max(halfW, halfH) * 0.9, 25),
  };
}

/**
 * Where the beam lands, as centre points — one per item, in queue order.
 *
 * All of the actual work is pickSpawnCentres in spawn-picker.js, shared with
 * the Ships and Q tabs; this only dresses its messages in transporter language.
 */
function _pickBeamCentres(items, { pattern, spacing, location, indicatorColor, verb }) {
  return pickSpawnCentres(items, {
    pattern, spacing, location,
    color: indicatorColor,
    verb,
    noun: "pattern",
    padNoun: "pad",
    errorPrefix: "Transporter Malfunction — ",
    abortMsg: "Transport aborted.",
  });
}

/**
 * Create the tokens and run the arrival effect on each.
 *
 * `snap` is on only when filling a Region, where landing on grid spaces is the
 * whole point. A free canvas click and a pad marker are both deliberate
 * placements — the GM put the cursor or drew the marker where they meant it, and
 * a marker that was drawn off-grid was drawn off-grid on purpose.
 */
async function _materializeItems(items, centres, effectType, effects, { snap = false } = {}) {
  const config = effects[effectType];
  _playSound(config?.sound);
  canvas.animatePan({ x: centres[0]?.x ?? 0, y: centres[0]?.y ?? 0, duration: 1000 });

  for (let i = 0; i < items.length; i++) {
    const item   = items[i];
    const centre = centres[i] ?? centres[0];
    const { x, y } = centreToTopLeft(centre, item.halfW, item.halfH, snap);

    try {
      const newTokenData = await buildSpawnTokenData(item.actor, {
        name: item.displayName, x, y, alpha: 0,
      });

      // A restored pattern comes back wearing the image it left with, rather
      // than a fresh wildcard roll — the same person rematerialises.
      const proto    = item.actor.prototypeToken;
      const protoImg = proto?.texture?.src ?? proto?.img;
      let img = item.resolvedImg ?? null;
      if (!img && item.isWildcard && item.wildcardPath) img = await getWildcardImage(item.wildcardPath);
      if (img && img !== protoImg) {
        newTokenData.texture = foundry.utils.mergeObject(newTokenData.texture ?? {}, { src: img });
      }

      const [created] = await canvas.scene.createEmbeddedDocuments("Token", [newTokenData]);
      if (!created) throw new Error("Token creation returned nothing.");

      if (_isNativeVFX()) {
        // Native VFX: beamIn drives the full materialisation sequence —
        // mesh alpha, glow filters, and document sync are all handled internally.
        // A 50 ms yield ensures the canvas token is registered before we animate it.
        setTimeout(() => {
          const tk = canvas.tokens.get(created.id);
          if (tk) TransporterVFX.beamIn(tk, effectType);
        }, 50);
      } else {
        setTimeout(async () => {
          try {
            const td = created.document ?? created;
            // Apply sparkle rain right as the token begins to fade in so it's
            // visible from the very first frame of materialisation.
            const tk = canvas.tokens.get(created.id);
            if (tk) _applyTransporterMagic(tk, effectType);
            await td.update({ alpha: 1 }, { animate: true, animation: { duration: 800 } });
            // Let the effect shimmer briefly after fully materialising, then
            // clean up.  (800 ms fade + ~1 s visible = 1800 ms)
            setTimeout(() => {
              const tk2 = canvas.tokens.get(created.id);
              if (tk2) _removeTransporterMagic(tk2);
            }, 1800);
          } catch { /**/ }
        }, 2000);
        _playEffect(created, effectType, effects);
      }
    } catch (e) {
      console.error(`Transporter: error spawning ${item.displayName}:`, e);
      ui.notifications.error(`Failed to spawn ${item.displayName}.`);
    }
  }
}

// ── Beam in (from the panel queue) ────────────────────────────────────────────

async function _beamInQueue(selectedTokens, transporterType, spacing, effects, pattern = "circle", location = "canvas") {
  if (!selectedTokens.length) {
    ui.notifications.warn("No tokens in the transport queue.");
    return;
  }
  const total = selectedTokens.reduce((s, t) => s + (t.isLinked ? 1 : t.quantity), 0);
  if (total > 6) {
    ui.notifications.error(`Transporter Malfunction — ${total} patterns in queue. Starfleet limit is 6.`);
    return;
  }

  const indicatorColor = _TRANSPORTER_COLORS[transporterType] ?? 0x4488ff;

  const items = [];
  for (const td of selectedTokens) {
    const count = td.isLinked ? 1 : td.quantity;
    for (let i = 0; i < count; i++) {
      items.push(_beamItem({
        actor:        td.actor,
        displayName:  count > 1 ? `${td.name} ${i + 1}` : td.name,
        isWildcard:   td.isWildcard,
        wildcardPath: td.wildcardPath,
      }));
    }
  }

  const centres = await _pickBeamCentres(items, {
    pattern, spacing, location, indicatorColor, verb: "BEAM-IN",
  });
  if (!centres) return false;   // aborted — queue stays intact

  await _materializeItems(items, centres, transporterType, effects, {
    snap: parseLocation(location).kind === "region",
  });
  return true;  // beam-in completed — caller may clear queue
}

// ── Restore a buffered group ──────────────────────────────────────────────────

async function _spawnGroupEntries(group, transporterType, spacing, effects, pattern = "circle", location = "canvas") {
  const { entries, transporterType: savedType, label } = group;
  const effectType = savedType ?? transporterType;
  const indicatorColor = _TRANSPORTER_COLORS[effectType] ?? 0x4488ff;

  const items = [];
  for (const entry of entries) {
    const actor = game.actors.get(entry.actorId);
    if (!actor) { console.warn(`Transporter: actor ${entry.actorId} not found.`); continue; }
    items.push(_beamItem({
      actor,
      displayName:  entry.name,
      isWildcard:   entry.isWildcard,
      wildcardPath: entry.wildcardPath,
      resolvedImg:  entry.resolvedImg,
    }));
  }
  if (!items.length) {
    ui.notifications.error(`No actors left for "${label}" — the patterns cannot be restored.`);
    return false;
  }

  const centres = await _pickBeamCentres(items, {
    pattern, spacing, location, indicatorColor, verb: `RESTORE · ${label}`,
  });
  if (!centres) return false;   // aborted — buffer stays intact

  await _materializeItems(items, centres, effectType, effects, {
    snap: parseLocation(location).kind === "region",
  });
  return true;  // materialization completed — caller may remove the buffer entry
}

// ── Dialog HTML builders ──────────────────────────────────────────────────────

const _buildBeamBufferHTML = groups => buildBufferHTML(groups, {
  title: "BUFFER",
  empty: "— NO PATTERNS HELD —",
  unit:  "PATTERN",
  icon:  "⚡",
});

// Queue UI (drop zone, rows, quantity) is shared with the Q tab — spawn-queue.js.


// ── Buffer button wiring ──────────────────────────────────────────────────────

/**
 * @param {HTMLElement} html   Element holding the buffer buttons — the whole
 *   panel on first wire, just the rebuilt buffer column afterwards.
 * @param {object} transporterEffects
 * @param {() => Promise<void>} refresh
 * @param {HTMLElement} [panel] Where the placement controls live. Defaults to
 *   `html`, which is right on the first wire and wrong after a rebuild.
 * @param {object} [api]        Spawn-window API, for getting out of the way of
 *   the canvas during placement.
 */
function _wireBufferButtons(html, transporterEffects, refresh, panel = html, api = null) {
  const place = fn => (api?.hideWhile ? api.hideWhile(fn) : fn());

  wireBufferButtons(html, {
    settingKey: BUFFER_SETTING,
    noun: "transport group",
    refresh,
    restore: group => {
      const { type, spacing, pattern, location } = _readTpControls(panel);
      return place(() => _spawnGroupEntries(group, type, spacing, transporterEffects, pattern, location));
    },
  });
}

// ── Panel state ───────────────────────────────────────────────────────────────

/**
 * The transport queue. Module-level, like the ship spawner's, so it survives a
 * tab switch — the spawn window keeps both panels mounted and the GM should be
 * able to assemble a landing party, go look at the fleet, and come back to it.
 */
let _tpQueue = [];

/**
 * The buffer groups as last rendered. The footer only needs their count — it
 * offers "Restore All (n)" when something is held — and caching them here keeps
 * buildActions synchronous, which is what the window's tab switch needs.
 */
let _tpGroups = [];

/** Effect definitions are rebuilt per render so a settings change is picked up. */
function _effects() {
  return _buildTransporterEffects();
}

/** Grid-aware default spacing — 350px at a 100px grid. */
function _defaultSpacing() {
  return Math.round(350 * ((canvas.grid?.size ?? 100) / 100));
}

// ── Rail keys ─────────────────────────────────────────────────────────────────
// Rebuilt whenever the buffer changes, since Restore All only exists when there
// is something held.

function _buildActions(groups, transporterEffects, contentEl, refresh, api) {
  const cfg = () => _readTpControls(contentEl);
  /** Placement happens on the canvas under this panel, so get out of the way. */
  const place = fn => (api?.hideWhile ? api.hideWhile(fn) : fn());

  const keys = [];

  const beamOutBtn = swKey("Beam Out", {
    icon: "fas fa-sign-out-alt",
    accent: "var(--sw-secondary)",
    title: "Beam the selected tokens out and hold them in the pattern buffer",
  });
  beamOutBtn.addEventListener("click", async () => {
    if (beamOutBtn.disabled) return;
    beamOutBtn.disabled = true;
    await _beamOutSelected(cfg().type, transporterEffects);
    await refresh();
    // refresh() rebuilds the rail — no need to re-enable
  });
  keys.push(beamOutBtn);

  const beamInBtn = swKey("Beam In", { icon: "fas fa-check" });
  beamInBtn.addEventListener("click", async () => {
    if (beamInBtn.disabled) return;
    beamInBtn.disabled = true;
    const { type, spacing, pattern, location } = cfg();
    const beamed = await place(() =>
      _beamInQueue(_tpQueue, type, spacing, transporterEffects, pattern, location));
    if (beamed) {
      _tpQueue.splice(0, _tpQueue.length);
      _renderTpQueue(contentEl);
    }
    beamInBtn.disabled = false;
  });
  keys.push(beamInBtn);

  if (groups.length) {
    const total = groups.reduce((n, g) => n + g.entries.length, 0);
    const restoreBtn = swKey(`Restore ${total}`, {
      icon: "fas fa-history",
      accent: "var(--sw-tertiary)",
      title: `Materialize every held pattern (${total})`,
    });
    restoreBtn.addEventListener("click", async () => {
      if (restoreBtn.disabled) return;
      restoreBtn.disabled = true;

      const { type, spacing, pattern, location } = cfg();
      const latest = await _getBeamGroups();
      const allSpawned = await place(async () => {
        for (const group of latest) {
          const spawned = await _spawnGroupEntries(group, type, spacing, transporterEffects, pattern, location);
          if (!spawned) return false;
          await _removeBeamGroup(group.groupId);
        }
        return true;
      });
      if (allSpawned) ui.notifications.info("All transporter buffer groups materialized.");
      await refresh();
    });
    keys.push(restoreBtn);
  }

  return keys;
}

// ── Panel HTML builders ───────────────────────────────────────────────────────

/** The buffer column's contents — rebuilt on its own whenever the buffer changes. */
function _buildBufferColumn(groups) {
  return swPanel("Transporter Buffer", _buildBeamBufferHTML(groups));
}

function _buildInnerHTML(groups, transporterEffects, adjustedSpacing, gridScaleFactor) {
  const typeOptions = Object.entries(transporterEffects)
    .map(([k, v]) => `<option value="${k}">${v.name}</option>`)
    .join("");

  const gridSize = Math.round(canvas.grid?.size ?? 100);
  const gridNote = gridScaleFactor !== 1
    ? `AUTO-ADJ ${gridSize}px GRID (${gridScaleFactor.toFixed(1)}×)`
    : null;

  const config = swGrid([
    swField("Emitter Type", swSelect({ id: "sta2e-tp-type", options: typeOptions })),
    swField("Token Spacing",
      swInput({ id: "sta2e-tp-spacing", value: adjustedSpacing }),
      { note: gridNote }),
    swField("Beam-In Pattern", swSelect({
      id: "sta2e-tp-pattern",
      options: Object.entries(SPAWN_PATTERNS)
        .map(([key, label]) => `<option value="${key}">${label}</option>`)
        .join(""),
    })),
    swField("Beam Site",
      swSelect({
        id: "sta2e-tp-location",
        options: buildLocationOptions(getSpawnPref(BEAM_SITE_PREF, "canvas")),
      }),
      { noteId: "sta2e-tp-location-note" }),
  ].join(""), 2);

  const left = [
    swPanel("Transporter Configuration", config),
    swPanel("Transport Queue", buildQueueHTML(), { meta: "drag tokens / actors here" }),
  ].join("");

  return swColumns(left, _buildBufferColumn(groups));
}

/** Read the four placement controls back out of the panel. */
function _readTpControls(root) {
  const q = sel => root?.querySelector(sel);
  return {
    type:     q("#sta2e-tp-type")?.value     ?? "tngFed",
    spacing:  parseInt(q("#sta2e-tp-spacing")?.value ?? _defaultSpacing()) || _defaultSpacing(),
    pattern:  q("#sta2e-tp-pattern")?.value  ?? "circle",
    location: q("#sta2e-tp-location")?.value || "canvas",
  };
}

const _renderTpQueue = root => renderQueue(root, _tpQueue);

/**
 * Re-read the panel against the current scene. Runs on every activation, since
 * the scene's Regions can change while the Ships tab is in front — and the
 * pattern control has nothing to say once a Region defines the layout.
 */
function _refreshTpPanel(root) {
  const select = root?.querySelector("#sta2e-tp-location");
  if (select) {
    select.innerHTML = buildLocationOptions(select.value);
    if (!select.value) select.value = "canvas";
  }

  // Neither Region mode has anything for the formation controls to say — the
  // pads or the grid spaces define the layout.
  const site    = parseLocation(select?.value);
  const onCanvas = site.kind === "canvas";
  const pattern  = root?.querySelector("#sta2e-tp-pattern");
  const spacing  = root?.querySelector("#sta2e-tp-spacing");
  if (pattern) pattern.disabled = !onCanvas;
  if (spacing) spacing.disabled = !onCanvas;

  const note = root?.querySelector("#sta2e-tp-location-note");
  if (note) {
    note.textContent = site.kind === "pads" ? "ONE PATTERN PER PAD MARKER"
                     : site.kind === "region" ? "ONE PATTERN PER GRID SPACE"
                     : "";
  }
}

// ── Tab registration ──────────────────────────────────────────────────────────

registerSpawnTab({
  id:    TAB_ID,
  label: "Transporter",
  icon:  "fas fa-person-booth",
  meta:  () => _getCurrentDateLabel() ?? "",
  buildHTML: async () => {
    _tpGroups = await _getBeamGroups();
    return _buildInnerHTML(_tpGroups, _effects(), _defaultSpacing(), (canvas.grid?.size ?? 100) / 100);
  },

  wire: (panel, api) => {
    const transporterEffects = _effects();

    // Rebuilds the buffer column and the rail keys — the queue, the emitter
    // type and the spacing the GM has already set are left alone.
    const refresh = async () => {
      _tpGroups = await _getBeamGroups();
      const colRight = panel.querySelector(".sw-col--right");
      if (colRight) {
        colRight.innerHTML = _buildBufferColumn(_tpGroups);
        _wireBufferButtons(colRight, transporterEffects, refresh, panel, api);
      }
      api.refreshActions();
    };
    panel._sta2eRefresh = refresh;

    wireQueue(panel, _tpQueue);
    _wireBufferButtons(panel, transporterEffects, refresh, panel, api);
    // Persisted only on a real choice, never on a refresh: moving to a scene
    // without those pads should not erase the pads you normally use.
    panel.querySelector("#sta2e-tp-location")?.addEventListener("change", ev => {
      setSpawnPref(BEAM_SITE_PREF, ev.currentTarget.value);
      _refreshTpPanel(panel);
    });

    _renderTpQueue(panel);   // re-hydrate from the surviving module state
    _refreshTpPanel(panel);
  },

  onActivate: panel => {
    _renderTpQueue(panel);
    _refreshTpPanel(panel);
  },

  buildActions: (panel, api) =>
    _buildActions(_tpGroups, _effects(), panel, panel._sta2eRefresh ?? (async () => {}), api),
});

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Open the spawn window on the Transporter tab. GM only.
 * Exposed as `game.sta2eToolkit.openTransporter()` and called by the Combat HUD.
 */
export async function openTransporter() {
  return openSpawnWindow({ tab: TAB_ID });
}

// ── Settings registration helper (called from settings.js) ───────────────────
// Registers the beam buffer storage setting and all sound path settings.

export function registerTransporterSettings() {
  // Visual effects engine selector
  game.settings.register(MODULE, "vfxEngine", {
    name:    "Transporter Visual Effects Engine",
    hint:    "Native: uses Foundry v14's built-in VFX API — no Sequencer or JB2A required. "
           + "Sequencer: plays JB2A assets via the Sequencer module (classic behaviour).",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      sequencer: "Sequencer + JB2A (default)",
      native:    "Native Foundry v14 VFX (experimental)",
    },
    default: "sequencer",
  });

  // Internal: beam buffer storage — world-scoped so all GMs share it
  game.settings.register(MODULE, "transporterBeamBuffer", {
    name:    "Transporter Beam Buffer",
    scope:   "world",
    config:  false,
    type:    Array,
    default: [],
  });

  // Managed via the "Sounds & Animations" config menu — config: false hides from main list
  const tSnd = (name) => ({
    name,
    hint:       "Audio file played when this transporter type activates. Leave blank for no sound.",
    scope:      "world",
    config:     false,
    type:       String,
    default:    "",
    filePicker: "audio",
  });

  game.settings.register(MODULE, "sndTransporterVoyFed",    tSnd("Transporter Sound — Voyager / Federation"));
  game.settings.register(MODULE, "sndTransporterTngFed",    tSnd("Transporter Sound — TNG Federation"));
  game.settings.register(MODULE, "sndTransporterTosFed",    tSnd("Transporter Sound — TOS Federation"));
  game.settings.register(MODULE, "sndTransporterTmpFed",    tSnd("Transporter Sound — TMP / Films"));
  game.settings.register(MODULE, "sndTransporterKlingon",   tSnd("Transporter Sound — Klingon"));
  game.settings.register(MODULE, "sndTransporterCardassian",tSnd("Transporter Sound — Cardassian"));
  game.settings.register(MODULE, "sndTransporterRomulan",   tSnd("Transporter Sound — Romulan"));
  game.settings.register(MODULE, "sndTransporterFerengi",   tSnd("Transporter Sound — Ferengi"));
  game.settings.register(MODULE, "sndTransporterBorg",      tSnd("Transporter Sound — Borg"));
}
