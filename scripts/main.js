/**
 * sta2e-toolkit | main.js
 * Module entry point — v13 native.
 */

import { registerSettings } from "./settings.js";
import { CampaignStore } from "./campaign-store.js";
import { StardateHUD } from "./stardate-hud.js";
import { DateEditor } from "./date-editor.js";
import { CampaignManager } from "./campaign-manager.js";
import { EffectConfigMenu } from "./effect-config.js";
import { ToolkitAPI } from "./toolkit-api.js";
import { openWarpCalc } from "./warp-calc.js";
import { AlertHUD } from "./alert-hud.js";
import { CombatHUD, BRIDGE_STATIONS, TASK_PARAMS, checkOpposedTaskForTokens, openWeaponAttackForOfficer, applyScanForWeakness, applyDefenseModeForOfficer, applyModulateShieldsForOfficer, applyCalibrateWeaponsForOfficer, applyTargetingSolutionForOfficer, consumeTargetingSolutionForOfficer, applyPrepareForOfficer, applyImpulseForOfficer, applyThrustersForOfficer, applyCalibrateSensorsForOfficer, consumeCalibrateSensorsForOfficer, applyLaunchProbeForOfficer, applyDirectForOfficer, lockTractorBeam, applyWarpForOfficer, applyRamForOfficer, handleOfficerTaskResult, showRerouteSystemDialog, showTransportConfigDialog, hasRapidFireTorpedoLauncher, hasCloakingDevice, handleCloakActivateResult, applyCloakDeactivateForOfficer, runImpulseEngageCard, runWarpEngageCard, runWarpFleeCard, promptShipCardDestination } from "./combat-hud.js";
import { buildWeaponContext } from "./weapon-configs.js";
import { registerConditionHooks } from "./token-conditions.js";
import { openNpcRoller, openPlayerRoller } from "./npc-roller.js";
import { openTransporter, registerTransporterSettings } from "./transporter.js";
import { ToolkitWidget } from "./toolkit-widget.js";
import { getCrewManifest, STATION_SLOTS, getAssignedShips, setAssignedShips, readOfficerStats, openCrewManifest } from "./crew-manifest.js";
import { getLcTokens } from "./lcars-theme.js";
import { registerElevationRuler } from "./elevation-ruler.js";
import { applyWildcardName } from "./wildcard-namer.js";
import { ZoneOverlay } from "./zone-layer.js";
import { ZoneEditState, ZoneToolbar } from "./zone-editor.js";
import { getSceneZones, getZoneDistance, getZoneAtPoint } from "./zone-data.js";
import { ZoneDragRuler } from "./zone-drag-ruler.js";
import { ZoneMovementLog } from "./zone-movement-log.js";
import { ZoneHazard } from "./zone-hazard.js";
import { ZoneVisibility, registerZoneVisibilityWrap } from "./zone-visibility.js";
import { ZoneMonitor } from "./zone-monitor.js";
import {
  openOpposedTaskSetup,
  startOpposedTask,
  wireOpposedTaskCard,
  applyOpposedRollResult,
} from "./opposed-task.js";

function getShipCardAllowedUserIds(message, payload = {}) {
  const toolkitFlags = message?.flags?.["sta2e-toolkit"] ?? {};
  if (Object.prototype.hasOwnProperty.call(toolkitFlags, "allowedUserIds")) {
    return Array.isArray(toolkitFlags.allowedUserIds) ? toolkitFlags.allowedUserIds : [];
  }

  const actor = canvas?.tokens?.get(payload.tokenId)?.actor
    ?? game.actors.get(payload.actorId)
    ?? null;
  if (!actor) return [];

  return game.users
    .filter(user => !user.isGM && actor.testUserPermission?.(user, "OWNER"))
    .map(user => user.id);
}

function getShipCardActorAccess(payload = {}) {
  const actor = canvas?.tokens?.get(payload.tokenId)?.actor
    ?? game.actors.get(payload.actorId)
    ?? null;
  if (!actor) return { actor: null, canUse: game.user.isGM };

  const isShip = actor.system?.systems !== undefined;
  const isNpc  = isShip
    ? CombatHUD.isNpcShip(actor)
    : CombatHUD.isGroundNpcActor(actor);

  return {
    actor,
    isNpc,
    canUse: game.user.isGM || (actor.isOwner && !isNpc),
  };
}

function getShipCardUserAccess(message, payload = {}, userId = game.user.id) {
  const actorAccess = getShipCardActorAccess(payload);
  const toolkitFlags = message?.flags?.["sta2e-toolkit"] ?? {};
  const hasExplicitAllowedUsers = Object.prototype.hasOwnProperty.call(toolkitFlags, "allowedUserIds");
  const allowedUserIds = getShipCardAllowedUserIds(message, payload);
  const requestingUser = game.users.get(userId);
  const fallbackCanUse = requestingUser?.isGM || (
    !!actorAccess.actor
    && !actorAccess.isNpc
    && actorAccess.actor.testUserPermission?.(requestingUser, "OWNER")
  );

  return {
    actor: actorAccess.actor,
    isNpc: actorAccess.isNpc,
    allowedUserIds,
    canUse: requestingUser?.isGM || (hasExplicitAllowedUsers
      ? allowedUserIds.includes(userId)
      : !!fallbackCanUse),
  };
}

function applyShipCardLockToDom(messageId, flags = {}) {
  if (!messageId) return;
  const roots = document.querySelectorAll(`[data-message-id="${messageId}"]`);
  if (!roots.length) return;

  const impulseLocked = !!flags.impulseEngageConsumed;
  const warpLockState = flags.warpEngageConsumedAction ?? null;

  roots.forEach(root => {
    if (impulseLocked) {
      root.querySelectorAll(".sta2e-impulse-engage").forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.textContent = "✓ ENGAGED";
      });
    }

    if (warpLockState) {
      root.querySelectorAll(".sta2e-warp-engage, .sta2e-warp-flee").forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = "0.5";
      });
      root.querySelectorAll(".sta2e-warp-engage").forEach(btn => {
        btn.textContent = warpLockState === "engage" ? "✓ ENGAGED" : "⚡ ENGAGE";
      });
      root.querySelectorAll(".sta2e-warp-flee").forEach(btn => {
        btn.textContent = warpLockState === "flee" ? "✓ FLED" : "🚀 FLEE";
      });
    }
  });
}

function applyShipCardAccessToDom(messageId, flags = {}) {
  if (!messageId) return;
  if (game.user.isGM) return;
  if (!Object.prototype.hasOwnProperty.call(flags, "allowedUserIds")) return;

  const allowedUserIds = flags.allowedUserIds ?? [];
  if (allowedUserIds.includes(game.user.id)) return;

  const roots = document.querySelectorAll(`[data-message-id="${messageId}"]`);
  if (!roots.length) return;

  roots.forEach(root => {
    root.querySelectorAll(".sta2e-impulse-engage, .sta2e-warp-engage, .sta2e-warp-flee")
      .forEach(btn => btn.remove());
  });
}

function applyShipCardAccessToHtml(html, flags = {}) {
  if (game.user.isGM) return;
  if (!Object.prototype.hasOwnProperty.call(flags, "allowedUserIds")) return;

  const allowedUserIds = flags.allowedUserIds ?? [];
  if (allowedUserIds.includes(game.user.id)) return;

  html.querySelectorAll(".sta2e-impulse-engage, .sta2e-warp-engage, .sta2e-warp-flee")
    .forEach(btn => btn.remove());
}

function applyShipCardLockToHtml(html, flags = {}) {
  const impulseLocked = !!flags.impulseEngageConsumed;
  const warpLockState = flags.warpEngageConsumedAction ?? null;

  if (impulseLocked) {
    html.querySelectorAll(".sta2e-impulse-engage").forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = "0.5";
      btn.textContent = "✓ ENGAGED";
    });
  }

  if (warpLockState) {
    html.querySelectorAll(".sta2e-warp-engage, .sta2e-warp-flee").forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = "0.5";
    });
    html.querySelectorAll(".sta2e-warp-engage").forEach(btn => {
      btn.textContent = warpLockState === "engage" ? "✓ ENGAGED" : "⚡ ENGAGE";
    });
    html.querySelectorAll(".sta2e-warp-flee").forEach(btn => {
      btn.textContent = warpLockState === "flee" ? "✓ FLED" : "🚀 FLEE";
    });
  }
}

// ---------------------------------------------------------------------------
// init — register settings first
// ---------------------------------------------------------------------------

function _canWriteWorldSettings() {
  return game.permissions?.SETTINGS_MODIFY?.includes(game.user.role) ?? game.user.isGM;
}

async function _setStaTrackerPoolValue(resource, value) {
  const nextValue = Math.max(0, Number(value) || 0);
  const Tracker = game.STATracker?.constructor ?? null;

  if (Tracker && (Tracker.UserHasPermissionFor?.(resource) || !_canWriteWorldSettings())) {
    await Tracker.DoUpdateResource(resource, nextValue);
    if ((Tracker.ValueOf(resource) ?? 0) === nextValue) return true;
  }

  if (!_canWriteWorldSettings()) return false;

  await game.settings.set("sta", resource, nextValue);
  try {
    Tracker?.SendUpdateMessage?.(Tracker.MessageType?.UpdateResource, resource, nextValue);
    Tracker?.UpdateTracker?.();
  } catch (err) {
    console.warn(`STA2e Toolkit | Could not refresh STA ${resource} tracker after direct setting write:`, err);
  }
  return true;
}

async function _adjustStaTrackerPoolValue(resource, delta) {
  const Tracker = game.STATracker?.constructor ?? null;
  const current = Tracker
    ? (Tracker.ValueOf(resource) ?? 0)
    : (() => {
        try { return game.settings.get("sta", resource) ?? 0; }
        catch { return 0; }
      })();

  return _setStaTrackerPoolValue(resource, current + delta);
}

Hooks.once("init", () => {
  console.log("STA 2e Toolkit | Initializing");
  registerSettings();
  registerTransporterSettings();

  // ── Keybinding: toggle Combat HUD on selected token ───────────────────────
  game.keybindings.register("sta2e-toolkit", "toggleCombatHud", {
    name:     "STA2E.Keybinding.ToggleCombatHud.Name",
    hint:     "STA2E.Keybinding.ToggleCombatHud.Hint",
    editable: [{ key: "KeyH", modifiers: ["Shift"] }],
    onDown:   () => _combatHudToggle(),
    restricted: false,
  });

  game.keybindings.register("sta2e-toolkit", "openTransporter", {
    name:       "STA2E.Keybinding.OpenTransporter.Name",
    hint:       "STA2E.Keybinding.OpenTransporter.Hint",
    editable:   [{ key: "KeyB", modifiers: ["Shift"] }],
    onDown:     () => { if (game.user.isGM) openTransporter(); },
    restricted: true,
  });

  game.keybindings.register("sta2e-toolkit", "openSocialOpposedTask", {
    name:       "STA2E.Keybinding.OpenSocialOpposedTask.Name",
    hint:       "STA2E.Keybinding.OpenSocialOpposedTask.Hint",
    editable:   [{ key: "KeyO", modifiers: ["Shift"] }],
    onDown:     () => { if (game.user.isGM) openOpposedTaskSetup({ kind: "social" }); },
    restricted: true,
  });

  game.keybindings.register("sta2e-toolkit", "toggleZoneEditor", {
    name:       "STA2E.Keybinding.ToggleZoneEditor.Name",
    hint:       "STA2E.Keybinding.ToggleZoneEditor.Hint",
    editable:   [{ key: "KeyZ", modifiers: ["Shift"] }],
    onDown:     () => {
      console.log("STA2e | toggleZoneEditor hotkey fired — isGM:", game.user.isGM, "sta2eToolkit:", game.sta2eToolkit, "zoneToolbar:", game.sta2eToolkit?.zoneToolbar);
      if (game.user.isGM) game.sta2eToolkit?.zoneToolbar?.toggle();
    },
    restricted: true,
  });
});

// ── Slash command: /opposed ─ opens the Opposed Task setup dialog ─────────────
// GM-only.  Accepts optional args:
//   /opposed                   → setup dialog, defaults
//   /opposed social            → setup dialog pre-set to social kind
//   /opposed skill "Task Name" → setup dialog with kind + task name prefilled
// Shared parser + launcher — used by both the chatMessage hook (v13 classic)
// and the chatInput pre-send catch (v13+ alternate).  Returns true when the
// message was a /opposed command and should be suppressed.
function _handleOpposedChatCommand(rawMessage) {
  if (typeof rawMessage !== "string") return false;
  const trimmed = rawMessage.trim();
  if (!/^\/opposed(\s|$)/i.test(trimmed)) return false;

  if (!game.user.isGM) {
    ui.notifications.warn("STA2e Toolkit: Only the GM can open the Opposed Task dialog.");
    return true;
  }

  const rest = trimmed.replace(/^\/opposed\s*/i, "");
  const prefill = {};
  const kindMatch = rest.match(/^(social|skill|stealth|custom)\b/i);
  if (kindMatch) prefill.kind = kindMatch[1].toLowerCase();
  const nameMatch = rest.match(/"([^"]+)"|'([^']+)'/);
  if (nameMatch) prefill.taskName = nameMatch[1] ?? nameMatch[2];

  openOpposedTaskSetup(prefill);
  return true;
}

// v13 classic chatMessage hook — fires before the message is processed.
// Returning false prevents the default chat echo.
Hooks.on("chatMessage", (_chatLog, message) => {
  if (_handleOpposedChatCommand(message)) return false;
});

// v13+ safety net: intercept the raw textarea input on Enter so a /opposed
// command is caught even if Foundry's chat-command parser has changed in a
// way that bypasses the chatMessage hook.  Idempotent with the hook above.
Hooks.once("ready", () => {
  const _textarea = document.querySelector("#chat-message, textarea[name=\"chat-message\"]");
  if (!_textarea) return;
  _textarea.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    const val = _textarea.value ?? "";
    if (!/^\s*\/opposed(\s|$)/i.test(val)) return;
    // Let the hook do the work if it's going to; also call the handler directly
    // in case the hook doesn't fire.  _handleOpposedChatCommand is idempotent
    // (it only opens the dialog, which is a GM-owned user action).
    if (_handleOpposedChatCommand(val)) {
      e.preventDefault();
      e.stopPropagation();
      _textarea.value = "";
    }
  }, true);  // capture phase — beats the system's own Enter handler
});

// ── Shared Combat HUD toggle logic ───────────────────────────────────────────
function _combatHudToggle() {
  const combatHud = game.sta2eToolkit?.combatHud;
  if (!combatHud) return;
  const token = canvas.tokens?.controlled[0];
  if (combatHud._el?.style.display !== "none" && combatHud._token) {
    combatHud.forceClose();
  } else if (token?.actor) {
    combatHud.open(token);
  } else {
    ui.notifications.warn(game.i18n.localize("STA2E.Notifications.SelectTokenFirst"));
  }
}

// ── Shared NPC Roller launcher ────────────────────────────────────────────────
async function _npcRollerLaunch() {
  // 1. If a token is selected and is a starship — open directly
  const controlled = canvas.tokens?.controlled[0];
  if (controlled?.actor?.system?.systems !== undefined) {
    openNpcRoller(controlled.actor, controlled);
    return;
  }

  // 2. Show a picker of ALL starship actors in the world directory
  const shipActors = game.actors.filter(a => a.system?.systems !== undefined);

  if (!shipActors.length) {
    ui.notifications.warn(game.i18n.localize("STA2E.Notifications.NoShipActors"));
    return;
  }

  let pickedActorId = shipActors[0].id;

  const options = shipActors
    .map(a => `<option value="${a.id}">${a.name}</option>`)
    .join("");

  const content = `
    <div style='padding:8px 0'>
      <label style='display:block;margin-bottom:6px;font-weight:bold;'>Select NPC Ship</label>
      <select id='sta2e-npc-actor-pick' style='width:100%;padding:4px;'>
        ${options}
      </select>
    </div>`;

  setTimeout(() => {
    const sel = document.getElementById("sta2e-npc-actor-pick");
    if (sel) {
      pickedActorId = sel.value;
      sel.addEventListener("change", e => { pickedActorId = e.target.value; });
    }
  }, 50);

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: "NPC Ship Dice Roller" },
    content,
    buttons: [
      { action: "open", label: "Open Roller", icon: "fas fa-dice-d20", default: true },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
  });

  if (result !== "open") return;

  const actor = game.actors.get(pickedActorId);
  if (!actor) return;

  const sceneToken = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id) ?? null;
  openNpcRoller(actor, sceneToken);
}

// ── Scene Controls — single toggle button for the floating toolkit widget ─────
// One button in the token controls toggles the floating ToolkitWidget.
// v13: icon must be a FontAwesome class string.

