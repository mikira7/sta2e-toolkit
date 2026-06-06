/**
 * sta2e-toolkit | shield-impact-vfx.js
 * Localized JB2A shield impact flashes for starship weapon hits.
 */

const MODULE = "sta2e-toolkit";
const SHIELD_IMPACT_EFFECT = "jb2a.impact.004.blue";
const HULL_IMPACT_EFFECT = "jb2a.explosion_side.01.orange.2";

const PRESET_FACTORS = Object.freeze({
  subtle: 0.72,
  cinematic: 1,
  intense: 1.24,
});

function _number(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function _clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function _settingEnabled() {
  try { return game.settings.get(MODULE, "shieldImpactFX") !== false; }
  catch { return true; }
}

function _presetFactor() {
  try { return PRESET_FACTORS[game.settings.get(MODULE, "shieldImpactPreset")] ?? PRESET_FACTORS.cinematic; }
  catch { return PRESET_FACTORS.cinematic; }
}

function _tokenDimensions(token) {
  const doc = token?.document ?? token;
  const gridSize = canvas?.grid?.size ?? canvas?.scene?.grid?.size ?? 100;
  return {
    width: token?.w ?? ((doc?.width ?? 1) * gridSize),
    height: token?.h ?? ((doc?.height ?? 1) * gridSize),
  };
}

function _shieldImpactScale(targetToken, options = {}) {
  const damage = Math.max(0, _number(options.finalDamage, 0));
  const maxShields = Math.max(1, _number(options.maxShields, 8));
  const damageFactor = _clamp(damage / maxShields, 0.12, 1.15);
  const preset = _presetFactor();
  const { width, height } = _tokenDimensions(targetToken);
  const tokenLimit = Math.max(1, Math.min(width, height));
  const tokenFactor = _clamp(tokenLimit / 240, 0.55, 1.45);
  const base = 0.26 + damageFactor * 0.24;
  return _clamp(base * preset * tokenFactor * (options.shieldBroke ? 1.18 : 1), 0.18, 0.78);
}

function _impactLocation(targetToken, impactPoint) {
  if (impactPoint?.x != null && impactPoint?.y != null) return impactPoint;
  if (targetToken?.center) return { x: targetToken.center.x, y: targetToken.center.y };
  return targetToken;
}

export function scheduleShieldImpactVFX(sourceToken, targetToken, impactPoint, options = {}) {
  const delayMs = Math.max(0, Math.round(_number(options.delayMs, 0)));
  if (delayMs <= 0) {
    playShieldImpactVFX(sourceToken, targetToken, impactPoint, options);
    return;
  }
  window.setTimeout(() => playShieldImpactVFX(sourceToken, targetToken, impactPoint, options), delayMs);
}

export function scheduleHullImpactVFX(targetToken, impactPoint, options = {}) {
  const delayMs = Math.max(0, Math.round(_number(options.delayMs, 0)));
  if (delayMs <= 0) {
    playHullImpactVFX(targetToken, impactPoint, options);
    return;
  }
  window.setTimeout(() => playHullImpactVFX(targetToken, impactPoint, options), delayMs);
}

export async function playShieldImpactVFX(_sourceToken, targetToken, impactPoint, options = {}) {
  if (!_settingEnabled()) return;
  if (!targetToken || !(options.preShields > 0)) return;
  if (!globalThis.Sequence) return;

  try {
    const location = _impactLocation(targetToken, impactPoint);
    const scale = _shieldImpactScale(targetToken, options);
    const s = new Sequence();
    s.effect()
      .file(SHIELD_IMPACT_EFFECT)
      .atLocation(location)
      .scale(scale)
      .fadeIn(60)
      .fadeOut(options.shieldBroke ? 520 : 360);

    if (options.shieldBroke) {
      s.wait(90)
        .effect()
        .file(SHIELD_IMPACT_EFFECT)
        .atLocation(location)
        .scale(Math.min(0.9, scale * 1.22))
        .opacity(0.72)
        .fadeIn(40)
        .fadeOut(620);
    }

    await s.play();
  } catch (err) {
    console.warn("STA2e Toolkit | Shield impact JB2A effect failed:", err);
  }
}

export async function playHullImpactVFX(targetToken, impactPoint, options = {}) {
  if (!targetToken || !options.shieldsDown) return;
  if (!globalThis.Sequence) return;

  try {
    const location = _impactLocation(targetToken, impactPoint);
    const scale = _clamp(_shieldImpactScale(targetToken, {
      ...options,
      preShields: 1,
      maxShields: options.maxShields ?? 8,
    }) * 1.35, 0.35, 1.05);
    const s = new Sequence();
    s.effect()
      .file(HULL_IMPACT_EFFECT)
      .atLocation(location)
      .scale(scale)
      .fadeIn(40)
      .fadeOut(560);
    await s.play();
  } catch (err) {
    console.warn("STA2e Toolkit | Hull impact JB2A effect failed:", err);
  }
}
