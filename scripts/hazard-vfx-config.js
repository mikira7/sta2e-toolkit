/** Shared hazard visual settings, independent of Foundry and the renderer. */
export const HAZARD_VFX_TYPES = Object.freeze({
  fire: '#ff7026', electrical: '#67bcff', radiation: '#6aef83', 'toxic-gas': '#a1bd45',
  'plasma-storm': '#ed7951', 'asteroid-field': '#a59a8c', 'nebula-gas': '#a27be8', 'falling-rocks': '#a79075',
  'cave-in': '#b59b7b', quicksand: '#c1a46c', 'extreme-temp': '#ff9254', minefield: '#ff7040', generic: '#c985ef',
  'ion-storm': '#79dfc4',
});
export const HAZARD_VFX_SUPPORTED = 'All zone and Region hazard types, including cave-ins, quicksand, extreme heat/cold, mines, and generic hazards';
export const HAZARD_VFX_MODES = Object.freeze({
  trigger: 'On trigger only', gm: 'Area + trigger — active GM only',
  all: 'Area + trigger — everyone', off: 'Disabled',
});
export function normalizeHazardVfx(raw = {}, type = 'fire') {
  const intensity = Number(raw.intensity ?? 1);
  return {
    mode: Object.hasOwn(HAZARD_VFX_MODES, raw.mode) ? raw.mode : 'trigger',
    intensity: Number.isFinite(intensity) ? Math.min(2, Math.max(.25, intensity)) : 1,
    color: /^#[0-9a-f]{6}$/i.test(raw.color ?? '') ? raw.color
      : type === 'extreme-temp' && raw.temperature === 'cold' ? '#80ccff' : HAZARD_VFX_TYPES[type] ?? '#ff7026',
    accentColor: /^#[0-9a-f]{6}$/i.test(raw.accentColor ?? '') ? raw.accentColor : '',
    sound: raw.sound !== false,
    temperature: raw.temperature === 'cold' ? 'cold' : 'heat',
  };
}
export function hazardVfxFields(raw, type, prefix = 'hvfx') {
  const c = normalizeHazardVfx(raw, type);
  const colorControl = (key, label, value) => `<div class="form-group"><label>${label}</label>
    <input name="${prefix}-${key}" type="color" value="${value}" data-hazard-color="${prefix}-${key}" aria-label="${label}">
    <input name="${prefix}-${key}-hex" type="text" value="${value}" pattern="#[0-9a-fA-F]{6}" maxlength="7" data-hazard-hex="${prefix}-${key}" aria-label="${label} hex code" style="width:100px;flex:0 0 100px;"></div>`;
  return `<fieldset data-hazard-colors="${prefix}"><legend>Hazard effects</legend>
    <p class="notes">${HAZARD_VFX_SUPPORTED}. Area effects follow the zone or Region boundary.</p>
    <div class="form-group"><label>Visibility</label><select name="${prefix}-mode">${Object.entries(HAZARD_VFX_MODES)
      .map(([key, label]) => `<option value="${key}" ${c.mode === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
    <div class="form-group"><label>Intensity</label><input name="${prefix}-intensity" type="number" min="0.25" max="2" step="0.25" value="${c.intensity}"></div>
    ${colorControl('color', 'Base color', c.color)}
    <div class="form-group"><label>Custom accent color</label><input name="${prefix}-accent-enabled" type="checkbox" ${c.accentColor ? 'checked' : ''}></div>
    ${colorControl('accent', 'Glow / highlight color', c.accentColor || '#ffffff')}
    <p class="notes">Picking an accent enables it. Uncheck Custom accent color to keep the original highlights.</p>
    <button type="button" data-hazard-color-reset="${prefix}">Reset colors to defaults</button>
    <div class="form-group"><label>Trigger sound</label><input name="${prefix}-sound" type="checkbox" ${c.sound ? 'checked' : ''}></div>
    <div class="form-group"><label>Extreme temperature style</label><select name="${prefix}-temperature"><option value="heat" ${c.temperature === 'heat' ? 'selected' : ''}>Heat</option><option value="cold" ${c.temperature === 'cold' ? 'selected' : ''}>Cold / frost</option></select></div>
    <p class="notes">Temperature style applies only to Extreme Temperature hazards.</p>
    <p class="notes">Uses the hazard sound configured in module settings. GM-only effects and sounds stay private.</p>
    <button type="button" data-hazard-vfx-preview="${prefix}">Preview on selected token</button>
  </fieldset>`;
}

export function wireHazardVfxPreview(root, getType) {
  root?.addEventListener('change', event => {
    const input = event.target;
    if (!input.name?.endsWith('-temperature') || getType(input) !== 'extreme-temp') return;
    const prefix = input.name.slice(0, -'-temperature'.length);
    const picker = root.querySelector(`[name="${prefix}-color"]`);
    const oldDefault = input.value === 'cold' ? '#ff9254' : '#80ccff';
    if (picker?.value.toLowerCase() === oldDefault) {
      picker.value = input.value === 'cold' ? '#80ccff' : '#ff9254';
      picker.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  root?.addEventListener('input', event => {
    const input = event.target;
    const name = input.dataset?.hazardColor ?? input.dataset?.hazardHex;
    if (!name) return;
    const valid = /^#[0-9a-f]{6}$/i.test(input.value);
    input.setCustomValidity?.(valid ? '' : 'Enter a hex color such as #33aaff.');
    if (!valid) return;
    const picker = root.querySelector(`[name="${name}"]`);
    const hex = root.querySelector(`[name="${name}-hex"]`);
    if (picker) picker.value = input.value;
    if (hex) hex.value = input.value;
    hex?.setCustomValidity?.('');
    if (name.endsWith('-accent')) {
      const enabled = root.querySelector(`[name="${name}-enabled"]`);
      if (enabled) enabled.checked = true;
    }
  });
  root?.addEventListener('click', async event => {
    const reset = event.target.closest?.('[data-hazard-color-reset]');
    if (reset) {
      event.preventDefault();
      const prefix = reset.dataset.hazardColorReset;
      const temperature = root.querySelector(`[name="${prefix}-temperature"]`)?.value;
      const type = getType(reset);
      const base = type === 'extreme-temp' && temperature === 'cold' ? '#80ccff' : HAZARD_VFX_TYPES[type] ?? '#ff7026';
      for (const [key, value] of [['color', base], ['accent', '#ffffff']]) {
        for (const suffix of ['', '-hex']) {
          const field = root.querySelector(`[name="${prefix}-${key}${suffix}"]`);
          if (field) { field.value = value; field.setCustomValidity?.(''); }
        }
      }
      root.querySelector(`[name="${prefix}-accent-enabled"]`).checked = false;
      return;
    }
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
    color: field('color')?.value, accentColor: field('accent-enabled')?.checked ? field('accent')?.value : '',
    sound: field('sound')?.checked, temperature: field('temperature')?.value }, type);
}