Hooks.on("getSceneControlButtons", (controls) => {
  const tokenGroup = controls.tokens;
  if (!tokenGroup?.tools) return;

  tokenGroup.tools.sta2eWidget = {
    name:    "sta2eWidget",
    title:   game.i18n.localize("STA2E.SceneControl.Sta2eWidget.Title"),
    icon:    "fas fa-star-of-life",   // FA fallback — hidden via CSS, SVG shown via ::after
    button:  true,
    visible: true,
    order:   Object.keys(tokenGroup.tools).length,
    onChange: () => game.sta2eToolkit?.toolkitWidget?.toggle(),
  };

});

// Swap the FA placeholder for our SVG after the toolbar renders.
// Also logs all [data-tool] elements so we can confirm the selector in v13.
Hooks.on("renderSceneControls", () => {
  // ── Toolkit widget button — swap FA icon for SVG ───────────────────────
  const btn = document.querySelector('[data-tool="sta2eWidget"]');
  if (!btn) { console.warn("STA2e | sta2eWidget button not found in DOM"); return; }

  btn.classList.remove("fas", "fa-star-of-life");
  btn.style.backgroundImage    = 'url("modules/sta2e-toolkit/assets/toolkit-icon.svg")';
  btn.style.backgroundSize     = "contain";
  btn.style.backgroundRepeat   = "no-repeat";
  btn.style.backgroundPosition = "center";
  btn.style.filter             = "drop-shadow(0 0 2px rgba(0,0,0,0.5))";

});

Hooks.on("updateChatMessage", (message, changed) => {
  const toolkitFlags = changed?.flags?.["sta2e-toolkit"];
  if (!toolkitFlags) return;
  applyShipCardAccessToDom(message.id, message.flags?.["sta2e-toolkit"] ?? {});
  applyShipCardLockToDom(message.id, message.flags?.["sta2e-toolkit"] ?? {});
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  const flags = message.flags?.["sta2e-toolkit"] ?? {};
  applyShipCardAccessToHtml(html, flags);
  applyShipCardLockToHtml(html, flags);
  applyShipCardAccessToDom(message.id, flags);
  applyShipCardLockToDom(message.id, flags);
  // Wire hazard avoidance card buttons (Avoided / Take Damage)
  ZoneHazard.wireAvoidanceCard(message, html);
  // Wire terrain hazard card buttons (Spend / Add Threat / Skip)
  ZoneHazard.wireTerrainCard(message, html);
  // Wire opposed-task card buttons (Defender / Attacker)
  wireOpposedTaskCard(message, html);
});

// ---------------------------------------------------------------------------
// ready — build systems, expose API, render HUD
// ---------------------------------------------------------------------------

Hooks.once("ready", async () => {
  console.log("STA 2e Toolkit | Ready");

  const campaignStore   = new CampaignStore();
  const hud             = new StardateHUD();
  const dateEditor      = new DateEditor();
  const campaignManager = new CampaignManager();
  const alertHud        = new AlertHUD();
  const combatHud       = new CombatHUD();
  const toolkitWidget   = new ToolkitWidget();

  game.sta2eToolkit = new ToolkitAPI({ campaignStore, hud, dateEditor, campaignManager });
  game.sta2eToolkit.openWarpCalc    = openWarpCalc;
  game.sta2eToolkit.alertHud        = alertHud;
  game.sta2eToolkit.combatHud       = combatHud;

  // Exposed so the GM-as-defender path in combat-hud.js can call this directly.
  // game.socket.emit does not loop back to the sender, so when the GM confirms
  // a defense roll we call this function directly instead of going via socket.
  game.sta2eToolkit.resolveDefenderRoll = async (successes) => {
    let pending;
    try { pending = game.settings.get("sta2e-toolkit", "pendingOpposedTask"); } catch(e) { return; }
    if (!pending) {
      console.warn("STA2e Toolkit | resolveDefenderRoll: no pending opposed task");
      return;
    }
    try { await game.settings.set("sta2e-toolkit", "pendingOpposedTask", null); } catch(e) {}

    const clampedSuccesses = Math.max(0, successes);

    // Determine the defense type — ground uses defenseType, ship uses defMode
    const defType = pending.defenseType ?? pending.defMode ?? null;

    // Ground combat adds guard and prone penalties on top of the defender's successes.
    // Ship combat uses overridePenalty (+1 for Override actions). Neither applies to the other.
    const guardPenalty = pending.guardPenalty ?? 0;
    const pronePenalty = pending.pronePenalty ?? 0;
    const difficulty = pending.overridePenalty
      ? clampedSuccesses + 1                               // ship override: +1 on top
      : clampedSuccesses + guardPenalty + pronePenalty;    // ground: add situational penalties

    // Build the taskContext string now that defender's actual successes are known
    let taskContext;
    if (defType === "melee") {
      const prone  = pending.targetIsProne ? " · Prone +2 Momentum" : "";
      const guard  = guardPenalty ? " +1 Guard" : "";
      taskContext = `Melee — Opposed Task (defender: ${clampedSuccesses} success${clampedSuccesses !== 1 ? "es" : ""}${guard}${prone})`;
    } else if (defType === "cover") {
      const guard  = guardPenalty ? " +1 Guard" : "";
      const prone  = pronePenalty ? ` +${pronePenalty} Prone Difficulty` : "";
      const proInC = pending.targetIsProneInCover ? " · +1 Protection" : "";
      taskContext = `Ranged vs Cover — Opposed Task (defender: ${clampedSuccesses} success${clampedSuccesses !== 1 ? "es" : ""}${guard}${prone}${proInC})`;
    } else {
      // Ship combat — use whatever context was stored in rollerOpts
      taskContext = pending.rollerOpts?.taskContext ?? null;
    }

    const finalRollerOpts = {
      ...pending.rollerOpts,
      opposedDifficulty:  difficulty,
      opposedDefenseType: defType,
      defenderSuccesses:  clampedSuccesses,
      difficulty:         null,   // opposed tasks always use opposedDifficulty
      taskContext,
    };

    if (pending.attackerUserId === game.userId) {
      const attackerToken = canvas.tokens?.get(pending.attackerTokenId);
      const attackerActor = game.actors?.get(pending.attackerActorId) ?? attackerToken?.actor;
      if (!attackerActor) return;
      // Ground NPCs use openPlayerRoller (groundIsNpc flag controls Threat/Momentum).
      // Ship NPCs use openNpcRoller. isNpcAttacker is only true for ship NPCs.
      if (pending.isNpcAttacker) openNpcRoller(attackerActor, attackerToken ?? null, finalRollerOpts);
      else                       openPlayerRoller(attackerActor, attackerToken ?? null, finalRollerOpts);
    } else {
      game.socket.emit("module.sta2e-toolkit", {
        action:          "openAttackerRoller",
        targetUserId:    pending.attackerUserId,
        attackerTokenId: pending.attackerTokenId,
        attackerActorId: pending.attackerActorId,
        isNpcAttacker:   pending.isNpcAttacker,
        rollerOpts:      finalRollerOpts,
      });
    }
  };
  game.sta2eToolkit.CombatHUD                = CombatHUD;                 // class ref for static methods
  game.sta2eToolkit.checkOpposedTaskForTokens = checkOpposedTaskForTokens; // standalone opposed-task check (used by npc-roller side-panel path)
  game.sta2eToolkit.EffectConfigMenu = EffectConfigMenu; // class ref for external access
  game.sta2eToolkit.openTransporter = openTransporter;
  game.sta2eToolkit.toolkitWidget   = toolkitWidget;
  // Expose NPC roller launcher so the widget button can call it
  game.sta2eToolkit.launchNpcRoller = _npcRollerLaunch;

  // Expose Opposed Task entry points
  game.sta2eToolkit.openOpposedTaskSetup = openOpposedTaskSetup;
  game.sta2eToolkit.startOpposedTask     = startOpposedTask;

  // Expose zone system helpers for macros
  game.sta2eToolkit.ZoneHazard = ZoneHazard;

  // Zone toolbar has no canvas dependency — create it now so it is always available.
  // (canvasReady can fire before game.sta2eToolkit is set, so we cannot rely on it.)
  if (game.user.isGM) {
    game.sta2eToolkit.zoneToolbar = new ZoneToolbar();
    game.sta2eToolkit.zoneMonitor = new ZoneMonitor();
  }

  // Zone overlay + editor depend on the canvas, but canvasReady can fire before
  // game.sta2eToolkit is assigned. If the canvas is already ready when this hook
  // runs (the normal case on first load), initialize them now. canvasReady will
  // reinitialize them on scene changes.
  if (canvas?.ready) {
    try {
      console.log("STA2e | ready: canvas is ready, initializing zone system...");
      const overlay = new ZoneOverlay();
      console.log("STA2e | ready: ZoneOverlay created:", overlay);
      game.sta2eToolkit.zoneOverlay = overlay;
      overlay.draw();
      console.log("STA2e | ready: overlay.draw() done, creating ZoneEditState...");
      game.sta2eToolkit.zoneEditor = new ZoneEditState(overlay);
      console.log("STA2e | ready: ZoneEditState created:", game.sta2eToolkit.zoneEditor);
      game.sta2eToolkit.zoneDragRuler   = new ZoneDragRuler();
      game.sta2eToolkit.zoneMovementLog = new ZoneMovementLog();
    } catch (err) {
      console.error("STA2e | Zone system init in ready hook FAILED:", err);
    }
  } else {
    console.log("STA2e | ready: canvas not ready, zone system will init on canvasReady");
  }

  // Apply character sheet theme + expose refresh handle for settings onChange
  _applySheetTheme();
  game.sta2eToolkit.refreshSheetTheme = _applySheetTheme;

  // Re-apply sheet theme whenever the GM switches HUD theme
  Hooks.on("updateSetting", (setting) => {
    if (setting.key === "sta2e-toolkit.hudTheme") _applySheetTheme();

    // Auto-save pool values to the active campaign whenever the STA tracker changes.
    // This keeps savedMomentum/savedThreat current so that switching campaigns
    // (via scene pin or switchCampaign) restores the right values.
    if ((setting.key === "sta.momentum" || setting.key === "sta.threat") && _canWriteWorldSettings()) {
      game.sta2eToolkit?.campaignStore?.syncPoolsFromTracker?.();
    }
  });

  // Register condition auto-clear hooks
  registerConditionHooks();

  // Register elevation ruler — hover distance label
  registerElevationRuler();

  if (!window.__sta2ePlayerShipCardDelegates) {
    window.__sta2ePlayerShipCardDelegates = true;
    document.addEventListener("click", async (event) => {
      if (game.user.isGM) return;

      const impulseBtn = event.target.closest?.(".sta2e-impulse-engage");
      if (impulseBtn && !impulseBtn.disabled) {
        event.preventDefault();
        event.stopPropagation();
        let payload;
        try { payload = JSON.parse(decodeURIComponent(impulseBtn.dataset.payload ?? "{}")); }
        catch { payload = {}; }
        const impulseMessageId = impulseBtn.closest("[data-message-id]")?.dataset.messageId ?? null;
        const impulseMessage = impulseMessageId ? game.messages.get(impulseMessageId) : null;
        if (impulseMessage?.flags?.["sta2e-toolkit"]?.impulseEngageConsumed) {
          applyShipCardLockToDom(impulseMessageId, impulseMessage.flags["sta2e-toolkit"]);
          return;
        }
        if (!getShipCardUserAccess(impulseMessage, payload).canUse) return;

        impulseBtn.disabled = true;
        impulseBtn.textContent = "🔴 ENGAGING...";
        impulseBtn.style.opacity = "0.7";

        const destination = await promptShipCardDestination({
          overlayId: "sta2e-impulse-overlay",
          title: "IMPULSE DESTINATION",
          color: "#ff3300",
          tokenId: payload.tokenId,
          actorId: payload.actorId,
          maxZones: 2,
        });

        if (!destination) {
          impulseBtn.disabled = false;
          impulseBtn.textContent = "🔴 ENGAGE IMPULSE";
          impulseBtn.style.opacity = "1";
          ui.notifications.info("STA2e Toolkit: Impulse aborted.");
          return;
        }

        game.socket.emit("module.sta2e-toolkit", {
          action: "runImpulseEngageCard",
          messageId: impulseMessageId,
          requesterUserId: game.user.id,
          payload,
          destination,
        });
        if (impulseMessageId) {
          game.socket.emit("module.sta2e-toolkit", {
            action: "updateShipCardLock",
            messageId: impulseMessageId,
            requesterUserId: game.user.id,
            updates: { impulseEngageConsumed: true },
          });
        }
        impulseBtn.textContent = "✓ ENGAGED";
        impulseBtn.style.opacity = "0.5";
        return;
      }

      const warpBtn = event.target.closest?.(".sta2e-warp-engage");
      if (warpBtn && !warpBtn.disabled) {
        event.preventDefault();
        event.stopPropagation();
        let payload;
        try { payload = JSON.parse(decodeURIComponent(warpBtn.dataset.payload ?? "{}")); }
        catch { payload = {}; }
        const warpMessageId = warpBtn.closest("[data-message-id]")?.dataset.messageId ?? null;
        const warpMessage = warpMessageId ? game.messages.get(warpMessageId) : null;
        if (warpMessage?.flags?.["sta2e-toolkit"]?.warpEngageConsumedAction) {
          applyShipCardLockToDom(warpMessageId, warpMessage.flags["sta2e-toolkit"]);
          return;
        }
        if (!getShipCardUserAccess(warpMessage, payload).canUse) return;

        warpBtn.disabled = true;
        warpBtn.textContent = "⚡ ENGAGING...";
        warpBtn.style.opacity = "0.7";

        const warpActor = game.actors.get(payload.actorId);
        const warpMaxZones = warpActor?.system?.systems?.engines?.value ?? null;
        const destination = await promptShipCardDestination({
          overlayId: "sta2e-warp-overlay",
          title: "WARP DESTINATION",
          color: "#00a6fb",
          tokenId: payload.tokenId,
          actorId: payload.actorId,
          maxZones: warpMaxZones,
        });

        if (!destination) {
          warpBtn.disabled = false;
          warpBtn.textContent = "⚡ ENGAGE";
          warpBtn.style.opacity = "1";
          ui.notifications.info("STA2e Toolkit: Warp sequence aborted.");
          return;
        }

        game.socket.emit("module.sta2e-toolkit", {
          action: "runWarpEngageCard",
          messageId: warpMessageId,
          requesterUserId: game.user.id,
          payload,
          destination,
        });
        if (warpMessageId) {
          game.socket.emit("module.sta2e-toolkit", {
            action: "updateShipCardLock",
            messageId: warpMessageId,
            requesterUserId: game.user.id,
            updates: { warpEngageConsumedAction: "engage" },
          });
        }
        warpBtn.textContent = "✓ ENGAGED";
        warpBtn.style.opacity = "0.5";
        return;
      }

      const fleeBtn = event.target.closest?.(".sta2e-warp-flee");
      if (fleeBtn && !fleeBtn.disabled) {
        event.preventDefault();
        event.stopPropagation();
        let payload;
        try { payload = JSON.parse(decodeURIComponent(fleeBtn.dataset.payload ?? "{}")); }
        catch { payload = {}; }
        const fleeMessageId = fleeBtn.closest("[data-message-id]")?.dataset.messageId ?? null;
        const fleeMessage = fleeMessageId ? game.messages.get(fleeMessageId) : null;
        if (fleeMessage?.flags?.["sta2e-toolkit"]?.warpEngageConsumedAction) {
          applyShipCardLockToDom(fleeMessageId, fleeMessage.flags["sta2e-toolkit"]);
          return;
        }
        if (!getShipCardUserAccess(fleeMessage, payload).canUse) return;

        fleeBtn.closest(".message-content")
          ?.querySelectorAll(".sta2e-warp-engage, .sta2e-warp-flee")
          .forEach(btn => { btn.disabled = true; btn.style.opacity = "0.5"; });
        fleeBtn.textContent = "🚀 FLEEING...";

        game.socket.emit("module.sta2e-toolkit", {
          action: "runWarpFleeCard",
          messageId: fleeMessageId,
          requesterUserId: game.user.id,
          payload,
        });
        if (fleeMessageId) {
          game.socket.emit("module.sta2e-toolkit", {
            action: "updateShipCardLock",
            messageId: fleeMessageId,
            requesterUserId: game.user.id,
            updates: { warpEngageConsumedAction: "flee" },
          });
        }
      }
    });
  }

  // Socket — listen for GM broadcast requesting all clients to re-render the HUD.
  // "world" scope settings onChange only fires on the GM's client, so whenever
  // the GM changes time, campaign data, or theme we emit this to sync players.
  game.socket.on("module.sta2e-toolkit", async (msg) => {
    if (!msg?.action) return;

    if (msg.action === "renderHUD") {
      game.sta2eToolkit?.hud?.render();
      game.sta2eToolkit?.alertHud?._refreshTheme();
      game.sta2eToolkit?.combatHud?._refresh?.();
      _applySheetTheme();   // re-inject sheet CSS on every client when theme changes
    }

    else if (msg.action === "setAlert" && msg.condition) {
      // Broadcast from a GM — update UI on all receiving clients.
      // Only GMs can write world-scoped settings; players just update their local UI.
      const prev = game.sta2eToolkit?.alertHud?.condition ?? "green";
      if (game.user.isGM) {
        await game.settings.set("sta2e-toolkit", "alertCondition", msg.condition);
      }
      game.sta2eToolkit?.alertHud?._onConditionChanged(prev, msg.condition);
    }

    else if (msg.action === "requestSetAlert" && msg.condition && game.user.isGM) {
      // Player requested an alert change — GM validates permission, writes, rebroadcasts.
      const allowed = game.settings.get("sta2e-toolkit", "playersCanSetAlert") ?? false;
      if (!allowed) return;
      const prev = game.sta2eToolkit?.alertHud?.condition ?? "green";
      await game.settings.set("sta2e-toolkit", "alertCondition", msg.condition);
      game.socket.emit("module.sta2e-toolkit", { action: "setAlert", condition: msg.condition });
      game.sta2eToolkit?.alertHud?._onConditionChanged(prev, msg.condition);
    }

    else if (msg.action === "applyGroundInjury" && game.user.isGM) {
      const { actorId, tokenId, injuryName, quantity, stressUpdate } = msg;
      const actor = canvas.tokens.get(tokenId)?.actor ?? game.actors.get(actorId);
      if (!actor) return;
      if (stressUpdate !== undefined) {
        await actor.update({ "system.stress.value": stressUpdate });
      }
      if (injuryName) {
        await actor.createEmbeddedDocuments("Item", [{
          name:   injuryName,
          type:   "injury",
          system: { description: "", quantity: quantity ?? 1 },
        }]);
      }
    }

    else if (msg.action === "resolveInjuryDecision" && game.user.isGM) {
      await CombatHUD._executeInjuryResolution(msg.choice, msg.payload, msg.messageId);
    }

    else if (msg.action === "applyAssistToTaskCard" && game.user.isGM) {
      // A non-author player asked the GM to update a chat message they don't own.
      const { messageId, newContent, newRollData, newFlag } = msg;
      if (!messageId || !newContent) return;
      const m = game.messages.get(messageId);
      if (!m) {
        console.warn(`STA2e Toolkit | applyAssistToTaskCard: message ${messageId} not found`);
        return;
      }
      const upd = { content: newContent };
      if (newRollData) upd["flags.sta2e-toolkit.rollData"] = newRollData;
      if (newFlag)     upd[`flags.sta2e-toolkit.${newFlag.key}`] = newFlag.value;
      await m.update(upd).catch(e =>
        console.error("STA2e Toolkit | applyAssistToTaskCard update failed:", e));
    }

    else if (msg.action === "applyScanForWeakness" && game.user.isGM) {
      // Player confirmed a Scan for Weakness roll — apply conditions/flags to the target token.
      const { sourceTokenId, targetTokenId, sourceName } = msg;
      const sourceToken = canvas.tokens.get(sourceTokenId);
      const targetToken = canvas.tokens.get(targetTokenId);
      if (!targetToken) return;
      // Runs the GM branch of applyScanForWeakness; returned card HTML is discarded
      // (the player already created the ChatMessage on their client)
      await applyScanForWeakness(sourceToken, targetToken, sourceName);
    }

    else if (msg.action === "runImpulseEngageCard" && game.user.isGM) {
      const message = msg.messageId ? game.messages.get(msg.messageId) : null;
      if (!getShipCardUserAccess(message, msg.payload, msg.requesterUserId).canUse) return;
      const _impTok = canvas?.tokens?.get(msg.payload?.tokenId)
        ?? (msg.payload?.actorId ? canvas?.tokens?.placeables?.find(t => t.actor?.id === msg.payload.actorId) : null);
      if (_impTok) _impTok.document.setFlag("sta2e-toolkit", "_impulseActive", true).catch(() => {});
      await runImpulseEngageCard(msg.payload, msg.destination);
    }

    else if (msg.action === "runWarpEngageCard" && game.user.isGM) {
      const message = msg.messageId ? game.messages.get(msg.messageId) : null;
      if (!getShipCardUserAccess(message, msg.payload, msg.requesterUserId).canUse) return;
      const _warpTok = canvas?.tokens?.get(msg.payload?.tokenId)
        ?? (msg.payload?.actorId ? canvas?.tokens?.placeables?.find(t => t.actor?.id === msg.payload.actorId) : null);
      if (_warpTok) _warpTok.document.setFlag("sta2e-toolkit", "_warpActive", true).catch(() => {});
      await runWarpEngageCard(msg.payload, msg.destination);
    }

    else if (msg.action === "runWarpFleeCard" && game.user.isGM) {
      const message = msg.messageId ? game.messages.get(msg.messageId) : null;
      if (!getShipCardUserAccess(message, msg.payload, msg.requesterUserId).canUse) return;
      await runWarpFleeCard(msg.payload);
    }

    else if (msg.action === "updateShipCardLock" && game.user.isGM) {
      const { messageId, updates } = msg;
      if (!messageId || !updates) return;
      const m = game.messages.get(messageId);
      if (!m) return;
      if (!getShipCardUserAccess(m, {}, msg.requesterUserId).canUse) return;

      const payload = {};
      for (const [key, value] of Object.entries(updates)) {
        payload[`flags.sta2e-toolkit.${key}`] = value;
      }
      await m.update(payload).catch(err =>
        console.error("STA2e Toolkit | updateShipCardLock failed:", err));
    }

    else if (msg.action === "zonesUpdated") {
      game.sta2eToolkit?.zoneOverlay?.refresh();
      game.sta2eToolkit?.zoneVisibility?.refresh();
      game.sta2eToolkit?.zoneMonitor?._debouncedRefresh();
    }

    else if (msg.action === "zoneMovementPayment" && game.user.isGM) {
      game.sta2eToolkit?.zoneMovementLog?.processPayment(msg.messageId, msg.payment, msg.isNpc, msg.cost);
    }

    else if (msg.action === "adjustThreatFromRoll" && game.user.isGM) {
      const { delta } = msg;
      if (!delta || typeof delta !== "number") return;
      try {
        const updated = await _adjustStaTrackerPoolValue("threat", delta);
        if (!updated) console.warn("STA2e Toolkit | adjustThreatFromRoll ignored: no connected GM can write STA threat.");
      } catch(e) {
        console.error("STA2e Toolkit | adjustThreatFromRoll failed:", e);
      }
    }

    // ── Opposed Task (social/skill) — a non-GM player finished their roll ───
    // Only the GM can update the chat card's flags, so players forward results
    // over the socket and we apply them here.
    else if (msg.action === "opposedTaskRollComplete" && game.user.isGM) {
      try {
        await applyOpposedRollResult({
          messageId:     msg.messageId,
          taskId:        msg.taskId,
          side:          msg.side,
          successes:     msg.successes,
          complications: msg.complications,
        });
      } catch (e) {
        console.error("STA2e Toolkit | applyOpposedRollResult via socket failed:", e);
      }
    }

    // ── Defender (player) confirmed their roll — relay to resolveDefenderRoll ──
    // Only fires on the GM's client when a player is the defender.
    // (When the GM is the defender, combat-hud.js calls resolveDefenderRoll directly.)
    else if (msg.action === "defenderRollComplete" && game.user.isGM) {
      const { successes } = msg;
      if (typeof successes !== "number") return;
      await game.sta2eToolkit?.resolveDefenderRoll?.(successes);
    }

    // ── Open the attacker's roller on their specific client ──────────────────
    // Handles the case where the attacker is a player (not the GM).
    // Not GM-gated — every client checks whether they are the intended target.
    else if (msg.action === "openAttackerRoller") {
      if (msg.targetUserId !== game.userId) return;

      const attackerToken = canvas.tokens?.get(msg.attackerTokenId);
      const attackerActor = game.actors?.get(msg.attackerActorId) ?? attackerToken?.actor;
      if (!attackerActor) {
        console.warn("STA2e Toolkit | openAttackerRoller: attacker actor not found", msg.attackerActorId);
        return;
      }

      if (msg.isNpcAttacker) {
        openNpcRoller(attackerActor, attackerToken ?? null, msg.rollerOpts);
      } else {
        openPlayerRoller(attackerActor, attackerToken ?? null, msg.rollerOpts);
      }
    }
  });

  // Seed default campaign for new worlds
  if (game.user.isGM && campaignStore.getCampaigns().length === 0) {
    await campaignStore.addCampaign({
      name: "USS Navajo",
      era: "tng",
      stardate: 49523.7,
      calendarDate: "2372-03-14",
      time: { hours: 8, minutes: 0 }
    });
    ui.notifications.info("STA 2e Toolkit: Default campaign created. Open ⚙ to configure.");
  }

  await hud.render();
  alertHud.render();
});

