/** Shared hazard visual settings, independent of Foundry and the renderer. */
export const HAZARD_VFX_TYPES = Object.freeze({
  fire: '#ff7026', electrical: '#67bcff', radiation: '#6aef83', 'toxic-gas': '#a1bd45',
  'plasma-storm': '#ed7951', 'asteroid-field': '#a59a8c', 'nebula-gas': '#a27be8', 'falling-rocks': '#a79075',
});
export const HAZARD_VFX_SUPPORTED = 'Fire, electrical discharge, radiation, toxic gas, plasma storms, asteroid fields, nebula gas, and falling rocks/debris';
export const HAZARD_VFX_MODES = Object.freeze({
  trigger: 'On trigger only', gm: 'Area + trigger — active GM only',
  all: 'Area + trigger — everyone', off: 'Disabled',
});
export function normalizeHazardVfx(raw = {}, type = 'fire') {
  const intensity = Number(raw.intensity ?? 1);
  return {
    mode: Object.hasOwn(HAZARD_VFX_MODES, raw.mode) ? raw.mode : 'trigger',
    intensity: Number.isFinite(intensity) ? Math.min(2, Math.max(.25, intensity)) : 1,
    color: /^#[0-9a-f]{6}$/i.test(raw.color ?? '') ? raw.color : HAZARD_VFX_TYPES[type] ?? '#ff7026',
    sound: raw.sound !== false,
  };
}
export function hazardVfxFields(raw, type, prefix = 'hvfx') {
  const c = normalizeHazardVfx(raw, type);
  return `<fieldset><legend>Hazard effects</legend>
    <p class="notes">${HAZARD_VFX_SUPPORTED}. Area effects follow the zone or Region boundary.</p>
    <div class="form-group"><label>Visibility</label><select name="${prefix}-mode">${Object.entries(HAZARD_VFX_MODES)
      .map(([key, label]) => `<option value="${key}" ${c.mode === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
    <div class="form-group"><label>Intensity</label><input name="${prefix}-intensity" type="number" min="0.25" max="2" step="0.25" value="${c.intensity}"></div>
    <div class="form-group"><label>Color</label><input name="${prefix}-color" type="color" value="${c.color}"></div>
    <div class="form-group"><label>Trigger sound</label><input name="${prefix}-sound" type="checkbox" ${c.sound ? 'checked' : ''}></div>
    <p class="notes">Uses the hazard sound configured in module settings. GM-only effects and sounds stay private.</p>
    <button type="button" data-hazard-vfx-preview="${prefix}">Preview on selected token</button>
  </fieldset>`;
}

export function wireHazardVfxPreview(root, getType) {
  root?.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-hazard-vfx-preview]');
    if (!button) return;
    event.preventDefault();
    const type = getType(button);
    const config = readHazardVfxFields(root, type, button.dataset.hazardVfxPreview);
    const { previewHazardVfx } = await import('./hazard-vfx.js');
    previewHazardVfx(type, config);
  });
}
export function readHazardVfxFields(root, type, prefix = 'hvfx') {
  const field = key => root?.querySelector?.(`[name="${prefix}-${key}"]`);
  return normalizeHazardVfx({ mode: field('mode')?.value, intensity: field('intensity')?.value,
    color: field('color')?.value, sound: field('sound')?.checked }, type);
}
