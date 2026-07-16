/**
 * sta2e-toolkit | lcars-action-ring.js
 * Compact player action ring docked near the Foundry hotbar.
 */

import { COMMAND_SEATS, getCrewManifest, readOfficerStats, setCrewManifest, STATION_SLOTS } from "./crew-manifest.js";
import { openNpcRoller } from "./npc-roller.js";
import { BRIDGE_STATIONS, CombatHUD, GROUND_ACTIONS, openWeaponAttackForOfficer } from "./combat-hud.js";
import { getActiveLcThemeKey, getLcCssVars, getLcTokens } from "./lcars-theme.js";

const MODULE = "sta2e-toolkit";
const RING_ID = "sta2e-lcars-action-ring";
const BASE_RING_SCALE = 0.625;
const OWNER = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
const EXCLUDED_CENTER_TYPES = new Set([
  "starship",
  "smallcraft",
  "spacecraft2e",
  "extendedtask",
  "extendedtasks",
  "extendedTask",
  "extended-tasks",
  "scenetraits",
]);
const SHIP_TYPES = new Set(["starship", "smallcraft"]);
const COMBAT_CATEGORY_META = {
  weapons: { title: "Weapons", icon: "fas fa-crosshairs" },
  minor:   { title: "Minor Actions", icon: "fas fa-stopwatch" },
  major:   { title: "Major Actions", icon: "fas fa-bolt" },
};
const COMBAT_ACTION_ICONS = {
  "ground-aim": "fas fa-bullseye",
  "ground-prepare": "fas fa-hourglass-half",
  "ground-prone": "fas fa-person-falling",
  "ground-interact": "fas fa-hand-pointer",
  "ground-first-aid": "fas fa-kit-medical",
  "ground-create-advantage": "fas fa-lightbulb",
  "ground-direct": "fas fa-bullhorn",
  "ground-guard": "fas fa-shield-halved",
  "ground-sprint": "fas fa-person-running",
  "attack-pattern": "fas fa-route",
  "evasive-action": "fas fa-arrows-turn-to-dots",
  "ram": "fas fa-explosion",
  "warp": "fas fa-forward-fast",
  "calibrate-weapons": "fas fa-screwdriver-wrench",
  "targeting-solution": "fas fa-bullseye",
  "prepare": "fas fa-shield-halved",
  "defensive-fire": "fas fa-shield",
  "scan-for-weakness": "fas fa-magnifying-glass",
  "sensor-sweep": "fas fa-satellite-dish",
  "reveal": "fas fa-eye",
  "damage-control": "fas fa-screwdriver-wrench",
  "first-aid": "fas fa-kit-medical",
  "pass": "fas fa-forward",
  "ready": "fas fa-bolt",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[ch]);
}

function ownerByUserOrDefault(document, user = game.user) {
  if (!document || !user) return false;
  const ownership = document.ownership ?? {};
  return Number(ownership[user.id] ?? 0) >= OWNER
    || Number(ownership.default ?? 0) >= OWNER;
}

function actorHasStaStats(actor) {
  return !!(actor?.system?.attributes && actor?.system?.disciplines);
}

function isValidCenterActor(actor) {
  if (!actor || EXCLUDED_CENTER_TYPES.has(actor.type)) return false;
  return actorHasStaStats(actor) && ownerByUserOrDefault(actor);
}

function isOwnedShipActor(actor) {
  return !!actor && SHIP_TYPES.has(actor.type) && ownerByUserOrDefault(actor);
}

function actorSort(a, b) {
  return String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
}

function setting(name, fallback = null) {
  try {
    return game.settings.get(MODULE, name);
  } catch {
    return fallback;
  }
}

function localize(key, fallback) {
  try {
    const value = game.i18n?.localize?.(key);
    return value && value !== key ? value : fallback;
  } catch {
    return fallback;
  }
}

function actionRingSize() {
  const value = Number(setting("lcarsRingSize", 100));
  return Math.min(1.5, Math.max(0.5, Number.isFinite(value) ? value / 100 : 1));
}

function actionRingVisualScale() {
  const responsiveScale = window.innerWidth <= 760 ? 0.88 : 1;
  return BASE_RING_SCALE * actionRingSize() * responsiveScale;
}

function ringThemeContext() {
  const key = getActiveLcThemeKey();
  const tokens = getLcTokens();
  // Mirror the calendar HUD's three-color LCARS Classic palette rather than
  // reducing it to the generic shared-widget gold and yellow tokens.
  if (key === "lcars-tng") {
    return {
      key,
      tokens: {
        ...tokens,
        primary: "#ff9900",
        secondary: "#cc88ff",
        tertiary: "#ffcc66",
        text: "#ffcc88",
        textDim: "#aa6600",
        textBright: "#ffffff",
        border: "#cc6600",
        borderDim: "#402000",
      },
    };
  }
  return { key, tokens };
}

function ringThemeStyle(tokens) {
  return `${getLcCssVars("sta2e-ring", tokens)}--sta2e-ring-ink:${tokens.bg};`;
}

function applyRingTheme(element) {
  if (!element) return;
  const { key, tokens } = ringThemeContext();
  element.dataset.theme = key;
  for (const declaration of ringThemeStyle(tokens).split(";").filter(Boolean)) {
    const [property, value] = declaration.split(":");
    element.style.setProperty(property, value);
  }
}

function ringDialogThemeAttributes() {
  const { key, tokens } = ringThemeContext();
  return `data-theme="${key}" style="${ringThemeStyle(tokens)}"`;
}

