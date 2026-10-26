/**
 * sta2e-toolkit | light-toggle-sound.js
 *
 * A sound an Ambient Light plays when it is turned on or off — by a Door &
 * Light Control behavior (so a sequence clicks on light by light) or by the GM
 * toggling it from the Lighting layer. Set on the light's own config sheet,
 * Basic tab, in four flags on their native form paths, so the sheet's ordinary
 * submit saves them (the region-pad-config.js trick):
 *
 *   soundOn / soundOff   audio files; blank plays nothing
 *   soundVolume          0–1, default 0.8
 *   soundRadius          distance units; blank or 0 = heard everywhere,
 *                        otherwise positional at the light, blocked by walls
 *
 * No socket and no broadcast: `updateAmbientLight` fires on every client, and
 * each plays the sound for itself — only when it is viewing that scene, so a
 * light on another scene stays silent. Pushing from one client as well would
 * play it twice for everyone.
 */

const MODULE = "sta2e-toolkit";
const FLAGS = { on: "soundOn", off: "soundOff", volume: "soundVolume", radius: "soundRadius" };

function _flag(doc, key) {
  return doc?.getFlag?.(MODULE, FLAGS[key]);
}

/** The stored volume clamped to 0–1; blank (null or "") is 0.8. */
function _volume(doc) {
  const raw = _flag(doc, "volume");
  const v = Number(raw);
  if (raw === null || raw === undefined || raw === "" || !Number.isFinite(v)) return 0.8;
  return Math.min(1, Math.max(0, v));
}

function _onUpdateLight(doc, changes) {
  if (!("hidden" in (changes ?? {}))) return;
  if (!doc.parent?.isView || !canvas?.ready) return;
  const src = changes.hidden ? _flag(doc, "off") : _flag(doc, "on");
  if (!src) return;
  const volume = _volume(doc);
  const radius = Number(_flag(doc, "radius"));
  try {
    if (Number.isFinite(radius) && radius > 0) {
      canvas.sounds.playAtPosition(src, { x: doc.x, y: doc.y, elevation: doc.elevation ?? 0 }, radius, {
        volume, walls: true, easing: true,
      })?.catch?.(err => console.warn("STA2e Toolkit | Light sound failed", src, err));
    } else {
      foundry.audio.AudioHelper.play({ src, volume, loop: false, channel: "environment" }, false);
    }
  } catch (err) {
    console.warn("STA2e Toolkit | Light sound failed", src, err);
  }
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

function _row(label, field, hint) {
  const group = document.createElement("div");
  group.className = "form-group";
  group.innerHTML = `
    <label>${label} <span style="opacity:0.65;">(STA Toolkit)</span></label>
    <div class="form-fields">${field}</div>
    ${hint ? `<p class="hint">${hint}</p>` : ""}`;
  return group;
}

function _injectLightSoundFields(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const path = key => `flags.${MODULE}.${FLAGS[key]}`;
  if (root.querySelector(`[name="${path("on")}"]`)) return;   // idempotency guard
  const doc = app?.document ?? app?.object ?? null;
  const val = key => esc(_flag(doc, key) ?? "");

  const target = root.querySelector('.tab[data-tab="basic"]') ?? root.querySelector("form") ?? root;
  target.append(
    _row("Sound When Turned On",
      `<file-picker name="${path("on")}" type="audio" value="${val("on")}"></file-picker>`,
      "Played whenever this light is turned on — by a Door &amp; Light Control behavior or from the "
        + "Lighting layer. Blank plays nothing."),
    _row("Sound When Turned Off",
      `<file-picker name="${path("off")}" type="audio" value="${val("off")}"></file-picker>`, ""),
    _row("Light Sound Volume",
      `<input type="number" name="${path("volume")}" value="${val("volume")}" min="0" max="1" step="0.05" placeholder="0.8">`,
      "0–1. Blank is 0.8."),
    _row("Sound Heard Within",
      `<input type="number" name="${path("radius")}" value="${val("radius")}" min="0" step="1" placeholder="Everywhere">`,
      "In scene distance units. Blank or 0: everyone viewing the scene hears it. Otherwise it plays "
        + "from the light and only tokens within range hear it, muffled by walls."),
  );
}

export function registerLightToggleSound() {
  Hooks.on("updateAmbientLight", _onUpdateLight);
  Hooks.on("renderAmbientLightConfig", _injectLightSoundFields);
}