// ---------------------------------------------------------------------------
// Settings change hooks
// ---------------------------------------------------------------------------

// Live-update alert sound volume when the user adjusts the slider
Hooks.on("settingChanged", (namespace, key, value) => {
  if (namespace === "sta2e-toolkit" && key === "alertVolume") {
    game.sta2eToolkit?.alertHud?.updateVolume();
  }
});

function _hasExplicitOwnerPermission(document, userId) {
  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const explicit = document?.ownership?.[userId];
  return Number(explicit) >= ownerLevel;
}

function _tokenMatchesPrimaryActor(token, primaryActor) {
  if (!token || !primaryActor) return false;
  const actor = token.actor ?? token.document?.actor ?? null;
  return actor?.id === primaryActor.id
    || actor?.uuid === primaryActor.uuid
    || token.document?.actorId === primaryActor.id;
}

function _findExplicitlyOwnedSceneToken() {
  const tokens = canvas.tokens?.placeables ?? [];
  const userId = game.user.id;
  const primaryActor = game.user.character ?? null;

  const explicitlyOwned = tokens.filter(token =>
    _hasExplicitOwnerPermission(token.document, userId)
    || _hasExplicitOwnerPermission(token.actor, userId)
  );

  return explicitlyOwned.find(token => _tokenMatchesPrimaryActor(token, primaryActor))
    ?? explicitlyOwned[0]
    ?? tokens.find(token => _tokenMatchesPrimaryActor(token, primaryActor))
    ?? null;
}

function _schedulePrimaryCharacterSelection() {
  if (game.user.isGM) return;
  if (!canvas?.ready) return;
  if (!game.settings.get("sta2e-toolkit", "forcePrimaryCharacterSelection")) return;

  setTimeout(() => {
    if (!canvas?.ready || game.user.isGM) return;
    if (!game.settings.get("sta2e-toolkit", "forcePrimaryCharacterSelection")) return;

    const token = _findExplicitlyOwnedSceneToken();
    if (!token) return;

    token.control({ releaseOthers: true });
  }, 250);
}

// ---------------------------------------------------------------------------
// canvasReady — fires for ALL users when the active scene changes.
// If the new scene has a pinned campaign, make it the world active campaign.
// Scenes without a pin leave the current active campaign unchanged —
// so the last-used campaign sticks until a pinned scene overrides it.
// Only the GM writes the setting; players just re-render.
// ---------------------------------------------------------------------------

Hooks.on("canvasReady", async () => {
  const toolkit = game.sta2eToolkit;
  console.log("STA2e | canvasReady fired — toolkit:", toolkit);
  if (!toolkit) return;

  // ── Zone toolbar — create once, persists across scene changes ───────────
  if (!toolkit.zoneToolbar && game.user.isGM) {
    toolkit.zoneToolbar = new ZoneToolbar();
  }
  // Close toolbar on scene change so the user starts fresh
  if (toolkit.zoneToolbar?.isOpen) toolkit.zoneToolbar.close();

  // ── Zone overlay — init / refresh on scene change ───────────────────────
  // Must run before any early returns so zones are always available.
  try {
    toolkit.zoneOverlay?.destroy();
    const overlay = new ZoneOverlay();
    toolkit.zoneOverlay = overlay;
    overlay.draw();
    // If there was an existing editor, reconnect it; otherwise create one
    if (toolkit.zoneEditor) {
      toolkit.zoneEditor.overlay = overlay;
      toolkit.zoneEditor.setTool(null);
    } else {
      toolkit.zoneEditor = new ZoneEditState(overlay);
    }
    console.log("STA2e | canvasReady — zoneOverlay:", toolkit.zoneOverlay, "zoneEditor:", toolkit.zoneEditor);
  } catch (err) {
    console.warn("STA2e Toolkit | Zone overlay init error:", err);
  }

  // ── Zone drag ruler — recreate on scene change ──────────────────────────
  try {
    toolkit.zoneDragRuler?.destroy();
    toolkit.zoneDragRuler = new ZoneDragRuler();
  } catch (err) {
    console.warn("STA2e Toolkit | Zone drag ruler init error:", err);
  }

  // ── Zone movement log — recreate on scene change ────────────────────────
  try {
    toolkit.zoneMovementLog?.destroy();
    toolkit.zoneMovementLog = new ZoneMovementLog();
  } catch (err) {
    console.warn("STA2e Toolkit | Zone movement log init error:", err);
  }

  // ── Zone visibility — hide tokens in obscured zones for non-same-zone players ─
  try {
    toolkit.zoneVisibility?.destroy();
    toolkit.zoneVisibility = new ZoneVisibility();
    toolkit.zoneVisibility.refresh();
  } catch (err) {
    console.warn("STA2e Toolkit | Zone visibility init error:", err);
  }

  // Refresh zone monitor for new scene
  toolkit.zoneMonitor?._debouncedRefresh();

  _schedulePrimaryCharacterSelection();

  if (game.user.isGM) {
    const pinnedId = canvas?.scene?.getFlag("sta2e-toolkit", "campaignOverride") ?? null;
    if (pinnedId) {
      const campaign = toolkit.campaignStore.getCampaignById(pinnedId);
      if (campaign) {
        // Save + switch happen immediately; pool restore is deferred by one tick
        // so the STA system's own canvasReady hooks finish before we write to
        // sta.momentum / sta.threat (avoids the STA tracker overwriting us).
        await toolkit.campaignStore.setActiveCampaign(pinnedId, { deferRestore: true });
        // HUD re-render is triggered by setActiveCampaign → no extra call needed
        return;
      }
    }
  }

  // No pin on this scene (or player client) — re-render with current active.
  // On the GM client, also restore the active campaign's saved pools so the
  // tracker reflects wherever that campaign left off.
  if (game.user.isGM) {
    const activeId = toolkit.campaignStore.getActiveCampaignId();
    if (activeId) await toolkit.campaignStore._silentRestorePools(activeId);
  }
  toolkit.hud?.render();

  // Restore persistent breach FX for any breach-flagged ships on this scene.
  // State is stored on the token document (not the actor) so each wildcard
  // instance is independent.
  setTimeout(() => {
    if (!window.Sequencer) return;
    for (const token of canvas.tokens?.placeables ?? []) {
      const breachFlag = token.document?.getFlag("sta2e-toolkit", "warpBreachImminent");
      if (breachFlag === true) {
        CombatHUD._startBreachTrailFX(token);
      }
    }
  }, 1500);
});

// ---------------------------------------------------------------------------
// isZonesEnabled — checks both the global master switch and per-scene flag.
// Zone overlay rendering and zone-aware ruler/drag use this gate.
// ---------------------------------------------------------------------------

export function isZonesEnabled(scene = canvas?.scene) {
  const globalOn = game.settings.get("sta2e-toolkit", "showZoneBorders");
  if (!globalOn) return false;
  // If the scene has an explicit per-scene flag, honour it; default = true
  const perScene = scene?.getFlag("sta2e-toolkit", "zonesEnabled");
  return perScene !== false; // undefined (not set) treated as enabled
}

// ---------------------------------------------------------------------------
// renderSceneConfig — inject "STA2e Zones" section into scene config.
// ---------------------------------------------------------------------------

