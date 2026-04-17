/**
 * sta2e-toolkit | stardate-hud.js
 * Stardate HUD — plain class, renders directly into #interface.
 *
 * Themes:
 *   blue        — standard Starfleet bar
 *   lcars-tng   — LCARS panel with rounded left cap, segmented bar
 *   tos-panel   — TOS era: boxy, dark grey, gold/red/green grid buttons
 *   tmp-console — TMP era: sleek, near-black, blue-white oval buttons, green display
 */

import { formatStardate, formatCalendarDate, formatTime, formatKlingonDate, formatRomulanDate } from "./stardate-calc.js";
// scene-flags helpers still used by date-editor; HUD now reads canvas.scene directly

const LCARS_THEMES  = new Set(["lcars-tng", "lcars-tng-blue", "klingon", "romulan"]);
const KLINGON_THEMES = new Set(["klingon"]);
const ROMULAN_THEMES = new Set(["romulan"]);
const TOS_THEMES    = new Set(["tos-panel"]);
const TMP_THEMES    = new Set(["tmp-console"]);
const ENT_THEMES    = new Set(["ent-panel"]);

export class StardateHUD {

  constructor() { this._element = null; }

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  _getContext() {
    const store       = game.sta2eToolkit.campaignStore;
    const campaigns   = store.getCampaigns();
    const showMinutes = game.settings.get("sta2e-toolkit", "showMinutes");
    const isGM        = game.user.isGM;
    const globalTheme = game.settings.get("sta2e-toolkit", "hudTheme") ?? "blue";

    const visibility = game.settings.get("sta2e-toolkit", "hudVisibility");
    if (visibility === "gmonly" && !isGM) return null;

    // Always display the world active campaign — canvasReady already switched
    // it when entering a pinned scene, so no separate override lookup needed.
    const active = store.getActiveCampaign();
    if (!active) return { noCampaigns: true, isGM, campaigns: [], theme: globalTheme };

    // hasOverride = this scene has a pin (drives button lit/unlit state only)
    const pinnedId   = canvas?.scene?.getFlag("sta2e-toolkit", "campaignOverride") ?? null;
    const hasOverride = !!pinnedId;

    const theme  = active?.theme ?? globalTheme;
    const isENT  = active.era === "ent";
    const isKlingon = active.era === "klingon" || theme === "klingon";
    const isRomulan = active.era === "romulan" || theme === "romulan";
    const isFaction = isKlingon || isRomulan;

    // Faction date strings (null if not applicable)
    const klingonDate = (isKlingon && active.calendarDate) ? formatKlingonDate(active.calendarDate) : null;
    const romulanDate = (isRomulan && active.calendarDate) ? formatRomulanDate(active.calendarDate) : null;

    return {
      noCampaigns:  false,
      isGM, theme, campaigns, isENT, isFaction, isKlingon, isRomulan,
      activeName:   active.name,
      activeId:     active.id,
      stardate:     (isENT || isFaction) ? null : formatStardate(active.stardate),
      calendarDate: active.calendarDate ? formatCalendarDate(active.calendarDate) : null,
      klingonDate,
      romulanDate,
      time:         formatTime(active.time ?? { hours: 0, minutes: 0 }, showMinutes),
      hasOverride,
      overrideTooltip: hasOverride ? `Scene pinned to: ${active.name}` : ""
    };
  }

  // ---------------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------------

  _buildHTML(ctx) {
    if (!ctx) return "";
    // Players always get the clean read-only bar, regardless of theme
    if (!ctx.isGM) return this._buildPlayerHUD(ctx);
    if (KLINGON_THEMES.has(ctx.theme)) return this._buildKlingon(ctx);
    if (ROMULAN_THEMES.has(ctx.theme)) return this._buildRomulan(ctx);
    if (LCARS_THEMES.has(ctx.theme))  return this._buildLCARS(ctx);
    if (TOS_THEMES.has(ctx.theme))    return this._buildTOS(ctx);
    if (TMP_THEMES.has(ctx.theme))    return this._buildTMP(ctx);
    if (ENT_THEMES.has(ctx.theme))    return this._buildENT(ctx);
    return this._buildStandard(ctx);
  }

  _buildOptions(ctx) {
    return ctx.campaigns.map(c =>
      `<option value="${c.id}" ${c.id === ctx.activeId ? "selected" : ""}>${c.name}</option>`
    ).join("");
  }

  // ---------------------------------------------------------------------------
  // Player HUD router — dispatches to theme-matched read-only builders
  // ---------------------------------------------------------------------------

  _buildPlayerHUD(ctx) {
    if (!ctx || ctx.noCampaigns) return "";
    if (KLINGON_THEMES.has(ctx.theme)) return this._buildPlayerKlingon(ctx);
    if (ROMULAN_THEMES.has(ctx.theme)) return this._buildPlayerRomulan(ctx);
    if (LCARS_THEMES.has(ctx.theme))  return this._buildPlayerLCARS(ctx);
    if (TOS_THEMES.has(ctx.theme))    return this._buildPlayerTOS(ctx);
    if (TMP_THEMES.has(ctx.theme))    return this._buildPlayerTMP(ctx);
    if (ENT_THEMES.has(ctx.theme))    return this._buildPlayerENT(ctx);
    return this._buildPlayerStandard(ctx);
  }

