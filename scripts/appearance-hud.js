/**
 * sta2e-toolkit | appearance-hud.js
 *
 * The Token HUD's Appearance button (a theatre-masks control of its own, not a
 * section of the GM toolkit arrowhead): switch looks, put gear on and take it
 * off, and (GM) open the Appearance Manager.
 *
 * It is a separate control because players use it — a player switches their
 * own character's look and puts their own EV suit on — while the arrowhead is
 * a GM menu. Players see it on tokens they own when there is something to do:
 * looks, gear, or Mimic — which the Appearances settings may limit to a trait.
 *
 * It reuses the toolkit's HUD plumbing (token-hud-util.js) and its
 * rebuild-in-place idiom: two views, `"looks"` and `"gear"`, and every row
 * rebuilds the panel after its write so the marks always show what was just
 * written. Both controls sit in the same column, so `toggleHudFlyout`'s
 * one-flyout-per-column sweep closes the arrowhead's panel when this one opens.
 */

import {
  buildHudControl, buildHudFlyout, buildHudItem, resolveHudToken, toggleHudFlyout,
} from "./token-hud-util.js";
import { WEARABLE_TYPES, hasLooks, storeMimicInLibrary, findVersion, ruleKey } from "./appearance-data.js";
import {
  libraryFor, lookStateFor, applyLook, applyRandomLook, isWorn, setWorn, applyMimic, endMimic, canUseMimic,
  storeMimicForm,
} from "./appearance.js";
import { openAppearanceManager } from "./appearance-manager.js";

const PALETTE_CLASS = "sta2e-appearance-hud-palette";

function _wearables(token) {
  return (token.actor?.items?.contents ?? []).filter(i => WEARABLE_TYPES.has(i.type));
}

function _available(token) {
  if (!token?.actor) return false;
  if (game.user.isGM) return true;
  if (!token.document.isOwner) return false;
  // Something to do: looks, gear to put on, or Mimic (when this token may use it).
  return hasLooks(libraryFor(token.document)) || _wearables(token).length > 0 || canUseMimic(token.document)
    || !!lookStateFor(token.document).mimic;   // always able to end a disguise
}

/** A small icon key for the looks toolbar. */
function _key(icon, tooltip, onClick, { active = false } = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `sta2e-ap-hud-key${active ? " active" : ""}`;
  btn.dataset.tooltip = tooltip;
  btn.setAttribute("aria-label", tooltip);
  btn.innerHTML = `<i class="${icon}"></i>`;
  btn.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); onClick(event); });
  return btn;
}

/**
 * One look as a thumbnail card. Names go in with `textContent` — they are
 * user-supplied, the same rule `buildHudItem` follows.
 */
function _card(src, name, { current = false, auto = false, tooltip }, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sta2e-ap-hud-card";
  if (current) btn.classList.add("active");
  if (auto) btn.classList.add("auto");
  btn.dataset.tooltip = tooltip ?? name;
  const stage = document.createElement("span");
  stage.className = "sta2e-ap-hud-card-stage";
  if (src) {
    const video = /\.(webm|mp4)$/i.test(src);
    const media = document.createElement(video ? "video" : "img");
    media.src = src;
    if (video) Object.assign(media, { muted: true, autoplay: true, loop: true });
    stage.appendChild(media);
  } else {
    stage.innerHTML = `<i class="fas fa-circle-user"></i>`;
  }
  if (auto) stage.insertAdjacentHTML("beforeend", `<i class="fas fa-bolt sta2e-ap-hud-card-auto"></i>`);
  const label = document.createElement("span");
  label.className = "sta2e-ap-hud-card-name";
  label.textContent = name;
  btn.append(stage, label);
  btn.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); onClick(event); });
  return btn;
}

/**
 * Looks as a card grid rather than a row per look, so a token with a dozen
 * faces stays a compact panel. A toolbar of icon keys carries the actions
 * (Random, Gear, Manage); Original Art is the first card.
 */