Hooks.on("renderSceneConfig", (app, html) => {
  if (!game.user.isGM) return;

  // In v13 ApplicationV2 the hook receives (app, HTMLElement, data).
  // Normalise: if html is an array-like (jQuery / old API) unwrap it.
  const root = html instanceof HTMLElement ? html : (html[0] ?? html);

  // Guard: only inject once (hook can fire multiple times on re-render).
  if (root.querySelector(".sta2e-zones-fieldset")) return;

  const scene = app.document ?? app.object;
  if (!scene) return;

  const zonesEnabled  = scene.getFlag("sta2e-toolkit", "zonesEnabled")      ?? true;
  const showLabels    = scene.getFlag("sta2e-toolkit", "zoneShowLabels")    ?? true;
  const showFill      = scene.getFlag("sta2e-toolkit", "zonePlayShowFill")  ?? false;
  const hideBorders   = scene.getFlag("sta2e-toolkit", "zoneHideBorders")   ?? false;
  const defaultColor  = scene.getFlag("sta2e-toolkit", "zoneDefaultColor")  ?? scene.getFlag("sta2e-toolkit", "zonePlayBorderColor") ?? "";
  const movementLog   = scene.getFlag("sta2e-toolkit", "zoneMovementLog")   ?? false;

  const section = document.createElement("fieldset");
  section.className = "sta2e-zones-fieldset";
  section.innerHTML = `
    <legend>STA2e Zones</legend>
    <div class="form-group">
      <label>Enable Zones on this Scene</label>
      <input type="checkbox" name="sta2e-zones-enabled" ${zonesEnabled ? "checked" : ""}/>
      <p class="notes">Show zone overlay and enable zone-aware ruler and drag ruler on this scene.</p>
    </div>
    <div class="form-group">
      <label>Default Zone Color</label>
      <div class="form-fields">
        <input type="color" name="sta2e-zones-default-color" value="${defaultColor || "#4488ff"}" style="width:50px;height:28px;padding:1px;cursor:pointer;"/>
        <input type="text"  name="sta2e-zones-default-color-text" value="${defaultColor}" placeholder="#4488ff" style="flex:1;" maxlength="9"/>
        <button type="button" id="sta2e-zones-default-clear" style="width:auto;padding:2px 8px;" title="Reset to built-in default (#4488ff)">↺ Reset</button>
      </div>
      <p class="notes">Color used for all zones that have no custom color set. Individual zones can override this in the Zone Editor.</p>
    </div>
    <div class="form-group">
      <label>Show Zone Fill During Play</label>
      <input type="checkbox" name="sta2e-zones-show-fill" ${showFill ? "checked" : ""}/>
      <p class="notes">When off (default), only border lines are visible during play. Enable to show each zone's fill color.</p>
    </div>
    <div class="form-group">
      <label>Hide Zone Borders During Play</label>
      <input type="checkbox" name="sta2e-zones-hide-borders" ${hideBorders ? "checked" : ""}/>
      <p class="notes">Hide all zone border lines during play on this scene. Zones remain active for mechanics.</p>
    </div>
    <div class="form-group">
      <label>Show Zone Labels</label>
      <input type="checkbox" name="sta2e-zones-show-labels" ${showLabels ? "checked" : ""}/>
      <p class="notes">Show zone name labels during play on this scene.</p>
    </div>
    <div class="form-group">
      <label>Zone Movement Log</label>
      <input type="checkbox" name="sta2e-zones-movement-log" ${movementLog ? "checked" : ""}/>
      <p class="notes">Post a chat message when a token moves between zones on this scene.</p>
    </div>
    <div class="form-group">
      <label>Zone Editor</label>
      <button type="button" id="sta2e-open-zone-editor" style="width:auto;padding:2px 10px;">
        <i class="fas fa-vector-square"></i> Open Zone Editor
      </button>
      <p class="notes">Open the Zone Editor toolbar (Shift+Z).</p>
    </div>`;

  section.querySelector("#sta2e-open-zone-editor")?.addEventListener("click", () => {
    game.sta2eToolkit?.zoneToolbar?.toggle();
  });

  // ── Default color picker ↔ text sync ─────────────────────────────────────
  const colorPicker = section.querySelector("[name='sta2e-zones-default-color']");
  const colorText   = section.querySelector("[name='sta2e-zones-default-color-text']");
  const colorClear  = section.querySelector("#sta2e-zones-default-clear");
  if (colorPicker && colorText) {
    colorPicker.addEventListener("input", () => { colorText.value = colorPicker.value; });
    colorText.addEventListener("change", () => {
      const v = colorText.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) colorPicker.value = v;
    });
    colorClear?.addEventListener("click", () => {
      colorText.value = "";
      colorPicker.value = "#4488ff";
    });
  }

  // v13 SceneConfig: tab content has class "tab" AND data-tab="basics".
  // Use the same selector that other modules (terrainmapper) rely on.
  // Must check for .tab class first — plain [data-tab="basics"] also matches
  // the nav <a> link and would insert the fieldset into the navigation.
  const basicsTab = root.querySelector('.tab[data-tab="basics"]')
    ?? root.querySelector('section[data-tab="basics"]');

  if (basicsTab) {
    basicsTab.appendChild(section);
    app.setPosition?.({ height: "auto" });
  } else {
    // Last-resort: append to the form
    const form = root.querySelector("form") ?? root;
    form.appendChild(section);
    app.setPosition?.({ height: "auto" });
  }

  // Save flags on native form submit — avoids touching the frozen app.options object.
  const form = root.querySelector("form") ?? root;
  form.addEventListener("submit", async () => {
    const enabled        = form.querySelector("[name='sta2e-zones-enabled']")?.checked ?? true;
    const showLblChk     = form.querySelector("[name='sta2e-zones-show-labels']")?.checked ?? true;
    const showFillChk    = form.querySelector("[name='sta2e-zones-show-fill']")?.checked ?? false;
    const hideBordersChk = form.querySelector("[name='sta2e-zones-hide-borders']")?.checked ?? false;
    const log            = form.querySelector("[name='sta2e-zones-movement-log']")?.checked ?? false;
    // Default color: use text field value if valid hex, else empty (use built-in default)
    const colorRaw       = (form.querySelector("[name='sta2e-zones-default-color-text']")?.value ?? "").trim();
    const colorVal       = /^#[0-9a-fA-F]{6}$/.test(colorRaw) ? colorRaw : "";
    await scene.setFlag("sta2e-toolkit", "zonesEnabled",       enabled).catch(() => {});
    await scene.setFlag("sta2e-toolkit", "zoneShowLabels",     showLblChk).catch(() => {});
    await scene.setFlag("sta2e-toolkit", "zonePlayShowFill",   showFillChk).catch(() => {});
    await scene.setFlag("sta2e-toolkit", "zoneHideBorders",    hideBordersChk).catch(() => {});
    await scene.setFlag("sta2e-toolkit", "zoneDefaultColor",   colorVal).catch(() => {});
    await scene.setFlag("sta2e-toolkit", "zoneMovementLog",    log).catch(() => {});
  }, { once: true });
});

// ---------------------------------------------------------------------------
// Token drag ruler — patch Token prototype once in "init" (before canvas loads)
// ---------------------------------------------------------------------------

Hooks.once("setup", () => {
  // Register obscured-zone token visibility via libWrapper (must run at setup time).
  registerZoneVisibilityWrap();

  // Patch Token._onDragLeftStart and _onDragLeftDrop to feed the ZoneDragRuler
  const TokenClass = foundry.canvas?.placeables?.Token ?? Token;
  if (!TokenClass?.prototype) return;

  const origStart = TokenClass.prototype._onDragLeftStart;
  const origDrop  = TokenClass.prototype._onDragLeftDrop;
  const origCancel = TokenClass.prototype._onDragLeftCancel;

  TokenClass.prototype._onDragLeftStart = function (event) {
    const result = origStart?.call(this, event);
    try {
      game.sta2eToolkit?.zoneDragRuler?.startDrag(this);
    } catch { /* ignore */ }
    return result;
  };

  TokenClass.prototype._onDragLeftDrop = function (event) {
    try {
      game.sta2eToolkit?.zoneDragRuler?.endDrag();
    } catch { /* ignore */ }
    return origDrop?.call(this, event);
  };

  TokenClass.prototype._onDragLeftCancel = function (event) {
    try {
      game.sta2eToolkit?.zoneDragRuler?.endDrag();
    } catch { /* ignore */ }
    return origCancel?.call(this, event);
  };
});

// ---------------------------------------------------------------------------
// createToken — clear per-token state flags when a new token is placed.
// Wildcard tokens copy the base actor's data; any token-scoped flags from a
// previous instance must be cleared so the new token starts fresh.
// ---------------------------------------------------------------------------

Hooks.on("createToken", async (tokenDoc) => {
  if (!game.user.isGM) return;
  // Clear any state that should never carry over to a fresh token placement
  const flagsToClear = ["shipStatus", "warpBreachImminent"];
  for (const flag of flagsToClear) {
    try {
      const existing = tokenDoc.getFlag("sta2e-toolkit", flag);
      if (existing !== undefined && existing !== null) {
        await tokenDoc.unsetFlag("sta2e-toolkit", flag);
      }
    } catch { /* flag didn't exist — fine */ }
  }
  // Apply a random name from a rollable table if the actor matches a configured trait rule
  await applyWildcardName(tokenDoc);
  game.sta2eToolkit?.zoneMonitor?._debouncedRefresh();
});

Hooks.on("deleteToken", () => {
  game.sta2eToolkit?.zoneMonitor?._debouncedRefresh();
});

// (pin toggled while scene is already loaded)
// ---------------------------------------------------------------------------

Hooks.on("updateScene", (scene) => {
  if (scene.id !== canvas?.scene?.id) return;
  game.sta2eToolkit?.hud?.render();
  game.sta2eToolkit?.zoneOverlay?.refresh();
  game.sta2eToolkit?.zoneVisibility?.refresh();
});

// ---------------------------------------------------------------------------
// Combat HUD — auto-open on token control during active combat
// ---------------------------------------------------------------------------

Hooks.on("controlToken", (token, controlled) => {
  const combatHud = game.sta2eToolkit?.combatHud;
  if (!combatHud) return;

  if (controlled && token?.actor) {
    // Open for any token during active combat, or if already open/pinned
    if (game.combat?.active || combatHud._pinned) {
      combatHud.open(token);
    }
  } else if (!controlled) {
    combatHud.close();
  }
});

// Refresh HUD when the user targets or un-targets a token so that buttons
// that require a target (Scan for Weakness, Ram, Tractor Beam, etc.) enable
// or disable immediately without needing to re-select the active ship.
Hooks.on("targetToken", (user, token, targeted) => {
  if (user.id !== game.user.id) return;   // only react to this client's own targeting
  const combatHud = game.sta2eToolkit?.combatHud;
  if (combatHud?._token) combatHud.refresh();
});

// Auto-open HUD when combat starts (Begin Combat clicked)
Hooks.on("updateCombat", async (combat, changes) => {
  // Auto-apply established lingering hazards at the start of each new round
  if (game.user.isGM && "round" in changes) {
    await ZoneHazard.applyLingeringForRound().catch(err =>
      console.warn("STA2e Toolkit | Lingering hazard round-start failed:", err)
    );
  }

  const combatHud = game.sta2eToolkit?.combatHud;
  if (!combatHud) return;
  if (changes.active === true) {
    const token = canvas.tokens?.controlled[0]
      ?? canvas.tokens?.get(combat.combatant?.tokenId);
    if (token?.actor) {
      combatHud.open(token);
    } else {
      combatHud.openRoster();
    }
  }

  // ── Clear guardActive flags whose expiry token just became the active combatant ──
  if (game.user.isGM && ("turn" in changes || "round" in changes)) {
    const currentTokenId = combat.combatant?.tokenId ?? null;
    if (!currentTokenId) return;
    for (const placeable of (canvas.tokens?.placeables ?? [])) {
      const td = placeable.document;
      const guard = td?.getFlag("sta2e-toolkit", "guardActive");
      if (guard?.expiresForTokenId === currentTokenId) {
        try { await td.unsetFlag("sta2e-toolkit", "guardActive"); } catch(e) {
          console.warn("STA2e Toolkit | Could not clear guardActive flag:", e);
        }
      }
    }
  }
});

// Tractor beam follow — track last known position of each source token.
//
// By the time updateToken fires, tokenDoc.x/y are already the new values, so
// we cannot compute a delta from the document alone. Two hooks work together:
//
//  preUpdateToken  — fires BEFORE the document is mutated; stores the old x/y.
//  updateToken     — fires AFTER the mutation; reads the stored old x/y to get
//                    the true delta, then immediately writes the NEW x/y back
//                    so the NEXT updateToken call always has a valid baseline.
//
// Writing back in updateToken means multi-step / long-distance moves work
// even when preUpdateToken does not fire for every intermediate step.
//
// _tractorTargetExpected tracks where we last told the target to go instead of
// reading targetTok.document.x, which lags behind when multiple target updates
// are in-flight simultaneously (e.g. the ~44 rapid steps of an impulse arc).
const _tractorLastPos        = new Map();
const _tractorTargetExpected = new Map();

Hooks.on("preUpdateToken", (tokenDoc, changes) => {
  if (!game.user.isGM) return;
  const tractorState = tokenDoc.getFlag("sta2e-toolkit", "tractorBeam");
  if (!tractorState?.targetTokenId) return;
  if ("x" in changes || "y" in changes) {
    _tractorLastPos.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y });
  }
});