  // Shared display content fragment — used by all player builders
  _playerDisplay(ctx) {
    const ship     = ctx.activeName ?? "";
    const override = ctx.hasOverride
      ? `<span class="sta2e-player__override" title="${ctx.overrideTooltip}">⚡</span>` : "";
    const calDate  = ctx.calendarDate ?? "";
    const noSD     = ctx.isENT || !ctx.stardate;
    return { ship, override, calDate, noSD };
  }

  // ── Standard player bar (Starfleet Blue) ──────────────────────────────────

  _buildPlayerStandard(ctx) {
    const { ship, override, calDate, noSD } = this._playerDisplay(ctx);
    const sdBlock = noSD ? "" : `
      <span class="sta2e-player__label">STARDATE</span>
      <span class="sta2e-player__stardate">${ctx.stardate}</span>
      <span class="sta2e-player__sep">|</span>`;
    const dateBlock = calDate
      ? `<span class="sta2e-player__date">${calDate}</span><span class="sta2e-player__sep">|</span>`
      : "";
    return `<div class="sta2e-player-hud sta2e-player-theme-${ctx.theme}">
      <span class="sta2e-player__ship">${ship}</span>
      <span class="sta2e-player__sep">|</span>
      ${sdBlock}
      ${dateBlock}
      <span class="sta2e-player__time">${ctx.time}</span>
      ${override}
    </div>`;
  }

  // ── LCARS player bar ──────────────────────────────────────────────────────
  // Same structure as GM bar: cap | ship segment | display segment | endcap
  // Buttons replaced by static text labels; no dropdown, no tools segment.

  _buildPlayerLCARS(ctx) {
    const { ship, override, calDate, noSD } = this._playerDisplay(ctx);
    const sdBlock = noSD ? "" : `
      <span class="lcars__label">STARDATE</span>
      <span class="lcars__stardate">${ctx.stardate}</span>
      ${calDate ? `<span class="lcars__sep"></span>` : ""}`;
    const dateBlock = calDate
      ? `<span class="lcars__date">${calDate}</span><span class="lcars__sep"></span>`
      : "";
    return `<div class="sta2e-hud sta2e-lcars sta2e-theme-${ctx.theme}">
      <div class="lcars__cap"><div class="lcars__cap-label">STARFLEET</div></div>
      <div class="lcars__segment lcars__segment--campaign">
        <span class="lcars__ship-name">${ship}</span>
      </div>
      <div class="lcars__elbow"></div>
      <div class="lcars__segment lcars__segment--display">
        ${sdBlock}
        ${dateBlock}
        <span class="lcars__time">${ctx.time}</span>
        ${override}
      </div>
      <div class="lcars__endcap"></div>
    </div>`;
  }

  // ── TOS player bar ────────────────────────────────────────────────────────

