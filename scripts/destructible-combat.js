/** Object-specific chat rows, sharing the existing Momentum spend panel. */
import { getDestructibleConfig, getDestructibleState, isDestructible, requestObjectOperation, fractureKind } from "./destructible-objects.js";
import { objectDamage } from "./destructible-geometry.js";
const MODULE = "sta2e-toolkit";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function objectDamageRow(t, weapon, { ground = false, areaTargets = [], traitHtml = "" } = {}) {
  const token = canvas.tokens?.get(t.tokenId);
  if (!t.destructible && !isDestructible(token)) return null;
  const config = t.destructible?.config ?? getDestructibleConfig(token), state = t.destructible?.state ?? getDestructibleState(token);
  t.destructible ??= { config, state };
  const weaponType = t.weaponType || (ground ? (weapon.system?.range === "melee" ? "melee" : "ground-beam") : weapon.system?.qualities?.torpedo ? "torpedo" : "beam");
  const payload = { ...t, sceneId: token?.document?.parent?.id ?? t.sceneId ?? canvas.scene.id,
    ground, rawDamage: ground ? t.severity : t.rawDamage ?? t.finalDamage ?? 0,
    piercing: !!(t.weaponPiercing || t.piercingApplied || t.resistanceIgnored || weapon.system?.qualities?.piercing),
    resistance: config.resistance, useStun: !!t.useStun, weaponType, kind: fractureKind(weaponType), weaponId: weapon.id,
    weaponName: weapon.name, current: state?.current ?? config.integrity, maximum: state?.maximum ?? config.integrity,
    area: !!(t.areaActive || t.area), severity: t.severity,
  };
  const damage = objectDamage(payload), encoded = esc(encodeURIComponent(JSON.stringify(payload)));
  return `<div class="sta2e-object-row" style="border:1px solid #887a65;border-radius:3px;padding:8px;margin:6px 0;color:#e4ddd0">
    <strong>${esc(t.name)} · Destructible object</strong>
    <div>Resistance ${config.resistance}${payload.piercing ? " (Piercing bypasses Resistance)" : ""}</div>
    <div data-object-result>Integrity ${payload.current} → ${Math.max(0, payload.current - damage)} / ${payload.maximum} (${damage} damage)</div>
    ${payload.useStun ? "<div>Stun has no effect on objects.</div>" : ""}
    ${t.rangeStatus?.warning ? `<div>${esc(t.rangeStatus.warning)}</div>` : ""}
    <div class="sta2e-object-controls" style="margin-top:6px">
      ${traitHtml}
      <input type="hidden" class="sta2e-object-adj" value="0" data-base-payload="${encoded}">
      <label>GM damage adjustment <input type="number" data-object-manual value="0" step="1" style="width:60px"></label>
      ${payload.area && areaTargets.length ? `<div><strong>Area targets</strong>${areaTargets.map(a => `<label style="display:block"><input type="checkbox" class="${ground ? "sta2e-ground-area-target" : "sta2e-main-area-target"}" value="${esc(a.id)}"> ${esc(a.name)}</label>`).join("")}</div>` : ""}
      <button type="button" class="sta2e-apply-object" data-payload="${encoded}" style="width:100%;margin-top:6px">Apply Integrity damage</button>
    </div>
  </div>`;
}
export function registerDestructibleCombat() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    for (const button of html.querySelectorAll(".sta2e-apply-object")) {
      const controls = button.closest(".sta2e-object-controls"), row = button.closest(".sta2e-object-row");
      let base;
      try { base = JSON.parse(decodeURIComponent(button.dataset.payload)); } catch { continue; }
      const operationId = `chat-${message.id}-${base.tokenId}`;
      const receipt = game.scenes.get(base.sceneId)?.getFlag(MODULE, "destructibleOperations")?.[operationId];
      const sync = () => {
        const extra = Number(controls.querySelector(".sta2e-object-adj")?.value) || 0;
        const manual = Number(controls.querySelector("[data-object-manual]")?.value) || 0;
        const traits = Array.from(controls.querySelectorAll(".sta2e-trait-damage-cb:checked")).reduce((sum, input) => sum + (Number(input.dataset.delta) || 0), 0);
        const payload = { ...base, rawDamage: Math.max(0, base.rawDamage + extra + manual + traits), operationId };
        payload.areaSecondaryTokenIds = Array.from(controls.querySelectorAll(".sta2e-ground-area-target:checked, .sta2e-main-area-target:checked")).map(i => i.value);
        button.dataset.payload = encodeURIComponent(JSON.stringify(payload));
        const damage = objectDamage(payload);
        if (!receipt) row.querySelector("[data-object-result]").textContent = `Integrity ${base.current} → ${Math.max(0, base.current - damage)} / ${base.maximum} (${damage} damage)`;
      };
      controls.querySelectorAll("input").forEach(input => { input.addEventListener("input", sync); input.addEventListener("change", sync); });
      if (receipt?.status === "complete") {
        button.disabled = true; button.textContent = "Applied";
        row.querySelector("[data-object-result]").textContent = `Integrity ${receipt.result.before} → ${receipt.result.after}; ${receipt.result.fragments.length} fragments`;
      }
      if (!game.user.isGM || receipt) controls.querySelectorAll("input,button").forEach(el => { el.disabled = true; });
      if (!game.user.isGM) { button.hidden = true; continue; }
      button.addEventListener("click", async () => {
        if (button.dataset.busy) return;
        sync(); button.dataset.busy = "1"; button.disabled = true;
        try {
          if (button.dataset.spendBlocked === "1") throw new Error("Insufficient Momentum/Threat for this spend.");
          const payload = JSON.parse(decodeURIComponent(button.dataset.payload));
          if (button.dataset.spendResult) payload.spendResult = button.dataset.spendResult;
          const result = await requestObjectOperation(payload);
          row.querySelector("[data-object-result]").textContent = `Integrity ${result.before} → ${result.after}${result.destroyed ? `; ${result.fragments.length} surviving fragments` : ""}`;
          button.textContent = "Applied";
          controls.querySelectorAll("input,button").forEach(el => { el.disabled = true; });
          if (!result.replayed && payload.areaSecondaryTokenIds.length) {
            const hud = game.sta2eToolkit.CombatHUD, spend = payload.spendResult ? JSON.parse(decodeURIComponent(payload.spendResult)) : {};
            const areaPayload = { ...payload, finalDamage: result.damage, severity: payload.rawDamage, areaSecondaryPrepaid: spend.areaSecondaryCost ?? 0 };
            if (payload.ground) await hud._applyGroundAreaSecondaryTargets(areaPayload);
            else await hud._applyAreaSecondaryTargets(areaPayload);
          }
        } catch (err) { button.disabled = false; ui.notifications.error(err.message); console.error("STA2e Toolkit | Object damage:", err); }
        finally { delete button.dataset.busy; }
      });
      sync();
    }
  });
}