// Refresh HUD if the same token's flags change (condition applied/removed)
Hooks.on("updateToken", async (tokenDoc, changes) => {
  const combatHud = game.sta2eToolkit?.combatHud;
  if (combatHud?._token && tokenDoc.id === combatHud._token.id) {
    if (changes.flags?.["sta2e-toolkit"]) combatHud.refresh();
  }

  // Tractor beam follow — move target by the SAME DELTA as source moved.
  if (!game.user.isGM) return;

  const tractorState = tokenDoc.getFlag("sta2e-toolkit", "tractorBeam");
  if (!tractorState?.targetTokenId) return;  // not a source token

  const targetTok = canvas.tokens?.get(tractorState.targetTokenId);
  if (!targetTok) return;

  // Token Attacher is handling movement for this pair — nothing to do here.
  if (tractorState.usesTA) return;

  const rotChanged = "rotation" in changes;
  const posChanged = "x" in changes || "y" in changes;
  if (!posChanged && !rotChanged) return;

  const newSrcRot = changes.rotation ?? tokenDoc.rotation ?? 0;

  if (posChanged) {
    const oldPos = _tractorLastPos.get(tokenDoc.id);
    // Always refresh so the next call has a correct baseline even when
    // preUpdateToken does not fire for every step (long-distance moves).
    _tractorLastPos.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y });

    const dx = oldPos ? tokenDoc.x - oldPos.x : 0;
    const dy = oldPos ? tokenDoc.y - oldPos.y : 0;

    if (dx !== 0 || dy !== 0) {
      // Use our own tracked expected position rather than targetTok.document.x/y.
      // During rapid-fire animations (impulse bezier ~44 steps in 700ms) several
      // target updates may be in-flight at once; document.x would be stale and
      // each step would re-base from the same old value, producing wrong deltas.
      const expected = _tractorTargetExpected.get(targetTok.id)
        ?? { x: targetTok.document.x, y: targetTok.document.y };
      const newX = expected.x + dx;
      const newY = expected.y + dy;
      _tractorTargetExpected.set(targetTok.id, { x: newX, y: newY });
      await targetTok.document.update({
        x: newX, y: newY, rotation: newSrcRot,
      }, { animate: true }).catch(() => {});
    }

    // Always return here — never fall through to the rotation branch while the
    // source is also moving.  The rotation branch is for pure heading changes
    // only (no position change).  Letting it run during movement (e.g. every
    // step of an impulse arc) snaps the target to a "behind" position computed
    // from the momentary tangent angle, causing wild back-and-forth oscillation.
    return;
  }

  if (rotChanged) {
    // Pure rotation-only change — recompute behind position for new heading.
    _tractorLastPos.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y });
    const gridSize = canvas.grid?.size ?? 100;
    const srcW     = (tokenDoc.width            ?? 1) * gridSize;
    const srcH     = (tokenDoc.height           ?? 1) * gridSize;
    const tgtW     = (targetTok.document.width  ?? 1) * gridSize;
    const tgtH     = (targetTok.document.height ?? 1) * gridSize;
    const srcCX    = tokenDoc.x + srcW / 2;
    const srcCY    = tokenDoc.y + srcH / 2;
    const towDist  = tractorState.towDist ?? (srcW * 0.5 + tgtW * 0.5 + gridSize * 0.2);
    const rotRad   = (newSrcRot * Math.PI) / 180;
    const behindX  = srcCX + Math.sin(rotRad) * towDist - tgtW / 2;
    const behindY  = srcCY - Math.cos(rotRad) * towDist - tgtH / 2;
    _tractorTargetExpected.set(targetTok.id, { x: behindX, y: behindY });
    await targetTok.document.update({
      x: behindX, y: behindY, rotation: newSrcRot,
    }, { animate: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Zone movement — feed ZoneMovementLog and combat soft warnings
// ---------------------------------------------------------------------------

// Store pre-move positions for zone movement detection
const _zoneMoveOrigins = new Map();
// Tracks the last known center for each token so the GM can recover origin
// when the move was initiated by a remote client (e.g. player on The Forge).
const _lastKnownTokenPositions = new Map();

Hooks.on("preUpdateToken", (tokenDoc, changes) => {
  if (!("x" in changes || "y" in changes)) return;
  // Store the pre-move canvas center for zone distance calculation
  const gs = canvas.grid?.size ?? 100;
  const tw = (tokenDoc.width  ?? 1) * gs;
  const th = (tokenDoc.height ?? 1) * gs;
  _zoneMoveOrigins.set(tokenDoc.id, {
    x: tokenDoc.x + tw / 2,
    y: tokenDoc.y + th / 2,
  });
});

// Pre-populate last-known positions whenever a scene becomes ready so the
// very first move of any token has a valid fallback on the GM client.
Hooks.on("canvasReady", () => {
  _lastKnownTokenPositions.clear();
  const gs = canvas.grid?.size ?? 100;
  for (const token of canvas.tokens?.placeables ?? []) {
    const tw = (token.document.width  ?? 1) * gs;
    const th = (token.document.height ?? 1) * gs;
    _lastKnownTokenPositions.set(token.id, {
      x: token.document.x + tw / 2,
      y: token.document.y + th / 2,
    });
  }
});

Hooks.on("updateToken", async (tokenDoc, changes) => {
  if (!("x" in changes || "y" in changes)) return;

  game.sta2eToolkit?.zoneMonitor?._debouncedRefresh();

  const gs = canvas.grid?.size ?? 100;
  const tw = (tokenDoc.width  ?? 1) * gs;
  const th = (tokenDoc.height ?? 1) * gs;
  const newCenter = {
    x: (changes.x ?? tokenDoc.x) + tw / 2,
    y: (changes.y ?? tokenDoc.y) + th / 2,
  };

  // preHookOrigin: only present on the client that initiated the move.
  // Used exclusively for the movement-log card to avoid duplicates.
  const preHookOrigin = _zoneMoveOrigins.get(tokenDoc.id);
  _zoneMoveOrigins.delete(tokenDoc.id);

  // For GM-side zone logic (cover, combat warnings) fall back to the last
  // known position when the move was initiated by a remote client.
  // Read BEFORE updating so we have the pre-move position.
  const gmOrigin = preHookOrigin ?? (game.user.isGM ? _lastKnownTokenPositions.get(tokenDoc.id) : undefined);

  // Always keep last-known position up to date for future moves.
  _lastKnownTokenPositions.set(tokenDoc.id, newCenter);

  // Movement log — only the initiating client creates the card.
  if (preHookOrigin) {
    game.sta2eToolkit?.zoneMovementLog?.onTokenMove(tokenDoc, preHookOrigin, changes);
  }

  // All zone-based logic below is GM-only.
  if (!game.user.isGM) return;

  const origin = gmOrigin;
  if (!origin) return;

  const perScene = canvas?.scene?.getFlag("sta2e-toolkit", "zonesEnabled");
  if (perScene === false) return;

  const dest = newCenter;
  const zones = getSceneZones();

  // ── Zone cover auto-apply (runs outside combat too) ───────────────────────
  if (zones.length > 0) {
    const destZone     = getZoneAtPoint(dest.x, dest.y, zones);
    const destHasCover = (destZone?.tags ?? []).includes("cover");
    const hasCoverNow  = !!(tokenDoc.getFlag("sta2e-toolkit", "coverActive"));
    if (destHasCover && !hasCoverNow) {
      await tokenDoc.setFlag("sta2e-toolkit", "coverActive", true);
      ui.notifications.info(`${tokenDoc.name} moved into cover.`);
    } else if (!destHasCover && hasCoverNow) {
      await tokenDoc.unsetFlag("sta2e-toolkit", "coverActive");
      ui.notifications.info(`${tokenDoc.name} moved out of cover.`);
    }
  }

  // ── Combat movement warnings ──────────────────────────────────────────────
  if (!game.combat?.active) return;
  if (!zones.length) return;

  const info = getZoneDistance(origin, dest, zones);
  if (!info.fromZone || !info.toZone || info.zoneCount < 0) return;
  if (info.fromZone.id === info.toZone.id && info.zoneCount === 0) return; // moved within same zone (Close/Contact) — no log

  const actor  = canvas.tokens?.get(tokenDoc.id)?.actor ?? null;
  if (!actor) return;
  const isShip = actor.system?.systems !== undefined;
  const zn     = info.zoneCount;

  // Check impulse active flag
  const impulseActive = tokenDoc.getFlag("sta2e-toolkit", "_impulseActive");
  const warpActive    = tokenDoc.getFlag("sta2e-toolkit", "_warpActive");

  if (impulseActive || (isShip && !warpActive)) {
    if (zn > 2) {
      ui.notifications.warn(
        `⚠ ${actor.name} moved ${zn} zones — exceeds Impulse limit of 2.`
      );
    }
    // Clear flag
    if (impulseActive) {
      tokenDoc.unsetFlag("sta2e-toolkit", "_impulseActive").catch(() => {});
    }
  }

  if (warpActive) {
    const enginesScore = actor.system?.systems?.engines?.value ?? null;
    if (enginesScore != null && zn > enginesScore) {
      ui.notifications.warn(
        `⚠ ${actor.name} moved ${zn} zones — exceeds Warp limit of ${enginesScore} (Engines).`
      );
    }
    tokenDoc.unsetFlag("sta2e-toolkit", "_warpActive").catch(() => {});
  }

  if (!isShip && zn > 2) {
    ui.notifications.warn(
      `⚠ ${actor.name} moved ${zn} zones — exceeds Sprint limit of 2.`
    );
  }
});

// Refresh HUD when the current token's actor data changes (shields, breaches,
// system values, shaken, etc. edited directly on the actor sheet)
Hooks.on("updateActor", (actor, changes) => {
  const combatHud = game.sta2eToolkit?.combatHud;
  if (!combatHud?._token) return;
  if (combatHud._token.actor?.id !== actor.id) return;
  combatHud.refresh();
});

// Refresh HUD when items on the current token's actor change (injuries added/removed)
Hooks.on("createItem", (item) => {
  const combatHud = game.sta2eToolkit?.combatHud;
  if (!combatHud?._token) return;
  if (combatHud._token.actor?.id !== item.parent?.id) return;
  combatHud.refresh();
});

Hooks.on("updateItem", (item) => {
  const combatHud = game.sta2eToolkit?.combatHud;
  if (!combatHud?._token) return;
  if (combatHud._token.actor?.id !== item.parent?.id) return;
  combatHud.refresh();
});

Hooks.on("deleteItem", (item) => {
  const combatHud = game.sta2eToolkit?.combatHud;
  if (!combatHud?._token) return;
  if (combatHud._token.actor?.id !== item.parent?.id) return;
  combatHud.refresh();
});

// ---------------------------------------------------------------------------
// Character sheet theme injection
// ---------------------------------------------------------------------------

/** Injects (or removes) a <style> tag that overrides the STA2e character sheet
 *  colors to match the currently active toolkit HUD theme.  Idempotent — safe
 *  to call any number of times. */
function _applySheetTheme() {
  const STYLE_ID = "sta2e-sheet-theme";
  document.getElementById(STYLE_ID)?.remove();
  if (!game.settings.get("sta2e-toolkit", "themeCharacterSheet")) return;

  const LC  = getLcTokens();
  const css = `
/* ── STA2e Toolkit — character sheet theme ── */
.character-sheet {
  background: ${LC.bg} !important;
  color: ${LC.text} !important;
  scrollbar-color: ${LC.border} transparent !important;
}
.character-sheet .title {
  background-color: ${LC.primary} !important;
  border-color:     ${LC.primary} !important;
  color:            ${LC.textBright} !important;
}
.character-sheet .text-entry,
.character-sheet .numeric-entry {
  border-color: ${LC.border} !important;
  color:        ${LC.text} !important;
  background:   transparent !important;
}
.character-sheet input,
.character-sheet textarea,
.character-sheet select {
  color: ${LC.text} !important;
}
.character-sheet nav.sheet-tabs.tabs {
  background-color: ${LC.panel} !important;
  border-color:     ${LC.border} !important;
}
.character-sheet nav.sheet-tabs.tabs a.item {
  color: ${LC.textDim} !important;
}
.character-sheet nav.sheet-tabs.tabs a.item.active {
  background-color: ${LC.primary} !important;
  color:            ${LC.textBright} !important;
  text-shadow:      none !important;
}
.character-sheet nav.sheet-tabs.tabs a.item:hover {
  color:       ${LC.primary} !important;
  text-shadow: 0 0 6px ${LC.primary} !important;
}
.character-sheet .bottom-right-column {
  border-left-color: ${LC.primary} !important;
}
.character-sheet .section .header {
  background-color: ${LC.border} !important;
  color:            ${LC.textBright} !important;
}
.character-sheet .track .bar .box:hover {
  box-shadow: 0 0 8px ${LC.primary} !important;
}
.character-sheet .track .bar .box.stress.selected,
.character-sheet .track .bar .box.determination.selected,
.character-sheet .track .bar .box.rep.selected,
.character-sheet .track .bar .box.shields.selected,
.character-sheet .track .bar .box.power.selected,
.character-sheet .track .bar .box.crew.selected,
.character-sheet .track .bar .box.extendedtask.selected {
  background-color: ${LC.primary} !important;
  color:            ${LC.bg} !important;
  border-color:     ${LC.primary} !important;
}
.character-sheet .tracktitle {
  color: ${LC.textDim} !important;
}
.character-sheet .btn {
  border-color: ${LC.primary} !important;
  color:        ${LC.text} !important;
}
.character-sheet .btn:hover {
  background-color: ${LC.primary} !important;
  color:            ${LC.textBright} !important;
}
.character-sheet .btn2 {
  border-color: ${LC.red} !important;
}
.character-sheet .btn2:hover {
  background-color: ${LC.red} !important;
  color:            ${LC.textBright} !important;
}
.character-sheet .btn3 {
  border-color: ${LC.tertiary} !important;
}
.character-sheet .btn3:hover {
  background-color: ${LC.tertiary} !important;
  color:            ${LC.bg} !important;
}
.app.window-app:has(.character-sheet) .window-header {
  background:          ${LC.panel} !important;
  border-bottom-color: ${LC.border} !important;
  color:               ${LC.textBright} !important;
}
`;

  // Duplicate all selectors for .starship-sheet (starship + smallcraft)
  // and .extended-tasks (extended task actors) so they share the same theme.
  const shipCss         = css.replace(/\.character-sheet/g, ".starship-sheet");
  const extendedTaskCss = css.replace(/\.character-sheet/g, ".extended-tasks");

  const el = document.createElement("style");
  el.id          = STYLE_ID;
  el.textContent = css + "\n" + shipCss + "\n" + extendedTaskCss;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// Sheet-roller override — helpers
// ---------------------------------------------------------------------------

/** Returns true for any actor that is a starship or smallcraft. */
function _isShipActor(a) {
  return a.type === "starship" || a.type === "smallcraft";
}

/** Returns all world ship actors.
 *  Does not require ships to be placed on the canvas — characters can get
 *  ship assist from any ship actor in the world. */
function _allWorldShips() {
  return game.actors
    .filter(_isShipActor)
    .map(a => ({ label: a.name, actorId: a.id, shipActor: a, shipToken: null }));
}

/**
 * Find the active combat ship for a character actor.
 * Checks two paths in priority order:
 *   1. Character's assignedShips flag — any of those ships are active combatants.
 *   2. Character appears in a combat ship's crew manifest.
 * Returns { shipActor, combatant, stationIds: string[] } or null.
 */
function _getCombatShipContext(actor) {
  if (!game.combat?.active) return null;
  const assignedIds = new Set(getAssignedShips(actor));

  for (const combatant of game.combat.combatants) {
    const shipActor = combatant.actor;
    if (!shipActor || !_isShipActor(shipActor)) continue;

    // Path 1: character is in the assignedShips list for this ship
    if (assignedIds.has(shipActor.id)) {
      const manifest   = getCrewManifest(shipActor);
      const stationIds = STATION_SLOTS
        .filter(s => (manifest[s.id] ?? []).includes(actor.id))
        .map(s => s.id);
      return { shipActor, combatant, stationIds };
    }

    // Path 2: character appears in the ship's own crew manifest
    const manifest   = getCrewManifest(shipActor);
    const stationIds = STATION_SLOTS
      .filter(s => (manifest[s.id] ?? []).includes(actor.id))
      .map(s => s.id);
    if (stationIds.length > 0)
      return { shipActor, combatant, stationIds };
  }
  return null;
}

/**
 * Returns all combat ship combatants that can be targeted, excluding the
 * character's own ship.  Used to populate the target-ship dropdown in the
 * combat task panel.
 */
function _getCombatTargetShips(excludeActorId) {
  if (!game.combat?.active) return [];
  return game.combat.combatants
    .filter(c => _isShipActor(c.actor) && c.actor?.id !== excludeActorId)
    .map(c => ({ label: c.name, actorId: c.actor.id, tokenId: c.tokenId }));
}

/** Open the "Assign Ships" management dialog for a character actor.
 *  Lists every ship actor in the world; currently assigned ones are pre-checked. */
async function _openAssignShipsDialog(actor) {
  const allShips = game.actors.filter(_isShipActor);
  if (!allShips.length) {
    ui.notifications.warn("STA2e Toolkit: No ship actors found in this world.");
    return;
  }

  function _buildContent() {
    const LC = getLcTokens();
    const presets     = game.settings.get("sta2e-toolkit", "shipPresets") ?? {};
    const current     = new Set(getAssignedShips(actor));
    const presetNames = Object.keys(presets);

    const inputStyle  = `background:${LC.panel};color:${LC.text};border:1px solid ${LC.border};border-radius:3px;padding:3px 6px;`;
    const btnStyle    = (color = LC.primary) =>
      `background:transparent;color:${color};border:2px solid ${color};border-radius:3px;` +
      `padding:3px 10px;cursor:pointer;font-weight:bold;font-size:0.8em;white-space:nowrap;` +
      `transition:background 0.15s,color 0.15s;`;

    const presetOptions = presetNames.length
      ? `<option value="" style="background:${LC.panel};">— Apply Preset —</option>` +
        presetNames.map(n => `<option value="${n}" style="background:${LC.panel};color:${LC.text};">${n}</option>`).join("")
      : `<option value="" disabled style="background:${LC.panel};">No saved presets</option>`;

    const rows = allShips.map(s => {
      const checked = current.has(s.id);
      return `<label style="display:flex;align-items:center;gap:10px;padding:5px 8px;cursor:pointer;
                border-radius:4px;border-left:3px solid ${checked ? LC.primary : LC.border};
                background:${checked ? LC.panel : 'transparent'};transition:background 0.1s;"
               data-ship-label>
        <input type="checkbox" name="ship" value="${s.id}" ${checked ? "checked" : ""}
               style="accent-color:${LC.primary};width:14px;height:14px;">
        <span style="color:${LC.text};font-size:0.9em;letter-spacing:0.03em;">${s.name}</span>
      </label>`;
    }).join("");

    return `
    <div style="background:${LC.bg};color:${LC.text};padding:8px;border-radius:4px;font-family:${LC.font ?? 'sans-serif'};">

      <!-- ── PRESETS section ───────────────────────────────────────── -->
      <div style="background:${LC.panel};border-radius:4px;padding:8px;margin-bottom:8px;">
        <div style="font-size:0.7em;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;
                    color:${LC.primary};margin-bottom:6px;border-bottom:1px solid ${LC.border};padding-bottom:3px;">
          ◈ Ship Crew Presets
        </div>
        <div style="display:flex;gap:4px;align-items:center;margin-bottom:6px;">
          <select id="sta2e-preset-select" style="flex:1;min-width:0;${inputStyle}">${presetOptions}</select>
          <button type="button" id="sta2e-preset-load"   style="${btnStyle(LC.primary)}" title="Apply preset to checkboxes">Apply</button>
          <button type="button" id="sta2e-preset-update" style="${btnStyle(LC.tertiary ?? LC.primary)}" title="Overwrite selected preset with current selection">Update</button>
          <button type="button" id="sta2e-preset-delete" style="${btnStyle(LC.red ?? '#ff4444')};padding:3px 8px;" title="Delete selected preset">✕</button>
        </div>
        <div style="display:flex;gap:4px;align-items:center;">
          <input id="sta2e-preset-name" type="text" placeholder="New preset name…"
                 style="flex:1;min-width:0;${inputStyle}">
          <button type="button" id="sta2e-preset-save" style="${btnStyle(LC.tertiary ?? LC.primary)}" title="Save current selection as preset">Save Preset</button>
        </div>
      </div>

      <!-- ── SHIP LIST ─────────────────────────────────────────────── -->
      <div style="font-size:0.7em;font-weight:bold;letter-spacing:0.12em;text-transform:uppercase;
                  color:${LC.primary};margin-bottom:4px;">◈ Ships</div>
      <div id="sta2e-ship-rows"
           style="max-height:250px;overflow-y:auto;display:flex;flex-direction:column;gap:3px;
                  padding-right:4px;scrollbar-color:${LC.border} transparent;">
        ${rows}
      </div>
    </div>`;
  }

  // Tracks the last preset applied this session so Save can subscribe the actor to it
  let _presetApplied = null;

  // Wire preset controls + live styling after the dialog renders
  Hooks.once("renderDialogV2", (dlgApp, html) => {
    if (!html.querySelector("#sta2e-preset-select")) return; // wrong dialog
    const LC = getLcTokens();

    // Live label highlight when a checkbox is toggled
    function _syncLabel(cb) {
      const label = cb.closest("label");
      if (!label) return;
      label.style.borderLeftColor = cb.checked ? LC.primary : LC.border;
      label.style.background      = cb.checked ? LC.panel   : "transparent";
    }
    html.querySelectorAll('input[name="ship"]').forEach(cb => {
      _syncLabel(cb);
      cb.addEventListener("change", () => _syncLabel(cb));
    });

    // Hover effect on buttons
    html.querySelectorAll("button[type=button]").forEach(btn => {
      const origBg    = btn.style.background;
      const origColor = btn.style.color;
      const hoverBg   = btn.style.borderColor;
      btn.addEventListener("mouseenter", () => { btn.style.background = hoverBg; btn.style.color = LC.bg; });
      btn.addEventListener("mouseleave", () => { btn.style.background = origBg;  btn.style.color = origColor; });
    });

    function _refreshPresetDropdown() {
      const presets = game.settings.get("sta2e-toolkit", "shipPresets") ?? {};
      const sel = html.querySelector("#sta2e-preset-select");
      if (!sel) return;
      const names = Object.keys(presets);
      sel.innerHTML = names.length
        ? `<option value="" style="background:${LC.panel};">— Apply Preset —</option>` +
          names.map(n => `<option value="${n}" style="background:${LC.panel};color:${LC.text};">${n}</option>`).join("")
        : `<option value="" disabled style="background:${LC.panel};">No saved presets</option>`;
    }

    // Apply preset → tick matching checkboxes, track for Save subscription
    html.querySelector("#sta2e-preset-load")?.addEventListener("click", () => {
      const name = html.querySelector("#sta2e-preset-select")?.value;
      if (!name) return;
      _presetApplied = name;
      const presets = game.settings.get("sta2e-toolkit", "shipPresets") ?? {};
      const ids = new Set(presets[name] ?? []);
      html.querySelectorAll('input[name="ship"]').forEach(cb => {
        cb.checked = ids.has(cb.value);
        _syncLabel(cb);
      });
    });

    // Update preset — overwrite with current selection and push to subscribed characters
    html.querySelector("#sta2e-preset-update")?.addEventListener("click", async () => {
      const name = html.querySelector("#sta2e-preset-select")?.value;
      if (!name) { ui.notifications.warn("Select a preset to update first."); return; }
      const ids = [...html.querySelectorAll('input[name="ship"]:checked')].map(el => el.value);
      const presets = { ...(game.settings.get("sta2e-toolkit", "shipPresets") ?? {}), [name]: ids };
      await game.settings.set("sta2e-toolkit", "shipPresets", presets);

      // Push to every character actor subscribed to this preset
      const subscribers = game.actors.filter(a =>
        !_isShipActor(a) && a.getFlag("sta2e-toolkit", "activePreset") === name
      );
      if (subscribers.length) {
        await Promise.all(subscribers.map(a => setAssignedShips(a, ids)));
        ui.notifications.info(
          `STA2e Toolkit: Preset "${name}" updated and pushed to ` +
          `${subscribers.length} character${subscribers.length !== 1 ? "s" : ""}.`
        );
      } else {
        ui.notifications.info(`STA2e Toolkit: Preset "${name}" updated (${ids.length} ship${ids.length !== 1 ? "s" : ""}).`);
      }
    });

    // Delete preset
    html.querySelector("#sta2e-preset-delete")?.addEventListener("click", async () => {
      const name = html.querySelector("#sta2e-preset-select")?.value;
      if (!name) return;
      if (!confirm(`Delete preset "${name}"?`)) return;
      const presets = { ...(game.settings.get("sta2e-toolkit", "shipPresets") ?? {}) };
      delete presets[name];
      await game.settings.set("sta2e-toolkit", "shipPresets", presets);
      _refreshPresetDropdown();
      ui.notifications.info(`STA2e Toolkit: Preset "${name}" deleted.`);
    });

    // Save current selection as a named preset
    html.querySelector("#sta2e-preset-save")?.addEventListener("click", async () => {
      const name = html.querySelector("#sta2e-preset-name")?.value?.trim();
      if (!name) { ui.notifications.warn("Enter a preset name first."); return; }
      const ids = [...html.querySelectorAll('input[name="ship"]:checked')].map(el => el.value);
      const presets = { ...(game.settings.get("sta2e-toolkit", "shipPresets") ?? {}), [name]: ids };
      await game.settings.set("sta2e-toolkit", "shipPresets", presets);
      html.querySelector("#sta2e-preset-name").value = "";
      _refreshPresetDropdown();
      ui.notifications.info(`STA2e Toolkit: Preset "${name}" saved (${ids.length} ship${ids.length !== 1 ? "s" : ""}).`);
    });
  });

  await foundry.applications.api.DialogV2.wait({
    window: { title: `Assign Ships — ${actor.name}` },
    content: _buildContent(),
    rejectClose: false,
    buttons: [
      {
        action: "save",
        label: "Save",
        icon: "fas fa-save",
        default: true,
        callback: async (_event, _button, dlg) => {
          const checked = [...dlg.element.querySelectorAll('input[name="ship"]:checked')].map(el => el.value);
          await setAssignedShips(actor, checked);
          // Subscribe this actor to the applied preset so future Updates push here
          if (_presetApplied)
            await actor.setFlag("sta2e-toolkit", "activePreset", _presetApplied);
          ui.notifications.info(`STA2e Toolkit: Assigned ships updated for ${actor.name}.`);
        },
      },
      { action: "cancel", label: "Cancel", icon: "fas fa-times" },
    ],
  });
}

// _pickShipAssist removed — ship selection is now handled inline in the roller dialog

// ---------------------------------------------------------------------------
// Combat HUD — right-click context menu (available outside combat too)
// ---------------------------------------------------------------------------

Hooks.on("getTokenContextMenuEntries", (token, options) => {
  options.push({
    name:     "Quick Actions",
    icon:     '<i class="fas fa-crosshairs"></i>',
    condition: () => !!token?.actor,
    callback:  (li) => {
      // li is the token HTML element in the HUD — get the actual Token object
      const tokenObj = canvas.tokens.get(li.data("tokenId")) ?? canvas.tokens.controlled[0];
      game.sta2eToolkit?.combatHud?.open(tokenObj);
    }
  });

});

// ---------------------------------------------------------------------------
// Character sheet roller override — intercept onAttributeTest clicks
// ---------------------------------------------------------------------------

/**
 * Attach the capture-phase override listener to every onAttributeTest element
 * in the rendered sheet.  A data attribute guards against double-binding if
 * multiple hooks happen to fire for the same render (e.g. both a base-class
 * hook and a subclass hook).
 */
function _applySheetRollerOverride(app, html) {
  if (!game.settings.get("sta2e-toolkit", "overrideSheetRoller")) return;

  // ── Inject "Assign Ships" button below Stress Modifier in the left panel ──
  const actor = app.document ?? app.actor;
  if (actor?.type === "character" && !html.querySelector(".sta2e-assign-ships-btn")) {
    const anchor = html.querySelector(".stressmod");
    if (anchor) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sta2e-assign-ships-btn check-button btn";
      btn.title = "Assign ships available for ship assist rolls";
      btn.innerHTML = 'Assign Ships';
      btn.style.cssText = "margin-top:8px;width:100%;cursor:pointer;";
      btn.addEventListener("click", (e) => { e.preventDefault(); _openAssignShipsDialog(actor); });
      anchor.insertAdjacentElement("afterend", btn);
    }
  }

  // ── Ship actors: inline NPC toggle + crew quality below the name field ─────
  if (_isShipActor(actor) && !html.querySelector(".sta2e-npc-ship-block")) {
    const nameField = html.querySelector(".name-field");
    if (nameField) {
      const isNpc   = actor.getFlag("sta2e-toolkit", "isNpcShip")   ?? false;
      const quality = actor.getFlag("sta2e-toolkit", "crewQuality") ?? "proficient";

      const CREW_QUALITIES = [
        { key: "basic",       label: "Basic"       },
        { key: "proficient",  label: "Proficient"  },
        { key: "talented",    label: "Talented"    },
        { key: "exceptional", label: "Exceptional" },
      ];

      const radioHTML = CREW_QUALITIES.map(o => `
        <label class="sta2e-cq-option">
          <input type="radio" name="sta2e-crewQuality" value="${o.key}"
            ${quality === o.key ? "checked" : ""}
            style="accent-color:var(--sta2e-primary,#c47f00);" />
          <span class="sta2e-cq-label">${o.label}</span>
        </label>`).join("");

      const block = document.createElement("div");
      block.className = "sta2e-npc-ship-block";
      block.innerHTML = `
        <label class="sta2e-npc-toggle">
          <input type="checkbox" class="sta2e-npc-cb"
            ${isNpc ? "checked" : ""}
            style="accent-color:var(--sta2e-primary,#c47f00);" />
          <span>NPC Ship</span>
        </label>
        <div class="sta2e-crew-quality" style="display:${isNpc ? "block" : "none"};">
          <div class="sta2e-cq-title">Crew Quality</div>
          ${radioHTML}
        </div>`;

      block.querySelector(".sta2e-npc-cb").addEventListener("change", async (ev) => {
        await actor.setFlag("sta2e-toolkit", "isNpcShip", ev.target.checked);
        block.querySelector(".sta2e-crew-quality").style.display =
          ev.target.checked ? "block" : "none";
      });

      block.querySelectorAll('input[name="sta2e-crewQuality"]').forEach(radio => {
        radio.addEventListener("change", async (ev) => {
          if (ev.target.checked)
            await actor.setFlag("sta2e-toolkit", "crewQuality", ev.target.value);
        });
      });

      nameField.insertAdjacentElement("afterend", block);
    }
  }

  html.querySelectorAll('[data-action="onAttributeTest"]:not([data-sta2e-roller-bound])').forEach(el => {
    el.dataset.sta2eRollerBound = "1";

    el.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();

      // ApplicationV2 exposes the document as app.document; legacy sheets use app.actor
      const actor = app.document ?? app.actor;
      if (!actor) return;

      // Best-available token for the actor on the current scene
      const pcToken = actor.getActiveTokens(true)[0]?.document
        ?? canvas.tokens?.placeables.find(t => t.actor?.id === actor.id)?.document
        ?? null;

      // ── Ship actors: assist roll or full NPC roller based on flag ────
      if (_isShipActor(actor)) {
        // Read currently selected system and department from the sheet checkboxes
        const sheetEl = app.element;
        let selectedSysKey  = null;
        let selectedDeptKey = null;
        sheetEl?.querySelectorAll('input.selector.system').forEach(cb => {
          if (cb.checked) selectedSysKey = cb.id.replace('.selector', '');
        });
        sheetEl?.querySelectorAll('input.selector.department').forEach(cb => {
          if (cb.checked) selectedDeptKey = cb.id.replace('.selector', '');
        });
        const shipOpts = {};
        if (selectedSysKey)  shipOpts.shipSystemKey = selectedSysKey;
        if (selectedDeptKey) shipOpts.shipDeptKey   = selectedDeptKey;
        if (CombatHUD.isNpcShip(actor)) {
          openNpcRoller(actor, pcToken, shipOpts);           // full NPC task roller
        } else {
          openNpcRoller(actor, pcToken, { ...shipOpts, isAssistRoll: true }); // ship assist card
        }
        return;
      }

      // ── Ground NPC characters (any actor type with NPC sheet + attributes) ──
      // getGroundCombatProfile distinguishes PCs/Supporting (isPlayerOwned:true) from
      // ground NPCs (minor/notable/major) — regardless of actor.type.
      // Ships were already handled above; only non-ship non-player actors reach here.
      const _npcProfile = CombatHUD.getGroundCombatProfile(actor);
      if (!_npcProfile.isPlayerOwned && !_npcProfile.isShip) {
        const _npcSheetEl = app.element;
        let _npcAttrKey = null;
        let _npcDiscKey = null;
        _npcSheetEl?.querySelectorAll('.attribute-block .selector.attribute').forEach(cb => {
          if (cb.checked) _npcAttrKey = cb.id.replace('.selector', '');
        });
        _npcSheetEl?.querySelectorAll('.discipline-block .selector.discipline').forEach(cb => {
          if (cb.checked) _npcDiscKey = cb.id.replace('.selector', '');
        });
        const _npcStats = readOfficerStats(actor);
        const _npcAllShips = _allWorldShips();
        const _npcSerializedShips = _npcAllShips.map(s => ({
          label:              s.label,
          actorId:            s.actorId,
          systems:            s.shipActor.system?.systems     ?? {},
          depts:              s.shipActor.system?.departments ?? {},
          hasAdvancedSensors: s.shipActor.items?.some(i =>
            i.name.toLowerCase().includes("advanced sensor suites") ||
            i.name.toLowerCase().includes("advanced sensors")
          ) ?? false,
          sensorsBreaches:    s.shipActor.system?.systems?.sensors?.breaches ?? 0,
        }));
        openNpcRoller(actor, pcToken, {
          groundMode:     true,
          groundIsNpc:    true,
          officer:        _npcStats || undefined,
          defaultAttr:    _npcAttrKey || undefined,
          defaultDisc:    _npcDiscKey || undefined,
          availableShips: _npcSerializedShips,
        });
        return;
      }

      // ── Player characters: check for ship assist ─────────────────────
      // Mirror the system's native _onAttributeTest logic: read which attribute
      // and discipline checkboxes are currently checked on the sheet.
      const sheetEl = app.element;
      let selectedAttrKey = null;
      let selectedDiscKey = null;
      sheetEl?.querySelectorAll('.attribute-block .selector.attribute').forEach(cb => {
        if (cb.checked) selectedAttrKey = cb.id.replace('.selector', '');
      });
      sheetEl?.querySelectorAll('.discipline-block .selector.discipline').forEach(cb => {
        if (cb.checked) selectedDiscKey = cb.id.replace('.selector', '');
      });

      // Read the PC's full stats so the roller can display the character's attr/disc values.
      const pcStats  = readOfficerStats(actor);
      const allShips = _allWorldShips();

      // Serialize ship data for the in-roller ship selector.
      // Assigned ships float to the top; unassigned ships follow after a separator.
      const assignedIds    = new Set(getAssignedShips(actor));
      const preferredShips = allShips.filter(s =>  assignedIds.has(s.actorId));
      const otherShips     = allShips.filter(s => !assignedIds.has(s.actorId));
      // Show only assigned ships when any are assigned; fall back to full list otherwise
      const orderedShips = assignedIds.size > 0
        ? preferredShips
        : [...preferredShips, ...otherShips];

      const serializedShips = orderedShips.map(s => ({
        label:              s.label,
        actorId:            s.actorId,
        systems:            s.shipActor.system?.systems     ?? {},
        depts:              s.shipActor.system?.departments ?? {},
        hasAdvancedSensors: s.shipActor.items?.some(i =>
          i.name.toLowerCase().includes("advanced sensor suites") ||
          i.name.toLowerCase().includes("advanced sensors")
        ) ?? false,
        sensorsBreaches:    s.shipActor.system?.systems?.sensors?.breaches ?? 0,
      }));

      // ── Combat task context (only when character is on a ship in active combat) ──
      const combatCtx = _getCombatShipContext(actor);
      const combatTaskContext = combatCtx ? (() => {
        // Serialize ship weapons for the Tactical station weapon sub-list
        const shipWeapons = (combatCtx.shipActor.items ?? [])
          .filter(i => i.type === "starshipweapon2e")
          .map(i => ({
            id:         i.id,
            name:       i.name,
            img:        i.img ?? "",
            damage:     i.system?.damage ?? 0,
            isTorpedo:  (i.system?.qualities?.torpedo ?? false) ||
                        i.name.toLowerCase().includes("torpedo") ||
                        i.name.toLowerCase().includes("missile"),
          }));
        // Resolve ship token for reading per-token flags (minor action states)
        const _shipToken = canvas.tokens?.placeables
          .find(t => t.actor?.id === combatCtx.shipActor.id) ?? null;
        const _isTactical = combatCtx.stationIds.includes("tactical");
        const _isHelm     = combatCtx.stationIds.includes("helm");
        const _isSensors  = combatCtx.stationIds.includes("sensors");
        return {
          bridgeStations: BRIDGE_STATIONS,
          taskParams:     TASK_PARAMS,
          myStations:     combatCtx.stationIds,
          combatShip: {
            label:   combatCtx.shipActor.name,
            actorId: combatCtx.shipActor.id,
          },
          shipWeapons,
          targetShips:  _getCombatTargetShips(combatCtx.shipActor.id),
          preTargetId:  [...(game.user.targets ?? [])]
            .find(t => _isShipActor(t.actor))?.actor?.id ?? null,
          // Initial states for tactical minor action buttons (read once at roller open time)
          tacticalMinorStates: _isTactical ? {
            calibrateWeapons:  CombatHUD.hasCalibrateWeapons(_shipToken),
            targetingSolution: CombatHUD.hasTargetingSolution(_shipToken),
            weaponsArmed:      CombatHUD.getWeaponsArmed(combatCtx.shipActor),
            shieldsLowered:    CombatHUD.getShieldsLowered(combatCtx.shipActor),
          } : null,
          // Helm minor actions (Impulse + Thrusters are info-only, no persistent state)
          helmMinorStates: _isHelm ? {} : null,
          // Sensor minor actions (Calibrate Sensors is a toggle, Launch Probe is info-only)
          sensorMinorStates: _isSensors ? {
            calibrateSensors: CombatHUD.hasCalibratesensors(_shipToken),
          } : null,
          // Injected here to avoid circular import in npc-roller.js
          buildWeaponContext: (weapon) => buildWeaponContext(weapon),
          shipHasRapidFireTorpedo: hasRapidFireTorpedoLauncher(combatCtx.shipActor),
          openWeaponAttack: (shipActor, shipToken, weapon, officer) =>
            openWeaponAttackForOfficer(shipActor, shipToken, weapon, officer),
          applyDefenseMode: (shipActor, shipToken, conditionKey) =>
            applyDefenseModeForOfficer(shipActor, shipToken, conditionKey),
          applyModulateShields: (shipActor, shipToken) =>
            applyModulateShieldsForOfficer(shipActor, shipToken),
          applyCalibrateWeapons: (shipActor, shipToken) =>
            applyCalibrateWeaponsForOfficer(shipActor, shipToken),
          applyTargetingSolution: (shipActor, shipToken) =>
            applyTargetingSolutionForOfficer(shipActor, shipToken),
          consumeTargetingSolution: _isTactical ? (shipActor, shipToken, benefit, system) =>
            consumeTargetingSolutionForOfficer(shipActor, shipToken, benefit, system) : null,
          applyPrepare: (shipActor, shipToken) =>
            applyPrepareForOfficer(shipActor, shipToken),
          applyImpulse: _isHelm ? (shipActor, shipToken) =>
            applyImpulseForOfficer(shipActor, shipToken) : null,
          applyThrusters: _isHelm ? (shipActor, shipToken) =>
            applyThrustersForOfficer(shipActor, shipToken) : null,
          applyCalibrateSensors: _isSensors ? (shipActor, shipToken) =>
            applyCalibrateSensorsForOfficer(shipActor, shipToken) : null,
          consumeCalibrateSensors: _isSensors ? (shipActor, shipToken, benefit) =>
            consumeCalibrateSensorsForOfficer(shipActor, shipToken, benefit) : null,
          applyLaunchProbe: _isSensors ? (shipActor, shipToken) =>
            applyLaunchProbeForOfficer(shipActor, shipToken) : null,
          getMinorActionStates: () => _isTactical ? {
            weaponsArmed:  CombatHUD.getWeaponsArmed(combatCtx.shipActor),
            shieldsLowered: CombatHUD.getShieldsLowered(combatCtx.shipActor),
          } : null,
          applyDirect: (shipActor, shipToken) =>
            applyDirectForOfficer(shipActor, shipToken, actor),
          // Cloaking Device — Tactical station only, if the ship carries the talent
          shipHasCloakingDevice: _isTactical && hasCloakingDevice(combatCtx.shipActor),
          cloakingDeviceActive:  _isTactical
            ? ((combatCtx.shipActor?.statuses?.has("invisible") ?? false)
               || (_shipToken?.document?.hidden ?? false))
            : false,
          // applyCloakDeactivate: instant minor-action decloak (no roll)
          applyCloakDeactivate: _isTactical && hasCloakingDevice(combatCtx.shipActor)
            ? (sA, sT) => applyCloakDeactivateForOfficer(sA, sT)
            : null,
          applyReroutePower: async (shipActor, shipToken) => {
            const system = await showRerouteSystemDialog(shipActor);
            if (!system) return;
            await handleOfficerTaskResult("reroute-power", shipActor, shipToken, actor,
              { passed: true, successes: 0, momentum: 0, rerouteSystem: system });
          },
          transportConfigDialog: (shipActor) =>
            showTransportConfigDialog(shipActor),
        };
      })() : null;

      // Open the roller directly — ship selection is handled via the inline selector
      // inside the roller dialog. When no ships are on canvas, open in groundMode.
      openNpcRoller(actor, pcToken, {
        playerMode:          true,
        crewQuality:         null,
        officer:             pcStats,
        defaultAttr:         selectedAttrKey,
        defaultDisc:         selectedDiscKey,
        sheetMode:           true,
        groundMode:          serializedShips.length === 0,
        availableShips:      serializedShips,
        combatTaskContext,
        // Apply target-flagging task effects when roll passes (scan-for-weakness etc.)
        taskCallback: combatTaskContext ? async ({ passed, successes = 0, momentum = 0 }) => {
          const sel      = combatTaskContext._selected ?? {};
          const taskKey  = sel.taskKey;
          const targetId = sel.targetId;
          if (!taskKey) return;

          const targetToken = targetId
            ? canvas.tokens?.placeables.find(t => t.actor?.id === targetId) ?? null
            : null;
          const shipToken = canvas.tokens?.placeables
            .find(t => t.actor?.id === combatTaskContext.combatShip.actorId) ?? null;
          const shipActor = game.actors.get(combatTaskContext.combatShip.actorId);

          if (taskKey === "scan-for-weakness") {
            if (!passed) return;
            if (!targetToken) {
              ui.notifications.warn("STA2e Toolkit: Target ship not on canvas — scan not applied.");
              return;
            }
            const cardHtml = await applyScanForWeakness(
              shipToken, targetToken, combatTaskContext.combatShip.label
            );
            ChatMessage.create({
              content:  cardHtml,
              speaker:  ChatMessage.getSpeaker({ token: shipToken }),
            });

          } else if (taskKey === "tractor-beam") {
            if (!passed) return;
            if (!targetToken) {
              ui.notifications.warn("STA2e Toolkit: Target ship not on canvas — tractor beam not applied.");
              return;
            }
            if (!shipToken) {
              ui.notifications.warn("STA2e Toolkit: Ship token not found on canvas.");
              return;
            }
            await lockTractorBeam(shipToken, targetToken);

          } else if (taskKey === "warp") {
            // applyWarpForOfficer handles both pass and fail chat cards internally
            await applyWarpForOfficer(shipActor, shipToken, passed);

          } else if (taskKey === "ram") {
            if (!shipToken) {
              ui.notifications.warn("STA2e Toolkit: Ship token not found on canvas.");
              return;
            }
            // applyRamForOfficer handles both pass and fail chat cards internally
            await applyRamForOfficer(shipToken, targetToken, passed, momentum);

          } else if (["regen-shields","regain-power","damage-control","transport"].includes(taskKey)) {
            // handleOfficerTaskResult handles all Ops/Engineering task outcomes
            await handleOfficerTaskResult(taskKey, shipActor, shipToken, actor,
              { passed, successes, momentum,
                rerouteSystem:    combatTaskContext._selected?.rerouteSystem    ?? null,
                transportConfig:  combatTaskContext._selected?.transportConfig  ?? null });

          } else if (taskKey === "cloak-toggle") {
            // Cloaking Device activation — Reserve Power check + effects handled inside
            await handleCloakActivateResult(shipActor, shipToken, passed);
          }
        } : null,
        onAssignShips: async () => {
          await _openAssignShipsDialog(actor);
          const allShips2  = _allWorldShips();
          const assigned2  = new Set(getAssignedShips(actor));
          const source     = assigned2.size > 0
            ? allShips2.filter(s =>  assigned2.has(s.actorId))
            : allShips2;
          return source.map(s => ({
            label:              s.label,
            actorId:            s.actorId,
            systems:            s.shipActor.system?.systems     ?? {},
            depts:              s.shipActor.system?.departments ?? {},
            hasAdvancedSensors: s.shipActor.items?.some(i =>
              i.name.toLowerCase().includes("advanced sensor suites") ||
              i.name.toLowerCase().includes("advanced sensors")
            ) ?? false,
            sensorsBreaches:    s.shipActor.system?.systems?.sensors?.breaches ?? 0,
          }));
        },
      });
    }, true); // capture phase fires before ApplicationV2's delegated handler
  });
}

