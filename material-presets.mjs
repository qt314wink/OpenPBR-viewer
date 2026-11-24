/**
 * Named OpenPBR material recipes. Presets only change material parameters;
 * scene, camera, renderer and lighting settings remain under manual control.
 */
export const MATERIAL_KEYS = Object.freeze([
  'base_weight', 'base_color', 'base_diffuse_roughness', 'base_metalness',
  'specular_weight', 'specular_color', 'specular_roughness', 'specular_anisotropy',
  'specular_ior', 'specular_haze', 'specular_haze_spread', 'specular_retroreflectivity',
  'transmission_weight', 'transmission_color', 'transmission_depth',
  'transmission_scatter', 'transmission_scatter_anisotropy',
  'transmission_dispersion_abbe_number', 'transmission_dispersion_scale',
  'subsurface_weight', 'subsurface_color', 'subsurface_radius',
  'subsurface_radius_scale', 'subsurface_anisotropy',
  'coat_weight', 'coat_color', 'coat_roughness', 'coat_anisotropy',
  'coat_ior', 'coat_darkening',
  'fuzz_weight', 'fuzz_color', 'fuzz_roughness',
  'emission_weight', 'emission_luminance', 'emission_color',
  'thin_film_weight', 'thin_film_thickness', 'thin_film_ior',
  'geometry_opacity', 'geometry_thin_walled'
]);

export const MATERIAL_PRESETS = Object.freeze([
  { id: 'neutral', name: 'Neutral', subtitle: 'Original baseline', swatch: '#bec6d0', values: {} },
  { id: 'iridescent', name: 'Iridescent', subtitle: 'Pearlescent thin film', swatch: '#88d9d8',
    values: { base_color: [0.46, 0.68, 0.72], specular_roughness: 0.13,
      coat_weight: 0.85, coat_roughness: 0.09, coat_ior: 1.52,
      thin_film_weight: 1, thin_film_thickness: 620, thin_film_ior: 1.45 } },
  { id: 'metal', name: 'Satin Metal', subtitle: 'Anisotropic highlights', swatch: '#9faabc',
    values: { base_color: [0.73, 0.78, 0.85], base_metalness: 1,
      specular_roughness: 0.32, specular_anisotropy: 0.65 } },
  { id: 'glass', name: 'Clear Glass', subtitle: 'Transmission & refraction', swatch: '#d5f4ff',
    values: { base_color: [1, 1, 1], specular_roughness: 0.025, specular_ior: 1.52,
      transmission_weight: 1, transmission_color: [0.93, 0.99, 1],
      geometry_thin_walled: false } },
  { id: 'velvet', name: 'Soft Velvet', subtitle: 'Fuzzy diffuse surface', swatch: '#a16bc5',
    values: { base_color: [0.22, 0.075, 0.36], base_diffuse_roughness: 0.65,
      specular_weight: 0.45, specular_roughness: 0.7,
      fuzz_weight: 0.85, fuzz_color: [0.8, 0.47, 0.88], fuzz_roughness: 0.68 } },
  { id: 'ceramic', name: 'Glazed Clay', subtitle: 'Warm layered coating', swatch: '#c97b61',
    values: { base_color: [0.78, 0.32, 0.17], specular_roughness: 0.28,
      coat_weight: 0.7, coat_color: [1, 0.89, 0.79], coat_roughness: 0.08,
      subsurface_weight: 0.12, subsurface_color: [0.8, 0.25, 0.13],
      subsurface_radius: 0.18 } }
]);

const copy = (v) => Array.isArray(v) ? [...v] : v;

export function captureMaterialDefaults(params) {
  const snapshot = {};
  for (const key of MATERIAL_KEYS) {
    if (!Object.hasOwn(params, key)) throw new Error('Missing material parameter: ' + key);
    snapshot[key] = copy(params[key]);
  }
  return snapshot;
}

export function applyMaterialPreset(params, defaults, presetId) {
  const preset = MATERIAL_PRESETS.find(p => p.id === presetId);
  if (!preset) return false;
  for (const key of MATERIAL_KEYS) {
    params[key] = copy(Object.hasOwn(preset.values, key) ? preset.values[key] : defaults[key]);
  }
  return true;
}

