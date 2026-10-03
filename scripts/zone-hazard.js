/**
 * sta2e-toolkit | zone-hazard.js
 * Hazard damage system — damage is built via Threat spends at resolution time,
 * then routed through the same CombatHUD flows used by weapon attacks.
 *
 * Three categories with distinct timing/triggers:
 *   immediate — GM right-click triggered; one-shot with avoidance task option
 *   lingering — movement-triggered first time (builder opens, Threat spent, state stored);
 *               auto-fires every combat round via updateCombat hook
 *   terrain   — movement-triggered; Momentum to cross safely, or Threat → damage
 *
 * Damage routes:
 *   Ship / shields  → CombatHUD.applyDamage  (shield thresholds, breach triggers)
 *   Ship / breaches → CombatHUD.applyBreach × n
 *   Ground          → CombatHUD.applyGroundInjury (stress/injury flow)
 *
 * Threat cost tables (builder):
 *   Ship:   base 3 dmg = 2 Threat; +1 dmg = +1 Threat; Piercing +2; Persistent +3;
 *           Multi-zone +3; Not adversaries +3; Area × total (applied last)
 *   Ground: base Sev 1 = 2 Threat; +1 sev = +2 Threat; Multi-zone +3;
 *           Not adversaries +3; Area × total (applied last)
 */

import { getLcTokens }                                from "./lcars-theme.js";
import { lcarsChatCard } from "./chat-card-frame.js";
import { CombatHUD }                                  from "./combat-hud.js";
import { getSceneZones, updateZone, pointInPolygon }  from "./zone-data.js";
import { PaymentPrompt }                              from "./payment-prompt.js";
import { readPool, setPool }                          from "./pool-service.js";
import { getRegionFeatures, regionHazardView, regionContainsToken, tokenCentre } from "./region-terrain.js";
import { activeGmWhisperIds, isActiveGM }             from "./gm-authority.js";
import { createTraitFromData, postTraitCreatedCard }  from "./trait-service.js";

const LC     = new Proxy({}, { get(_, prop) { return getLcTokens()[prop]; } });
const MODULE = "sta2e-toolkit";

// ─────────────────────────────────────────────────────────────────────────────
// Momentum & Threat pool helpers (bridge to STA game system)
// ─────────────────────────────────────────────────────────────────────────────

function _getMomentum() {
  return readPool("momentum");
}

async function _setMomentum(value) {
  await setPool("momentum", value, { source: "zoneHazard" });
}

function _getThreat() {
  return readPool("threat");
}