// In Foundry v13, ApplicationV2-based sheets fire render{ClassName} hooks,
// NOT the legacy renderActorSheet.  Register for every known STA2e sheet class
// so the override works regardless of which concrete sheet is opened.
// The _applySheetRollerOverride guard attribute prevents double-binding if
// more than one of these happens to fire for the same render.
for (const hookName of [
  "renderSTACharacterSheet2e",   // player character
  "renderSTANPCSheet2e",         // NPC
  "renderSTASupportingSheet2e",  // supporting character
  "renderSTAStarshipSheet2e",    // starship
  "renderSTASmallCraftSheet2e",  // smallcraft
  "renderSTAExtendedTaskSheet",  // extended task actor
  "renderSTAActors",             // base class (future-proofing / any new subclass)
  "renderActorSheet",            // legacy fallback for any non-AppV2 sheets
]) {
  Hooks.on(hookName, _applySheetRollerOverride);
}

// ---------------------------------------------------------------------------
// Supporting Character — Supervisory toggle
// ---------------------------------------------------------------------------
// The STA2e system determines stress track length by counting "value" items:
//   numValues === 1  →  ceil(stress / 2)  (Supporting Character)
//   numValues  >  1  →  full stress       (Supervisory Character)
// This is unreliable when a Supporting Character has multiple values or a
// Supervisory Character has only one.  We expose an explicit checkbox that
// stores a flag and recalculates stress.max directly.