let dock;
let defaultSnapshot;
let activeId = 'neutral';
let hasInitialized = false;
let currentGui;
let currentParams;
let currentResetSamples;
let readyCheck = () => true;
let pendingApply = false;

export function setupMaterialPresets(params, gui, resetSamples, isReady = () => true) {
  if (!defaultSnapshot) defaultSnapshot = captureMaterialDefaults(params);
  if (gui) currentGui = gui;
  readyCheck = isReady;
  currentParams = params;
  currentResetSamples = resetSamples;
  if (!dock) {
    dock = document.createElement('aside');
    dock.id = 'material-preset-dock';
    dock.setAttribute('aria-label', 'Material presets');
    dock.innerHTML = `
      <div class="preset-head">
        <span class="preset-kicker">OPENPBR / MATERIAL LIBRARY</span>
        <h2>Explore materials</h2>
        <p>One click changes the actual shader parameters.</p>
      </div>
      <div class="preset-options" role="group" aria-label="Choose a material preset">
        ${MATERIAL_PRESETS.map(p => `
          <button class="preset-button" type="button" data-preset="${p.id}"
                  aria-pressed="false" title="${p.subtitle}">
            <span class="preset-swatch" style="--preset-color:${p.swatch}" aria-hidden="true"></span>
            <span class="preset-copy"><strong>${p.name}</strong><small>${p.subtitle}</small></span>
          </button>`).join('')}
      </div>
      <p id="material-preset-status" class="preset-status" role="status" aria-live="polite"></p>
      <p class="preset-hint">Fine-tune any value in the Controls panel. Presets don't change your camera.</p>
    `;
    document.body.appendChild(dock);
    dock.querySelectorAll('[data-preset]').forEach(button => {
      button.addEventListener('click', () => {
        const selected = button.dataset.preset;
        if (!applyMaterialPreset(currentParams, defaultSnapshot, selected)) return;
        activeId = selected;
        const ready = Boolean(currentGui) && readyCheck();
        if (ready) currentGui.controllersRecursive().forEach(c => c.updateDisplay());
        const url = new URL(window.location.href);
        url.searchParams.set('preset', selected);
        window.history.replaceState(null, '', url);
        if (ready) currentResetSamples();
        else pendingApply = true;
        renderPresetState();
      });
    });
  }
  // Global GUI events denote manual edits; display refreshes do not fire them.
  if (gui) gui.onChange(() => {
    if (activeId !== null) {
      activeId = null;
      pendingApply = false;
      const url = new URL(window.location.href);
      url.searchParams.delete('preset');
      window.history.replaceState(null, '', url);
      renderPresetState();
    }
  });
  if (!hasInitialized) {
    hasInitialized = true;
    const initial = new URLSearchParams(window.location.search).get('preset');
    if (MATERIAL_PRESETS.some(p => p.id === initial)) {
      applyMaterialPreset(params, defaultSnapshot, initial);
      activeId = initial;
      if (gui) {
        gui.controllersRecursive().forEach(c => c.updateDisplay());
        resetSamples();
      }
    }
  }
  if (gui && window.matchMedia('(max-width: 700px)').matches) gui.close();
  flushPendingMaterialPreset();
  renderPresetState();
}

export function flushPendingMaterialPreset() {
  if (!pendingApply || !currentGui || !readyCheck()) return;
  pendingApply = false;
  currentGui.controllersRecursive().forEach(c => c.updateDisplay());
  renderPresetState();
  currentResetSamples();
}

function renderPresetState() {
  if (!dock) return;
  for (const button of dock.querySelectorAll('[data-preset]')) {
    button.setAttribute('aria-pressed', String(button.dataset.preset === activeId));
  }
  const chosen = MATERIAL_PRESETS.find(p => p.id === activeId);
  const status = dock.querySelector('#material-preset-status');
  if (status) status.textContent = chosen
    ? 'Active: ' + chosen.name + ' · ' + chosen.subtitle
    : 'Custom material · select a preset to restore a recipe';
  if (status && pendingApply) status.textContent += ' · queued while scene loads';
}
