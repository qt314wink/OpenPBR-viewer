import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MATERIAL_KEYS, MATERIAL_PRESETS, captureMaterialDefaults, applyMaterialPreset
} from './material-presets.mjs';

const copy = (x) => Array.isArray(x) ? [...x] : x;
const baseline = () => Object.fromEntries(MATERIAL_KEYS.map(k => [k,
  k.endsWith('_color') || k === 'transmission_scatter' || k === 'subsurface_radius_scale'
    ? [0.5, 0.5, 0.5] : k === 'geometry_thin_walled' ? false : 0
]));

test('six unique named recipes with valid material keys', () => {
  assert.equal(MATERIAL_PRESETS.length, 6);
  assert.equal(new Set(MATERIAL_PRESETS.map(x => x.id)).size, 6);
  for (const p of MATERIAL_PRESETS) {
    for (const k of Object.keys(p.values)) {
      assert.ok(MATERIAL_KEYS.includes(k), k);
      assert.ok(p.values[k] !== undefined);
    }
  }
});

test('selection restores defaults between recipes and preserves nonmaterial settings', () => {
  const params = baseline();
  params.scene_name = 'standard-shader-ball';
  params.sunPower = .25;
  const defaults = captureMaterialDefaults(params);
  assert.equal(applyMaterialPreset(params, defaults, 'iridescent'), true);
  assert.equal(params.thin_film_weight, 1);
  assert.equal(applyMaterialPreset(params, defaults, 'glass'), true);
  assert.equal(params.thin_film_weight, 0);
  assert.equal(params.transmission_weight, 1);
  assert.equal(params.scene_name, 'standard-shader-ball');
  assert.equal(params.sunPower, .25);
  assert.equal(applyMaterialPreset(params, defaults, 'neutral'), true);
  for (const key of MATERIAL_KEYS) assert.deepEqual(params[key], defaults[key], key);
});

test('color values are copied rather than shared with preset or baseline data', () => {
  const params = baseline();
  const defaults = captureMaterialDefaults(params);
  applyMaterialPreset(params, defaults, 'ceramic');
  params.base_color[0] = 0;
  applyMaterialPreset(params, defaults, 'ceramic');
  assert.equal(params.base_color[0], .78);
  applyMaterialPreset(params, defaults, 'neutral');
  params.base_color[0] = .99;
  assert.deepEqual(defaults.base_color, [.5,.5,.5]);
});

test('unknown preset has no side effects', () => {
  const params = baseline();
  const defaults = captureMaterialDefaults(params);
  const before = structuredClone(params);
  assert.equal(applyMaterialPreset(params, defaults, 'unregistered'), false);
  assert.deepEqual(params, before);
});

test('snapshots fail explicitly if source contract changes', () => {
  const p = baseline();
  delete p.coat_weight;
  assert.throws(() => captureMaterialDefaults(p), /coat_weight/);
});