function _calcSupportingStressMax(actor, isSupervisory) {
  const fitness  = actor.system.attributes?.fitness?.value  ?? 7;
  const strmod   = actor.system.strmod ?? 0;
  const command  = actor.system.disciplines?.command?.value ?? 2;
  const control  = actor.system.disciplines?.control?.value ?? 2;
  const hasTough = actor.items.some(i => i.name.toLowerCase().includes("tough"));
  const hasResolute = actor.items.some(i => i.name.toLowerCase().includes("resolute"));
  const hasMentalDiscipline = actor.items.some(i =>
    i.name.toLowerCase().includes("mental discipline"));
  let max = fitness + strmod;
  if (hasTough) max += 2;
  if (hasResolute) max += command;
  if (hasMentalDiscipline) max = control;
  if (!isSupervisory) max = Math.ceil(max / 2);
  return max;
}

Hooks.on("renderSTASupportingSheet2e", (app, html) => {
  const actor = app.document ?? app.actor;
  if (!actor) return;

  // ── Patch _StressTrackMax on the instance (once) ──────────────────────────
  // The system's _onRender calls _onStressTrackUpdate → _StressTrackMax on
  // every render.  By replacing it on the app instance we ensure our flag is
  // respected every time — including the re-render triggered by actor.update().
  if (!app._sta2eStressPatched) {
    app._sta2eStressPatched = true;
    app._StressTrackMax = async function() {
      const isSup = this.actor.getFlag("sta2e-toolkit", "supervisoryCharacter") ?? false;
      const numValues = this.actor.itemTypes.value.length;
      if (!numValues) return undefined;
      const localizedTough  = game.i18n.localize("sta.actor.character.talents.tough");
      const localizedRes    = game.i18n.localize("sta.actor.character.talents.resolute");
      const localizedMD     = game.i18n.localize("sta.actor.character.talents.mentaldiscipline");
      const fitness  = parseInt(this.element.querySelector("#fitness")?.value  || 0, 10);
      const strmod   = parseInt(this.element.querySelector("#strmod")?.value   || 0, 10);
      const command  = parseInt(this.element.querySelector("#command")?.value  || 0, 10);
      const control  = parseInt(this.element.querySelector("#control")?.value  || 0, 10);
      let max = fitness + strmod;
      if (this.element.querySelector(`[data-talent-name*="${localizedTough}"]`))  max += 2;
      if (this.element.querySelector(`[data-talent-name*="${localizedRes}"]`))    max += command;
      if (this.element.querySelector(`[data-talent-name*="${localizedMD}"]`))     max = control;
      if (!isSup) max = Math.ceil(max / 2);
      return max;
    };
    // Immediately re-render the stress track with the corrected max
    app._onStressTrackUpdate?.();
  }

  // ── Inject radio buttons below the stress track (once per DOM render) ─────
  if (html.querySelector(".sta2e-supervisory-toggle")) return;
  const stressTrack = html.querySelector("#bar-stress-renderer")?.closest(".track");
  if (!stressTrack) return;

  const isSupervisory = actor.getFlag("sta2e-toolkit", "supervisoryCharacter") ?? false;
  const wrapper = document.createElement("div");
  wrapper.className = "sta2e-supervisory-toggle";
  wrapper.style.cssText = "display:flex;gap:8px;margin:2px 0 4px;align-items:center;";
  wrapper.innerHTML = `
    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:0.78em;">
      <input type="radio" name="sta2e-char-rank" value="supporting"
        ${!isSupervisory ? "checked" : ""}
        style="accent-color:var(--sta2e-primary,#c47f00);">
      <span>Supporting</span>
    </label>
    <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:0.78em;">
      <input type="radio" name="sta2e-char-rank" value="supervisory"
        ${isSupervisory ? "checked" : ""}
        style="accent-color:var(--sta2e-primary,#c47f00);">
      <span>Supervisory</span>
    </label>`;
  stressTrack.insertAdjacentElement("afterend", wrapper);

  wrapper.querySelectorAll("input[type=radio]").forEach(radio => {
    radio.addEventListener("change", async () => {
      const nowSupervisory = wrapper.querySelector("input[value=supervisory]").checked;
      await actor.setFlag("sta2e-toolkit", "supervisoryCharacter", nowSupervisory);
      // _StressTrackMax is already patched — just trigger the track update
      app._onStressTrackUpdate?.();
    });
  });
});

// ---------------------------------------------------------------------------
// Starship / Smallcraft sheet — GM Toolkit settings button
// Adds a small icon button to the sheet's window header. Clicking it opens
// the combined STA GM Toolkit Settings dialog: warp speed config (Normal
// Cruise, Maximum Cruise, Emergency Maximum) plus a shortcut to the ship's
// Crew Manifest assignment dialog.
// ---------------------------------------------------------------------------

