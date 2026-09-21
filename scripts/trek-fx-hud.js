import { buildHudItem } from "./token-hud-util.js";
import {
  getTrekFx, setTrekFx, clearTrekFx,
  TREK_PARTICLE_COLORS, getTrekParticleColor, setTrekParticleColor,
} from "./trek-fx.js";

const EFFECTS = [
  ["blueHaze", "Blue Static Haze", "Fuzzy blue static with a persistent blue glow"],
  ["particleStorm", "Particle Bombardment", "Particles of varied sizes popping in and out at random, each with a soft colored glow"],
  ["blueDissolve", "Blue Particle Dissolve", "Dissolve into blue particles, then remove this token from the scene after 6.5 seconds. Turn off to cancel removal"],
];

export const TREK_FX_SECTION = {
  id: "trek-fx",
  label: "Trek FX",
  icon: "fas fa-wand-magic-sparkles",
  tooltip: "Shader effects for this token",
  available: token => !!token?.document,
  build(host, nav) {
    const state = getTrekFx(host.token);
    const selected = getTrekParticleColor(host.token);
    let pending = false;
    const run = async (action, next) => {
      if (pending) return;
      pending = true;
      const buttons = host.palette.querySelectorAll("button");
      for (const button of buttons) button.disabled = true;
      try { await action(); }
      catch (error) {
        console.error("STA2e Toolkit | Trek FX update failed:", error);
        ui.notifications.error("Could not update Trek FX for this token.");
      } finally {
        pending = false;
        for (const button of buttons) button.disabled = false;
        host.rebuild(next);
      }
    };
    const rows = [];
    for (const [key, label, tooltip] of EFFECTS) {
      const row = buildHudItem({
        icon: state[key] ? "fas fa-check-square" : "far fa-square",
        label, tooltip: `${tooltip}. Click to turn ${state[key] ? "off" : "on"}.`,
        extraClass: state[key] ? "trek-fx-active" : "",
      }, () => run(() => setTrekFx(host.token, key, !getTrekFx(host.token)[key])));
      row.setAttribute("aria-pressed", String(state[key]));
      rows.push(row);
      if (key === "particleStorm") {
        const colorButton = buildHudItem({
          icon: "fas fa-palette", label: `Particle Color: ${selected.label}`,
          tooltip: "Choose the color of the bombardment particles and their glow",
        }, () => host.rebuild({ colorsOpen: !nav?.colorsOpen }));
        colorButton.setAttribute("aria-expanded", String(!!nav?.colorsOpen));
        rows.push(colorButton);
        if (nav?.colorsOpen) for (const color of TREK_PARTICLE_COLORS) {
          const choice = buildHudItem({
            icon: color.id === selected.id ? "fas fa-check-circle" : "fas fa-circle",
            label: color.label, tooltip: `Use ${color.label.toLowerCase()} particles and glow`,
            extraClass: color.id === selected.id ? "trek-fx-active" : "",
          }, () => run(() => setTrekParticleColor(host.token, color.id), { colorsOpen: false }));
          choice.querySelector("i").style.color = `rgb(${color.core.map(c => Math.round(c * 255)).join(",")})`;
          choice.setAttribute("aria-pressed", String(color.id === selected.id));
          rows.push(choice);
        }
      }
    }
    rows.push(buildHudItem({ icon: "fas fa-ban", label: "Clear Trek FX", danger: true,
      tooltip: "Remove all Trek FX and restore the token artwork",
    }, () => run(() => clearTrekFx(host.token))));
    return rows;
  },
};