function selectedShipMap() {
  const value = setting("lcarsRingShipByActor", {});
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ringFavorites() {
  const value = setting("lcarsRingFavorites", {});
  const idsFor = key => Array.isArray(value?.[key])
    ? [...new Set(value[key].filter(id => typeof id === "string" && id))]
    : [];
  return { characters: idsFor("characters"), ships: idsFor("ships") };
}

function combatantToken(combatant) {
  if (!combatant?.tokenId) return null;
  return canvas.tokens?.get(combatant.tokenId)
    ?? canvas.tokens?.placeables?.find(token => token.id === combatant.tokenId)
    ?? null;
}

function combatActionIcon(entry) {
  if (entry?.kind === "weapon") return "fas fa-crosshairs";
  return COMBAT_ACTION_ICONS[entry?.action?.key] ?? "fas fa-dice-d20";
}

function serializeShip(actor) {
  return {
    label: actor.name,
    actorId: actor.id,
    systems: actor.system?.systems ?? {},
    depts: actor.system?.departments ?? {},
    hasAdvancedSensors: actor.items?.some(i => {
      const name = i.name?.toLowerCase?.() ?? "";
      return name.includes("advanced sensor suites") || name.includes("advanced sensors");
    }) ?? false,
    sensorsBreaches: actor.system?.systems?.sensors?.breaches ?? 0,
  };
}

function polarToCartesian(cx, cy, radius, angleDeg) {
  const angleRad = (angleDeg - 90) * Math.PI / 180;
  return {
    x: cx + (radius * Math.cos(angleRad)),
    y: cy + (radius * Math.sin(angleRad)),
  };
}

function ringSegmentPath(startAngle, endAngle, { cx = 120, cy = 120, outer = 116, inner = 80 } = {}) {
  const outerStart = polarToCartesian(cx, cy, outer, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outer, startAngle);
  const innerStart = polarToCartesian(cx, cy, inner, startAngle);
  const innerEnd = polarToCartesian(cx, cy, inner, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M", outerStart.x, outerStart.y,
    "A", outer, outer, 0, largeArc, 0, outerEnd.x, outerEnd.y,
    "L", innerStart.x, innerStart.y,
    "A", inner, inner, 0, largeArc, 1, innerEnd.x, innerEnd.y,
    "Z",
  ].join(" ");
}

function ringSegmentLabelPosition(startAngle, endAngle, { cx = 120, cy = 120, radius = 98 } = {}) {
  return polarToCartesian(cx, cy, radius, (startAngle + endAngle) / 2);
}

function userDisplayFlaggedForMonksCommonDisplay() {
  const candidates = ["monks-common-display", "monks-common-display2"];
  const moduleActive = candidates.some(id => game.modules.get(id)?.active);
  const titleActive = Array.from(game.modules?.values?.() ?? []).some(mod =>
    mod?.active && /monk'?s common display/i.test(mod.title ?? mod.id ?? "")
  );
  if (!moduleActive && !titleActive) return false;

  const userFlagScopes = ["monks-common-display", "monks-common-display2"];
  const userFlagKeys = ["display", "isDisplay", "commonDisplay", "streaming", "hideHud", "hideUI"];
  for (const scope of userFlagScopes) {
    for (const key of userFlagKeys) {
      try {
        if (game.user?.getFlag?.(scope, key) === true) return true;
      } catch {
        // Foundry throws for inactive/unknown flag scopes; optional module probes must be quiet.
      }
    }
  }

  const api = globalThis.MonksCommonDisplay ?? globalThis.monksCommonDisplay;
  return !!(api?.isDisplayClient || api?.isDisplay || api?.displayClient);
}

export class LcarsActionRing {
  constructor() {
    this._el = null;
    this._activeActor = null;
    this._combatBranch = null;
    this._combatBranchEntries = [];
    this._resizeHandler = () => this.refresh();
    this._outsideClickHandler = event => {
      if (this._combatBranch && this._el && !this._el.contains(event.target)) {
        this._combatBranch = null;
        this.refresh();
      }
    };
    this._documentKeydownHandler = event => {
      if (event.key !== "Escape" || !this._combatBranch) return;
      this._combatBranch = null;
      this.refresh();
    };
  }

  init() {
    window.addEventListener("resize", this._resizeHandler);
    document.addEventListener("click", this._outsideClickHandler);
    document.addEventListener("keydown", this._documentKeydownHandler);
    this.refresh();
  }

  destroy() {
    this._el?.remove();
    this._el = null;
    this._combatBranch = null;
    this._combatBranchEntries = [];
  }

  refresh() {
    if (!this._shouldRender()) {
      this.destroy();
      return;
    }
    const actor = this._resolveActiveActor();
    this._activeActor = actor;
    this._render(actor);
  }

  debugState() {
    return {
      enabled: setting("lcarsRingEnabled", true),
      hiddenForStreaming: setting("lcarsRingHiddenForStreaming", false),
      collapsed: setting("lcarsRingCollapsed", false),
      size: setting("lcarsRingSize", 100),
      monksDisplayClient: userDisplayFlaggedForMonksCommonDisplay(),
      activeActorId: setting("lcarsRingActiveActorId", ""),
      validCenterActors: this._validCenterActors().map(actor => ({
        id: actor.id,
        name: actor.name,
        type: actor.type,
        ownership: actor.ownership?.[game.user?.id] ?? 0,
      })),
      ownedShips: this._ownedShips().map(actor => ({
        id: actor.id,
        name: actor.name,
        type: actor.type,
        ownership: actor.ownership?.[game.user?.id] ?? 0,
      })),
      elementPresent: !!document.getElementById(RING_ID),
    };
  }

  _shouldRender() {
    if (!setting("lcarsRingEnabled", true)) return false;
    if (setting("lcarsRingHiddenForStreaming", false)) return false;
    if (userDisplayFlaggedForMonksCommonDisplay()) return false;
    return !!game.user;
  }

  _validCenterActors() {
    return game.actors.filter(isValidCenterActor).sort(actorSort);
  }

  _ownedShips() {
    return game.actors.filter(isOwnedShipActor).sort(actorSort);
  }

  _favoriteIds(kind) {
    return ringFavorites()[kind] ?? [];
  }

  async _toggleFavorite(kind, id) {
    const favorites = ringFavorites();
    const ids = new Set(favorites[kind] ?? []);
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    favorites[kind] = [...ids];
    await game.settings.set(MODULE, "lcarsRingFavorites", favorites);
    return favorites[kind];
  }

  _pickerCards(items, { kind, inputName, selectedId, emptyMessage = "No matching entries." }) {
    const favorites = new Set(this._favoriteIds(kind));
    const sorted = [...items].sort((a, b) => {
      const favoriteOrder = Number(favorites.has(b.id)) - Number(favorites.has(a.id));
      return favoriteOrder || actorSort(a, b);
    });
    if (!sorted.length) {
      return `<p class="sta2e-lcars-ring-dialog__empty">${escapeHtml(emptyMessage)}</p>`;
    }
    return sorted.map(item => {
      const favorite = favorites.has(item.id);
      const token = this._findTokenForActor(item);
      const image = token?.document?.texture?.src ?? token?.actor?.img ?? item.img ?? "icons/svg/mystery-man.svg";
      const name = item.name ?? "Unnamed";
      const favoriteLabel = favorite ? `Remove ${name} from favorites` : `Add ${name} to favorites`;
      return `
        <div class="sta2e-lcars-ring-dialog__choice${favorite ? " is-favorite" : ""}">
          <label class="sta2e-lcars-ring-dialog__choice-main">
            <input type="radio" name="${escapeHtml(inputName)}" value="${escapeHtml(item.id)}"${item.id === selectedId ? " checked" : ""} />
            <img src="${escapeHtml(image)}" alt="" />
            <span>${escapeHtml(name)}</span>
          </label>
          <button type="button" class="sta2e-lcars-ring-dialog__favorite${favorite ? " is-favorite" : ""}"
                  data-lcars-favorite="${escapeHtml(item.id)}" title="${escapeHtml(favoriteLabel)}"
                  aria-label="${escapeHtml(favoriteLabel)}" aria-pressed="${favorite}">
            <i class="${favorite ? "fas" : "far"} fa-star" aria-hidden="true"></i>
          </button>
        </div>`;
    }).join("");
  }

  _bindPickerFavorites(dialog, items, { kind, inputName, selectedId }) {
    const list = dialog.element?.querySelector("[data-lcars-picker-list]");
    if (!list) return;
    const filterInput = dialog.element.querySelector("[data-lcars-picker-filter]");
    const sceneOnlyInput = dialog.element.querySelector("[data-lcars-picker-scene]");
    let currentSelection = selectedId;
    let filterText = filterInput?.value?.trim().toLocaleLowerCase() ?? "";
    let sceneOnly = !!sceneOnlyInput?.checked;
    const matchingItems = () => items.filter(item => {
      if (filterText && !String(item.name ?? "").toLocaleLowerCase().includes(filterText)) return false;
      return !sceneOnly || !!this._findTokenForActor(item);
    });
    const draw = () => {
      list.dataset.lcarsPickerSelected = currentSelection;
      list.innerHTML = this._pickerCards(matchingItems(), { kind, inputName, selectedId: currentSelection });
      list.querySelectorAll("[data-lcars-favorite]").forEach(button => {
        button.addEventListener("click", async event => {
          event.preventDefault();
          event.stopPropagation();
          const id = button.dataset.lcarsFavorite;
          if (!id) return;
          try {
            await this._toggleFavorite(kind, id);
            draw();
          } catch (err) {
            console.error("STA2e Toolkit | Failed to update LCARS ring favorites:", err);
            ui.notifications.error("STA2e Toolkit: Could not update LCARS ring favorites.");
          }
        });
      });
    };
    list.addEventListener("change", event => {
      const input = event.target.closest(`input[name="${inputName}"]`);
      if (!input?.checked) return;
      currentSelection = input.value;
      list.dataset.lcarsPickerSelected = currentSelection;
    });
    filterInput?.addEventListener("input", () => {
      filterText = filterInput.value.trim().toLocaleLowerCase();
      draw();
    });
    sceneOnlyInput?.addEventListener("change", () => {
      sceneOnly = sceneOnlyInput.checked;
      draw();
    });
    draw();
  }

  _findTokenForActor(actor) {
    if (!actor) return null;
    const controlled = canvas.tokens?.controlled?.find(t => t.actor?.id === actor.id);
    if (controlled) return controlled;
    return canvas.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;
  }

  _resolveActiveActor() {
    const actors = this._validCenterActors();
    if (!actors.length) return null;

    const savedId = setting("lcarsRingActiveActorId", "");
    const saved = actors.find(a => a.id === savedId);
    if (saved) return saved;

    const controlled = canvas.tokens?.controlled
      ?.map(t => t.actor)
      .find(actor => actors.some(a => a.id === actor?.id));
    if (controlled) return controlled;

    const primary = game.user.character;
    if (primary && actors.some(a => a.id === primary.id)) return primary;

    return actors[0];
  }

  _selectedShip(actor) {
    const shipId = selectedShipMap()[actor?.id];
    const ship = shipId ? game.actors.get(shipId) : null;
    return isOwnedShipActor(ship) ? ship : null;
  }

  _stationForActor(ship, actor) {
    if (!ship || !actor) return null;
    const manifest = getCrewManifest(ship);
    const slot = STATION_SLOTS.find(entry => (manifest[entry.id] ?? []).includes(actor.id));
    return slot ? BRIDGE_STATIONS.find(station => station.id === slot.id) ?? null : null;
  }

  _shipsForRoller(actor) {
    const ships = this._ownedShips();
    const selected = this._selectedShip(actor);
    if (!selected) return ships.map(serializeShip);
    return [
      selected,
      ...ships.filter(ship => ship.id !== selected.id),
    ].map(serializeShip);
  }

  _combatContext(actor) {
    if (!game.combat?.active) return { valid: false, reason: "Combat tracker is not active." };
    if (!actor) return { valid: false, reason: "Select an active character first." };

    const selectedShip = this._selectedShip(actor);
    const combatants = game.combat.combatants ?? [];
    const shipCombatant = selectedShip
      ? combatants.find(combatant => combatant.actor?.id === selectedShip.id)
      : null;

    // A selected combat ship takes precedence over ground context so a player
    // can explicitly choose whether their ring is operating at a bridge post.
    if (shipCombatant) {
      const shipToken = combatantToken(shipCombatant);
      if (!shipToken) {
        return { valid: false, reason: "The selected combat ship needs a canvas token." };
      }
      const manifest = getCrewManifest(selectedShip);
      const stationIds = STATION_SLOTS
        .filter(slot => (manifest[slot.id] ?? []).includes(actor.id))
        .map(slot => slot.id);
      if (!stationIds.length) {
        return { valid: false, reason: "Assign this character to a station on the selected combat ship." };
      }
      return {
        valid: true,
        kind: "starship",
        actor,
        ship: selectedShip,
        token: shipToken,
        stationIds,
        key: `starship:${selectedShip.id}:${stationIds.join(",")}`,
      };
    }

    const actorCombatant = combatants.find(combatant => combatant.actor?.id === actor.id);
    const actorToken = combatantToken(actorCombatant);
    if (actorCombatant && actorToken) {
      return {
        valid: true,
        kind: "ground",
        actor,
        token: actorToken,
        key: `ground:${actor.id}:${actorToken.id}`,
      };
    }

    if (selectedShip) {
      return { valid: false, reason: "The selected ship is not in the active combat tracker." };
    }
    return { valid: false, reason: "The active character needs a token in the combat tracker." };
  }

  _combatCategories(context) {
    if (!context?.valid) return [];
    if (context.kind === "ground") {
      const weapons = context.actor.items
        .filter(item => item.type === "characterweapon2e")
        .map(weapon => ({ kind: "weapon", weapon, title: `Attack with ${weapon.name}` }));
      return [
        { id: "weapons", entries: weapons },
        { id: "minor", entries: GROUND_ACTIONS.minor.map(action => ({ kind: "action", action, station: null })) },
        { id: "major", entries: GROUND_ACTIONS.major.map(action => ({ kind: "action", action, station: null })) },
      ];
    }

    const stations = context.stationIds
      .map(id => BRIDGE_STATIONS.find(station => station.id === id))
      .filter(Boolean);
    const stationEntries = (type) => {
      const seen = new Set();
      return stations.flatMap(station => (station[type] ?? []).map(action => ({ action, station })))
        .filter(({ action }) => {
          if (!action.key || action.key === "override" || seen.has(action.key)) return false;
          seen.add(action.key);
          return true;
        })
        .map(({ action, station }) => ({ kind: "action", action, station }));
    };
    const tactical = context.stationIds.includes("tactical");
    const weapons = context.ship.items
      .filter(item => item.type === "starshipweapon2e")
      .map(weapon => ({
        kind: "weapon",
        weapon,
        override: !tactical,
        title: `${tactical ? "Fire" : "Override fire"}: ${weapon.name}${tactical ? "" : " (+1 Difficulty)"}`,
      }));
    return [
      { id: "weapons", entries: weapons },
      { id: "minor", entries: stationEntries("minor") },
      { id: "major", entries: stationEntries("major") },
    ];
  }

  _branchSegments(context) {
    if (!this._combatBranch || this._combatBranch.key !== context.key) return [];
    const categories = this._combatCategories(context);
    const categorySegments = categories.map((category, index) => ({
      action: "combat-category",
      categoryId: category.id,
      cls: this._combatBranch.categoryId === category.id
        && ["actions", "targeting-choice", "targeting-systems", "sensor-choice"].includes(this._combatBranch.level)
        ? "combat-category-active"
        : "combat-category",
      icon: COMBAT_CATEGORY_META[category.id].icon,
      title: category.entries.length
        ? COMBAT_CATEGORY_META[category.id].title
        : `${COMBAT_CATEGORY_META[category.id].title} (none available)`,
      disabled: category.entries.length === 0,
      start: 276 + (index * 46),
      end: 318 + (index * 46),
      outer: 150,
      inner: 120,
      labelRadius: 135,
    }));
    if (this._combatBranch.level === "categories") {
      this._combatBranchEntries = categories;
      return categorySegments;
    }

    if (this._combatBranch.level === "targeting-choice" || this._combatBranch.level === "targeting-systems") {
      if (!CombatHUD.hasTargetingSolution(context.token)) return categorySegments;
      const targeting = CombatHUD.getTargetingSolution(context.token) ?? {};
      const choiceSegments = [
        {
          action: "combat-targeting-reroll",
          cls: targeting.benefit === "reroll" ? "combat-targeting-active" : "combat-targeting",
          icon: "fas fa-rotate-left",
          title: "Targeting Solution: reroll one d20 on the next attack",
          start: 256,
          end: 340,
          outer: 182,
          inner: 152,
          labelRadius: 167,
        },
        {
          action: "combat-targeting-systems",
          cls: ["system", "both"].includes(targeting.benefit) ? "combat-targeting-active" : "combat-targeting",
          icon: "fas fa-microchip",
          title: "Targeting Solution: choose the system hit by the next attack",
          start: 344,
          end: 428,
          outer: 182,
          inner: 152,
          labelRadius: 167,
        },
      ];
      if (this._combatBranch.level === "targeting-choice") return [...categorySegments, ...choiceSegments];

      const systems = ["communications", "computers", "engines", "sensors", "structure", "weapons"];
      const start = 256;
      const arc = 172;
      const slot = arc / systems.length;
      const systemSegments = systems.map((system, index) => ({
        action: "combat-targeting-system",
        system,
        cls: targeting.system === system ? "combat-targeting-active" : "combat-targeting",
        icon: "fas fa-microchip",
        title: `Targeting Solution: target ${CombatHUD.systemLabel(system)}`,
        start: start + (index * slot) + 2,
        end: start + ((index + 1) * slot) - 2,
        outer: 182,
        inner: 152,
        labelRadius: 167,
      }));
      return [...categorySegments, ...systemSegments];
    }

    if (this._combatBranch.level === "sensor-choice") {
      if (!CombatHUD.hasCalibratesensors(context.token)) return categorySegments;
      return [...categorySegments,
        {
          action: "combat-sensor-reroll",
          cls: "combat-sensor",
          icon: "fas fa-rotate-left",
          title: "Calibrate Sensors: reroll one d20 on the next Sensor Operations task",
          start: 256,
          end: 340,
          outer: 182,
          inner: 152,
          labelRadius: 167,
        },
        {
          action: "combat-sensor-ignore-trait",
          cls: "combat-sensor",
          icon: "fas fa-ban",
          title: "Calibrate Sensors: ignore one trait affecting the next Sensor Operations task",
          start: 344,
          end: 428,
          outer: 182,
          inner: 152,
          labelRadius: 167,
        },
      ];
    }

    const category = categories.find(item => item.id === this._combatBranch.categoryId);
    const entries = category?.entries ?? [];
    this._combatBranchEntries = entries;
    if (!entries.length) return categorySegments;
    const start = 256;
    const arc = 186;
    const slot = arc / entries.length;
    const actionSegments = entries.map((entry, index) => ({
      action: entry.action?.isInfo ? null : "combat-entry",
      entryIndex: index,
      cls: entry.kind === "weapon" ? "combat-weapon" : "combat-action",
      icon: combatActionIcon(entry),
      title: entry.title ?? `${entry.station ? `${entry.station.label}: ` : ""}${entry.action?.label ?? "Combat action"}${entry.action?.tooltip ? ` — ${entry.action.tooltip}` : ""}`,
      disabled: !!entry.action?.isInfo,
      start: start + (index * slot) + 2,
      end: start + ((index + 1) * slot) - 2,
      outer: 182,
      inner: 152,
      labelRadius: 167,
    }));
    return [...categorySegments, ...actionSegments];
  }

  async _runCombatEntry(entry, context) {
    const combatHud = game.sta2eToolkit?.combatHud;
    if (!entry || !context?.valid || !combatHud) {
      ui.notifications.warn("STA2e Toolkit: Combat actions are not ready.");
      return;
    }
    if (entry.kind === "weapon") {
      if (context.kind === "ground") {
        combatHud.triggerRingWeapon(context.token, entry.weapon.id);
      } else {
        await openWeaponAttackForOfficer(
          context.ship,
          context.token,
          entry.weapon,
          readOfficerStats(context.actor),
          { override: !!entry.override },
        );
      }
      return;
    }
    await combatHud.triggerRingAction(context.token, entry.action, entry.station);
  }

  _render(actor) {
    if (!this._el) {
      document.getElementById(RING_ID)?.remove();
      this._el = document.createElement("div");
      this._el.id = RING_ID;
      this._el.addEventListener("click", event => this._onClick(event));
      this._el.addEventListener("keydown", event => this._onKeyDown(event));
      document.body.appendChild(this._el);
    }

    const token = this._findTokenForActor(actor);
    const img = token?.document?.texture?.src ?? token?.actor?.img ?? actor?.img ?? "icons/svg/mystery-man.svg";
    const portraitTitle = actor ? `Open ${actor.name}` : "No owned character found";
    const noActorClass = actor ? "" : " sta2e-lcars-ring--empty";
    const collapsed = setting("lcarsRingCollapsed", false) === true;
    const toggleLabel = localize(
      collapsed ? "STA2E.LcarsRing.Toggle.Show" : "STA2E.LcarsRing.Toggle.Hide",
      collapsed ? "Show action ring" : "Hide action ring",
    );
    const combatContext = this._combatContext(actor);
    if (this._combatBranch && this._combatBranch.key !== combatContext.key) {
      this._combatBranch = null;
      this._combatBranchEntries = [];
    }
    const segments = [
      { action: "pick-character", cls: "character", icon: "fas fa-user-astronaut", title: "Change active character", start: 276, end: 318 },
      { action: "task-roll", cls: "roll", icon: "fas fa-dice-d20", title: "Open task roller", start: 322, end: 364 },
      { action: "pick-ship", cls: "ship", icon: "fas fa-rocket", title: "Select current ship", start: 54, end: 96 },
      { action: "assign-station", cls: "station", icon: "fas fa-chair", title: "Assign station", start: 100, end: 142 },
    ];
    const blankSegments = [
      { cls: "blank", start: 146, end: 272 },
    ];
    if (game.combat?.active) {
      segments.push({
        action: combatContext.valid ? "combat-tasks" : null,
        cls: combatContext.valid ? "combat" : "combat-disabled",
        icon: "fas fa-crosshairs",
        title: combatContext.valid ? "Combat tasks" : combatContext.reason,
        disabled: !combatContext.valid,
        start: 8,
        end: 50,
      });
    } else {
      segments.push({
        action: "create-trait",
        cls: "trait",
        icon: "fas fa-plus-circle",
        title: "Create trait",
        start: 8,
        end: 50,
      });
    }
    const branchSegments = combatContext.valid ? this._branchSegments(combatContext) : [];
    const renderPath = segment => {
      const interactive = !!segment.action && !segment.disabled;
      const data = interactive
        ? `data-action="${segment.action}"${segment.categoryId ? ` data-category-id="${segment.categoryId}"` : ""}${segment.system ? ` data-system="${segment.system}"` : ""}${Number.isInteger(segment.entryIndex) ? ` data-entry-index="${segment.entryIndex}"` : ""}`
        : "";
      return `
        <path class="sta2e-lcars-ring__segment sta2e-lcars-ring__segment--${segment.cls}${segment.disabled ? " sta2e-lcars-ring__segment--disabled" : ""}"
              ${data}
              ${interactive ? "tabindex=\"0\" role=\"button\"" : "aria-disabled=\"true\""}
              title="${escapeHtml(segment.title)}"
              aria-label="${escapeHtml(segment.title)}"
              d="${ringSegmentPath(segment.start, segment.end, { outer: segment.outer ?? 116, inner: segment.inner ?? 80 })}">
          <title>${escapeHtml(segment.title)}</title>
        </path>`;
    };
    const labelSegments = [...segments, ...branchSegments];

    this._el.className = `${noActorClass}${collapsed ? " sta2e-lcars-ring--collapsed" : ""}`.trim();
    applyRingTheme(this._el);
    this._el.style.setProperty("--sta2e-ring-scale", String(actionRingVisualScale()));
    this._el.innerHTML = `
      ${collapsed ? "" : `
        <svg class="sta2e-lcars-ring__svg" viewBox="0 0 240 240" aria-label="LCARS action ring">
          ${blankSegments.map(segment => `
            <path class="sta2e-lcars-ring__segment sta2e-lcars-ring__segment--${segment.cls}"
                  aria-hidden="true"
                  d="${ringSegmentPath(segment.start, segment.end)}"></path>
          `).join("")}
          ${segments.map(renderPath).join("")}
          ${branchSegments.map(renderPath).join("")}
        </svg>
        ${labelSegments.map(segment => {
          const pos = ringSegmentLabelPosition(segment.start, segment.end, { radius: segment.labelRadius ?? 98 });
          return `
          <div class="sta2e-lcars-ring__segment-label sta2e-lcars-ring__segment-label--${segment.cls}${segment.outer ? " sta2e-lcars-ring__segment-label--branch" : ""}${segment.disabled ? " sta2e-lcars-ring__segment-label--disabled" : ""}"
               style="left:${pos.x.toFixed(1)}px;top:${pos.y.toFixed(1)}px;">
            <i class="${segment.icon}"></i>
          </div>
        `;
        }).join("")}
        <button type="button" class="sta2e-lcars-ring__portrait" data-action="open-actor" title="${escapeHtml(portraitTitle)}">
          <img src="${escapeHtml(img)}" alt="" />
        </button>
      `}
      <button type="button" class="sta2e-lcars-ring__toggle" data-action="toggle-collapse"
              title="${escapeHtml(toggleLabel)}" aria-label="${escapeHtml(toggleLabel)}"
              aria-expanded="${String(!collapsed)}">${collapsed ? "▲" : "▼"}</button>
    `;
    this._positionNearHotbar();
  }

  _positionNearHotbar() {
    if (!this._el) return;

    const hotbar = document.getElementById("hotbar");
    if (!hotbar) {
      this._el.style.left = "6px";
      this._el.style.bottom = "10px";
      return;
    }

    const gap = 8;
    const rect = hotbar.getBoundingClientRect();
    const width = (this._el.offsetWidth || 252) * actionRingVisualScale();
    const left = Math.max(6, Math.floor(rect.left - width - gap));
    const bottom = Math.max(6, Math.floor(window.innerHeight - rect.bottom));

    this._el.style.left = `${left}px`;
    this._el.style.bottom = `${bottom}px`;
  }

  async _onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const action = button.dataset.action;
    try {
      if (action === "toggle-collapse") {
        this._combatBranch = null;
        this._combatBranchEntries = [];
        await game.settings.set(MODULE, "lcarsRingCollapsed", !setting("lcarsRingCollapsed", false));
        this.refresh();
      } else if (action === "open-actor") {
        if (this._activeActor) this._activeActor.sheet?.render?.(true);
        else ui.notifications.warn("STA2e Toolkit: No owned character actors found for this user.");
      } else if (action === "pick-character") {
        await this._pickCharacter();
      } else if (action === "task-roll") {
        await this._openTaskRoller();
      } else if (action === "pick-ship") {
        await this._pickShip();
      } else if (action === "assign-station") {
        await this._assignStation();
      } else if (action === "create-trait") {
        await this._createTrait();
      } else if (action === "combat-tasks") {
        const context = this._combatContext(this._activeActor);
        if (!context.valid) {
          ui.notifications.warn(`STA2e Toolkit: ${context.reason}`);
          return;
        }
        this._combatBranch = this._combatBranch
          ? null
          : { key: context.key, level: "categories", categoryId: null };
        this.refresh();
      } else if (action === "combat-category") {
        const context = this._combatContext(this._activeActor);
        const categoryId = button.dataset.categoryId;
        const category = this._combatCategories(context).find(item => item.id === categoryId);
        if (!context.valid || !category?.entries.length) return;
        this._combatBranch = { key: context.key, level: "actions", categoryId };
        this.refresh();
      } else if (action === "combat-entry") {
        const entry = this._combatBranchEntries[Number(button.dataset.entryIndex)];
        const context = this._combatContext(this._activeActor);
        const isTargetingSolution = entry?.action?.key === "targeting-solution" && context.kind === "starship";
        const isCalibrateSensors = entry?.action?.key === "calibrate-sensors" && context.kind === "starship";
        this._combatBranch = null;
        this.refresh();
        await this._runCombatEntry(entry, context);
        if (isTargetingSolution && CombatHUD.hasTargetingSolution(context.token)) {
          this._combatBranch = { key: context.key, level: "targeting-choice", categoryId: "minor" };
          this.refresh();
        } else if (isCalibrateSensors && CombatHUD.hasCalibratesensors(context.token)) {
          this._combatBranch = { key: context.key, level: "sensor-choice", categoryId: "minor" };
          this.refresh();
        }
      } else if (action === "combat-targeting-reroll") {
        const context = this._combatContext(this._activeActor);
        if (context.kind !== "starship") return;
        await game.sta2eToolkit?.combatHud?.triggerRingAction(
          context.token,
          { key: "ts-reroll" },
          BRIDGE_STATIONS.find(station => station.id === "tactical") ?? null,
        );
        this._combatBranch = { key: context.key, level: "targeting-choice", categoryId: "minor" };
        this.refresh();
      } else if (action === "combat-targeting-systems") {
        const context = this._combatContext(this._activeActor);
        if (context.kind !== "starship") return;
        this._combatBranch = { key: context.key, level: "targeting-systems", categoryId: "minor" };
        this.refresh();
      } else if (action === "combat-targeting-system") {
        const context = this._combatContext(this._activeActor);
        if (context.kind !== "starship") return;
        await game.sta2eToolkit?.combatHud?.triggerRingAction(
          context.token,
          { key: `ts-system-${button.dataset.system}` },
          BRIDGE_STATIONS.find(station => station.id === "tactical") ?? null,
        );
        this._combatBranch = { key: context.key, level: "targeting-choice", categoryId: "minor" };
        this.refresh();
      } else if (action === "combat-sensor-reroll") {
        const context = this._combatContext(this._activeActor);
        if (context.kind !== "starship") return;
        await game.sta2eToolkit?.combatHud?.triggerRingAction(
          context.token,
          { key: "cs-reroll" },
          BRIDGE_STATIONS.find(station => station.id === "sensors") ?? null,
        );
        this._combatBranch = { key: context.key, level: "sensor-choice", categoryId: "minor" };
        this.refresh();
      } else if (action === "combat-sensor-ignore-trait") {
        const context = this._combatContext(this._activeActor);
        if (context.kind !== "starship") return;
        await game.sta2eToolkit?.combatHud?.triggerRingAction(
          context.token,
          { key: "cs-ignore-trait" },
          BRIDGE_STATIONS.find(station => station.id === "sensors") ?? null,
        );
        this._combatBranch = { key: context.key, level: "actions", categoryId: "minor" };
        this.refresh();
      }
    } catch (err) {
      console.error("STA2e Toolkit | LCARS action ring action failed:", err);
      ui.notifications.error("STA2e Toolkit: LCARS action failed. See console.");
    }
  }

  _onKeyDown(event) {
    if (event.key === "Escape" && this._combatBranch) {
      event.preventDefault();
      this._combatBranch = null;
      this.refresh();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const button = event.target.closest("[data-action]");
    if (!button) return;
    event.preventDefault();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  async _pickCharacter() {
    const actors = this._validCenterActors();
    if (!actors.length) {
      ui.notifications.warn("STA2e Toolkit: No owned character actors found.");
      return;
    }

    const currentId = this._activeActor?.id ?? "";
    let selectedId = currentId || actors[0].id;
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "LCARS Ring - Active Character" },
      content: `
        <div class="sta2e-lcars-ring-dialog" ${ringDialogThemeAttributes()}>
          <p class="sta2e-lcars-ring-dialog__hint">Choose the active character. Favorites stay at the top of this list.</p>
          <div class="sta2e-lcars-ring-dialog__filters">
            <input type="search" data-lcars-picker-filter placeholder="Filter by name" aria-label="Filter characters by name" />
            <label><input type="checkbox" data-lcars-picker-scene /> In current scene</label>
          </div>
          <div class="sta2e-lcars-ring-dialog__picker" data-lcars-picker-list role="radiogroup" aria-label="Active character">
            ${this._pickerCards(actors, { kind: "characters", inputName: "actorId", selectedId })}
          </div>
        </div>`,
      rejectClose: false,
      render: (_event, dialog) => {
        applyRingTheme(dialog.element);
        this._bindPickerFavorites(dialog, actors, {
          kind: "characters", inputName: "actorId", selectedId,
        });
      },
      buttons: [
        {
          action: "select",
          label: "Select",
          icon: "fas fa-check",
          default: true,
          callback: (_event, _button, dialog) => {
            selectedId = dialog.element.querySelector("[name='actorId']:checked")?.value
              || dialog.element.querySelector("[data-lcars-picker-list]")?.dataset.lcarsPickerSelected
              || selectedId;
            return "select";
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });
    if (result !== "select") return;
    await game.settings.set(MODULE, "lcarsRingActiveActorId", selectedId);
    this.refresh();
  }

  async _pickShip() {
    const actor = this._activeActor;
    if (!actor) return;
    const ships = this._ownedShips();
    if (!ships.length) {
      ui.notifications.warn("STA2e Toolkit: No owned starship or smallcraft actors found.");
      return;
    }

    const current = this._selectedShip(actor);
    const currentId = current?.id ?? ships[0].id;
    let selectedId = currentId;
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: "LCARS Ring - Current Ship" },
      content: `
        <div class="sta2e-lcars-ring-dialog" ${ringDialogThemeAttributes()}>
          <p class="sta2e-lcars-ring-dialog__hint">Choose the current ship or smallcraft. Favorites stay at the top of this list.</p>
          <div class="sta2e-lcars-ring-dialog__filters">
            <input type="search" data-lcars-picker-filter placeholder="Filter by name" aria-label="Filter ships by name" />
            <label><input type="checkbox" data-lcars-picker-scene /> In current scene</label>
          </div>
          <div class="sta2e-lcars-ring-dialog__picker" data-lcars-picker-list role="radiogroup" aria-label="Current ship or smallcraft">
            ${this._pickerCards(ships, { kind: "ships", inputName: "shipId", selectedId })}
          </div>
        </div>`,
      rejectClose: false,
      render: (_event, dialog) => {
        applyRingTheme(dialog.element);
        this._bindPickerFavorites(dialog, ships, {
          kind: "ships", inputName: "shipId", selectedId,
        });
      },
      buttons: [
        {
          action: "select",
          label: "Select",
          icon: "fas fa-check",
          default: true,
          callback: (_event, _button, dialog) => {
            selectedId = dialog.element.querySelector("[name='shipId']:checked")?.value
              || dialog.element.querySelector("[data-lcars-picker-list]")?.dataset.lcarsPickerSelected
              || selectedId;
            return "select";
          },
        },
        {
          action: "clear",
          label: "Clear",
          icon: "fas fa-ban",
          callback: () => {
            selectedId = "";
            return "clear";
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });
    if (!["select", "clear"].includes(result)) return;

    const map = { ...selectedShipMap() };
    if (selectedId) map[actor.id] = selectedId;
    else delete map[actor.id];
    await game.settings.set(MODULE, "lcarsRingShipByActor", map);
    this.refresh();
  }

  async _openTaskRoller() {
    const actor = this._activeActor;
    if (!actor) {
      ui.notifications.warn("STA2e Toolkit: Select an active character first.");
      return;
    }

    const token = this._findTokenForActor(actor);
    const ships = this._shipsForRoller(actor);
    openNpcRoller(actor, token, {
      playerMode: true,
      crewQuality: null,
      officer: readOfficerStats(actor),
      groundMode: ships.length === 0,
      availableShips: ships,
      shipAssist: false,
      selectedShipIdx: -1,
    });
  }

  async _createTrait() {
    const creatorActor = this._activeActor;
    if (!creatorActor) {
      ui.notifications.warn("STA2e Toolkit: Select an active character first.");
      return;
    }

    const ship = this._selectedShip(creatorActor);
    if (!ship) {
      ui.notifications.warn("STA2e Toolkit: Select a current ship before creating a trait.");
      return;
    }

    const token = this._findTokenForActor(ship);
    if (!token) {
      ui.notifications.warn("STA2e Toolkit: The selected ship needs a canvas token to create a trait.");
      return;
    }

    const combatHud = game.sta2eToolkit?.combatHud;
    if (!combatHud) {
      ui.notifications.warn("STA2e Toolkit: Combat actions are not ready.");
      return;
    }

    await combatHud.triggerRingAction(token, {
      key: "create-trait",
      creatorActorId: creatorActor.id,
      allowUnassignedCreator: true,
    }, this._stationForActor(ship, creatorActor));
  }

  async _assignStation() {
    const actor = this._activeActor;
    if (!actor) {
      ui.notifications.warn("STA2e Toolkit: Select an active character first.");
      return;
    }

    const ship = this._selectedShip(actor);
    if (!ship) {
      ui.notifications.warn("STA2e Toolkit: Select a current ship before assigning a station.");
      return;
    }

    const manifest = getCrewManifest(ship);
    const choices = [
      { stationId: "", seatIndex: null, label: "Unassigned", occupant: null },
      ...STATION_SLOTS.flatMap(slot => {
        if (slot.id === "command") {
          return COMMAND_SEATS.map(seat => ({
            stationId: slot.id,
            seatIndex: seat.index,
            label: `Command — ${seat.label}`,
            occupant: manifest.command[seat.index] ?? null,
          }));
        }
        return [{
          stationId: slot.id,
          seatIndex: null,
          label: slot.label,
          occupant: manifest[slot.id]?.[0] ?? null,
        }];
      }),
    ];
    const currentChoiceIndex = choices.findIndex(choice =>
      choice.stationId && manifest[choice.stationId]?.[choice.seatIndex ?? 0] === actor.id
    );
    let selectedChoiceIndex = currentChoiceIndex >= 0 ? currentChoiceIndex : 0;
    const radioChoices = choices.map((choice, index) => {
      const occupant = choice.occupant ? game.actors.get(choice.occupant) : null;
      const status = !choice.stationId
        ? "Remove this officer from all stations"
        : occupant?.id === actor.id
          ? "Currently assigned"
          : occupant
            ? `Replaces ${occupant.name}`
            : "Vacant";
      return `
        <label class="sta2e-lcars-ring-dialog__station-choice">
          <input type="radio" name="stationChoice" value="${index}" ${index === selectedChoiceIndex ? "checked" : ""} />
          <span class="sta2e-lcars-ring-dialog__station-choice-main">
            <strong>${escapeHtml(choice.label)}</strong>
            <small>${escapeHtml(status)}</small>
          </span>
        </label>`;
    }).join("");

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: `LCARS Ring - Assign Station: ${ship.name}` },
      content: `
        <div class="sta2e-lcars-ring-dialog" ${ringDialogThemeAttributes()}>
          <p class="sta2e-lcars-ring-dialog__hint">Choose a station for ${escapeHtml(actor.name)}.</p>
          <div class="sta2e-lcars-ring-dialog__station-picker" role="radiogroup" aria-label="Station for ${escapeHtml(actor.name)}">
            ${radioChoices}
          </div>
          <p class="sta2e-lcars-ring-dialog__hint">Selecting an occupied seat replaces its officer and moves ${escapeHtml(actor.name)} from any other station.</p>
        </div>`,
      rejectClose: false,
      render: (_event, dialog) => applyRingTheme(dialog.element),
      buttons: [
        {
          action: "assign",
          label: "Assign",
          icon: "fas fa-check",
          default: true,
          callback: (_event, _button, dialog) => {
            selectedChoiceIndex = Number(dialog.element.querySelector("[name='stationChoice']:checked")?.value ?? selectedChoiceIndex);
            return "assign";
          },
        },
        { action: "cancel", label: "Cancel", icon: "fas fa-times" },
      ],
    });
    if (result !== "assign") return;

    const choice = choices[selectedChoiceIndex] ?? choices[0];
    const nextManifest = Object.fromEntries(STATION_SLOTS.map(slot => [slot.id, [...(manifest[slot.id] ?? [])]]));
    for (const slot of STATION_SLOTS) {
      nextManifest[slot.id] = slot.id === "command"
        ? (manifest.command ?? []).map(id => id === actor.id ? null : id)
        : (manifest[slot.id] ?? []).filter(id => id !== actor.id);
    }
    if (choice.stationId === "command") {
      nextManifest.command[choice.seatIndex] = actor.id;
    } else if (choice.stationId) {
      nextManifest[choice.stationId] = [actor.id];
    }

    await setCrewManifest(ship, nextManifest);
    this.refresh();
  }

}