function _looksView(host) {
  const doc = host.token.document;
  const lib = libraryFor(doc);
  const st = lookStateFor(doc);
  const run = (fn) => async () => { await fn(); host.rebuild(); };
  const out = [];

  const bar = document.createElement("div");
  bar.className = "sta2e-ap-hud-bar";
  const title = document.createElement("span");
  title.className = "sta2e-ap-hud-title";
  title.textContent = "Appearance";
  bar.appendChild(title);
  if (lib.looks.filter(l => l.token && !l.mimicked).length > 1) {
    bar.appendChild(_key("fas fa-dice", "Random look", run(() => applyRandomLook(doc))));
  }
  if (_wearables(host.token).length) {
    bar.appendChild(_key("fas fa-shirt", "Gear — put on or take off armour and suits", () => host.rebuild("gear")));
  }
  if (canUseMimic(doc)) bar.appendChild(_key("fas fa-user-secret", "Mimic — copy your targeted token's look and name", async () => {
    const targets = [...game.user.targets].filter(t => t.document?.uuid !== doc.uuid);
    if (targets.length !== 1) {
      ui.notifications.info("Target the one token to copy (hover it and press T), then click Mimic.");
      return;
    }
    await applyMimic(doc, targets[0].document);
    host.rebuild();
  }, { active: !!st.mimic }));
  if (game.user.isGM) {
    bar.appendChild(_key("fas fa-pen-to-square", "Manage looks", () => openAppearanceManager(doc)));
  }
  out.push(bar);

  if (st.mimic) {
    // Clicking the banner drops the disguise.
    const note = document.createElement("button");
    note.type = "button";
    note.className = "sta2e-ap-hud-note is-mimic";
    note.dataset.tooltip = "Click to stop mimicking — back to your own look and name";
    note.innerHTML = `<i class="fas fa-user-secret"></i> `;
    note.append(`Mimicking: ${st.mimic.from || st.mimic.tokenName || "another token"}`);
    const x = document.createElement("i");
    x.className = "fas fa-xmark";
    note.append(" ", x);
    note.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await endMimic(doc);
      host.rebuild();
    });
    out.push(note);

    // Keep a copy of the disguise as a look, to take again later.
    const stored = storeMimicInLibrary(lib, st.mimic).duplicate;
    if (stored) {
      const done = document.createElement("div");
      done.className = "sta2e-ap-hud-note is-stored";
      done.innerHTML = `<i class="fas fa-bookmark"></i> `;
      done.append(`Form stored as "${stored.name}"`);
      out.push(done);
    } else if (canUseMimic(doc)) {
      const save = document.createElement("button");
      save.type = "button";
      save.className = "sta2e-ap-hud-note is-store";
      save.dataset.tooltip = "Save this disguise as one of your looks, to take again later";
      save.innerHTML = `<i class="fas fa-bookmark"></i> Store This Form`;
      save.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await storeMimicForm(doc);
        host.rebuild();
      });
      out.push(save);
    }
  }

  if (st.ruleLookId) {
    const ruled = lib.looks.find(l => l.id === st.ruleLookId);
    // The worn look's (or the Original's) own version of the rule, if it has one.
    const rule = st.ruleKey ? lib.rules.find(r => ruleKey(r) === st.ruleKey) : null;
    // Under gear (an EV suit), the condition's version comes from the gear's look.
    const gear = st.gearKey ? lib.rules.find(r => r.kind === "item" && ruleKey(r) === st.gearKey) : null;
    const gearLook = gear ? lib.looks.find(l => l.id === gear.lookId) : null;
    const chosen = gearLook ?? lib.looks.find(l => l.id === st.lookId);
    const owner = chosen ?? (st.mimic ? null : { name: "Original", versions: lib.baseVersions });
    const versioned = rule && owner && findVersion(owner, rule);
    const note = document.createElement("div");
    note.className = "sta2e-ap-hud-note";
    note.dataset.tooltip = versioned
      ? "Gear or a condition is showing this look's own version of it. The look returns once it ends."
      : "Gear or a condition is choosing this look. Your pick shows once it ends.";
    note.innerHTML = `<i class="fas fa-bolt"></i> `;
    note.append(versioned
      ? `Auto: ${owner.name || "look"} (${ruled?.name || rule.match})`
      : `Auto: ${ruled?.name || "look"}`);
    out.push(note);
  }

  const grid = document.createElement("div");
  grid.className = "sta2e-ap-hud-grid";
  // Original Art: while no look is chosen the token is wearing it, otherwise
  // the baseline remembers it.
  const originalSrc = (st.lookId || st.mimic) ? (st.baseline?.token || "") : (doc.texture?.src ?? "");
  grid.appendChild(_card(originalSrc, "Original", {
    current: !st.lookId && !st.mimic,
    tooltip: "The art this token had before any look",
  }, run(() => applyLook(doc, null))));
  for (const look of lib.looks) {
    if (!look.token && !look.portrait) continue;
    const name = look.name || "Unnamed look";
    grid.appendChild(_card(look.token || look.portrait, name, {
      current: look.id === st.lookId,
      auto:    look.id === st.ruleLookId,
      tooltip: look.id === st.lookId ? `${name} (current)` : name,
    }, run(() => applyLook(doc, look.id))));
  }
  out.push(grid);
  return out;
}

function _gearView(host) {
  const rows = [buildHudItem({
    icon: "fas fa-chevron-left", label: "Looks", tooltip: "Back to looks", extraClass: "back",
  }, () => host.rebuild("looks"))];
  for (const item of _wearables(host.token)) {
    const worn = isWorn(item);
    rows.push(buildHudItem({
      icon:       worn ? "fas fa-toggle-on" : "fas fa-toggle-off",
      label:      item.name,
      tooltip:    worn ? "Worn — click to take off" : "Carried — click to wear",
      extraClass: worn ? "active" : "",
    }, async () => {
      if (!item.isOwner) { ui.notifications.warn("You don't own that item."); return; }
      await setWorn(item, !worn);
      host.rebuild();
    }));
  }
  return rows;
}

/** Build the panel for one view. */
function _render(token, control, view) {
  const palette = buildHudFlyout(PALETTE_CLASS);
  palette.dataset.section = "appearance";
  const host = {
    token,
    rebuild: (next) => {
      // The HUD may have closed while a write was in flight.
      if (!control.isConnected || !palette.isConnected) return;
      const fresh = _render(token, control, next ?? view);
      fresh.style.top = palette.style.top;
      palette.replaceWith(fresh);
    },
  };
  for (const row of view === "gear" ? _gearView(host) : _looksView(host)) palette.appendChild(row);
  return palette;
}

function _injectAppearanceHud(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".sta2e-appearance-hud")) return;
  const token = resolveHudToken(app);
  if (!_available(token)) return;

  const column = root.querySelector(".col.right") ?? root.querySelector(".col.left");
  if (!column) return;
  const control = buildHudControl(column.querySelector(".control-icon"), {
    cssClass: "sta2e-appearance-hud",
    icon:     "fas fa-masks-theater",
    tooltip:  "Appearance",
  });
  control.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleHudFlyout(control, PALETTE_CLASS, () => _render(token, control, "looks"));
  });
  column.appendChild(control);
}

/** Register the HUD hook. Call once from main.js init. */
export function registerAppearanceHud() {
  Hooks.on("renderTokenHUD", _injectAppearanceHud);
}