const _TOOLKIT_SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"
  width="16" height="16" style="display:block;pointer-events:none;">
  <defs><style>.tsi{fill:#fff;fill-rule:evenodd;}</style></defs>
  <path class="tsi" d="M417.871,58.62q0-9.943-10.062-20.122T342.235,23.347q-55.517-4.971-85.578-4.971-30.538,0-86.17,4.853T104.794,38.379q-10.065,10.3-10.061,20.24V452.54q0,10.182,10.3,20.241T170.723,487.7q55.395,4.854,85.7,5.326,30.3,0,86.052-5.208t65.574-15.151q9.821-9.942,9.825-20.122V58.62ZM307,281c-22.691,4.366-27.689,5.866-52,9-3.562-6.87-8.252-12.973-18-29-2.346-3.663,2.812.907,10-1,19.319,16.465,42.088,14.557,50,9,16.939-17.478,6.53-47.2-3-56-21.688-20.022-51.882-10.379-56-9-31.679,10.2-31.659,30.777-32,40-1.174,31.758,47.729,66,38,58-5.81-4.772,33.8,23.552,42,29l12,10c-24.912-10.113-74.558-32.134-92-39-2.773-23.19-7.72-60.795-10-82,40.363-26.75,6.008-4.2,60-40,18.843,12.134,33.388,22.118,61,39"/>
</svg>`;

async function openShipToolkitSettings(actor) {
  const cruiser   = actor.getFlag("sta2e-toolkit", "cruiserSpeed")       ?? "";
  const maxWarp   = actor.getFlag("sta2e-toolkit", "maxWarpSpeed")       ?? "";
  const emergency = actor.getFlag("sta2e-toolkit", "emergencyWarpSpeed") ?? "";
  const shieldDiagram = actor.getFlag("sta2e-toolkit", "shieldDiagram")  ?? "";

  // Wire the Crew Manifest and Shield Diagram Browse buttons before the dialog renders
  Hooks.once("renderDialogV2", (_app, dialogHtml) => {
    dialogHtml.querySelector(".sta2e-open-manifest-btn")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        openCrewManifest(actor);
      });

    dialogHtml.querySelector(".sta2e-browse-shield-diagram-btn")
      ?.addEventListener("click", (e) => {
        e.preventDefault();
        const input = dialogHtml.querySelector('input[name="shieldDiagram"]');
        if (input) {
          new foundry.applications.apps.FilePicker.implementation({
            type: "image",
            callback: (path) => {
              input.value = path;
            }
          }).browse();
        }
      });
  });

  const formData = await foundry.applications.api.DialogV2.prompt({
    window: { title: `STA GM Toolkit Settings — ${actor.name}` },
    position: { width: 340 },
    content: `
      <form style="padding:8px 4px;">
        <div style="font-size:0.75em;letter-spacing:0.07em;text-transform:uppercase;
                    opacity:0.55;margin-bottom:8px;">Warp Speeds</div>
        <div class="form-group" style="margin-bottom:8px;">
          <label>Normal Cruise</label>
          <input type="number" name="cruiserSpeed" value="${cruiser}"
            min="0.1" step="0.001" placeholder="e.g. 6" />
        </div>
        <div class="form-group" style="margin-bottom:8px;">
          <label>Maximum Cruise</label>
          <input type="number" name="maxWarpSpeed" value="${maxWarp}"
            min="0.1" step="0.001" placeholder="e.g. 9.6" />
        </div>
        <div class="form-group" style="margin-bottom:16px;">
          <label>Emergency Maximum (12hr)</label>
          <input type="number" name="emergencyWarpSpeed" value="${emergency}"
            min="0.1" step="0.001" placeholder="e.g. 9.975" />
        </div>
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin-bottom:12px;" />
        <div style="font-size:0.75em;letter-spacing:0.07em;text-transform:uppercase;
                    opacity:0.55;margin-bottom:12px;">Shield Diagram Portrait</div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:10px;">
          <input type="text" name="shieldDiagram" value="${shieldDiagram}"
            placeholder="Paste image URL or browse" style="flex:1;" />
          <button type="button" class="sta2e-browse-shield-diagram-btn"
            style="padding:8px 10px;min-width:auto;white-space:nowrap;cursor:pointer;font-size:1.2em;">
            📁
          </button>
        </div>
        <small style="display:block;opacity:0.6;font-size:0.8em;">
          Leave empty to use the standard actor portrait
        </small>
        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.15);margin-bottom:12px;" />
        <div style="font-size:0.75em;letter-spacing:0.07em;text-transform:uppercase;
                    opacity:0.55;margin-bottom:8px;">Crew Assignment</div>
        <button type="button" class="sta2e-open-manifest-btn"
          style="width:100%;cursor:pointer;">
          Manage Crew Manifest
        </button>
      </form>`,
    ok: {
      label: "Save",
      callback: (_event, _button, dialog) => {
        const form = dialog.element.querySelector("form");
        return form ? new foundry.applications.ux.FormDataExtended(form).object : null;
      },
    },
  });

  if (!formData) return;

  const cs = parseFloat(formData.cruiserSpeed);
  const mw = parseFloat(formData.maxWarpSpeed);
  const em = parseFloat(formData.emergencyWarpSpeed);

  if (cs > 0) await actor.setFlag("sta2e-toolkit", "cruiserSpeed", cs);
  else        await actor.unsetFlag("sta2e-toolkit", "cruiserSpeed").catch(() => {});

  if (mw > 0) await actor.setFlag("sta2e-toolkit", "maxWarpSpeed", mw);
  else        await actor.unsetFlag("sta2e-toolkit", "maxWarpSpeed").catch(() => {});

  if (em > 0) await actor.setFlag("sta2e-toolkit", "emergencyWarpSpeed", em);
  else        await actor.unsetFlag("sta2e-toolkit", "emergencyWarpSpeed").catch(() => {});

  const shieldDiagramUrl = formData.shieldDiagram?.trim();
  if (shieldDiagramUrl) await actor.setFlag("sta2e-toolkit", "shieldDiagram", shieldDiagramUrl);
  else                  await actor.unsetFlag("sta2e-toolkit", "shieldDiagram").catch(() => {});
}

function _addShipToolkitSettingsButton(app, html) {
  const actor = app.document ?? app.actor;
  if (!actor) return;

  // Guard against double-injection on re-renders
  const root = html.closest?.(".app")
    ?? html.ownerDocument?.querySelector(`[data-appid="${app.appId}"]`)
    ?? html;
  if (root.querySelector(".sta2e-toolkit-settings-btn")) return;

  const header = root.querySelector(".window-header");
  if (!header) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sta2e-toolkit-settings-btn header-control";
  btn.title = "STA GM Toolkit Settings";
  btn.style.cssText = "display:inline-flex;align-items:center;justify-content:center;"
    + "padding:2px 4px;line-height:1;";
  btn.innerHTML = _TOOLKIT_SETTINGS_ICON;
  btn.addEventListener("click", () => openShipToolkitSettings(actor));

  const closeBtn = header.querySelector('[data-action="close"], .close');
  if (closeBtn) closeBtn.before(btn);
  else header.appendChild(btn);
}

Hooks.on("renderSTAStarshipSheet2e",  _addShipToolkitSettingsButton);
Hooks.on("renderSTASmallCraftSheet2e", _addShipToolkitSettingsButton);

// ---------------------------------------------------------------------------
// createCombatant — when a ship token is added to the combat tracker,
// also add combatant entries for all assigned crew officers so the GM
// can see and act for each officer without needing tokens on the canvas.
// ---------------------------------------------------------------------------

Hooks.on("createCombatant", async (combatant, _options, userId) => {
  // GM only — don't run on player clients
  if (!game.user.isGM) return;
  // Only react to combatants the current user just created
  if (userId !== game.user.id) return;

  // Resolve the actor — for wildcard tokens, get the synthetic actor via the
  // canvas token so getCrewManifest can correctly find the token-scoped manifest
  let actor = combatant.actor;
  if (!actor) return;

  // Try to get the synthetic actor from the canvas token if available
  // (gives us actor.token which _manifestStore needs for unlinked tokens)
  const tokenId      = combatant.tokenId;
  const canvasToken  = tokenId ? canvas.tokens?.get(tokenId) : null;
  if (canvasToken?.actor) actor = canvasToken.actor;

  // Only process ship actors
  const isShip = actor.type === "starship" || actor.type === "spacecraft2e"
    || actor.items?.some(i => i.type === "starshipweapon2e");
  if (!isShip) return;

  const manifest = getCrewManifest(actor);
  if (!manifest) return;

  // Collect all unique officer actor IDs across all stations
  const seen      = new Set();
  const officers  = [];
  for (const slot of STATION_SLOTS) {
    const ids = manifest[slot.id] ?? [];
    for (const actorId of ids) {
      if (seen.has(actorId)) continue;
      seen.add(actorId);
      const officerActor = game.actors.get(actorId);
      if (officerActor) officers.push({ actor: officerActor, stationId: slot.id, stationLabel: slot.label });
    }
  }

  if (!officers.length) return;

  // Check which officers are already in the combat tracker to avoid duplicates
  const combat            = combatant.combat;
  const existingActorIds  = new Set(
    combat.combatants.map(c => c.actorId).filter(Boolean)
  );

  const toAdd = officers.filter(o => !existingActorIds.has(o.actor.id));
  if (!toAdd.length) return;

  // Create combatant entries — actor-only (no tokenId), named with station
  const combatantData = toAdd.map(o => ({
    actorId:  o.actor.id,
    tokenId:  null,
    name:     `${o.actor.name} (${o.stationLabel})`,
    hidden:   combatant.hidden,   // match ship's hidden state
    initiative: null,
  }));

  try {
    await combat.createEmbeddedDocuments("Combatant", combatantData);
    ui.notifications.info(
      `STA2e Toolkit: Added ${toAdd.length} crew officer${toAdd.length > 1 ? "s" : ""} to combat tracker for ${actor.name}.`
    );
  } catch (err) {
    console.warn("STA2e Toolkit | Could not add crew officers to combat tracker:", err);
  }
});

// ---------------------------------------------------------------------------
// renderChatMessageHTML — v13 native (HTMLElement, not jQuery)
// ---------------------------------------------------------------------------

Hooks.on("renderChatMessageHTML", (_message, html) => {

  // Hide the confirm/cancel buttons entirely for non-GM users —
  // only the GM should see or interact with them.
  if (!game.user.isGM) {
    html.querySelectorAll(".sta2e-warp-buttons").forEach(el => el.remove());
    return;
  }

  // Confirm travel button
  html.querySelector(".sta2e-confirm-travel")
    ?.addEventListener("click", async (e) => {
      if (!game.user.isGM) {
        ui.notifications.warn("Only the GM can confirm travel.");
        return;
      }
      // Capture references and delta BEFORE the await — Foundry may re-render
      // the chat message DOM after advanceByDuration resolves, invalidating e.currentTarget
      const btn = e.currentTarget;
      const delta = JSON.parse(decodeURIComponent(btn.dataset.delta));
      // Disable immediately so double-clicks don't fire twice
      html.querySelectorAll(".sta2e-warp-buttons button").forEach(b => {
        b.disabled = true;
        b.style.opacity = "0.5";
      });
      try {
        await game.sta2eToolkit.advanceByDuration(delta);
        // Re-query after await in case DOM was replaced; fall back to captured ref
        const confirmBtn = html.querySelector(".sta2e-confirm-travel") ?? btn;
        if (confirmBtn) confirmBtn.textContent = "✅ Travel Confirmed";
        ui.notifications.info("STA 2e Toolkit: Stardate advanced.");
      } catch (err) {
        console.error("STA 2e Toolkit | Error confirming travel:", err);
        ui.notifications.error("STA 2e Toolkit: Failed to advance stardate.");
        // Re-enable buttons so the GM can retry
        html.querySelectorAll(".sta2e-warp-buttons button").forEach(b => {
          b.disabled = false;
          b.style.opacity = "1";
        });
      }
    });

  // Cancel button
  html.querySelector(".sta2e-cancel-travel")
    ?.addEventListener("click", (e) => {
      html.querySelectorAll(".sta2e-warp-buttons button").forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = "0.5";
      });
      e.currentTarget.textContent = "❌ Cancelled";
    });
});

// ── Clear Rerouted Power flags when combat ends ──────────────────────────────
// Rerouted power is a per-combat benefit — clear any that weren't spent.
Hooks.on("deleteCombat", async (combat) => {
  const CombatHUD = game.sta2eToolkit?.CombatHUD;
  if (!CombatHUD || !game.user.isGM) return;
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;
    try { await CombatHUD.clearAllReroutedPower(actor); } catch {}
    // Clear treated-injury flags — treatment only lasts for the combat encounter
    const tokenDoc = canvas.tokens?.get(combatant.tokenId)?.document;
    if (tokenDoc) {
      try { await tokenDoc.unsetFlag("sta2e-toolkit", "treatedInjuries"); } catch {}
    }
  }
  // Close the HUD when the encounter ends
  game.sta2eToolkit?.combatHud?.forceClose();
});

// ── Clear Regain Power combat-use counters when combat ends ───────────────────
// Regain Power difficulty increases by 1 per use during combat — cleared when
// combat ends (not scene-based since scenes aren't reliably trackable).
Hooks.on("deleteCombat", async (combat) => {
  const CombatHUD = game.sta2eToolkit?.CombatHUD;
  if (!CombatHUD || !game.user.isGM) return;
  // Find all combatants that are ships and clear their regainPowerUses flag
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;
    try {
      const base = actor.isToken
        ? (game.actors.get(actor.id ?? actor._id) ?? actor)
        : actor;
      const tokenDoc = combatant.token;
      await base.unsetFlag("sta2e-toolkit", "regainPowerUses").catch(() => {});
      await tokenDoc?.unsetFlag("sta2e-toolkit", "regainPowerUses").catch(() => {});
    } catch {}
  }
  console.log("STA2e Toolkit | Combat ended — Regain Power use counters cleared.");
});

// ---------------------------------------------------------------------------
// Elevation-aware Ruler
// ---------------------------------------------------------------------------
// Foundry v13 removed the Elevation Ruler module's compatibility.
// This patch replaces it: when the ruler destination sits over a token whose
// elevation differs from the origin token (or ruler start), the final label
// appends the elevation difference and the true 3-D distance
// (√(horizontal² + Δh²)) so the GM/players can see actual range.
//
// Uses a one-time prototype patch (guarded by _sta2eElevPatch) applied on
// "ready" so Ruler is guaranteed to exist.  Falls back silently on any error.

Hooks.once("ready", () => {
  // In Foundry v13 the Ruler was refactored: labels are HTML elements rendered
  // via Handlebars from _getWaypointLabelContext (not _getSegmentLabel).
  // Each waypoint already carries its own elevation so we can compute the true
  // 3-D distance (√(horizontal² + Δelevation²)) and append it to the label.
  const RulerClass = foundry?.canvas?.interaction?.Ruler;
  if (!RulerClass) {
    console.warn("STA2e Toolkit | Elevation ruler: foundry.canvas.interaction.Ruler not found.");
    return;
  }
  if (RulerClass.prototype._sta2eElevPatch) return;
  RulerClass.prototype._sta2eElevPatch = true;

  const _origContext = RulerClass.prototype._getWaypointLabelContext;
  if (!_origContext) {
    console.warn("STA2e Toolkit | Elevation ruler: _getWaypointLabelContext not found on Ruler prototype.");
    return;
  }

  // Helper: return a token's elevation if one sits near canvas point (cx, cy).
  function _elevationAt(cx, cy, excludeToken) {
    const tok = canvas.tokens?.placeables?.find(tk => {
      if (tk === excludeToken) return false;
      return Math.hypot(tk.center.x - cx, tk.center.y - cy) < Math.min(tk.w, tk.h) * 0.6;
    });
    return tok !== undefined ? Number(tok.document.elevation) || 0 : null;
  }

  RulerClass.prototype._getWaypointLabelContext = function (waypoint, state) {
    const context = _origContext.call(this, waypoint, state);
    if (!context) return context;

    const { elevation, previous } = waypoint;

    // On the first segment record origin elevation and position for later use.
    if (previous && state._sta2eOriginElev === undefined) {
      const tokElev = _elevationAt(previous.x, previous.y, null);
      state._sta2eOriginElev = tokElev !== null ? tokElev : (previous.elevation ?? 0);
      state._sta2eOriginPos = { x: previous.x, y: previous.y };
    }

    // Only annotate the LAST waypoint.
    if (!previous || waypoint.next) return context;

    // ── Elevation annotation ──────────────────────────────────────────────
    try {
      const totalDist2D = waypoint.measurement?.distance ?? 0;
      if (totalDist2D > 0) {
        const destTokElev = _elevationAt(waypoint.x, waypoint.y, this.token ?? null);
        const destElev = destTokElev !== null ? destTokElev : (elevation ?? 0);
        const totalElevDiff = Math.abs(destElev - state._sta2eOriginElev);
        if (totalElevDiff > 0) {
          const dist3D = Math.sqrt(totalDist2D ** 2 + totalElevDiff ** 2);
          const fmt = v => (Math.round(v * 100) / 100).toLocaleString(game.i18n.lang);
          context.distance.total = `${context.distance.total} ⊿${fmt(dist3D)}`;
        }
      }
    } catch (err) {
      console.warn("STA2e Toolkit | Elevation ruler error:", err);
    }

    // ── Zone-based distance annotation ────────────────────────────────────
    try {
      const zoneOrigin = state._sta2eOriginPos;
      const perScene   = canvas?.scene?.getFlag("sta2e-toolkit", "zonesEnabled");
      const sceneOn    = perScene !== false;
      if (game.settings.get("sta2e-toolkit", "zoneRulerOverride") && sceneOn && zoneOrigin) {
        const zones = getSceneZones();
        if (zones.length > 0) {
          const zoneInfo = getZoneDistance(
            zoneOrigin,
            { x: waypoint.x, y: waypoint.y },
            zones
          );
          if (zoneInfo.fromZone && zoneInfo.toZone && zoneInfo.zoneCount >= 0) {
            const parts = [];
            parts.push(`${zoneInfo.zoneCount} zone${zoneInfo.zoneCount !== 1 ? "s" : ""}`);
            parts.push(zoneInfo.rangeBand);
            if (zoneInfo.momentumCost > 0) parts.push(`+${zoneInfo.momentumCost} Momentum`);
            context.distance.total += ` [${parts.join(" · ")}]`;

            // ── Combat movement limit indicators ─────────────────────────
            if (game.combat?.active) {
              const rulerToken = this.token;
              const actor = rulerToken?.actor ?? null;
              const isShip = actor?.system?.systems !== undefined;
              const zn = zoneInfo.zoneCount;

              if (isShip) {
                // Impulse: max 2 zones
                const impulseOk = zn <= 2;
                context.distance.total += impulseOk
                  ? ` 🟢 Impulse OK`
                  : ` 🔴 Impulse: ${zn}/2`;

                // Warp: max = Engines score
                const enginesScore = actor.system?.systems?.engines?.value ?? null;
                if (enginesScore != null) {
                  const warpOk = zn <= enginesScore;
                  context.distance.total += warpOk
                    ? ` 🟢 Warp OK (Eng ${enginesScore})`
                    : ` 🔴 Warp: ${zn}/${enginesScore}`;
                }
              } else if (actor) {
                // Ground character: default move 1 zone, sprint up to 2 zones
                const sprintOk = zn <= 2;
                const moveOk   = zn <= 1;
                context.distance.total += moveOk
                  ? ` 🟢 Move OK`
                  : sprintOk
                    ? ` 🟡 Sprint (${zn}/2)`
                    : ` 🔴 Over range (${zn}/2)`;
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("STA2e Toolkit | Zone ruler error:", err);
    }

    return context;
  };
});