async function _setThreat(value) {
  await setPool("threat", value, { source: "zoneHazard" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Threat cost math
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate total Threat cost from builder state.
 * Area is applied as a multiplier last, per the rules.
 */
function _calcThreatCost(isShip, bonusSteps, effects) {
  let cost = 2; // base
  if (isShip) {
    cost += Number(bonusSteps);           // +1 per step
    if (effects.piercing)       cost += 2;
    if (effects.persistent)     cost += 3;
    if (effects.multiZone)      cost += 3;
    if (effects.notAdversaries) cost += 3;
    if (effects.area)           cost *= 2; // applied last
  } else {
    cost += Number(bonusSteps) * 2;       // +2 per severity step
    if (effects.multiZone)      cost += 3;
    if (effects.notAdversaries) cost += 3;
    if (effects.area)           cost *= 2; // applied last
  }
  return Math.max(1, Math.round(cost));
}

// ─────────────────────────────────────────────────────────────────────────────
// Damage application — delegates to CombatHUD
// ─────────────────────────────────────────────────────────────────────────────

async function _applyHazardDamage(actor, tokenDoc, token, damage, damageType, effects) {
  if (!actor || (damage ?? 0) <= 0) return;
  const isShip = actor.system?.systems !== undefined;

  try {
    if (isShip) {
      if (damageType === "breaches") {
        for (let i = 0; i < damage; i++) {
          await CombatHUD.applyBreach(actor, CombatHUD.rollSystemHit(), token);
        }
      } else {
        // Apply resistance — Piercing ignores it
        const resistance  = (effects?.piercing) ? 0 : (actor.system?.resistance ?? 0);
        const finalDamage = Math.max(0, damage - resistance);
        await CombatHUD.applyDamage({
          tokenId:        tokenDoc.id,
          actorId:        actor.id,
          finalDamage,
          noDevastating:  true,
        });
      }
    } else {
      // Ground: damage value = severity (1 + bonus steps)
      await CombatHUD.applyGroundInjury({
        tokenId:    tokenDoc.id,
        actorId:    actor.id,
        injuryName: "Hazard Injury",
        useStun:    !(effects?.deadly ?? false),
        potency:    damage,
      });
    }
  } catch (err) {
    console.warn("STA2e Toolkit | Zone hazard damage application failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation system
// ─────────────────────────────────────────────────────────────────────────────

const HAZARD_JB2A = {
  "radiation":      null,
  "plasma-storm":   "jb2a.energy_strands.complete.orange.01",
  "asteroid-field": null,
  "nebula-gas":     null,
  "fire":           "jb2a.fire_eruption.15ft.orange",
  "falling-rocks":  null,
  "cave-in":        null,
  "toxic-gas":      null,
  "quicksand":      null,
  "electrical":     "jb2a.static_electricity.03.blue",
  "extreme-temp":   null,
  "minefield":      "jb2a.explosion.01.orange0",
  "generic":        null,
};

const HAZARD_COLORS = {
  "radiation":      0x00cc44,
  "plasma-storm":   0xff6600,
  "asteroid-field": 0xaa7733,
  "nebula-gas":     0x9966ff,
  "fire":           0xff4400,
  "falling-rocks":  0x886644,
  "cave-in":        0x554433,
  "toxic-gas":      0x88cc00,
  "quicksand":      0xcc9944,
  "electrical":     0x4499ff,
  "extreme-temp":   0xff2222,
  "minefield":      0xff6600,
  "generic":        0xff3333,
};

async function _playHazardAnimation(token, hazardType, soundKey) {
  if (!token) return;

  const snd = soundKey ? (game.settings.get("sta2e-toolkit", soundKey) ?? "") : "";
  if (snd) {
    AudioHelper.play({ src: snd, volume: 0.7, autoplay: true, loop: false }, true);
  }

  const jb2aPath = HAZARD_JB2A[hazardType] ?? null;
  const hasSeq   = !!window.Sequencer;
  const hasJB2A  = !!(window.JB2A_DnD5e || window.jb2a_patreon);
  const color    = HAZARD_COLORS[hazardType] ?? 0xff3333;

  if (hasSeq && hasJB2A && jb2aPath) {
    const seq = new Sequence();
    seq.effect().file(jb2aPath).atLocation(token).scaleToObject(1.5).duration(2000);
    await seq.play();
    return;
  }

  if (hasSeq && jb2aPath) {
    try {
      const seq = new Sequence();
      seq.effect().file(jb2aPath).atLocation(token).scaleToObject(1.5).duration(2000);
      await seq.play();
      return;
    } catch { /* fall through to PIXI */ }
  }

  await _pixiHazardFlash(token, color, hazardType);
}

async function _pixiHazardFlash(token, colorInt, hazardType) {
  const container = canvas?.interface ?? canvas?.stage;
  if (!container) return;

  const cx = token.center?.x ?? token.x;
  const cy = token.center?.y ?? token.y;
  const r  = Math.max(token.w, token.h) * 0.6;

  const gfx = new PIXI.Graphics();
  container.addChild(gfx);

  let frame = 0;
  const totalFrames = 30;

  await new Promise(resolve => {
    const tick = (delta) => {
      frame += delta;
      const t = frame / totalFrames;
      if (t >= 1) {
        gfx.parent?.removeChild(gfx);
        gfx.destroy();
        canvas.app?.ticker?.remove(tick);
        resolve();
        return;
      }

      gfx.clear();

      if (hazardType === "quicksand") {
        const scale = 1 - t * 0.3;
        gfx.beginFill(colorInt, (1 - t) * 0.5);
        gfx.drawEllipse(cx, cy + t * 10, r * scale, r * scale * 0.5);
        gfx.endFill();
      } else if (hazardType === "toxic-gas") {
        gfx.beginFill(colorInt, 0.4 - t * 0.4);
        gfx.drawCircle(cx, cy, r * (0.5 + t * 1.5));
        gfx.endFill();
      } else if (hazardType === "electrical") {
        gfx.lineStyle(2, colorInt, 1 - t);
        for (let a = 0; a < 3; a++) {
          const angle = (a / 3) * Math.PI * 2 + t * Math.PI;
          let lx = cx, ly = cy;
          gfx.moveTo(lx, ly);
          for (let s = 1; s <= 4; s++) {
            const d = (r * s) / 4;
            const jitter = (Math.random() - 0.5) * 20;
            lx = cx + Math.cos(angle) * d + jitter;
            ly = cy + Math.sin(angle) * d + jitter;
            gfx.lineTo(lx, ly);
          }
        }
      } else {
        gfx.lineStyle(4, colorInt, 1 - t);
        gfx.drawCircle(cx, cy, r * (0.3 + t * 1.2));
        gfx.beginFill(colorInt, 0.4 - t * 0.4);
        gfx.drawCircle(cx, cy, r * 0.7);
        gfx.endFill();
      }
    };
    canvas.app?.ticker?.add(tick);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hazard sources — a hazard lives either in a drawn zone's `hazards[]` or on a
// Region's `terrainHazard` behavior. Everything below works through a source
// ref so the builder, the cards and their wiring handle both the same way.
//
//   { kind: "zone",   zoneId, hazardId }
//   { kind: "region", sceneId, regionId, behaviorId }
// ─────────────────────────────────────────────────────────────────────────────

/** The source ref for a hazard: a Region view carries its own; a zone entry does not. */
export function hazardRef(zone, hazard) {
  if (hazard?.source) return hazard.source;
  return { kind: "zone", zoneId: zone?.id ?? null, hazardId: hazard?.id ?? null };
}

/** Old card payloads carried a bare zoneId/hazardId. */
function _refFromPayload(p) {
  if (p?.source) return p.source;
  return { kind: "zone", zoneId: p?.zoneId ?? null, hazardId: p?.hazardId ?? null };
}

function _regionFromRef(ref) {
  const scene  = (ref.sceneId && game.scenes?.get(ref.sceneId)) || canvas?.scene;
  const region = scene?.regions?.get?.(ref.regionId) ?? null;
  const behavior = region?.behaviors?.get?.(ref.behaviorId) ?? null;
  return { scene, region, behavior };
}

/**
 * Resolve a ref to the live hazard.
 * @returns {{ name, hazard, containsToken(tokenDoc): boolean, store(patch) } | null}
 */
export function resolveHazardSource(ref) {
  if (!ref) return null;
  if (ref.kind === "region") {
    const { region, behavior } = _regionFromRef(ref);
    if (!region || !behavior) return null;
    const hazard = regionHazardView({ region, behavior, system: behavior.system });
    return {
      name: region.name || "Region",
      hazard,
      containsToken: doc => regionContainsToken(region, doc),
      store: async (patch) => {
        await behavior.update({ "system.established": _patchToEstablished(patch) });
      },
    };
  }

  const zone   = getSceneZones().find(z => z.id === ref.zoneId);
  const hazard = zone?.hazards?.find(h => h.id === ref.hazardId);
  if (!zone || !hazard) return null;
  return {
    name: zone.name || "(unnamed)",
    hazard,
    containsToken: doc => {
      const c = tokenCentre(doc);
      return pointInPolygon(c.x, c.y, zone.vertices);
    },
    store: async (patch) => {
      const updated = zone.hazards.map(h => (h.id === ref.hazardId ? { ...h, ...patch } : h));
      await updateZone(zone.id, { hazards: updated });
    },
  };
}

function _patchToEstablished(p) {
  if (!p.established) return {};
  return {
    established: true,
    damage:      p.establishedDamage ?? null,
    damageType:  p.establishedDamageType ?? null,
    effects:     p.establishedEffects ?? {},
    threatCost:  p.establishedThreatCost ?? 0,
    mode:        p.establishedMode ?? "damage",
    trait:       p.establishedTrait ?? null,
  };
}

/** Builder result → the stored "established" fields. */
function _establishedPatch(result, threatCost) {
  return {
    established:           true,
    establishedDamage:     result.damage ?? null,
    establishedDamageType: result.damageType ?? null,
    establishedEffects:    result.effects ?? {},
    establishedThreatCost: threatCost ?? 0,
    establishedMode:       result.mode ?? "damage",
    establishedTrait:      result.mode === "trait" ? { name: result.traitName, scope: result.traitScope } : null,
  };
}

const _CLEARED_PATCH = Object.freeze({
  established: false, establishedDamage: null, establishedDamageType: null,
  establishedEffects: null, establishedThreatCost: null, establishedMode: null, establishedTrait: null,
});

async function _storeEstablished(ref, result, threatCost) {
  const src = resolveHazardSource(ref);
  if (!src) return;
  await src.store(_establishedPatch(result, threatCost));
  game.sta2eToolkit?.zoneMonitor?._debouncedRefresh();
}

/** A stored hazard, replayed as a builder result. */
function _resultFromEstablished(hazard, isShip) {
  if (hazard.establishedMode === "trait" && hazard.establishedTrait?.name) {
    return {
      mode: "trait", traitName: hazard.establishedTrait.name, traitScope: hazard.establishedTrait.scope ?? "actor",
      damage: 0, damageType: null, effects: {}, totalThreatCost: 0, waiveThreat: true,
    };
  }
  return {
    mode:            "damage",
    damage:          hazard.establishedDamage ?? (isShip ? 3 : 1),
    damageType:      hazard.establishedDamageType ?? (isShip ? "shields" : "stress"),
    effects:         hazard.establishedEffects ?? {},
    totalThreatCost: hazard.establishedThreatCost ?? 2,
    waiveThreat:     true,
  };
}

/** Impose a hazard's trait — on the token's actor, or on the scene. */
async function _applyHazardTrait(actor, result, hazardLabel, sourceName, threatSpent) {
  const scope = result.traitScope === "scene" ? "scene" : "actor";
  const data = {
    name:        result.traitName || hazardLabel,
    scope,
    actorId:     scope === "actor" ? (actor?.id ?? "") : "",
    duration:    scope === "scene" ? "scene" : "persistent",
    description: `Imposed by the hazard "${hazardLabel}" (${sourceName}).`,
    quantity:    1,
  };
  try {
    await createTraitFromData(data);
    await postTraitCreatedCard(data, threatSpent > 0 ? { amount: threatSpent, pool: "threat" } : null);
  } catch (err) {
    console.warn("STA2e Toolkit | Hazard trait creation failed:", err);
    ui.notifications.warn(`STA2e Toolkit: Could not create trait "${data.name}" — ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ZoneHazard
// ─────────────────────────────────────────────────────────────────────────────

export class ZoneHazard {

  // ── Hazard builder dialog ──────────────────────────────────────────────────

  /**
   * Interactive Threat-spend builder dialog.
   * @param {string} hazardLabel
   * @param {object} hazard         zone hazard entry (may have established state)
   * @param {boolean} isShip
   * @param {string} category       "immediate" | "lingering" | "terrain"
   * @returns {{ damage, damageType, effects, totalThreatCost, waiveThreat } | null}
   */
  static async _showHazardBuilder(hazardLabel, hazard, isShip, category) {
    const hasEst    = !!hazard.established;
    const preEff    = hazard.establishedEffects ?? {};
    const preBonus  = hasEst
      ? Math.max(0, (hazard.establishedDamage ?? (isShip ? 3 : 1)) - (isShip ? 3 : 1))
      : 0;
    const curThreat = _getThreat();

    // Which effects are available for this category
    const canArea      = category === "immediate";
    const canMultiZone = category === "lingering";
    const canNotAdv    = category !== "terrain";
    const canPiercing  = isShip;
    const canPersist   = isShip;

    const baseLine = isShip ? "3 damage" : "Severity 1 injury";

    // Hazardous terrain: "that Threat is spent immediately to inflict damage on
    // the ship or impose a trait". A lingering hazard ticks every round, which a
    // trait cannot, so it stays damage-only.
    const canTrait    = category !== "lingering";
    const preTrait    = hasEst && hazard.establishedMode === "trait";
    const traitName   = hazard.establishedTrait?.name ?? hazardLabel;
    const traitScope  = hazard.establishedTrait?.scope ?? "actor";
    const escAttr     = s => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

    const content = `
<div style="font-family:${LC.font};padding:4px 2px;">
  <div style="color:${LC.primary};font-size:0.6em;letter-spacing:2px;margin-bottom:6px;">
    ⚡ HAZARD BUILDER — ${isShip ? "STARSHIP" : "GROUND"} — ${category.toUpperCase()}
  </div>
  <div style="color:${LC.textBright};font-size:0.9em;font-weight:700;margin-bottom:8px;">
    ${hazardLabel}
  </div>
  <div style="color:${LC.textDim};font-size:0.78em;margin-bottom:8px;">
    Threat Pool: <strong style="color:${LC.secondary};">${curThreat}</strong>
  </div>

  ${canTrait ? `
  <div style="display:flex;gap:12px;margin-bottom:8px;font-size:0.82em;color:${LC.text};">
    <label style="cursor:pointer;"><input type="radio" name="hb-mode" value="damage" ${preTrait ? "" : "checked"}> Inflict Damage</label>
    <label style="cursor:pointer;"><input type="radio" name="hb-mode" value="trait" ${preTrait ? "checked" : ""}> Impose Trait</label>
  </div>
  <div id="hb-trait-panel" style="background:${LC.panel};border:1px solid ${LC.borderDim};border-radius:4px;padding:8px;margin-bottom:8px;">
    <div style="color:${LC.text};font-size:0.8em;margin-bottom:6px;font-weight:700;">
      Impose a trait — <span style="color:${LC.yellow};">2 Threat</span>
    </div>
    <input type="text" id="hb-trait-name" value="${escAttr(traitName)}"
      style="width:100%;margin-bottom:6px;background:${LC.bg};border:1px solid ${LC.borderDim};color:${LC.text};padding:2px 4px;">
    <select id="hb-trait-scope"
      style="width:100%;background:${LC.panel};border:1px solid ${LC.borderDim};color:${LC.text};font-size:0.85em;padding:1px 4px;">
      <option value="actor" ${traitScope === "scene" ? "" : "selected"}>On the ${isShip ? "ship" : "character"} crossing</option>
      <option value="scene" ${traitScope === "scene" ? "selected" : ""}>On the scene</option>
    </select>
  </div>` : ""}

  <div id="hb-damage-panel" style="background:${LC.panel};border:1px solid ${LC.borderDim};border-radius:4px;padding:8px;margin-bottom:8px;">
    <div style="color:${LC.text};font-size:0.8em;margin-bottom:8px;font-weight:700;">
      Base: ${baseLine} — <span style="color:${LC.yellow};">2 Threat</span>
    </div>

    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span style="color:${LC.text};font-size:0.8em;flex:1;">
        ${isShip ? "+1 damage steps (+1 Threat each)" : "+1 severity steps (+2 Threat each)"}:
      </span>
      <button type="button" id="hb-decr"
        style="width:24px;height:24px;padding:0;font-weight:700;line-height:1;
          background:${LC.panel};border:1px solid ${LC.borderDim};color:${LC.text};
          border-radius:3px;cursor:pointer;">−</button>
      <span id="hb-bonus-val"
        style="min-width:24px;text-align:center;color:${LC.textBright};font-weight:700;
          font-size:1em;">0</span>
      <button type="button" id="hb-incr"
        style="width:24px;height:24px;padding:0;font-weight:700;line-height:1;
          background:${LC.panel};border:1px solid ${LC.borderDim};color:${LC.text};
          border-radius:3px;cursor:pointer;">+</button>
    </div>

    ${canPiercing ? `
    <label style="display:flex;align-items:center;gap:6px;font-size:0.8em;color:${LC.text};margin-bottom:5px;cursor:pointer;">
      <input type="checkbox" id="hb-piercing" ${preEff.piercing ? "checked" : ""}>
      Piercing — ignore Resistance <span style="color:${LC.yellow};">(+2 Threat)</span>
    </label>` : ""}

    ${canPersist ? `
    <label style="display:flex;align-items:center;gap:6px;font-size:0.8em;color:${LC.text};margin-bottom:5px;cursor:pointer;">
      <input type="checkbox" id="hb-persistent" ${preEff.persistent ? "checked" : ""}>
      Persistent <span style="color:${LC.yellow};">(+3 Threat)</span>
      <select id="hb-persist-rounds"
        style="margin-left:4px;background:${LC.panel};border:1px solid ${LC.borderDim};
          color:${LC.text};font-size:0.85em;border-radius:3px;padding:1px 4px;">
        <option value="1" ${(preEff.persistentRounds ?? 1) === 1 ? "selected" : ""}>1 round</option>
        <option value="2" ${(preEff.persistentRounds ?? 1) === 2 ? "selected" : ""}>2 rounds</option>
        <option value="3" ${(preEff.persistentRounds ?? 1) === 3 ? "selected" : ""}>3 rounds</option>
      </select>
    </label>` : ""}

    ${canArea ? `
    <label style="display:flex;align-items:center;gap:6px;font-size:0.8em;color:${LC.text};margin-bottom:5px;cursor:pointer;">
      <input type="checkbox" id="hb-area" ${preEff.area ? "checked" : ""}>
      Area — all tokens in zone <span style="color:${LC.yellow};">(× total cost)</span>
    </label>` : ""}

    ${canMultiZone ? `
    <label style="display:flex;align-items:center;gap:6px;font-size:0.8em;color:${LC.text};margin-bottom:5px;cursor:pointer;">
      <input type="checkbox" id="hb-multizone" ${preEff.multiZone ? "checked" : ""}>
      Multi-zone <span style="color:${LC.yellow};">(+3 Threat)</span>
    </label>` : ""}

    ${canNotAdv ? `
    <label style="display:flex;align-items:center;gap:6px;font-size:0.8em;color:${LC.text};margin-bottom:5px;cursor:pointer;">
      <input type="checkbox" id="hb-notadv" ${preEff.notAdversaries ? "checked" : ""}>
      Does not affect adversaries <span style="color:${LC.yellow};">(+3 Threat)</span>
    </label>` : ""}

    ${!isShip ? `
    <label style="display:flex;align-items:center;gap:6px;font-size:0.8em;color:${LC.red};margin-bottom:5px;cursor:pointer;">
      <input type="checkbox" id="hb-deadly" ${preEff.deadly ? "checked" : ""}>
      Deadly injury <span style="color:${LC.textDim};">(no extra cost)</span>
    </label>` : ""}
  </div>

  ${hasEst ? `
  <div style="background:${LC.panel};border:1px solid ${LC.primary};border-radius:4px;
    padding:6px 8px;margin-bottom:8px;">
    <label style="display:flex;align-items:center;gap:6px;font-size:0.82em;
      color:${LC.primary};cursor:pointer;font-weight:700;">
      <input type="checkbox" id="hb-estab" checked>
      ♻ Established — waive Threat cost
    </label>
    <div style="color:${LC.textDim};font-size:0.72em;margin-top:3px;">
      Previously built: ${hazard.establishedMode === "trait"
        ? `trait "${hazard.establishedTrait?.name ?? "?"}"`
        : `${hazard.establishedDamage ?? "?"} ${hazard.establishedDamageType ?? ""} damage`}
    </div>
  </div>` : ""}

  <div style="background:${LC.panel};border:1px solid ${LC.borderDim};border-radius:4px;
    padding:8px;display:flex;align-items:center;justify-content:space-between;">
    <span style="color:${LC.text};font-size:0.85em;">Total Threat Cost:</span>
    <strong id="hb-cost-val" style="color:${LC.yellow};font-size:1.1em;">2</strong>
  </div>
</div>`;

    return foundry.applications.api.DialogV2.wait({
      window: { title: `Hazard Builder — ${hazardLabel}` },
      content,
      buttons: [
        {
          action: "launch",
          label: "⚡ Launch Hazard",
          icon: "fas fa-bolt",
          callback: (event, button, dialog) => {
            const el = dialog?.element ?? dialog;
            const bonusVal = parseInt(el?.querySelector?.("#hb-bonus-val")?.textContent ?? "0") || 0;
            const effects = {
              piercing:         el?.querySelector?.("#hb-piercing")?.checked  ?? false,
              persistent:       el?.querySelector?.("#hb-persistent")?.checked ?? false,
              persistentRounds: parseInt(el?.querySelector?.("#hb-persist-rounds")?.value ?? "1") || 1,
              area:             el?.querySelector?.("#hb-area")?.checked      ?? false,
              multiZone:        el?.querySelector?.("#hb-multizone")?.checked  ?? false,
              notAdversaries:   el?.querySelector?.("#hb-notadv")?.checked    ?? false,
              deadly:           el?.querySelector?.("#hb-deadly")?.checked    ?? false,
            };
            const waiveThreat    = el?.querySelector?.("#hb-estab")?.checked ?? false;
            const mode = el?.querySelector?.('input[name="hb-mode"]:checked')?.value === "trait" ? "trait" : "damage";
            if (mode === "trait") {
              return {
                mode,
                traitName:       (el.querySelector("#hb-trait-name")?.value ?? "").trim() || hazardLabel,
                traitScope:      el.querySelector("#hb-trait-scope")?.value === "scene" ? "scene" : "actor",
                damage:          0,
                damageType:      null,
                effects:         {},
                totalThreatCost: waiveThreat ? 0 : 2,
                waiveThreat,
              };
            }
            const damage         = isShip ? 3 + bonusVal : 1 + bonusVal;
            const damageType     = isShip ? "shields" : "stress";
            const totalThreatCost = waiveThreat ? 0 : _calcThreatCost(isShip, bonusVal, effects);
            return { mode, damage, damageType, effects, totalThreatCost, waiveThreat };
          },
        },
        {
          action: "cancel",
          label: "Cancel",
          icon: "fas fa-times",
          callback: () => null,
        },
      ],
      default: "launch",
      render: (_event, html) => {
        const el = html?.element ?? html;
        if (!el) return;

        // Pre-fill bonus steps from established state
        const bonusEl = el.querySelector("#hb-bonus-val");
        if (bonusEl) bonusEl.textContent = String(preBonus);

        const isTraitMode = () => el.querySelector('input[name="hb-mode"]:checked')?.value === "trait";

        const updateCost = () => {
          const traitMode = isTraitMode();
          const dmgPanel   = el.querySelector("#hb-damage-panel");
          const traitPanel = el.querySelector("#hb-trait-panel");
          if (dmgPanel)   dmgPanel.style.display   = traitMode ? "none" : "";
          if (traitPanel) traitPanel.style.display = traitMode ? "" : "none";
          const bonus = parseInt(el.querySelector("#hb-bonus-val")?.textContent ?? "0") || 0;
          const eff = {
            piercing:       el.querySelector("#hb-piercing")?.checked  ?? false,
            persistent:     el.querySelector("#hb-persistent")?.checked ?? false,
            area:           el.querySelector("#hb-area")?.checked      ?? false,
            multiZone:      el.querySelector("#hb-multizone")?.checked  ?? false,
            notAdversaries: el.querySelector("#hb-notadv")?.checked    ?? false,
          };
          const waive   = el.querySelector("#hb-estab")?.checked ?? false;
          const costEl  = el.querySelector("#hb-cost-val");
          if (costEl) {
            costEl.textContent = waive
              ? "0 (Established)"
              : String(traitMode ? 2 : _calcThreatCost(isShip, bonus, eff));
          }
        };

        el.querySelectorAll('input[name="hb-mode"]').forEach(r => r.addEventListener("change", updateCost));

        el.querySelector("#hb-incr")?.addEventListener("click", () => {
          const bv = el.querySelector("#hb-bonus-val");
          if (bv) { bv.textContent = String(parseInt(bv.textContent || "0") + 1); updateCost(); }
        });
        el.querySelector("#hb-decr")?.addEventListener("click", () => {
          const bv = el.querySelector("#hb-bonus-val");
          if (bv) {
            const cur = parseInt(bv.textContent || "0");
            if (cur > 0) { bv.textContent = String(cur - 1); updateCost(); }
          }
        });

        for (const id of ["#hb-piercing","#hb-persistent","#hb-area","#hb-multizone","#hb-notadv","#hb-estab"]) {
          el.querySelector(id)?.addEventListener("change", updateCost);
        }

        updateCost();
      },
    }).catch(() => null);
  }

  // ── Chat cards ─────────────────────────────────────────────────────────────

  /**
   * Post an avoidance challenge card for an immediate hazard.
   * GM clicks Avoided / Take Damage per target — wired by wireAvoidanceCard().
   */
  static async _postAvoidanceCard(actorName, zoneName, hazard, builtResult, tokenId, actorId) {
    const { damage, damageType, effects, totalThreatCost } = builtResult;
    const difficulty = Math.max(1, totalThreatCost);

    const effNotes = [
      effects.piercing    ? "Piercing"                              : "",
      effects.persistent  ? `Persistent ${effects.persistentRounds || 1}R` : "",
      effects.area        ? "Area"                                  : "",
      effects.deadly      ? "Deadly"                                : "",
    ].filter(Boolean).join(" · ");

    const body = `
  <div style="padding:8px 12px;border-bottom:1px solid ${LC.borderDim};">
    <div style="color:${LC.textBright};font-size:0.9em;">
      <strong>${actorName}</strong> · <em>${zoneName}</em>
    </div>
    <div style="color:${LC.yellow};font-size:0.85em;margin-top:2px;font-weight:700;">
      ${hazard.label || hazard.type}
    </div>
    ${hazard.description
      ? `<div style="color:${LC.textDim};font-size:0.78em;margin-top:2px;">"${hazard.description}"</div>`
      : ""}
  </div>
  <div style="padding:8px 12px;border-bottom:1px solid ${LC.borderDim};">
    <div style="color:${LC.secondary};font-size:0.82em;">
      Avoidance Task Difficulty: <strong style="color:${LC.textBright};">${difficulty}</strong>
    </div>
    <div style="color:${LC.red};font-size:0.78em;margin-top:2px;">
      Potential: ${damage} ${damageType}${effNotes ? " · " + effNotes : ""}
    </div>
  </div>
  <div class="sta2e-avoidance-buttons" style="padding:8px 12px;display:flex;flex-direction:column;gap:4px;">
    <button class="sta2e-hazard-avoided"
      style="width:100%;padding:4px 8px;font-family:${LC.font};font-size:0.72em;font-weight:700;
        letter-spacing:0.06em;text-transform:uppercase;background:${LC.panel};
        border:1px solid ${LC.green ?? "#00cc66"};border-radius:3px;
        color:${LC.green ?? "#00cc66"};cursor:pointer;">
      ✅ Avoided (Task Succeeded)
    </button>
    <button class="sta2e-hazard-take-damage"
      style="width:100%;padding:4px 8px;font-family:${LC.font};font-size:0.72em;font-weight:700;
        letter-spacing:0.06em;text-transform:uppercase;background:${LC.panel};
        border:1px solid ${LC.red};border-radius:3px;color:${LC.red};cursor:pointer;">
      💥 Take Damage (Task Failed)
    </button>
  </div>`;

    const content = lcarsChatCard({
      title: `IMMEDIATE HAZARD — AVOIDANCE TASK`,
      accent: LC.yellow,
      body,
      legacy: () => `
<div style="background:${LC.bg};border:2px solid ${LC.yellow};border-radius:8px;
  font-family:${LC.font};overflow:hidden;max-width:320px;">
  <div style="background:${LC.yellow};padding:5px 12px;">
    <span style="color:#000;font-weight:700;font-size:0.65em;letter-spacing:2px;">
      IMMEDIATE HAZARD — AVOIDANCE TASK
    </span>
  </div>${body}
</div>`,
    });

    await ChatMessage.create({
      content,
      speaker: { alias: "Zone Hazard" },
      flags: {
        [MODULE]: {
          type:                "hazardAvoidance",
          tokenId,
          actorId,
          builtDamage:         damage,
          builtDamageType:     damageType,
          effects,
          avoidanceDifficulty: difficulty,
          hazardLabel:         hazard.label || hazard.type,
          hazardType:          hazard.type ?? "generic",
          zoneName,
          resolved:            false,
        },
      },
    });
  }

  static async _postSafeCard(actorName, zoneName, hazardLabel, reason = "avoided") {
    const body = `
  <div style="padding:8px 12px;">
    <div style="color:${LC.textBright};font-size:0.85em;margin-bottom:4px;">
      <strong>${actorName}</strong> · <em>${zoneName}</em>
    </div>
    <div style="color:${LC.green ?? "#00cc66"};font-size:0.82em;">
      ✅ ${hazardLabel} — ${reason}
    </div>
  </div>`;

    const content = lcarsChatCard({
      title: `HAZARDOUS TERRAIN`,
      accent: LC.primary,
      body,
      legacy: () => `
<div style="background:${LC.bg};border:2px solid ${LC.primary};border-radius:8px;
  font-family:${LC.font};overflow:hidden;max-width:300px;">
  <div style="background:${LC.primary};padding:5px 12px;">
    <span style="color:#000;font-weight:700;font-size:0.65em;letter-spacing:2px;">HAZARDOUS TERRAIN</span>
  </div>${body}
</div>`,
    });
    await ChatMessage.create({
      content,
      speaker: { alias: "Zone Hazard" },
      flags: { [MODULE]: { type: "hazardSafe" } },
    });
  }

  static async _postDamageCard(actorName, zoneName, hazardLabel, damage, damageType, extra = "") {
    const body = `
  <div style="padding:8px 12px;">
    <div style="color:${LC.textBright};font-size:0.85em;margin-bottom:4px;">
      <strong>${actorName}</strong> · <em>${zoneName}</em>
    </div>
    <div style="color:${LC.yellow};font-size:0.85em;margin-bottom:3px;">⚠ ${hazardLabel}</div>
    <div style="color:${LC.red};font-size:0.82em;">
      🔥 Damage: <strong>${damage} ${damageType}</strong> applied
    </div>
    ${extra ? `<div style="color:${LC.secondary};font-size:0.78em;margin-top:2px;">${extra}</div>` : ""}
  </div>`;

    const content = lcarsChatCard({
      title: `HAZARDOUS TERRAIN`,
      accent: LC.red,
      body,
      legacy: () => `
<div style="background:${LC.bg};border:2px solid ${LC.red};border-radius:8px;
  font-family:${LC.font};overflow:hidden;max-width:300px;">
  <div style="background:${LC.red};padding:5px 12px;">
    <span style="color:#fff;font-weight:700;font-size:0.65em;letter-spacing:2px;">HAZARDOUS TERRAIN</span>
  </div>${body}
</div>`,
    });
    await ChatMessage.create({
      content,
      speaker: { alias: "Zone Hazard" },
      flags: { [MODULE]: { type: "hazardDamage" } },
    });
  }

  static async _postLingeringCard(actorName, zoneName, hazardLabel, damage, damageType) {
    const body = `
  <div style="padding:8px 12px;">
    <div style="color:${LC.textBright};font-size:0.85em;margin-bottom:4px;">
      <strong>${actorName}</strong> · <em>${zoneName}</em>
    </div>
    <div style="color:${LC.yellow};font-size:0.85em;margin-bottom:3px;">⚠ ${hazardLabel}</div>
    <div style="color:${LC.red};font-size:0.82em;">
      🔥 Damage: <strong>${damage} ${damageType}</strong> applied
    </div>
  </div>`;

    const content = lcarsChatCard({
      title: `♻ LINGERING HAZARD`,
      accent: "#ff8800",
      body,
      legacy: () => `
<div style="background:${LC.bg};border:2px solid #ff8800;border-radius:8px;
  font-family:${LC.font};overflow:hidden;max-width:300px;">
  <div style="background:#ff8800;padding:5px 12px;">
    <span style="color:#000;font-weight:700;font-size:0.65em;letter-spacing:2px;">♻ LINGERING HAZARD</span>
  </div>${body}
</div>`,
    });
    await ChatMessage.create({
      content,
      speaker: { alias: "Zone Hazard" },
      flags: { [MODULE]: { type: "hazardLingering" } },
    });
  }

  /** Posted when a token enters a zone with an already-established lingering hazard. */
  static async _postLingeringWarningCard(actorName, zoneName, hazard) {
    const damage     = hazard.establishedDamage ?? "?";
    const damageType = hazard.establishedDamageType ?? "";
    const body = `
  <div style="padding:8px 12px;">
    <div style="color:${LC.textBright};font-size:0.85em;margin-bottom:4px;">
      <strong>${actorName}</strong> entered <em>${zoneName}</em>
    </div>
    <div style="color:${LC.yellow};font-size:0.85em;margin-bottom:3px;">⚠ ${hazard.label || hazard.type}</div>
    <div style="color:${LC.secondary};font-size:0.78em;">
      Takes <strong>${damage} ${damageType}</strong> at the start of each round in this zone.
    </div>
  </div>`;

    const content = lcarsChatCard({
      title: `♻ LINGERING HAZARD — ZONE ENTERED`,
      accent: "#ff8800",
      body,
      legacy: () => `
<div style="background:${LC.bg};border:2px solid #ff8800;border-radius:8px;
  font-family:${LC.font};overflow:hidden;max-width:300px;">
  <div style="background:#ff8800;padding:5px 12px;">
    <span style="color:#000;font-weight:700;font-size:0.65em;letter-spacing:2px;">♻ LINGERING HAZARD — ZONE ENTERED</span>
  </div>${body}
</div>`,
    });
    await ChatMessage.create({
      content,
      speaker: { alias: "Zone Hazard" },
      flags: { [MODULE]: { type: "hazardLingeringWarning" } },
    });
  }

  /** Posted when a lingering hazard is first established (Threat spent). */
  static async _postLingeringEstablishedCard(zoneName, hazard, damage, damageType, threatCost) {
    const body = `
  <div style="padding:8px 12px;">
    <div style="color:${LC.textBright};font-size:0.85em;margin-bottom:4px;">
      <em>${zoneName}</em>
    </div>
    <div style="color:${LC.yellow};font-size:0.85em;margin-bottom:3px;">⚠ ${hazard.label || hazard.type}</div>
    <div style="color:${LC.red};font-size:0.82em;margin-bottom:2px;">
      🔥 <strong>${damage} ${damageType}</strong> per round to all tokens in zone
    </div>
    <div style="color:${LC.secondary};font-size:0.78em;">
      ${threatCost > 0 ? `${threatCost} Threat spent to establish.` : "Established (no Threat cost)."}
      Damage applies at the start of each combat round.
    </div>
  </div>`;

    const content = lcarsChatCard({
      title: `♻ LINGERING HAZARD — ESTABLISHED`,
      accent: "#ff8800",
      body,
      legacy: () => `
<div style="background:${LC.bg};border:2px solid #ff8800;border-radius:8px;
  font-family:${LC.font};overflow:hidden;max-width:300px;">
  <div style="background:#ff8800;padding:5px 12px;">
    <span style="color:#000;font-weight:700;font-size:0.65em;letter-spacing:2px;">♻ LINGERING HAZARD — ESTABLISHED</span>
  </div>${body}
</div>`,
    });
    await ChatMessage.create({
      content,
      speaker: { alias: "Zone Hazard" },
      flags: { [MODULE]: { type: "hazardLingeringEstablished" } },
    });
  }

  // ── Avoidance card button wiring (registered as renderChatMessageHTML hook) ──

  /**
   * Wire Avoided / Take Damage buttons on hazardAvoidance chat cards.
   * Called from main.js renderChatMessageHTML hook.
   */
  static wireAvoidanceCard(message, html) {
    const flags = message.flags?.[MODULE];
    if (flags?.type !== "hazardAvoidance") return;
    if (!game.user.isGM) return;

    const root = html?.element ?? html;
    const btnContainer = root?.querySelector?.(".sta2e-avoidance-buttons");
    if (!btnContainer) return;

    if (flags.resolved) {
      const isAvoided = flags.resolution === "avoided";
      btnContainer.innerHTML = `
        <div style="padding:4px 0;font-family:${LC.font};font-size:0.75em;font-weight:700;
          color:${isAvoided ? (LC.green ?? "#00cc66") : LC.red};letter-spacing:0.06em;">
          ${isAvoided ? "✅ Task Succeeded — Avoided" : "💥 Task Failed — Damage Applied"}
        </div>`;
      return;
    }

    const avoidedBtn = btnContainer.querySelector(".sta2e-hazard-avoided");
    const damageBtn  = btnContainer.querySelector(".sta2e-hazard-take-damage");

    avoidedBtn?.addEventListener("click", async () => {
      const { tokenId, actorId, hazardLabel, zoneName } = flags;
      const actor     = canvas.tokens?.get(tokenId)?.actor ?? game.actors.get(actorId);
      const actorName = actor?.name ?? "Unknown";
      await ZoneHazard._postSafeCard(actorName, zoneName, hazardLabel, "task succeeded");
      await message.update({
        [`flags.${MODULE}.resolved`]:   true,
        [`flags.${MODULE}.resolution`]: "avoided",
      });
    });

    damageBtn?.addEventListener("click", async () => {
      const { tokenId, actorId, builtDamage, builtDamageType, effects, hazardLabel, hazardType, zoneName } = flags;
      const token     = canvas.tokens?.get(tokenId) ?? null;
      const tokenDoc  = token?.document ?? null;
      const actor     = token?.actor ?? game.actors.get(actorId);
      if (!actor || !tokenDoc) {
        ui.notifications.warn("STA2e Toolkit: Could not find token to apply hazard damage.");
        return;
      }
      const actorName = actor.name;
      await _applyHazardDamage(actor, tokenDoc, token, builtDamage, builtDamageType, effects ?? {});
      await _playHazardAnimation(token, hazardType ?? "generic",
        ZoneHazard._soundKeyFor(hazardType));
      await ZoneHazard._postDamageCard(actorName, zoneName, hazardLabel, builtDamage, builtDamageType);
      await message.update({
        [`flags.${MODULE}.resolved`]:   true,
        [`flags.${MODULE}.resolution`]: "damaged",
      });
    });
  }

  // ── setupHazard — zone monitor entry point for pre-configuring hazards ─────

  /**
   * Opens the hazard builder to (re-)establish a lingering or terrain hazard.
   * Used by the Zone Monitor when the GM wants to set up a hazard manually,
   * or re-configure one whose dialog was previously dismissed.
   * @param {string} zoneId
   * @param {string} hazardId
   * @param {string} hazardLabel
   * @param {object} hazard        zone hazard entry
   * @param {boolean} isShip
   * @param {string} category      "lingering" | "terrain"
   * @returns {object|null}        built result or null if cancelled
   */
  static async setupHazard(zoneIdOrRef, hazardId, hazardLabel, hazard, isShip, category) {
    const ref = typeof zoneIdOrRef === "object" && zoneIdOrRef
      ? zoneIdOrRef
      : { kind: "zone", zoneId: zoneIdOrRef, hazardId };
    const result = await ZoneHazard._showHazardBuilder(hazardLabel, hazard, isShip, category);
    if (!result) return null;

    const { totalThreatCost, waiveThreat } = result;

    // Spend Threat if applicable
    if (!waiveThreat && totalThreatCost > 0) {
      await _setThreat(_getThreat() - totalThreatCost);
    }

    await _storeEstablished(ref, result, waiveThreat ? 0 : totalThreatCost);
    return result;
  }

  // ── Reset hazard — clear established state and refund Threat ───────────────

  static async resetHazard(zoneIdOrRef, hazardId) {
    const ref = typeof zoneIdOrRef === "object" && zoneIdOrRef
      ? zoneIdOrRef
      : { kind: "zone", zoneId: zoneIdOrRef, hazardId };
    const src = resolveHazardSource(ref);
    const hazard = src?.hazard;
    if (!hazard || !hazard.established) return;

    const refund = hazard.establishedThreatCost ?? 0;
    if (refund > 0) {
      await _setThreat(_getThreat() + refund);
    }

    await src.store({ ..._CLEARED_PATCH });

    const label = hazard.label || hazard.type;
    ui.notifications.info(`STA2e Toolkit: Reset "${label}"${refund > 0 ? ` — refunded ${refund} Threat` : ""}`);
    game.sta2eToolkit?.zoneMonitor?._debouncedRefresh();
  }

  // ── resolveHazard — movement-log entry point (lingering only) ──────────────

  /**
   * A token entered a hazard. Immediate hazards are GM-triggered and terrain
   * hazards ride the movement card, so only lingering ones post here — as a
   * GM-only HAZARD ENTRY card, never a builder on the mover's client.
   */
  static async resolveHazard(tokenDoc, zone, hazard) {
    if ((hazard.category ?? "lingering") !== "lingering") return;
    const src = resolveHazardSource(hazardRef(zone, hazard));
    await ZoneHazard.postHazardEntryCard(tokenDoc, [{
      ref:        hazardRef(zone, hazard),
      label:      hazard.label || hazard.type,
      category:   "lingering",
      sourceName: hazard.sourceName ?? src?.name ?? zone?.name ?? "(unnamed)",
    }], { reason: "entry" });
  }

  // ── HAZARD ENTRY card — GM-only, one per move ──────────────────────────────

  /**
   * One card for every hazard a move ran into, whispered only to the active GM
   * (assistant GMs are treated as players). Posted from whichever client made
   * the move; the rows are resolved from the active GM's client.
   * @param {TokenDocument} tokenDoc
   * @param {{ref, label, category, sourceName}[]} entries
   * @param {{reason?: "entry"|"threat"}} [opts]
   */
  static async postHazardEntryCard(tokenDoc, entries, { reason = "entry" } = {}) {
    if (!tokenDoc || !entries?.length) return;
    const actor     = tokenDoc.actor ?? canvas.tokens?.get(tokenDoc.id)?.actor ?? null;
    const tokenName = tokenDoc.name ?? actor?.name ?? "Unknown";
    const catLabel  = { terrain: "Hazardous Terrain", lingering: "Lingering", immediate: "Immediate" };

    const rows = entries.map((e, i) => `
  <div class="sta2e-hz-row" data-row="${i}" style="padding:6px 12px;border-bottom:1px solid ${LC.borderDim};">
    <div style="color:${LC.yellow};font-size:0.82em;font-weight:700;">⚠ ${e.label}</div>
    <div style="color:${LC.textDim};font-size:0.68em;letter-spacing:0.06em;margin-bottom:4px;">
      ${e.sourceName} · ${catLabel[e.category] ?? e.category}
    </div>
    <div class="sta2e-hz-actions" style="display:flex;flex-direction:column;gap:3px;"></div>
  </div>`).join("");

    const body = `
  <div style="padding:8px 12px;border-bottom:1px solid ${LC.borderDim};">
    <div style="color:${LC.textBright};font-size:0.9em;font-weight:700;">${tokenName}</div>
    <div style="color:${LC.secondary};font-size:0.72em;margin-top:2px;">
      ${reason === "threat"
        ? "Crossed using Threat — the hazard triggers."
        : "Entered a hazardous area."}
    </div>
  </div>${rows}
  <div style="background:${LC.panel};padding:4px 12px;">
    <span style="color:${LC.textDim};font-size:0.5em;letter-spacing:2px;">GM ONLY</span>
  </div>`;

    const content = lcarsChatCard({
      title: "HAZARD ENTRY",
      accent: LC.yellow,
      body,
      legacy: () => `
<div style="background:${LC.bg};border:2px solid ${LC.yellow};border-radius:8px;
  font-family:${LC.font};overflow:hidden;max-width:320px;">
  <div style="background:${LC.yellow};padding:5px 12px;">
    <span style="color:#000;font-weight:700;font-size:0.65em;letter-spacing:2px;">HAZARD ENTRY</span>
  </div>${body}
</div>`,
    });

    await ChatMessage.create({
      content,
      speaker: { alias: "Zone Hazard" },
      whisper: activeGmWhisperIds(),
      flags: {
        [MODULE]: {
          type:    "hazardEntry",
          reason,
          tokenId: tokenDoc.id,
          actorId: actor?.id ?? null,
          rows:    entries.map(e => ({
            ref: e.ref, label: e.label, category: e.category, sourceName: e.sourceName, status: null,
          })),
        },
      },
    });
  }

  /** Wire the per-row buttons on a HAZARD ENTRY card (renderChatMessageHTML). */
  static wireHazardEntryCard(message, html) {
    const flags = message.flags?.[MODULE];
    if (flags?.type !== "hazardEntry") return;
    const root = html?.element ?? html;
    const rows = flags.rows ?? [];

    const btn = (cls, label, color) => `
      <button type="button" class="${cls}"
        style="width:100%;padding:3px 8px;font-family:${LC.font};font-size:0.7em;font-weight:700;
          letter-spacing:0.06em;text-transform:uppercase;background:${LC.panel};
          border:1px solid ${color};border-radius:3px;color:${color};cursor:pointer;">${label}</button>`;
    const status = (text, color) => `
      <div style="font-family:${LC.font};font-size:0.72em;font-weight:700;letter-spacing:0.06em;color:${color};">${text}</div>`;

    rows.forEach((row, i) => {
      const actions = root?.querySelector?.(`.sta2e-hz-row[data-row="${i}"] .sta2e-hz-actions`);
      if (!actions) return;

      if (row.status) {
        const done = {
          applied:     ["⚡ Resolved", LC.yellow],
          established: ["♻ Established — damage each round", "#ff8800"],
          ignored:     ["✕ Ignored", LC.textDim],
        }[row.status] ?? [row.status, LC.textDim];
        actions.innerHTML = status(...done);
        return;
      }
      if (!isActiveGM()) {
        actions.innerHTML = status("Awaiting the active GM", LC.textDim);
        return;
      }

      const live = resolveHazardSource(row.ref)?.hazard;
      actions.innerHTML = [
        btn("sta2e-hz-build", "⚡ Build & Apply", LC.primary),
        live?.established ? btn("sta2e-hz-established", "♻ Apply Established", LC.secondary) : "",
        btn("sta2e-hz-ignore", "✕ Ignore", LC.borderDim),
      ].join("");

      actions.querySelector(".sta2e-hz-build")
        ?.addEventListener("click", () => ZoneHazard._resolveEntryRow(message, i, false));
      actions.querySelector(".sta2e-hz-established")
        ?.addEventListener("click", () => ZoneHazard._resolveEntryRow(message, i, true));
      actions.querySelector(".sta2e-hz-ignore")
        ?.addEventListener("click", () => ZoneHazard._markEntryRow(message, i, "ignored"));
    });
  }

  static async _markEntryRow(message, index, statusValue) {
    const rows = foundry.utils.deepClone(message.flags?.[MODULE]?.rows ?? []);
    if (!rows[index]) return;
    rows[index].status = statusValue;
    await message.update({ [`flags.${MODULE}.rows`]: rows });
  }

  /**
   * Resolve one HAZARD ENTRY row on the active GM's client.
   *
   * Threat: a hazardous-terrain crossing already *added* the Threat that pays
   * for the hazard ("that Threat is spent immediately"), so terrain rows never
   * draw on the pool again. Lingering and immediate hazards are the GM's own
   * spend, drawn unless waived as established.
   */
  static async _resolveEntryRow(message, index, useEstablished) {
    const flags = message.flags?.[MODULE] ?? {};
    const row   = flags.rows?.[index];
    if (!row || row.status) return;

    const src = resolveHazardSource(row.ref);
    if (!src) {
      ui.notifications.warn("STA2e Toolkit: That hazard no longer exists.");
      return;
    }

    const token    = canvas.tokens?.get(flags.tokenId) ?? null;
    const tokenDoc = token?.document ?? null;
    const actor    = token?.actor ?? game.actors?.get(flags.actorId) ?? null;
    if (!actor) {
      ui.notifications.warn("STA2e Toolkit: Could not find the token that entered the hazard.");
      return;
    }
    const isShip    = actor.system?.systems !== undefined;
    const hazard    = src.hazard;
    const category  = row.category ?? hazard.category ?? "lingering";
    const label     = hazard.label || hazard.type || row.label;
    const actorName = tokenDoc?.name ?? actor.name;

    const result = useEstablished
      ? _resultFromEstablished(hazard, isShip)
      : await ZoneHazard._showHazardBuilder(label, hazard, isShip, category);
    if (!result) return;

    const drawsPool = category !== "terrain";
    const spent     = drawsPool && !result.waiveThreat ? (result.totalThreatCost ?? 0) : 0;
    if (spent > 0) await _setThreat(_getThreat() - spent);
    if (!useEstablished) await _storeEstablished(row.ref, result, spent);

    if (category === "lingering") {
      if (useEstablished) {
        await ZoneHazard._postLingeringWarningCard(actorName, src.name, hazard);
      } else {
        await ZoneHazard._postLingeringEstablishedCard(src.name, hazard, result.damage, result.damageType, spent);
      }
      await ZoneHazard._markEntryRow(message, index, "established");
      return;
    }

    if (result.mode === "trait") {
      await ZoneHazard._postTraitHazardCard(actorName, src.name, label, result);
      await _applyHazardTrait(actor, result, label, src.name, category === "terrain" ? 0 : spent);
    } else {
      await ZoneHazard._postAvoidanceCard(actorName, src.name, hazard, result, flags.tokenId, actor.id);
    }
    await ZoneHazard._markEntryRow(message, index, "applied");
  }

  /** Table-visible note that a hazard imposed a trait rather than damage. */
  static async _postTraitHazardCard(actorName, sourceName, hazardLabel, result) {
    const body = `
  <div style="padding:8px 12px;">
    <div style="color:${LC.textBright};font-size:0.85em;margin-bottom:4px;">
      <strong>${actorName}</strong> · <em>${sourceName}</em>
    </div>
    <div style="color:${LC.yellow};font-size:0.85em;margin-bottom:3px;">⚠ ${hazardLabel}</div>
    <div style="color:${LC.secondary};font-size:0.82em;">
      Trait imposed: <strong>${result.traitName}</strong>
      ${result.traitScope === "scene" ? " (on the scene)" : ""}
    </div>
  </div>`;
    await ChatMessage.create({
      content: lcarsChatCard({
        title: "HAZARD — TRAIT IMPOSED",
        accent: LC.yellow,
        body,
        legacy: () => `
<div style="background:${LC.bg};border:2px solid ${LC.yellow};border-radius:8px;
  font-family:${LC.font};overflow:hidden;max-width:300px;">
  <div style="background:${LC.yellow};padding:5px 12px;">
    <span style="color:#000;font-weight:700;font-size:0.65em;letter-spacing:2px;">HAZARD — TRAIT IMPOSED</span>
  </div>${body}
</div>`,
      }),
      speaker: { alias: "Zone Hazard" },
      flags: { [MODULE]: { type: "hazardTrait" } },
    });
  }


  /**
   * Wires the interactive buttons on a combined zone movement + terrain hazard chat card.
   * Called from the renderChatMessageHTML hook in main.js.
   * Handles cards with flags.type === "zoneMovementTerrain".
   */
  static wireTerrainCard(message, html) {
    const flags = message.flags?.[MODULE];
    if (flags?.type !== "zoneMovementTerrain") return;

    const costRow = html.querySelector?.(".sta2e-zone-cost-row");
    if (!costRow) return;

    // Already resolved — replace buttons with summary
    if (flags.resolved) {
      const res = flags.resolution ?? "skipped";
      let label, color;
      if (res === "spent-safe") {
        const d = flags.paymentDetails ?? {};
        label = d.momentumSpent !== undefined
          ? `✅ Paid: ${d.momentumSpent} Momentum / +${d.threatAdded ?? 0} Threat — Crossed safely`
          : `✅ ${flags.cost} Threat spent — Crossed safely`;
        color = "#00cc66";
      } else if (res === "spent-hazard") {
        const d = flags.paymentDetails ?? {};
        label = d.momentumSpent !== undefined
          ? `⚡ Paid: ${d.momentumSpent} Momentum / +${d.threatAdded} Threat — Hazard triggered`
          : `⚡ ${flags.cost} Threat spent — Hazard triggered`;
        color = LC.yellow;
      } else {
        label = "⭐ Skipped (GM Override)";
        color = LC.textDim;
      }
      costRow.innerHTML = `
        <div style="padding:6px 12px;font-family:${LC.font};font-size:0.75em;
          font-weight:700;letter-spacing:0.06em;color:${color};">${label}</div>`;
      return;
    }

    if (!game.user.isGM) {
      costRow.querySelectorAll("button").forEach(b => b.disabled = true);
      return;
    }

    // ── Spend button — Momentum/Threat via PaymentPrompt; NPC always Threat ──
    costRow.querySelector(".sta2e-spend-movement-cost")?.addEventListener("click", async () => {
      const cost     = flags.cost;
      const isNpc    = flags.isNpc;
      const payloads = flags.terrainPayloads ?? [];

      let payment;        // { momentumSpent, threatAdded } or null
      let threatUsed;     // true if any Threat spent

      if (isNpc) {
        await _setThreat(_getThreat() - cost);
        payment   = { momentumSpent: 0, threatAdded: cost };
        threatUsed = true;
      } else {
        payment = await PaymentPrompt.promptCost(cost);
        if (!payment) return;
        await _setMomentum(_getMomentum() - payment.momentumSpent);
        await _setThreat(_getThreat() + payment.threatAdded);
        threatUsed = payment.threatAdded > 0;
      }

      if (!threatUsed) {
        // Pure Momentum — safe crossing, no hazard
        await message.update({
          [`flags.${MODULE}.resolved`]:        true,
          [`flags.${MODULE}.resolution`]:      "spent-safe",
          [`flags.${MODULE}.paymentDetails`]:  payment,
        });
        return;
      }

      // Threat was used — every terrain hazard crossed triggers. Resolution
      // moves to a GM-only HAZARD ENTRY card rather than opening builders here.
      await message.update({
        [`flags.${MODULE}.resolved`]:        true,
        [`flags.${MODULE}.resolution`]:      "spent-hazard",
        [`flags.${MODULE}.paymentDetails`]:  payment,
      });

      const tokenDoc = canvas.tokens?.get(flags.tokenId)?.document
        ?? canvas.scene?.tokens?.get?.(flags.tokenId) ?? null;
      const entries = payloads.map(p => {
        const ref = _refFromPayload(p);
        return {
          ref,
          label:      p.hazardLabel,
          category:   "terrain",
          sourceName: p.sourceName ?? resolveHazardSource(ref)?.name ?? "(unnamed)",
        };
      });
      await ZoneHazard.postHazardEntryCard(tokenDoc, entries, { reason: "threat" });
    });

    // ── Skip button ─────────────────────────────────────────────────────────
    costRow.querySelector(".sta2e-skip-movement-cost")?.addEventListener("click", async () => {
      await message.update({
        [`flags.${MODULE}.resolved`]:   true,
        [`flags.${MODULE}.resolution`]: "skipped",
      });
    });
  }

  // ── Immediate resolution (GM right-click zone triggered) ──────────────────

  /**
   * Entry point for GM-initiated immediate hazard attacks from zone right-click.
   * Uses targeted tokens; falls back to all tokens in the zone.
   */
  static async resolveImmediate(zone, hazard) {
    if (!game.user.isGM) return;

    const ref      = hazardRef(zone, hazard);
    const src      = resolveHazardSource(ref);
    const zoneName = src?.name ?? zone?.name ?? "(unnamed)";

    // Determine ship/ground context from whatever tokens are available.
    // Prefer targeted tokens, then tokens in the zone, then default to ground.
    const targets       = [...(game.user.targets ?? [])];
    const tokensInZone  = (canvas.tokens?.placeables ?? []).filter(t => src?.containsToken(t.document));
    const contextToken  = targets[0] ?? tokensInZone[0] ?? null;
    const contextActor  = contextToken?.actor ?? contextToken?.document?.actor ?? null;
    const isShip        = contextActor?.system?.systems !== undefined;

    // Open builder first — always, regardless of whether tokens are targeted yet.
    const builtResult = await ZoneHazard._showHazardBuilder(
      hazard.label || hazard.type, hazard, isShip, "immediate"
    );
    if (!builtResult) return;

    const { totalThreatCost, waiveThreat } = builtResult;

    // Deduct Threat
    if (!waiveThreat && totalThreatCost > 0) {
      await _setThreat(_getThreat() - totalThreatCost);
    }

    // Store established state
    if (!hazard.established || !waiveThreat) {
      await _storeEstablished(ref, builtResult, waiveThreat ? 0 : totalThreatCost);
    }

    const hazardLabel = hazard.label || hazard.type;

    // A trait on the scene is imposed once, whoever is targeted.
    if (builtResult.mode === "trait" && builtResult.traitScope === "scene") {
      await ZoneHazard._postTraitHazardCard(zoneName, zoneName, hazardLabel, builtResult);
      await _applyHazardTrait(null, builtResult, hazardLabel, zoneName, waiveThreat ? 0 : totalThreatCost);
      return;
    }

    // Collect affected tokens: targeted first, else all in zone
    let affectedTokenDocs;
    if (targets.length > 0) {
      affectedTokenDocs = targets.map(t => t.document);
    } else {
      affectedTokenDocs = tokensInZone.map(t => t.document);
    }

    if (affectedTokenDocs.length === 0) {
      ui.notifications.info(
        `STA2e Toolkit: Hazard "${hazard.label || hazard.type}" built — target tokens and re-apply to post avoidance cards.`
      );
      return;
    }

    // Post avoidance challenge card for each affected token
    for (const tokenDoc of affectedTokenDocs) {
      const actor = tokenDoc.actor ?? canvas.tokens?.get(tokenDoc.id)?.actor;
      if (!actor) continue;
      const actorName = tokenDoc.name ?? actor.name;
      if (builtResult.mode === "trait") {
        await ZoneHazard._postTraitHazardCard(actorName, zoneName, hazardLabel, builtResult);
        await _applyHazardTrait(actor, builtResult, hazardLabel, zoneName, 0);
        continue;
      }
      await ZoneHazard._postAvoidanceCard(
        actorName, zoneName, hazard, builtResult, tokenDoc.id, actor.id
      );
    }
  }

  // ── Round-start auto-apply for established lingering hazards ──────────────

  /**
   * Called by the updateCombat hook when the round advances.
   * Applies all established lingering hazards to tokens in their zones.
   */
  static async applyLingeringForRound() {
    // Exactly one client applies round damage — the active GM, never an
    // assistant GM as well (which would double every tick).
    if (!isActiveGM()) return;
    const scene = canvas?.scene;
    if (!scene) return;

    // Zones and Region hazards alike: { name, established[], contains(token) }
    const sources = [];
    for (const zone of getSceneZones(scene)) {
      const established = (zone.hazards ?? []).filter(h => h.category === "lingering" && h.established);
      if (!established.length) continue;
      sources.push({
        name: zone.name || "(unnamed)",
        established,
        contains: t => {
          const cx = t.center?.x ?? (t.x + (t.w ?? 0) / 2);
          const cy = t.center?.y ?? (t.y + (t.h ?? 0) / 2);
          return pointInPolygon(cx, cy, zone.vertices);
        },
      });
    }
    for (const f of getRegionFeatures(scene, "hazard")) {
      const hz = regionHazardView(f);
      if (hz.category !== "lingering" || !hz.established) continue;
      sources.push({
        name: hz.sourceName,
        established: [hz],
        contains: t => regionContainsToken(f.region, t.document),
      });
    }
    if (sources.length === 0) return;

    for (const source of sources) {
      const established = source.established;
      const tokensInZone = (canvas.tokens?.placeables ?? []).filter(source.contains);

      for (const token of tokensInZone) {
        const tokenDoc  = token.document;
        const actor     = token.actor;
        if (!actor) continue;
        const actorName = tokenDoc.name ?? actor.name;
        const zoneName  = source.name;
        const isShip    = actor.system?.systems !== undefined;

        for (const hazard of established) {
          const damage     = hazard.establishedDamage ?? 0;
          const damageType = hazard.establishedDamageType ?? (isShip ? "shields" : "stress");
          const effects    = hazard.establishedEffects ?? {};
          if (damage <= 0) continue;
          await _applyHazardDamage(actor, tokenDoc, token, damage, damageType, effects);
          await _playHazardAnimation(token, hazard.type ?? "generic",
            ZoneHazard._soundKeyFor(hazard.type));
          await ZoneHazard._postLingeringCard(actorName, zoneName,
            hazard.label || hazard.type, damage, damageType);
        }
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  static _isNpc(actor) {
    if (actor.system?.systems !== undefined) {
      const owners = Object.entries(actor.ownership ?? {}).filter(
        ([uid, lvl]) => uid !== "default" && lvl >= 3
      );
      const hasPlayerOwner = owners.some(([uid]) => {
        const user = game.users.get(uid);
        return user && !user.isGM;
      });
      return !hasPlayerOwner;
    }
    return actor.type === "npc" || actor.type === "character"
      ? (actor.hasPlayerOwner === false)
      : false;
  }

  static _soundKeyFor(hazardType) {
    const map = {
      "radiation":      "sndHazardRadiation",
      "plasma-storm":   "sndHazardPlasmaStorm",
      "asteroid-field": "sndHazardAsteroid",
      "fire":           "sndHazardFire",
      "nebula-gas":     "sndHazardNebula",
      "falling-rocks":  "sndHazardFallingRocks",
      "cave-in":        "sndHazardCaveIn",
      "toxic-gas":      "sndHazardToxicGas",
      "electrical":     "sndHazardElectrical",
      "extreme-temp":   "sndHazardExtremeTemp",
      "minefield":      "sndHazardMinefield",
      "generic":        "sndHazardGeneric",
    };
    return map[hazardType] ?? null;
  }
}