  _buildPlayerTOS(ctx) {
    const { ship, override, calDate, noSD } = this._playerDisplay(ctx);
    return `<div class="sta2e-hud sta2e-tos sta2e-theme-tos-panel">
      <div class="tos__panel-frame">
        <div class="tos__block--campaign">
          <div class="tos__block-label">VESSEL</div>
          <span class="tos__ship-name">${ship}</span>
        </div>
        <div class="tos__strut"></div>
        <div class="tos__display-block">
          <div class="tos__display-label">${noSD ? "EARTH DATE / TIME" : "STARDATE / DATE / TIME"}</div>
          <div class="tos__display-row">
            ${noSD ? "" : `<span class="tos__stardate">${ctx.stardate}</span><span class="tos__readout-sep">//</span>`}
            ${calDate ? `<span class="tos__readout">${calDate}</span><span class="tos__readout-sep">//</span>` : ""}
            <span class="tos__time">${ctx.time}</span>
            ${override}
          </div>
        </div>
      </div>
    </div>`;
  }

  // ── TMP player bar ────────────────────────────────────────────────────────

  _buildPlayerTMP(ctx) {
    const { ship, override, calDate, noSD } = this._playerDisplay(ctx);
    return `<div class="sta2e-hud sta2e-tmp sta2e-theme-tmp-console">
      <div class="tmp__console-frame">
        <div class="tmp__id-stripe">SFHQ</div>
        <div class="tmp__oval-block">
          <div class="tmp__oval-label">VESSEL</div>
          <span class="tmp__ship-name">${ship}</span>
        </div>
        <div class="tmp__display">
          <span class="tmp__display-label">${noSD ? "EARTH DATE" : "STARDATE"}</span>
          ${noSD ? "" : `<span class="tmp__stardate">${ctx.stardate}</span>`}
          ${calDate ? `<span class="tmp__sep">·</span><span class="tmp__date">${calDate}</span>` : ""}
          <span class="tmp__sep">·</span>
          <span class="tmp__time">${ctx.time}</span>
          ${override}
        </div>
      </div>
    </div>`;
  }

  // ── ENT player bar ────────────────────────────────────────────────────────

  _buildPlayerENT(ctx) {
    const { ship, override, calDate } = this._playerDisplay(ctx);
    return `<div class="sta2e-hud sta2e-ent sta2e-theme-ent-panel">
      <div class="ent__frame">
        <div class="ent__id-block">
          <div class="ent__id-label">UESPA</div>
          <div class="ent__id-sub">VESSEL LOG</div>
        </div>
        <div class="ent__strut"></div>
        <div class="ent__field-block">
          <div class="ent__field-label">VESSEL</div>
          <span class="ent__ship-name">${ship}</span>
        </div>
        <div class="ent__strut"></div>
        <div class="ent__display">
          <div class="ent__display-label">EARTH DATE / TIME</div>
          <div class="ent__display-row">
            ${calDate ? `<span class="ent__date">${calDate}</span><span class="ent__sep">//</span>` : ""}
            <span class="ent__time">${ctx.time}</span>
            ${override}
          </div>
        </div>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Standard bar — Starfleet Blue
  // ---------------------------------------------------------------------------

  _buildStandard(ctx) {
    if (ctx.noCampaigns) {
      return `<div class="sta2e-hud sta2e-theme-${ctx.theme}">
        <span class="sta2e-hud__empty-msg">No campaigns —</span>
        ${ctx.isGM ? `<button type="button" class="sta2e-hud__btn" data-action="openManager">⚙ Setup</button>` : ""}
      </div>`;
    }
    const calDate  = ctx.calendarDate
      ? `<span class="sta2e-hud__sep">|</span><span class="sta2e-hud__date">${ctx.calendarDate}</span>` : "";
    const override = ctx.hasOverride
      ? `<span class="sta2e-hud__override" title="${ctx.overrideTooltip}">⚡</span>` : "";
    const gmBtns   = ctx.isGM ? `
      <button type="button" class="sta2e-hud__btn" data-action="openWarpCalc" title="Warp Calculator">WARP</button>
      <button type="button" class="sta2e-hud__btn" data-action="openEditor" title="Edit Date/Time">EDIT</button>
      <button type="button" class="sta2e-hud__btn" data-action="openManager" title="Campaign Manager">CONF</button>` : "";

    const pinTitle = ctx.hasOverride ? "Unpin scene from this campaign" : "Pin scene to this campaign";
    const pinActive = ctx.hasOverride ? " sta2e-hud__btn--pin-active" : "";
    const pinBtn = ctx.isGM
      ? `<button type="button" class="sta2e-hud__btn sta2e-hud__btn--icon${pinActive}" data-action="togglePin" title="${pinTitle}">📌</button>`
      : "";
    return `<div class="sta2e-hud sta2e-theme-${ctx.theme}">
      <select class="sta2e-hud__select" id="sta2e-campaign-select">${this._buildOptions(ctx)}</select>
      ${pinBtn}
      <button type="button" class="sta2e-hud__btn sta2e-hud__btn--advance" data-action="advance" data-advance="-1mo" title="Back 1 Month">◀ -1mo</button>
      <button type="button" class="sta2e-hud__btn sta2e-hud__btn--advance" data-action="advance" data-advance="-1d">-1d</button>
      <button type="button" class="sta2e-hud__btn sta2e-hud__btn--advance" data-action="advance" data-advance="-1h">-1h</button>
      <button type="button" class="sta2e-hud__btn sta2e-hud__btn--advance" data-action="advance" data-advance="-30m">-30m</button>
      <div class="sta2e-hud__display">
        <span class="sta2e-hud__label">STARDATE</span>
        <span class="sta2e-hud__stardate">${ctx.stardate}</span>
        ${calDate}
        <span class="sta2e-hud__sep">|</span>
        <span class="sta2e-hud__time">${ctx.time}</span>
        ${override}
      </div>
      <button type="button" class="sta2e-hud__btn sta2e-hud__btn--advance" data-action="advance" data-advance="+30m">+30m</button>
      <button type="button" class="sta2e-hud__btn sta2e-hud__btn--advance" data-action="advance" data-advance="+1h">+1h</button>
      <button type="button" class="sta2e-hud__btn sta2e-hud__btn--advance" data-action="advance" data-advance="+1d">+1d</button>
      <button type="button" class="sta2e-hud__btn sta2e-hud__btn--advance" data-action="advance" data-advance="+1mo" title="Forward 1 Month">+1mo ▶</button>
      ${gmBtns}
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // LCARS TNG — rounded cap, segmented bar, orange/tan/purple
  // ---------------------------------------------------------------------------

  _buildLCARS(ctx) {
    if (ctx.noCampaigns) {
      return `<div class="sta2e-hud sta2e-lcars sta2e-theme-${ctx.theme}">
        <div class="lcars__cap"><div class="lcars__cap-label">SFHQ</div></div>
        <div class="lcars__segment lcars__segment--display">
          <span class="lcars__empty">NO CAMPAIGNS</span>
          ${ctx.isGM ? `<button type="button" class="lcars__btn" data-action="openManager">SETUP</button>` : ""}
        </div>
        <div class="lcars__endcap"></div>
      </div>`;
    }

    const override = ctx.hasOverride
      ? `<span class="lcars__override" title="${ctx.overrideTooltip}">⚡</span>` : "";
    const calDate  = ctx.calendarDate
      ? `<span class="lcars__sep"></span><span class="lcars__date">${ctx.calendarDate}</span>` : "";
    const pinTitle = ctx.hasOverride ? "Unpin scene" : "Pin scene to this campaign";
    const pinClass = ctx.hasOverride ? " lcars__btn--pin-active" : "";
    const gmBtns   = ctx.isGM ? `
      <button type="button" class="lcars__btn${pinClass}" data-action="togglePin" title="${pinTitle}">PIN</button>
      <button type="button" class="lcars__btn" data-action="openWarpCalc" title="Warp Calculator">WARP</button>
      <button type="button" class="lcars__btn" data-action="openEditor" title="Edit Date/Time">EDIT</button>
      <button type="button" class="lcars__btn" data-action="openManager" title="Campaign Manager">CONF</button>` : "";

    return `<div class="sta2e-hud sta2e-lcars sta2e-theme-${ctx.theme}">
      <div class="lcars__cap"><div class="lcars__cap-label">STARFLEET</div></div>
      <div class="lcars__segment lcars__segment--campaign">
        <select class="lcars__select" id="sta2e-campaign-select">${this._buildOptions(ctx)}</select>
      </div>
      <div class="lcars__elbow"></div>
      <div class="lcars__segment lcars__segment--controls">
        <button type="button" class="lcars__btn" data-action="advance" data-advance="-1mo">-1MO</button>
        <button type="button" class="lcars__btn" data-action="advance" data-advance="-1d">-1D</button>
        <button type="button" class="lcars__btn" data-action="advance" data-advance="-1h">-1H</button>
        <button type="button" class="lcars__btn" data-action="advance" data-advance="-30m">-30M</button>
      </div>
      <div class="lcars__segment lcars__segment--display">
        <span class="lcars__label">STARDATE</span>
        <span class="lcars__stardate">${ctx.stardate}</span>
        ${calDate}
        <span class="lcars__sep"></span>
        <span class="lcars__time">${ctx.time}</span>
        ${override}
      </div>
      <div class="lcars__segment lcars__segment--controls">
        <button type="button" class="lcars__btn" data-action="advance" data-advance="+30m">+30M</button>
        <button type="button" class="lcars__btn" data-action="advance" data-advance="+1h">+1H</button>
        <button type="button" class="lcars__btn" data-action="advance" data-advance="+1d">+1D</button>
        <button type="button" class="lcars__btn" data-action="advance" data-advance="+1mo">+1MO</button>
      </div>
      ${ctx.isGM ? `<div class="lcars__segment lcars__segment--tools">${gmBtns}</div>` : ""}
      <div class="lcars__endcap"></div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // TOS Panel — boxy grid, dark grey, gold/red/green physical-button aesthetic
  // ---------------------------------------------------------------------------

  _buildTOS(ctx) {
    if (ctx.noCampaigns) {
      return `<div class="sta2e-hud sta2e-tos sta2e-theme-tos-panel">
        <div class="tos__panel-frame">
          <span class="tos__empty">NO ACTIVE MISSION</span>
          ${ctx.isGM ? `<button type="button" class="tos__btn tos__btn--green" data-action="openManager">SETUP</button>` : ""}
        </div>
      </div>`;
    }

    const override = ctx.hasOverride
      ? `<span class="tos__indicator tos__indicator--yellow" title="${ctx.overrideTooltip}">▶</span>` : "";
    const calDate  = ctx.calendarDate
      ? `<span class="tos__readout-sep">/</span><span class="tos__readout">${ctx.calendarDate}</span>` : "";
    const tosPinClass = ctx.hasOverride ? " tos__btn--red" : " tos__btn--amber";
    const tosPinTitle = ctx.hasOverride ? "Unpin scene" : "Pin scene to this campaign";
    const gmBtns   = ctx.isGM ? `
      <button type="button" class="tos__btn${tosPinClass}" data-action="togglePin"    title="${tosPinTitle}">PIN</button>
      <button type="button" class="tos__btn tos__btn--amber" data-action="openWarpCalc" title="Warp Calculator">WARP</button>
      <button type="button" class="tos__btn tos__btn--amber" data-action="openEditor"  title="Edit Date/Time">EDIT</button>
      <button type="button" class="tos__btn tos__btn--green" data-action="openManager" title="Campaign Manager">CONF</button>` : "";

    return `<div class="sta2e-hud sta2e-tos sta2e-theme-tos-panel">
      <div class="tos__panel-frame">

        <!-- Campaign selector block -->
        <div class="tos__block tos__block--campaign">
          <div class="tos__block-label">MISSION</div>
          <select class="tos__select" id="sta2e-campaign-select">${this._buildOptions(ctx)}</select>
        </div>

        <!-- Divider strut -->
        <div class="tos__strut"></div>

        <!-- Time-step buttons: boxy grid -->
        <div class="tos__btn-grid">
          <button type="button" class="tos__btn tos__btn--red"   data-action="advance" data-advance="-1mo">-1MO</button>
          <button type="button" class="tos__btn tos__btn--red"   data-action="advance" data-advance="-1d">-1D</button>
          <button type="button" class="tos__btn tos__btn--amber" data-action="advance" data-advance="-1h">-1H</button>
          <button type="button" class="tos__btn tos__btn--amber" data-action="advance" data-advance="-30m">-30M</button>
          <button type="button" class="tos__btn tos__btn--amber" data-action="advance" data-advance="+30m">+30M</button>
          <button type="button" class="tos__btn tos__btn--amber" data-action="advance" data-advance="+1h">+1H</button>
          <button type="button" class="tos__btn tos__btn--green" data-action="advance" data-advance="+1d">+1D</button>
          <button type="button" class="tos__btn tos__btn--green" data-action="advance" data-advance="+1mo">+1MO</button>
        </div>

        <!-- Divider strut -->
        <div class="tos__strut"></div>

        <!-- Main readout display -->
        <div class="tos__display-block">
          <div class="tos__display-label">STARDATE</div>
          <div class="tos__display-row">
            <span class="tos__stardate">${ctx.stardate}</span>
            ${calDate}
            <span class="tos__readout-sep">//</span>
            <span class="tos__time">${ctx.time}</span>
            ${override}
          </div>
        </div>

        <!-- Divider strut -->
        ${ctx.isGM ? `<div class="tos__strut"></div>` : ""}

        <!-- GM controls -->
        ${ctx.isGM ? `<div class="tos__btn-grid">${gmBtns}</div>` : ""}

      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // TMP Console — sleek, near-black, blue-white ovals, green monochrome display
  // ---------------------------------------------------------------------------

  _buildTMP(ctx) {
    if (ctx.noCampaigns) {
      return `<div class="sta2e-hud sta2e-tmp sta2e-theme-tmp-console">
        <div class="tmp__console-frame">
          <span class="tmp__empty">NO ACTIVE MISSION</span>
          ${ctx.isGM ? `<button type="button" class="tmp__btn" data-action="openManager">SETUP</button>` : ""}
        </div>
      </div>`;
    }

    const override = ctx.hasOverride
      ? `<span class="tmp__indicator" title="${ctx.overrideTooltip}">◈</span>` : "";
    const calDate  = ctx.calendarDate
      ? `<span class="tmp__sep">·</span><span class="tmp__date">${ctx.calendarDate}</span>` : "";
    const tmpPinClass = ctx.hasOverride ? " tmp__btn--pin-active" : "";
    const tmpPinTitle = ctx.hasOverride ? "Unpin scene" : "Pin scene to this campaign";
    const gmBtns   = ctx.isGM ? `
      <button type="button" class="tmp__btn${tmpPinClass}" data-action="togglePin" title="${tmpPinTitle}">PIN</button>
      <button type="button" class="tmp__btn tmp__btn--alt" data-action="openWarpCalc" title="Warp Calculator">WRP</button>
      <button type="button" class="tmp__btn tmp__btn--alt" data-action="openEditor" title="Edit Date/Time">EDT</button>
      <button type="button" class="tmp__btn" data-action="openManager" title="Campaign Manager">CFG</button>` : "";

    return `<div class="sta2e-hud sta2e-tmp sta2e-theme-tmp-console">
      <div class="tmp__console-frame">

        <!-- ID stripe -->
        <div class="tmp__id-stripe">SFHQ</div>

        <!-- Campaign oval selector -->
        <div class="tmp__oval-block">
          <div class="tmp__oval-label">VESSEL</div>
          <select class="tmp__select" id="sta2e-campaign-select">${this._buildOptions(ctx)}</select>
        </div>

        <!-- Control ovals -->
        <div class="tmp__oval-row">
          <button type="button" class="tmp__btn" data-action="advance" data-advance="-1mo">-1MO</button>
          <button type="button" class="tmp__btn" data-action="advance" data-advance="-1d">-1D</button>
          <button type="button" class="tmp__btn" data-action="advance" data-advance="-1h">-1H</button>
          <button type="button" class="tmp__btn" data-action="advance" data-advance="-30m">-30M</button>
        </div>

        <!-- Green mono display -->
        <div class="tmp__display">
          <span class="tmp__display-label">STARDATE</span>
          <span class="tmp__stardate">${ctx.stardate}</span>
          ${calDate}
          <span class="tmp__sep">·</span>
          <span class="tmp__time">${ctx.time}</span>
          ${override}
        </div>

        <!-- Advance ovals -->
        <div class="tmp__oval-row">
          <button type="button" class="tmp__btn" data-action="advance" data-advance="+30m">+30M</button>
          <button type="button" class="tmp__btn" data-action="advance" data-advance="+1h">+1H</button>
          <button type="button" class="tmp__btn" data-action="advance" data-advance="+1d">+1D</button>
          <button type="button" class="tmp__btn" data-action="advance" data-advance="+1mo">+1MO</button>
        </div>

        ${ctx.isGM ? `<div class="tmp__oval-row">${gmBtns}</div>` : ""}

      </div>
    </div>`;
  }


  // ---------------------------------------------------------------------------
  // ENT Panel — 2150s gunmetal industrial, calendar-only, no stardates
  // ---------------------------------------------------------------------------

  _buildENT(ctx) {
    if (ctx.noCampaigns) {
      return `<div class="sta2e-hud sta2e-ent sta2e-theme-ent-panel">
        <div class="ent__frame">
          <span class="ent__empty">NO ACTIVE MISSION</span>
          ${ctx.isGM ? `<button type="button" class="ent__btn" data-action="openManager">SETUP</button>` : ""}
        </div>
      </div>`;
    }

    const override = ctx.hasOverride
      ? `<span class="ent__indicator" title="${ctx.overrideTooltip}">◈</span>` : "";
    const entPinClass = ctx.hasOverride ? "" : " ent__btn--dim";
    const entPinTitle = ctx.hasOverride ? "Unpin scene" : "Pin scene to this campaign";
    const gmBtns = ctx.isGM ? `
      <button type="button" class="ent__btn${entPinClass}" data-action="togglePin" title="${entPinTitle}">PIN</button>
      <button type="button" class="ent__btn ent__btn--dim" data-action="openWarpCalc" title="Warp Calculator">WARP</button>
      <button type="button" class="ent__btn ent__btn--dim" data-action="openEditor" title="Edit Date/Time">EDIT</button>
      <button type="button" class="ent__btn ent__btn--dim" data-action="openManager" title="Campaign Manager">CFG</button>` : "";

    return `<div class="sta2e-hud sta2e-ent sta2e-theme-ent-panel">
      <div class="ent__frame">

        <!-- ID block -->
        <div class="ent__id-block">
          <div class="ent__id-label">UESPA</div>
          <div class="ent__id-sub">VESSEL LOG</div>
        </div>

        <div class="ent__strut"></div>

        <!-- Campaign selector -->
        <div class="ent__field-block">
          <div class="ent__field-label">VESSEL</div>
          <select class="ent__select" id="sta2e-campaign-select">${this._buildOptions(ctx)}</select>
        </div>

        <div class="ent__strut"></div>

        <!-- Time step buttons — 4 back -->
        <div class="ent__btn-row">
          <button type="button" class="ent__btn" data-action="advance" data-advance="-1mo">-1MO</button>
          <button type="button" class="ent__btn" data-action="advance" data-advance="-1d">-1D</button>
          <button type="button" class="ent__btn" data-action="advance" data-advance="-1h">-1H</button>
          <button type="button" class="ent__btn" data-action="advance" data-advance="-30m">-30M</button>
        </div>

        <div class="ent__strut"></div>

        <!-- Date/time display — NO stardate -->
        <div class="ent__display">
          <div class="ent__display-label">EARTH DATE / TIME</div>
          <div class="ent__display-row">
            ${ctx.calendarDate ? `<span class="ent__date">${ctx.calendarDate}</span>` : ""}
            <span class="ent__sep">//</span>
            <span class="ent__time">${ctx.time}</span>
            ${override}
          </div>
        </div>

        <div class="ent__strut"></div>

        <!-- Time step buttons — 4 fwd -->
        <div class="ent__btn-row">
          <button type="button" class="ent__btn" data-action="advance" data-advance="+30m">+30M</button>
          <button type="button" class="ent__btn" data-action="advance" data-advance="+1h">+1H</button>
          <button type="button" class="ent__btn" data-action="advance" data-advance="+1d">+1D</button>
          <button type="button" class="ent__btn" data-action="advance" data-advance="+1mo">+1MO</button>
        </div>

        ${ctx.isGM ? `<div class="ent__strut"></div><div class="ent__btn-row">${gmBtns}</div>` : ""}

      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // localStorage key — per user so each person's collapsed state is independent
  get _storageKey() {
    return `sta2e-hud-collapsed-${game.userId}`;
  }

  get _isCollapsed() {
    return localStorage.getItem(this._storageKey) === "1";
  }

  _setCollapsed(val) {
    localStorage.setItem(this._storageKey, val ? "1" : "0");
  }

  render() {
    const ctx      = this._getContext();
    const html     = this._buildHTML(ctx);
    const collapsed = this._isCollapsed;

    if (!this._element) {
      // Build container: tab + bar wrapper together
      const container = document.createElement("div");
      container.id = "sta2e-hud-container";
      if (collapsed) container.classList.add("sta2e-hud--collapsed");

      // Tab — always visible, toggles bar
      const tab = document.createElement("button");
      tab.id = "sta2e-hud-tab";
      tab.type = "button";
      tab.title = "Show/hide HUD";
      tab.innerHTML = collapsed ? "▼" : "▲";
      tab.addEventListener("click", () => this._toggleCollapsed());

      // Bar wrapper
      const wrapper = document.createElement("div");
      wrapper.id = "sta2e-hud-wrapper";
      wrapper.innerHTML = html;

      container.appendChild(tab);
      container.appendChild(wrapper);

      const target = document.getElementById("interface") ?? document.body;
      target.appendChild(container);

      this._element  = wrapper;
      this._container = container;
      this._tab       = tab;
    } else {
      this._element.innerHTML = html;
      // Keep collapsed state in sync after re-render
      this._container?.classList.toggle("sta2e-hud--collapsed", collapsed);
      if (this._tab) this._tab.innerHTML = collapsed ? "▼" : "▲";
    }

    this._activateListeners();
  }

  _toggleCollapsed() {
    const next = !this._isCollapsed;
    this._setCollapsed(next);
    this._container?.classList.toggle("sta2e-hud--collapsed", next);
    if (this._tab) this._tab.innerHTML = next ? "▼" : "▲";
  }

  _activateListeners() {
    if (!this._element) return;

    this._element.querySelector("#sta2e-campaign-select")
      ?.addEventListener("change", async (e) => {
        await game.sta2eToolkit.campaignStore.setActiveCampaign(e.target.value);
      });

    this._element.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const action = e.currentTarget.dataset.action;
        if (action === "advance")       this._onAdvance(e.currentTarget.dataset.advance);
        if (action === "togglePin")     this._onTogglePin();
        if (action === "openWarpCalc")  game.sta2eToolkit.openWarpCalc();
        if (action === "openEditor")    game.sta2eToolkit.dateEditor.render({ force: true });
        if (action === "openManager")   game.sta2eToolkit.campaignManager.render({ force: true });
      });
    });
  }

  async _onTogglePin() {
    if (!canvas?.scene) {
      ui.notifications.warn("STA 2e Toolkit: No active scene to pin.");
      return;
    }
    const existing = canvas.scene.getFlag("sta2e-toolkit", "campaignOverride") ?? null;
    if (existing) {
      // Remove pin — scene becomes unpinned (no auto-switch on entry)
      await canvas.scene.unsetFlag("sta2e-toolkit", "campaignOverride");
      ui.notifications.info("STA 2e Toolkit: Scene unpinned.");
    } else {
      // Pin this scene to the current active campaign
      const ctx = this._getContext();
      if (!ctx?.activeId) return;
      await canvas.scene.setFlag("sta2e-toolkit", "campaignOverride", ctx.activeId);
      ui.notifications.info(`STA 2e Toolkit: Scene pinned to "${ctx.activeName}". Auto-switches on entry.`);
    }
    // updateScene hook triggers HUD re-render automatically
  }

  async _onAdvance(raw) {
    // Supports: +1d -1d +1h -1h +30m -30m +1mo -1mo
    const match = raw?.match(/^([+-]\d+)(mo|d|h|m)$/);
    if (!match) return;
    const value = parseInt(match[1]);
    const unit  = match[2];
    const delta = unit === "mo" ? { months: value }
                : unit === "d"  ? { days: value }
                : unit === "h"  ? { hours: value }
                :                 { minutes: value };
    await game.sta2eToolkit.campaignStore.advanceByDuration(delta);
  }

  // ---------------------------------------------------------------------------
  // Klingon Panel — angular strut layout, crimson/black, Year of Kahless
  // Sharp horizontal bars with angled cuts, no curves, aggressive typography
  // ---------------------------------------------------------------------------

  _buildKlingon(ctx) {
    const LC = ctx.theme;
    if (ctx.noCampaigns) {
      return `<div class="sta2e-hud sta2e-kling sta2e-theme-klingon">
        <div class="kling__strut kling__strut--label">tlhIngan HoS</div>
        <div class="kling__display kling__display--empty">bIjatlh 'e' yImev</div>
        ${ctx.isGM ? `<button type="button" class="kling__btn" data-action="openManager">SeH</button>` : ""}
      </div>`;
    }

    const dateStr   = ctx.klingonDate ?? ctx.calendarDate ?? "——";
    const override  = ctx.hasOverride ? `<span class="kling__indicator" title="${ctx.overrideTooltip}">▶</span>` : "";
    const pinClass  = ctx.hasOverride ? " kling__btn--active" : "";
    const pinTitle  = ctx.hasOverride ? "Unpin scene" : "Pin scene to this campaign";
    const gmBtns    = ctx.isGM ? `
      <button type="button" class="kling__btn${pinClass}" data-action="togglePin"  title="${pinTitle}">jIH</button>
      <button type="button" class="kling__btn" data-action="openWarpCalc" title="Warp Calculator">warp</button>
      <button type="button" class="kling__btn" data-action="openEditor"   title="Edit Date/Time">tev</button>
      <button type="button" class="kling__btn" data-action="openManager"  title="Campaign Manager">SeH</button>` : "";
    return `<div class="sta2e-hud sta2e-kling sta2e-theme-klingon">
      <div class="kling__strut kling__strut--label">tlhIngan HoS</div>
      <div class="kling__campaign-block">
        <select class="kling__select" id="sta2e-campaign-select">${this._buildOptions(ctx)}</select>
      </div>
      <div class="kling__slash">▶</div>
      <div class="kling__controls">
        <button type="button" class="kling__btn" data-action="advance" data-advance="-1mo" title="Back 1 Month (jar)">-1jar</button>
        <button type="button" class="kling__btn" data-action="advance" data-advance="-1d"  title="Back 1 Day (jaj)">-1jaj</button>
        <button type="button" class="kling__btn" data-action="advance" data-advance="-1h"  title="Back 1 Hour (rep)">-1rep</button>
      </div>
      <div class="kling__display">
        <span class="kling__label">DIS · jar · jaj</span>
        <span class="kling__date">${dateStr}</span>
        <span class="kling__sep">◆</span>
        <span class="kling__time">${ctx.time}</span>
        ${override}
      </div>
      <div class="kling__controls">
        <button type="button" class="kling__btn" data-action="advance" data-advance="+1h"  title="Forward 1 Hour (rep)">+1rep</button>
        <button type="button" class="kling__btn" data-action="advance" data-advance="+1d"  title="Forward 1 Day (jaj)">+1jaj</button>
        <button type="button" class="kling__btn" data-action="advance" data-advance="+1mo" title="Forward 1 Month (jar)">+1jar</button>
      </div>
      ${ctx.isGM ? `<div class="kling__slash">▶</div><div class="kling__controls">${gmBtns}</div>` : ""}
      <div class="kling__strut kling__strut--end"></div>
    </div>`;
  }

  _buildPlayerKlingon(ctx) {
    if (ctx.noCampaigns) {
      return `<div class="sta2e-hud sta2e-kling sta2e-theme-klingon">
        <div class="kling__strut kling__strut--label">tlhIngan HoS</div>
        <div class="kling__display kling__display--empty">bIjatlh 'e' yImev</div>
        <div class="kling__strut kling__strut--end"></div>
      </div>`;
    }
    const dateStr  = ctx.klingonDate ?? ctx.calendarDate ?? "——";
    const override = ctx.hasOverride
      ? `<span class="kling__indicator" title="${ctx.overrideTooltip}">▶</span>` : "";
    return `<div class="sta2e-hud sta2e-kling sta2e-theme-klingon">
      <div class="kling__strut kling__strut--label">tlhIngan HoS</div>
      <div class="kling__display">
        <span class="kling__label">DIS · jar · jaj · ${ctx.activeName}</span>
        <span class="kling__date">${dateStr}</span>
        <span class="kling__sep">◆</span>
        <span class="kling__time">${ctx.time}</span>
        ${override}
      </div>
      <div class="kling__strut kling__strut--end"></div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Romulan Panel — geometric layout, cold green, After Settlement calendar
  // Diamond separators, precise grid, clinical and sharp
  // ---------------------------------------------------------------------------

  _buildRomulan(ctx) {
    if (ctx.noCampaigns) {
      return `<div class="sta2e-hud sta2e-rom sta2e-theme-romulan">
        <div class="rom__header">ch'Rihan Mnhei'sahe</div>
        <div class="rom__display rom__display--empty">Hteij ir-Kaleh</div>
        ${ctx.isGM ? `<button type="button" class="rom__btn" data-action="openManager">Khre'riov</button>` : ""}
      </div>`;
    }

    const dateStr  = ctx.romulanDate ?? ctx.calendarDate ?? "——";
    const override = ctx.hasOverride ? `<span class="rom__indicator" title="${ctx.overrideTooltip}">◈</span>` : "";
    const pinClass = ctx.hasOverride ? " rom__btn--active" : "";
    const pinTitle = ctx.hasOverride ? "Unpin scene" : "Pin scene to this campaign";
    const gmBtns   = ctx.isGM ? `
      <button type="button" class="rom__btn${pinClass}" data-action="togglePin"   title="${pinTitle}">hfai</button>
      <button type="button" class="rom__btn" data-action="openWarpCalc" title="Warp Calculator">mnekha</button>
      <button type="button" class="rom__btn" data-action="openEditor"   title="Edit Date/Time">aefvriha</button>
      <button type="button" class="rom__btn" data-action="openManager"  title="Campaign Manager">khre'riov</button>` : "";

    return `<div class="sta2e-hud sta2e-rom sta2e-theme-romulan">
      <div class="rom__header">ch'Rihan</div>
      <div class="rom__diamond">◆</div>
      <div class="rom__campaign-block">
        <select class="rom__select" id="sta2e-campaign-select">${this._buildOptions(ctx)}</select>
      </div>
      <div class="rom__diamond">◆</div>
      <div class="rom__controls">
        <button type="button" class="rom__btn" data-action="advance" data-advance="-1mo" title="Back 1 Month (mnhei)">-1mnhei</button>
        <button type="button" class="rom__btn" data-action="advance" data-advance="-1d"  title="Back 1 Day (aefvriha)">-1aefvriha</button>
        <button type="button" class="rom__btn" data-action="advance" data-advance="-1h"  title="Back 1 Hour (rep)">-1rep</button>
      </div>
      <div class="rom__diamond">◆</div>
      <div class="rom__display">
        <span class="rom__label">AS · mnhei · aefvriha</span>
        <span class="rom__date">${dateStr}</span>
        <span class="rom__sep">◇</span>
        <span class="rom__time">${ctx.time}</span>
        ${override}
      </div>
      <div class="rom__diamond">◆</div>
      <div class="rom__controls">
        <button type="button" class="rom__btn" data-action="advance" data-advance="+1h"  title="Forward 1 Hour (rep)">+1rep</button>
        <button type="button" class="rom__btn" data-action="advance" data-advance="+1d"  title="Forward 1 Day (aefvriha)">+1aefvriha</button>
        <button type="button" class="rom__btn" data-action="advance" data-advance="+1mo" title="Forward 1 Month (mnhei)">+1mnhei</button>
      </div>
      ${ctx.isGM ? `<div class="rom__diamond">◆</div><div class="rom__controls">${gmBtns}</div>` : ""}
      <div class="rom__footer"></div>
    </div>`;
  }

  _buildPlayerRomulan(ctx) {
    if (ctx.noCampaigns) {
      return `<div class="sta2e-hud sta2e-rom sta2e-theme-romulan">
        <div class="rom__header">ch'Rihan Mnhei'sahe</div>
        <div class="rom__display rom__display--empty">Hteij ir-Kaleh</div>
        <div class="rom__footer"></div>
      </div>`;
    }
    const dateStr  = ctx.romulanDate ?? ctx.calendarDate ?? "——";
    const override = ctx.hasOverride
      ? `<span class="rom__indicator" title="${ctx.overrideTooltip}">◈</span>` : "";
    return `<div class="sta2e-hud sta2e-rom sta2e-theme-romulan">
      <div class="rom__header">ch'Rihan</div>
      <div class="rom__diamond">◆</div>
      <div class="rom__display">
        <span class="rom__label">AS · mnhei · aefvriha · ${ctx.activeName}</span>
        <span class="rom__date">${dateStr}</span>
        <span class="rom__sep">◇</span>
        <span class="rom__time">${ctx.time}</span>
        ${override}
      </div>
      <div class="rom__diamond">◆</div>
      <div class="rom__footer"></div>
    </div>`;
  }

  destroy() {
    this._container?.remove();
    this._element   = null;
    this._container = null;
    this._tab       = null;
  }
}
