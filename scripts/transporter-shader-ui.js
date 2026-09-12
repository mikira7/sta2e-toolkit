import {
  TRANSPORTER_SHADER_SETTING, TRANSPORTER_SHADER_PRESETS, TRANSPORTER_SHADER_CONTROLS,
  getTransporterShaderSettings, normalizeTransporterShader,
} from "./transporter-shader-config.js";
import { previewTransporterShader } from "./transporter-shader.js";

export function transporterShaderForm() {
  let engine = "sequencer";
  try { engine = game.settings.get("sta2e-toolkit", "vfxEngine"); } catch { /* default */ }
  return {
    engines: [
      { value: "sequencer", label: "Sequencer + JB2A" },
      { value: "native", label: "Native VFX" },
      { value: "shader", label: "Cinematic Shader — Rain & Shimmer" },
    ].map(option => ({ ...option, selected: option.value === engine })),
    presets: Object.entries(TRANSPORTER_SHADER_PRESETS).map(([type, defaults]) => {
      const values = getTransporterShaderSettings(type);
      return {
        type, label: defaults.label, values,
        hasSecondary: values.accent === "dominion",
        portrait: values.framing === "portrait",
        controls: TRANSPORTER_SHADER_CONTROLS.filter(control => (!control.preset || control.preset === type)
          && (!control.particlesOnly || (values.strandWidth === 0 && !["romulan","dominion"].includes(values.accent))))
          .map(control => ({ ...control, value: values[control.key],
            options: control.choices ? Object.entries(control.choices).map(([value, label]) => ({
              value, label, selected: value === values[control.key],
            })) : null,
            label: values.strandWidth > 0
            ? ({particleSize:"Strand thickness",noiseScale:"Strand density",noiseStrength:"Strand intensity",shimmerSpeed:"Strand motion speed"}[control.key] ?? control.label)
            : values.accent === "romulan"
              ? ({particleSize:"Field texture width",noiseScale:"Field detail",noiseStrength:"Field intensity",shimmerSpeed:"Field motion speed"}[control.key] ?? control.label)
              : values.accent === "dominion"
                ? ({noiseScale:"Haze detail",noiseStrength:"Haze intensity",shimmerSpeed:"Haze motion speed"}[control.key] ?? control.label)
                : control.label })),
      };
    }),
  };
}
function readPreset(root) {
  const values = {};
  for (const input of root.querySelectorAll("[data-transporter-field]")) {
    values[input.dataset.transporterField] = input.value;
  }
  return normalizeTransporterShader(root.dataset.transporterPreset, values);
}
export async function saveTransporterShaderForm(element) {
  const roots = element.querySelectorAll("[data-transporter-preset]");
  if (!roots.length) return;
  const saved = {};
  for (const root of roots) saved[root.dataset.transporterPreset] = readPreset(root);
  await game.settings.set("sta2e-toolkit", TRANSPORTER_SHADER_SETTING, saved);
  const engine = element.querySelector("[data-transporter-engine]")?.value;
  if (["sequencer", "native", "shader"].includes(engine)) await game.settings.set("sta2e-toolkit", "vfxEngine", engine);
}
export function wireTransporterShaderForm(element) {
  const handles = new Set();
  const stop = () => { for (const handle of handles) handle.stop(); handles.clear(); };
  for (const root of element.querySelectorAll("[data-transporter-preset]")) {
    root.querySelector("[data-transporter-reset]")?.addEventListener("click", () => {
      const values = normalizeTransporterShader(root.dataset.transporterPreset);
      for (const input of root.querySelectorAll("[data-transporter-field]")) {
        input.value = values[input.dataset.transporterField];
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    for (const button of root.querySelectorAll("[data-transporter-preview]")) {
      button.addEventListener("click", () => {
        stop();
        for (const handle of previewTransporterShader(root.dataset.transporterPreset, button.dataset.transporterPreview, { settings: readPreset(root) })) {
          handles.add(handle);
          handle.finished.then(() => handles.delete(handle));
        }
      });
    }
  }
  element.querySelector("[data-transporter-stop]")?.addEventListener("click", stop);
  return stop;
}
