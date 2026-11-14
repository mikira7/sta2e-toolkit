// node tests/water-presets.mjs
//
// Every Water Surface preset writes the same set of fields, and every value is
// inside the range the behavior's schema accepts.
import assert from 'node:assert/strict';
import {
  WATER_PRESETS, WATER_PRESET_FIELDS, WATER_FIELD_RANGES, WATER_FLOW_MODES,
  waterPresetDefaults, waterPresetChoices, DEFAULT_WATER_PRESET, isWaterPresetId,
} from '../scripts/water-presets.js';

const hex = /^#[0-9a-f]{6}$/i;
assert.ok(isWaterPresetId(DEFAULT_WATER_PRESET));
assert.deepEqual(Object.keys(waterPresetChoices()), Object.keys(WATER_PRESETS));

for (const [id, preset] of Object.entries(WATER_PRESETS)) {
  const d = preset.defaults;
  assert.deepEqual(Object.keys(d).sort(), [...WATER_PRESET_FIELDS].sort(), `${id}: same fields`);
  for (const key of ['deepColor', 'shallowColor', 'foamColor']) assert.match(d[key], hex, `${id}.${key}`);
  assert.ok(d.flowMode in WATER_FLOW_MODES, `${id}.flowMode`);
  for (const [key, [min, max]] of Object.entries(WATER_FIELD_RANGES)) {
    if (!(key in d)) continue;
    assert.ok(typeof d[key] === 'number' && d[key] >= min && d[key] <= max, `${id}.${key} = ${d[key]} in [${min}, ${max}]`);
  }
  // A copy, never the frozen block.
  const copy = waterPresetDefaults(id);
  copy.opacity = -1;
  assert.notEqual(WATER_PRESETS[id].defaults.opacity, -1);
}
assert.deepEqual(waterPresetDefaults('nope'), waterPresetDefaults(DEFAULT_WATER_PRESET));

console.log('water-presets: all tests passed');
