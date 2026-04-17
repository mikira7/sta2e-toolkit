/**
 * sta2e-toolkit | transporter.js
 * Transporter Control — LCARS UI, cross-scene beam buffer, JB2A effects.
 *
 * Replaces the standalone Transporter macro. Exposes openTransporter() which
 * is registered on game.sta2eToolkit and called by the Combat HUD button.
 *
 * Beam buffer is stored as a world-level game setting (scope:"world") so any
 * GM can see and restore patterns regardless of who beamed them out.
 *
 * JB2A tier is detected from the sta2e-toolkit jb2aTier setting. Patron paths
 * are used when available; free-tier paths with .tint() are used otherwise.
 */

import { getLcTokens } from "./lcars-theme.js";
import {
  formatStardate, formatCalendarDate,
  formatKlingonDate, formatRomulanDate,
} from "./stardate-calc.js";

const MODULE = "sta2e-toolkit";

// ── Current date label ────────────────────────────────────────────────────────
// Returns the appropriate date string for the active campaign era/theme,
// replacing the old random stardate generator.

function _getCurrentDateLabel() {
  try {
    const store    = game?.sta2eToolkit?.campaignStore;
    const campaign = store?.getActiveCampaign?.();
    if (!campaign) return null;

    const era   = campaign.era;
    const theme = (() => {
      try { return game.settings.get(MODULE, "hudTheme"); } catch { return "lcars-tng"; }
    })();

    const isKlingon = era === "klingon" || theme === "klingon";
    const isRomulan = era === "romulan" || theme === "romulan";
    const isENT     = era === "ent"     || theme === "ent-panel";
    const isTOS     = era === "tos"     || theme === "tos-panel";
    const isTMP     = era === "tmp"     || theme === "tmp-console";

    if (isKlingon && campaign.calendarDate) return formatKlingonDate(campaign.calendarDate);
    if (isRomulan && campaign.calendarDate) return formatRomulanDate(campaign.calendarDate);
    if (isENT     && campaign.calendarDate) return formatCalendarDate(campaign.calendarDate);
    if (isTOS     && campaign.stardate   ) return `STARDATE ${formatStardate(campaign.stardate)}`;
    if (isTMP     && campaign.stardate   ) return `SD ${formatStardate(campaign.stardate)}`;
    if (campaign.stardate) return `STARDATE ${formatStardate(campaign.stardate)}`;
    if (campaign.calendarDate) return formatCalendarDate(campaign.calendarDate);
  } catch { /* fall through */ }
  return null;
}

// ── Theme detection ────────────────────────────────────────────────────────────

function _getThemeKey() {
  try {
    const store    = game?.sta2eToolkit?.campaignStore;
    const campaign = store?.getActiveCampaign?.();
    if (campaign?.theme) return campaign.theme;
    return game.settings.get(MODULE, "hudTheme") ?? "lcars-tng";
  } catch { return "lcars-tng"; }
}

// ── Per-theme CSS injection ────────────────────────────────────────────────────
// Each theme gets its own CSS variable overrides AND structural style
// overrides applied to .sta2e-tp-dialog via a data-theme attribute.

function _buildThemeVars() {
  const LC    = getLcTokens();
  const theme = _getThemeKey();
  const arrow = encodeURIComponent(LC.primary);

  // Base variables applied to all themes
  const baseVars = `
    .sta2e-tp-dialog {
      --tp-bg:         ${LC.bg};
      --tp-panel:      ${LC.panel};
      --tp-primary:    ${LC.primary};
      --tp-secondary:  ${LC.secondary};
      --tp-tertiary:   ${LC.tertiary};
      --tp-text:       ${LC.text};
      --tp-text-dim:   ${LC.textDim};
      --tp-border:     ${LC.border};
      --tp-border-dim: ${LC.borderDim};
      --tp-red:        ${LC.red};
      --tp-green:      ${LC.green};
      --tp-font:       ${LC.font};
    }
    .sta2e-tp-dialog .sta2e-tp-select {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='${arrow}'/%3E%3C/svg%3E") !important;
    }`;

  // Theme-specific structural overrides
  const themeExtras = {

    "tos-panel": `
      /* TOS — squared metal panel, amber on dark, blinky indicator aesthetic */
      .sta2e-tp-dialog[data-theme="tos-panel"] {
        font-family: "Helvetica Neue", Arial, sans-serif;
        background: #1a1a1a;
        border: 2px solid #111;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-header {
        background: linear-gradient(180deg, #363636 0%, #2a2a2a 40%, #222 100%);
        border-radius: 0;
        border-bottom: 3px solid #111;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -1px 0 rgba(0,0,0,0.5);
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-header-pill {
        background: #cc4400;
        color: #fff;
        border-radius: 2px;
        font-family: "Helvetica Neue", Arial, sans-serif;
        letter-spacing: 1px;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-header-title {
        color: #e8c860;
        font-family: "Helvetica Neue", Arial, sans-serif;
        font-size: 11px;
        letter-spacing: 4px;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-header-stardate {
        color: #e8c860;
        font-family: "Helvetica Neue", Arial, sans-serif;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-sidebar {
        background: linear-gradient(180deg, #333 0%, #222 100%);
        border-right: 2px solid #111;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-sidebar-right {
        background: linear-gradient(180deg, #222 0%, #1a1a1a 100%);
        border-left: 2px solid #111;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-section-label {
        color: #888;
        border-bottom: 1px solid #444;
        font-family: "Helvetica Neue", Arial, sans-serif;
        font-size: 8px;
        letter-spacing: 4px;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-label {
        color: #e8c860;
        font-family: "Helvetica Neue", Arial, sans-serif;
        font-size: 9px;
        letter-spacing: 2px;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-select,
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-input {
        background: #111 !important;
        border: 1px solid #555;
        color: #e8c860;
        border-radius: 2px;
        font-family: "Helvetica Neue", Arial, sans-serif;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-drop-zone {
        border: 2px solid #555;
        border-radius: 2px;
        background: #0f0f0f;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-drop-zone.drag-over {
        border-color: #e8c860;
        background: #1a1800;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-drop-hint { color: #555; }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-token-item {
        background: #111;
        border-color: #555;
        border-left-color: #e8c860;
        border-radius: 2px;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-col-right {
        border-left-color: #333;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-buffer-group {
        background: #0f0f0f;
        border-color: #555;
        border-left-color: #e8c860;
        border-radius: 2px;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-buffer-header {
        background: #1a1a1a;
        border-bottom-color: #333;
      }
      .sta2e-tp-dialog[data-theme="tos-panel"] .sta2e-tp-footer-bar {
        background: linear-gradient(to right, #e8c860, #aa8800, #e8c860);
      }`,

    "tmp-console": `
      /* TMP — sleek blue, oval pill buttons, left gradient stripe */
      .sta2e-tp-dialog[data-theme="tmp-console"] {
        font-family: "Helvetica Neue", Arial, sans-serif;
        background: #0d1016;
        border: 1px solid #1e2838;
        border-radius: 6px;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-header {
        background: linear-gradient(180deg, #141820 0%, #0d1016 100%);
        border-radius: 6px 6px 0 0;
        border-bottom: 1px solid #1e2838;
        padding-left: 38px; /* room for the stripe */
        position: relative;
        overflow: visible;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-header::before {
        content: "";
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 30px;
        background: linear-gradient(180deg, #3a6090 0%, #1e3a60 100%);
        border-radius: 6px 0 0 0;
        border-right: 1px solid #0a1828;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-header-pill {
        background: #1a3060;
        color: #b8d8f8;
        border-radius: 10px;
        font-family: "Helvetica Neue", Arial, sans-serif;
        border: 1px solid #3a5a90;
        font-size: 9px;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-header-title {
        color: #7ab4e8;
        font-family: "Helvetica Neue", Arial, sans-serif;
        font-size: 11px;
        letter-spacing: 4px;
        font-weight: 400;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-header-stardate {
        color: #3a5a80;
        font-family: "Helvetica Neue", Arial, sans-serif;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-sidebar {
        background: linear-gradient(180deg, #1e3060 0%, #0a1828 100%);
        border-right: 1px solid #0a1828;
        border-radius: 0;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-sidebar-right {
        background: linear-gradient(180deg, #0d1828 0%, #080d14 100%);
        border-left: 1px solid #1e2838;
        border-radius: 0 0 6px 0;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-section-label {
        color: #3a5a80;
        border-bottom: 1px solid #1e2838;
        font-family: "Helvetica Neue", Arial, sans-serif;
        font-size: 7px;
        letter-spacing: 4px;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-label {
        color: #3a5a80;
        font-family: "Helvetica Neue", Arial, sans-serif;
        font-size: 9px;
        letter-spacing: 3px;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-select,
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-input {
        background: #080d14 !important;
        border: 1px solid #2a3a50;
        border-radius: 8px;
        color: #7ab4e8;
        font-family: "Helvetica Neue", Arial, sans-serif;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-drop-zone {
        border: 1px solid #1e2838;
        border-radius: 8px;
        background: #080d14;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-drop-zone.drag-over {
        border-color: #7ab4e8;
        background: #0d1828;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-drop-hint { color: #1e2838; }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-token-item {
        background: #080d14;
        border-color: #1e2838;
        border-left-color: #3a6090;
        border-radius: 6px;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-col-right {
        border-left-color: #1e2838;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-buffer-group {
        background: #080d14;
        border-color: #1e2838;
        border-left-color: #3a6090;
        border-radius: 6px;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-buffer-header {
        background: #0d1828;
        border-bottom-color: #1e2838;
      }
      .sta2e-tp-dialog[data-theme="tmp-console"] .sta2e-tp-footer-bar {
        background: linear-gradient(to right, #3a6090, #1e3060, #3a6090);
        border-radius: 0 0 4px 4px;
      }`,

    "ent-panel": `
      /* ENT — gunmetal industrial, subdued blue-grey, UESPA aesthetic */
      .sta2e-tp-dialog[data-theme="ent-panel"] {
        font-family: Arial, sans-serif;
        background: #090c0f;
        border: 1px solid #1e2a38;
        border-radius: 2px;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-header {
        background: #111820;
        border-radius: 0;
        border-bottom: 2px solid #1e2a38;
        padding: 5px 12px;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-header-pill {
        background: #0d1520;
        color: #4a7a99;
        border-radius: 2px;
        font-family: Arial, sans-serif;
        border: 1px solid #253040;
        letter-spacing: 2px;
        font-size: 9px;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-header-title {
        color: #4a7a99;
        font-family: Arial, sans-serif;
        font-size: 11px;
        letter-spacing: 5px;
        font-weight: 400;
        text-transform: uppercase;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-header-stardate {
        color: #3a5566;
        font-family: "Courier New", monospace;
        font-size: 10px;
        letter-spacing: 1px;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-sidebar {
        background: #0d1520;
        border-right: 1px solid #1e2a38;
        border-radius: 0;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-sidebar-right {
        background: #0a1018;
        border-left: 1px solid #1e2a38;
        border-radius: 0;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-sidebar::before,
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-sidebar::after {
        background: #1e2a38;
        width: 8px; height: 8px;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-section-label {
        color: #3a5566;
        border-bottom: 1px solid #1e2a38;
        font-family: Arial, sans-serif;
        font-size: 8px;
        letter-spacing: 3px;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-label {
        color: #3a5566;
        font-family: Arial, sans-serif;
        font-size: 9px;
        letter-spacing: 2px;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-select,
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-input {
        background: #0d1520 !important;
        border: 1px solid #253040;
        border-radius: 1px;
        color: #4a7a99;
        font-family: Arial, sans-serif;
        font-size: 11px;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-drop-zone {
        border: 1px solid #1e2a38;
        border-radius: 1px;
        background: #080c12;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-drop-zone.drag-over {
        border-color: #4a7a99;
        background: #0d1828;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-drop-hint { color: #1e2a38; font-family: Arial, sans-serif; }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-token-item {
        background: #0d1520;
        border-color: #1e2a38;
        border-left-color: #4a7a99;
        border-radius: 1px;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-col-right { border-left-color: #1e2a38; }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-buffer-group {
        background: #0a1018;
        border-color: #1e2a38;
        border-left-color: #4a7a99;
        border-radius: 1px;
      }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-buffer-header { background: #0d1520; border-bottom-color: #1e2a38; }
      .sta2e-tp-dialog[data-theme="ent-panel"] .sta2e-tp-footer-bar {
        background: linear-gradient(to right, #253040, #1e2a38, #253040);
      }`,

    "klingon": `
      /* Klingon — harsh, zero curves, blood red on black */
      .sta2e-tp-dialog[data-theme="klingon"] {
        font-family: "Arial Narrow", Arial, sans-serif;
        background: #0f0000;
        border: 2px solid #661100;
        border-radius: 0;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-header {
        background: #1a0000;
        border-radius: 0;
        border-bottom: 2px solid #881100;
        padding: 6px 12px;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-header-pill {
        background: #330000;
        color: #cc1111;
        border-radius: 0;
        font-family: "Arial Narrow", Arial, sans-serif;
        border: 1px solid #661100;
        letter-spacing: 3px;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-header-title {
        color: #cc1111;
        font-family: "Arial Narrow", Arial, sans-serif;
        font-size: 14px;
        letter-spacing: 6px;
        font-weight: 700;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-header-stardate {
        color: #661100;
        font-family: "Arial Narrow", Arial, sans-serif;
        font-size: 10px;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-sidebar {
        background: #1a0000;
        border-right: 2px solid #661100;
        border-radius: 0;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-sidebar-right {
        background: #140000;
        border-left: 2px solid #440900;
        border-radius: 0;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-sidebar::before,
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-sidebar::after {
        background: #661100;
        border-radius: 0;
        width: 8px; height: 3px; /* angular, not round */
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-section-label {
        color: #661100;
        border-bottom: 1px solid #661100;
        font-family: "Arial Narrow", Arial, sans-serif;
        letter-spacing: 4px;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-label {
        color: #883300;
        font-family: "Arial Narrow", Arial, sans-serif;
        letter-spacing: 2px;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-select,
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-input {
        background: #0f0000 !important;
        border: 1px solid #661100;
        border-radius: 0;
        color: #cc3300;
        font-family: "Arial Narrow", Arial, sans-serif;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-drop-zone {
        border: 2px solid #441100;
        border-radius: 0;
        background: #0a0000;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-drop-zone.drag-over {
        border-color: #cc1111;
        background: #1a0000;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-drop-hint { color: #440900; font-family: "Arial Narrow", Arial, sans-serif; }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-token-item {
        background: #0f0000;
        border-color: #661100;
        border-left-color: #cc1111;
        border-radius: 0;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-col-right { border-left-color: #330000; }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-buffer-group {
        background: #0a0000;
        border-color: #661100;
        border-left-color: #cc1111;
        border-radius: 0;
      }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-buffer-header { background: #140000; border-bottom-color: #330000; }
      .sta2e-tp-dialog[data-theme="klingon"] .sta2e-tp-footer-bar {
        background: linear-gradient(to right, #cc1111, #661100, #cc1111);
        border-radius: 0;
      }`,

    "romulan": `
      /* Romulan — cold precise green, left accent stripe, clinical */
      .sta2e-tp-dialog[data-theme="romulan"] {
        font-family: "Arial Narrow", Arial, sans-serif;
        background: #000a00;
        border: 1px solid #1a5533;
        border-radius: 2px;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-header {
        background: #001200;
        border-radius: 0;
        border-bottom: 1px solid #1a5533;
        padding: 6px 12px 6px 16px;
        position: relative;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-header::before {
        content: "";
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 6px;
        background: #22aa44;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-header-pill {
        background: #001a00;
        color: #22aa44;
        border-radius: 2px;
        font-family: "Arial Narrow", Arial, sans-serif;
        border: 1px solid #1a5533;
        letter-spacing: 2px;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-header-title {
        color: #22aa44;
        font-family: "Arial Narrow", Arial, sans-serif;
        font-size: 12px;
        letter-spacing: 5px;
        font-weight: 400;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-header-stardate {
        color: #1a5533;
        font-family: "Arial Narrow", Arial, sans-serif;
        font-size: 10px;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-sidebar {
        background: #001a00;
        border-right: 1px solid #1a5533;
        border-radius: 0;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-sidebar::before,
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-sidebar::after {
        background: #1a5533;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-sidebar-right {
        background: #00140a;
        border-left: 1px solid #0d3322;
        border-radius: 0;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-section-label {
        color: #1a5533;
        border-bottom: 1px solid #1a5533;
        font-family: "Arial Narrow", Arial, sans-serif;
        letter-spacing: 4px;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-label {
        color: #226633;
        font-family: "Arial Narrow", Arial, sans-serif;
        letter-spacing: 2px;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-select,
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-input {
        background: #001200 !important;
        border: 1px solid #1a5533;
        border-radius: 2px;
        color: #22aa44;
        font-family: "Arial Narrow", Arial, sans-serif;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-drop-zone {
        border: 1px solid #0d3322;
        border-radius: 2px;
        background: #000a00;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-drop-zone.drag-over {
        border-color: #22aa44;
        background: #001a00;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-drop-hint { color: #0d3322; font-family: "Arial Narrow", Arial, sans-serif; }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-token-item {
        background: #001200;
        border-color: #1a5533;
        border-left-color: #22aa44;
        border-radius: 1px;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-col-right { border-left-color: #0d3322; }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-buffer-group {
        background: #000a00;
        border-color: #1a5533;
        border-left-color: #22aa44;
        border-radius: 2px;
      }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-buffer-header { background: #001a00; border-bottom-color: #0d3322; }
      .sta2e-tp-dialog[data-theme="romulan"] .sta2e-tp-footer-bar {
        background: linear-gradient(to right, #22aa44, #1a5533, #22aa44);
      }`,
  };

  const extra = themeExtras[theme] ?? "";
  return `<style>${baseVars}${extra}</style>`;
}

// ── Sound helper ─────────────────────────────────────────────────────────────
// Reads from module settings; returns empty string if unset (no sound played).

function _tSound(settingKey) {
  try { return game.settings.get(MODULE, settingKey) ?? ""; }
  catch { return ""; }
}

// ── Transporter effect configurations ────────────────────────────────────────
// Patron stacks use the colour-correct JB2A Patreon assets per faction.
// Free stacks use the confirmed-free blue assets for all factions;
// faction colour is applied via .tint() in _playEffect.

// Blue stack — confirmed available in JB2A free (JB2A_DnD5e)
const _BLUE_STACK = [
  { file: "jb2a.token_border.circle.static.blue.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
  { file: "jb2a.particle_burst.01.circle.bluepurple",  scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
  { file: "jb2a.markers.light.outro.blue",             scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
  { file: "jb2a.teleport.01.blue",                     scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
];

// Hex colors for the beam-in cursor indicator, one per transporter type.
// voyFed/tngFed have no freeTint so use their canonical blue.
const _TRANSPORTER_COLORS = {
  voyFed:     0x4488ff,
  tngFed:     0x4488ff,
  tmpFed:     0xDDEEFF,   // cool silver-white for TMP / film era
  tosFed:     0xFFD700,
  klingon:    0xCC2200,
  cardassian: 0xCC7700,
  romulan:    0x00CC55,
  ferengi:    0xFF8800,
  borg:       0x44BB22,
};

function _buildTransporterEffects() {
  return {
    voyFed: {
      name: "Voyager",
      sound: _tSound("sndTransporterVoyFed"),
      patronEffects: _BLUE_STACK,   // blue is correct for Voyager on both tiers
      freeEffects:   _BLUE_STACK,
    },
    tngFed: {
      name: "TNG",
      sound: _tSound("sndTransporterTngFed"),
      patronEffects: _BLUE_STACK,   // blue is correct for TNG on both tiers
      freeEffects:   _BLUE_STACK,
    },
    tosFed: {
      name: "TOS",
      sound: _tSound("sndTransporterTosFed"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.orange.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.yellow",       scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.yellow",            scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.yellow",                    scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 3000 },
      ],
      freeEffects: _BLUE_STACK,
      freeTint:    "#FFD700",
    },
    // TMP = Star Trek II–VI film era — silver-white transporter column.
    // Only jb2a.teleport.01.white is confirmed to exist; the border, burst,
    // and marker layers fall back to the blue stack tinted to silver-white.
    tmpFed: {
      name: "TMP / Films",
      sound: _tSound("sndTransporterTmpFed"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.blue.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.bluepurple",  scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.blue",             scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.white",                    scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
      ],
      patronTint:  "#DDEEFF",   // tints the blue layers to silver-white
      freeEffects: _BLUE_STACK,
      freeTint:    "#DDEEFF",
    },
    klingon: {
      name: "Klingon",
      sound: _tSound("sndTransporterKlingon"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.dark_red.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.orangepink",     scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.red",                 scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.greenorange",                 scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
      ],
      freeEffects: _BLUE_STACK,
      freeTint:    "#CC2200",
    },
    cardassian: {
      name: "Cardassian",
      sound: _tSound("sndTransporterCardassian"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.orange.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.yellow",       scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.yellow02",          scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.yellow",                    scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
      ],
      freeEffects: _BLUE_STACK,
      freeTint:    "#CC7700",
    },
    romulan: {
      name: "Romulan",
      sound: _tSound("sndTransporterRomulan"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.green.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.green",       scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.green",            scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.green",                    scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
      ],
      freeEffects: _BLUE_STACK,
      freeTint:    "#00CC55",
    },
    ferengi: {
      name: "Ferengi",
      sound: _tSound("sndTransporterFerengi"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.orange.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.yellow",       scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.yellow02",          scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.yellow",                    scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
      ],
      freeEffects: _BLUE_STACK,
      freeTint:    "#FF8800",
    },
    borg: {
      name: "Borg",
      sound: _tSound("sndTransporterBorg"),
      patronEffects: [
        { file: "jb2a.token_border.circle.static.green.007", scale: 0.5, fadeIn: 100, fadeOut: 500, delay: 200 },
        { file: "jb2a.particle_burst.01.circle.green",       scale: 0.4, fadeIn: 450, fadeOut: 600, delay: 50, playbackRate: 0.7, belowTokens: true },
        { file: "jb2a.markers.light.outro.green",            scale: 0.6, fadeIn: 50,  fadeOut: 500, delay: 50, playbackRate: 1 },
        { file: "jb2a.teleport.01.green",                    scale: 1.4, fadeIn: 100, fadeOut: 500, delay: 2400 },
      ],
      freeEffects: _BLUE_STACK,
      freeTint:    "#44BB22",
    },
  };
}

// ── JB2A tier detection ───────────────────────────────────────────────────────

function _isPatronJb2a() {
  try {
    const setting = game.settings.get(MODULE, "jb2aTier");
    if (setting) return setting === "patron";
  } catch { /* fall through */ }
  return game.modules.get("jb2a_patreon")?.active ?? false;
}

// ── VFX playback ──────────────────────────────────────────────────────────────
// Uses patron effect stack when jb2aTier === "patron", otherwise falls back
// to the free blue stack with a faction tint applied to each layer.

function _playEffect(token, transporterType, effects) {
  if (!game.modules.get("sequencer")?.active) {
    ui.notifications.warn("STA2e Toolkit: Sequencer module is not active.");
    return;
  }
  const config = effects[transporterType];
  if (!config) return;

  const patron = _isPatronJb2a();
  const stack  = patron ? config.patronEffects : config.freeEffects;
  const tint   = patron ? (config.patronTint ?? null) : (config.freeTint ?? null);

  const seq = new Sequence();
  stack.forEach(e => {
    let step = seq.effect().file(e.file).atLocation(token);
    if (e.scale)        step = step.scale(e.scale);
    if (e.fadeIn)       step = step.fadeIn(e.fadeIn);
    if (e.fadeOut)      step = step.fadeOut(e.fadeOut);
    if (e.delay)        step = step.delay(e.delay);
    if (e.playbackRate) step = step.playbackRate(e.playbackRate);
    if (e.belowTokens)  step = step.belowTokens();
    if (tint)           step = step.tint(tint);
  });
  seq.play();
}

function _playSound(soundSrc) {
  if (!soundSrc) return;
  const AudioHelper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
  AudioHelper.play({ src: soundSrc, volume: 0.8, autoplay: true, loop: false }, true);
}

// ── TokenMagic transporter effect ────────────────────────────────────────────

/**
 * Apply an old-film grain + faction-coloured glow via TokenMagic to a token
 * during transport.  No-ops gracefully when TokenMagic is not installed/active.
 * @param {Token} token           The canvas Token placeable.
 * @param {string} transporterType  Key into _TRANSPORTER_COLORS.
 */
function _applyTransporterMagic(token, transporterType) {
  if (!game.modules.get("tokenmagic")?.active) return;
  const TM = globalThis.TokenMagic;
  if (!TM) return;
  const color = _TRANSPORTER_COLORS[transporterType] ?? 0x4488ff;
  TM.addFilters(token, [
    // Flowing faction-coloured liquid distortion rippling over the token
    {
      filterType:   "liquid",
      filterId:     "sta2e-tp",
      color,
      scale:        1,
      intensity:    3,
      blend:        4,        // lighten — preserves token image beneath
      spectral:     false,
      alphaDiscard: false,
      animated: {
        time: { active: true, speed: 0.003, loopDuration: 3000, animType: "cosOscillation" },
      },
    },
    // Glowing particle rain — globes creates floating sparkle orbs that drift
    // over the token, matching the TNG transporter shimmer look.
    {
      filterType:   "globes",
      filterId:     "sta2e-tp",
      color,
      scale:        40,
      distortion:   0.2,
      alphaDiscard: false,
      animated: {
        time: { active: true, speed: 0.05, animType: "move", loopDuration: 3000 },
      },
    },
    // Bloom — makes the sparkle orbs flare brighter, adds the "dissolving
    // into light" look.  No colour param; amplifies existing bright pixels.
    {
      filterType:  "xbloom",
      filterId:    "sta2e-tp",
      threshold:   0.4,
      bloomScale:  1.5,
      brightness:  1.2,
      blur:        4,
      quality:     4,
      animated: {
        bloomScale: {
          active:       true,
          loopDuration: 900,
          val1:         1.0,
          val2:         2.2,
          animType:     "cosOscillation",
        },
      },
    },
    // Faction-coloured pulsing outer glow that ties everything together
    {
      filterType:    "glow",
      filterId:      "sta2e-tp",
      distance:      12,
      outerStrength: 2.0,
      innerStrength: 0.8,
      color,
      quality:  0.5,
      knockout: false,
      animated: {
        outerStrength: {
          active:       true,
          loopDuration: 700,
          val1:         0.5,
          val2:         3.5,
          animType:     "cosOscillation",
        },
      },
    },
  ]);
}

/**
 * Remove the transporter TokenMagic filters from a token.
 * @param {Token} token  The canvas Token placeable.
 */
function _removeTransporterMagic(token) {
  if (!game.modules.get("tokenmagic")?.active) return;
  const TM = globalThis.TokenMagic;
  if (!TM) return;
  TM.deleteFilters(token, "sta2e-tp");
}

// ── Beam buffer (world setting) ───────────────────────────────────────────────
// Stored as a JSON string in a world-scoped module setting so any GM client
// can read and restore patterns, not just the one who beamed them out.

const BUFFER_SETTING = "transporterBeamBuffer";

async function _getBeamGroups() {
  try {
    const raw = game.settings.get(MODULE, BUFFER_SETTING);
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

async function _setBeamGroups(groups) {
  await game.settings.set(MODULE, BUFFER_SETTING, groups);
}

async function _clearBeamGroups() {
  await game.settings.set(MODULE, BUFFER_SETTING, []);
}

async function _removeBeamGroup(groupId) {
  const groups  = await _getBeamGroups();
  const updated = groups.filter(g => g.groupId !== groupId);
  await _setBeamGroups(updated);
}

// ── Wildcard image helpers ────────────────────────────────────────────────────

async function _getWildcardImages(wildcardPath) {
  const lastSlash = wildcardPath.lastIndexOf("/");
  const directory = wildcardPath.substring(0, lastSlash);
  const pattern   = wildcardPath.substring(lastSlash + 1);
  try {
    const FP = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;
    const response = await FP.browse("data", directory);
    if (response?.files) {
      const regex = new RegExp("^" + pattern.replace("*", ".*") + "$");
      return response.files.filter(f => regex.test(f.split("/").pop()));
    }
  } catch (e) {
    console.warn("STA2e Transporter | wildcard browse failed:", e);
  }
  return [];
}

async function _getWildcardImage(wildcardPath) {
  try {
    const images = await _getWildcardImages(wildcardPath);
    if (images?.length > 0) return images[Math.floor(Math.random() * images.length)];
  } catch { /* fall through */ }
  return wildcardPath;
}

// ── Beam out ──────────────────────────────────────────────────────────────────

async function _beamOutSelected(transporterType, effects) {
  const controlled = canvas.tokens.controlled;
  if (!controlled?.length) {
    ui.notifications.warn("No tokens selected. Select tokens to beam out.");
    return;
  }
  if (controlled.length > 6) {
    ui.notifications.error(`Transporter Malfunction — ${controlled.length} patterns detected. Starfleet regulations limit transport to 6 personnel simultaneously.`);
    return;
  }

  const config  = effects[transporterType];
  const entries = controlled
    .filter(t => t.actor)
    .map(t => ({
      actorId:      t.actor.id,
      name:         t.actor.name,
      img:          t.document.texture?.src ?? t.actor.img,
      resolvedImg:  t.document.texture?.src ?? t.actor.img,
      wildcardPath: t.actor.prototypeToken?.texture?.src ?? t.actor.prototypeToken?.img,
      isLinked:     t.document.actorLink,
      isWildcard:   t.actor.prototypeToken?.randomImg ?? false,
      quantity:     1,
    }));

  if (entries.length) {
    const effectName = effects[transporterType]?.name ?? transporterType;
    const newGroup   = {
      groupId:         `grp_${Date.now()}`,
      label:           effectName.toUpperCase(),
      transporterType,
      timestamp:       Date.now(),
      entries,
    };
    const existing = await _getBeamGroups();
    await _setBeamGroups([...existing, newGroup]);
    ui.notifications.info(`Transporter buffer: "${newGroup.label}" — ${entries.length} pattern${entries.length > 1 ? "s" : ""} held.`);
  }

  _playSound(config.sound);

  for (const token of controlled) {
    _playEffect(token, transporterType, effects);
    _applyTransporterMagic(token, transporterType);
    setTimeout(async () => {
      try {
        await token.document.update({ alpha: 0 }, { animate: true, animation: { duration: 800 } });
        setTimeout(async () => { try { await token.document.delete(); } catch { /**/ } }, 1000);
      } catch (e) { console.error("Transporter beam-out error:", e); }
    }, 2400);
  }
}

// ── Beam in (from dialog queue) ───────────────────────────────────────────────

// ── Beam-in cursor indicator ──────────────────────────────────────────────────

/**
 * Draw a dashed circle arc sequence.
 * Uses 10 evenly-spaced dashes with a 4:1 dash-to-gap ratio — matching the
 * SVG's stroke-dasharray:120 30 on r=240, but scaled correctly at any radius.
 * Caller sets lineStyle first.
 */
function _drawDashedCircle(g, cx, cy, radius) {
  if (radius <= 0) return;
  const DASHES  = 10;
  const period  = (2 * Math.PI) / DASHES;   // 36° per slot
  const dashArc = period * (120 / 150);      // 4/5 of slot = dash, 1/5 = gap
  for (let i = 0; i < DASHES; i++) {
    const startAngle = i * period;
    const endAngle   = startAngle + dashArc;
    g.moveTo(cx + radius * Math.cos(startAngle), cy + radius * Math.sin(startAngle));
    g.arc(cx, cy, radius, startAngle, endAngle);
  }
}

/**
 * Calculate the top-left spawn position for each token under the chosen pattern.
 * cx/cy is the canvas point the user clicked (= the orbit / layout centre).
 */

function _scatterMaxRadius(total) {
  const gridSize = canvas.grid?.size ?? 100;
  return Math.max(gridSize * 1.5 * Math.sqrt(total), gridSize * 1.5);
}

function _calcSpawnPositions(pattern, total, cx, cy, spacing) {
  if (pattern === "line") {
    const step       = spacing / 2;
    const totalWidth = (total - 1) * step;
    return Array.from({ length: total }, (_, i) => ({
      x: cx - totalWidth / 2 + i * step,
      y: cy,
    }));
  }
  if (pattern === "scatter") {
    const gridSize  = canvas.grid?.size ?? 100;
    const maxRadius = _scatterMaxRadius(total);
    const minDist   = gridSize * 0.5;
    const minSep    = gridSize * 1.1;
    const placed    = [];
    for (let i = 0; i < total; i++) {
      let pos;
      let attempts = 0;
      do {
        const angle = Math.random() * 2 * Math.PI;
        const dist  = minDist + Math.random() * (maxRadius - minDist);
        pos = { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle) };
        attempts++;
      } while (attempts < 50 && placed.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) < minSep));
      placed.push(pos);
    }
    return placed;
  }
  if (pattern === "formation") {
    // Wedge: 1 lead → 2 flanking → 3 rear, centred vertically on click
    const step = spacing / 2;
    const raw  = [];
    let remaining = total;
    let row = 0;
    while (remaining > 0) {
      const cols = Math.min(row + 1, remaining);
      const rowW = (cols - 1) * step;
      for (let c = 0; c < cols; c++) {
        raw.push({ x: -rowW / 2 + c * step, y: row * step });
      }
      remaining -= cols;
      row++;
    }
    const maxY = raw[raw.length - 1]?.y ?? 0;
    return raw.map(p => ({ x: cx + p.x, y: cy + p.y - maxY / 2 }));
  }
  // circle (default)
  const radius = spacing * Math.sqrt(total) / (2 * Math.PI);
  return Array.from({ length: total }, (_, i) => {
    const angle = (i / total) * 2 * Math.PI;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
}

/**
 * Draw one dashed-circle indicator per token at its exact spawn position,
 * matching what _beamInQueue / _spawnGroupEntries will actually place.
 */
function _drawTokenPositions(g, cx, cy, total, spacing, colorHex, pattern = "circle") {
  if (total <= 0) return;
  const gridSize    = canvas.grid?.size ?? 100;
  const tokenRadius = Math.max(gridSize * 0.45, 25);
  const half        = gridSize / 2;

  const positions = _calcSpawnPositions(pattern, total, cx, cy, spacing);

  g.lineStyle(2, colorHex, 0.85);
  for (const p of positions) {
    _drawDashedCircle(g, p.x + half, p.y + half, tokenRadius);
  }
  // Center crosshair at cursor
  g.lineStyle(1, colorHex, 0.4);
  g.moveTo(cx - 8, cy); g.lineTo(cx + 8, cy);
  g.moveTo(cx, cy - 8); g.lineTo(cx, cy + 8);
}

function _createBeamIndicator() {
  const g = new PIXI.Graphics();
  canvas.interface.addChild(g);
  return g;
}

function _destroyBeamIndicator(g) {
  g.clear();
  canvas.interface.removeChild(g);
  g.destroy();
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prompt the GM to individually place each name in `names[]`.
 * `initGhosts` contains top-left positions already confirmed (shown as dim rings).
 * Returns an array of top-left { x, y } positions, or null if the user aborted.
 */
async function _runIndividualPlacements(names, initGhosts, indicatorColor, half, tokenRadius) {
  const totalCount = initGhosts.length + names.length;
  const ghosts     = [...initGhosts];
  const positions  = [];

  for (let i = 0; i < names.length; i++) {
    const ind = _createBeamIndicator();
    const pos = await new Promise(resolve => {
      function onMove() {
        const p = canvas.mousePosition;
        ind.clear();
        ind.lineStyle(2, indicatorColor, 0.55);
        for (const gh of ghosts) {
          _drawDashedCircle(ind, gh.x + half, gh.y + half, tokenRadius);
          ind.beginFill(indicatorColor, 0.4);
          ind.drawCircle(gh.x + half, gh.y + half, 5);
          ind.endFill();
        }
        ind.lineStyle(2, indicatorColor, 0.85);
        _drawDashedCircle(ind, p.x, p.y, tokenRadius);
        ind.lineStyle(1, indicatorColor, 0.4);
        ind.moveTo(p.x - 8, p.y); ind.lineTo(p.x + 8, p.y);
        ind.moveTo(p.x, p.y - 8); ind.lineTo(p.x, p.y + 8);
      }
      function cleanup() {
        canvas.stage.off("mousemove", onMove);
        canvas.stage.off("mousedown", onClick);
        canvas.stage.off("rightdown", onAbort);
        document.removeEventListener("keydown", onKey);
        _destroyBeamIndicator(ind);
      }
      function onAbort() { cleanup(); ui.notifications.warn("Transport aborted."); resolve(null); }
      function onKey(ev) { if (ev.key === "Escape") onAbort(); }
      function onClick(ev) {
        if (ev.button !== 0) return;
        cleanup();
        const p = canvas.mousePosition;
        resolve({ x: p.x - half, y: p.y - half });
      }
      canvas.stage.on("mousemove", onMove);
      canvas.stage.on("mousedown", onClick);
      canvas.stage.on("rightdown", onAbort);
      document.addEventListener("keydown", onKey);
      ui.notifications.info(
        `Place: ${names[i]} (${ghosts.length + 1} of ${totalCount}) · [RMB/Esc] abort`
      );
    });

    if (!pos) return null;
    ghosts.push(pos);
    positions.push(pos);
  }
  return positions;
}

async function _beamInQueue(selectedTokens, transporterType, spacing, effects, pattern = "circle") {
  if (!selectedTokens.length) {
    ui.notifications.warn("No tokens in the transport queue.");
    return;
  }
  const total = selectedTokens.reduce((s, t) => s + (t.isLinked ? 1 : t.quantity), 0);
  if (total > 6) {
    ui.notifications.error(`Transporter Malfunction — ${total} patterns in queue. Starfleet limit is 6.`);
    return;
  }

  const config         = effects[transporterType];
  const indicatorColor = _TRANSPORTER_COLORS[transporterType] ?? 0x4488ff;

  // ── Build flat spawn list up front (needed for individual mode label) ─────
  let tokensToSpawn = [];
  for (const td of selectedTokens) {
    const count = td.isLinked ? 1 : td.quantity;
    for (let i = 0; i < count; i++) {
      tokensToSpawn.push({ ...td, displayName: count > 1 ? `${td.name} ${i + 1}` : td.name });
    }
  }

  // ── Collect spawn positions ───────────────────────────────────────────────
  const gridSize    = canvas.grid?.size ?? 100;
  const tokenRadius = Math.max(gridSize * 0.45, 25);
  const half        = gridSize / 2;
  const names       = tokensToSpawn.map(t => t.displayName);

  let spawnPositions = [];
  let currentPattern = pattern; // may be cycled via [Q]

  if (pattern === "individual") {
    const placed = await _runIndividualPlacements(names, [], indicatorColor, half, tokenRadius);
    if (!placed) return false;   // aborted — queue stays intact
    spawnPositions = placed;
  } else {
    // Single first-click — [Q] cycles through all patterns incl. individual, [RMB/Esc] aborts
    const CYCLE  = ["circle", "line", "formation", "scatter", "individual"];
    const LABELS = { circle: "Circle", line: "Line", formation: "Formation", scatter: "Scatter", individual: "Individual" };

    const indicator = _createBeamIndicator();
    const firstClick = await new Promise(resolve => {
      function onMove() {
        const p = canvas.mousePosition;
        indicator.clear();
        if (currentPattern === "individual") {
          // Preview single-token ring — first click places token 1
          indicator.lineStyle(2, indicatorColor, 0.85);
          _drawDashedCircle(indicator, p.x, p.y, tokenRadius);
          indicator.lineStyle(1, indicatorColor, 0.4);
          indicator.moveTo(p.x - 8, p.y); indicator.lineTo(p.x + 8, p.y);
          indicator.moveTo(p.x, p.y - 8); indicator.lineTo(p.x, p.y + 8);
        } else if (currentPattern === "scatter") {
          const scatterRadius = _scatterMaxRadius(total);
          indicator.lineStyle(1, indicatorColor, 0.35);
          _drawDashedCircle(indicator, p.x, p.y, scatterRadius);
          indicator.lineStyle(1, indicatorColor, 0.4);
          indicator.moveTo(p.x - 8, p.y); indicator.lineTo(p.x + 8, p.y);
          indicator.moveTo(p.x, p.y - 8); indicator.lineTo(p.x, p.y + 8);
        } else {
          _drawTokenPositions(indicator, p.x, p.y, total, spacing, indicatorColor, currentPattern);
        }
      }
      function cleanup() {
        canvas.stage.off("mousemove", onMove);
        canvas.stage.off("mousedown", onClick);
        canvas.stage.off("rightdown", onAbort);
        document.removeEventListener("keydown", onKey);
        _destroyBeamIndicator(indicator);
      }
      function onAbort() { cleanup(); ui.notifications.warn("Transport aborted."); resolve(null); }
      function onKey(ev) {
        if (ev.key === "Escape") { onAbort(); return; }
        if (ev.key === "q" || ev.key === "Q") {
          const idx = CYCLE.indexOf(currentPattern);
          currentPattern = CYCLE[(idx + 1) % CYCLE.length];
          ui.notifications.info(`Pattern: ${LABELS[currentPattern]}`);
          onMove();
        }
      }
      function onClick(ev) {
        if (ev.button !== 0) return;
        cleanup();
        resolve({ x: canvas.mousePosition.x, y: canvas.mousePosition.y });
      }
      canvas.stage.on("mousemove", onMove);
      canvas.stage.on("mousedown", onClick);
      canvas.stage.on("rightdown", onAbort);
      document.addEventListener("keydown", onKey);
      ui.notifications.info("Click to beam in · [Q] cycle pattern · [RMB/Esc] abort");
    });

    if (!firstClick) return false;   // aborted — queue stays intact

    if (currentPattern === "individual") {
      // First click placed token 1; prompt for the rest individually
      const first = { x: firstClick.x - half, y: firstClick.y - half };
      spawnPositions.push(first);
      if (names.length > 1) {
        const rest = await _runIndividualPlacements(names.slice(1), [first], indicatorColor, half, tokenRadius);
        if (!rest) return false;
        spawnPositions.push(...rest);
      }
    } else {
      spawnPositions = _calcSpawnPositions(currentPattern, total, firstClick.x, firstClick.y, spacing);
    }
  }

  // ── Spawn ─────────────────────────────────────────────────────────────────
  _playSound(config.sound);
  canvas.animatePan({ x: spawnPositions[0]?.x ?? 0, y: spawnPositions[0]?.y ?? 0, duration: 1000 });

  for (let i = 0; i < tokensToSpawn.length; i++) {
    const info        = tokensToSpawn[i];
    const actor       = info.actor;
    const { x, y }   = spawnPositions[i] ?? spawnPositions[0];

    const proto = actor.prototypeToken;
    let img     = proto.texture?.src ?? proto.img;
    if (info.isWildcard) img = await _getWildcardImage(info.wildcardPath);

    let newTokenData = foundry.utils.mergeObject(proto.toObject(), {
      name: info.displayName, x, y, alpha: 0, actorId: actor.id,
    });
    if (info.isWildcard || img !== (proto.texture?.src ?? proto.img)) {
      newTokenData.texture = foundry.utils.mergeObject(newTokenData.texture ?? {}, { src: img });
    }

    try {
      const [created] = await canvas.scene.createEmbeddedDocuments("Token", [newTokenData]);
      if (!created) throw new Error("Token creation returned nothing.");
      setTimeout(async () => {
        try {
          const td = created.document ?? created;
          // Apply sparkle rain right as the token begins to fade in so it's
          // visible from the very first frame of materialisation.
          const tk = canvas.tokens.get(created.id);
          if (tk) _applyTransporterMagic(tk, transporterType);
          await td.update({ alpha: 1 }, { animate: true, animation: { duration: 800 } });
          // Let the effect shimmer briefly after fully materialising, then
          // clean up.  (800 ms fade + ~1 s visible = 1800 ms)
          setTimeout(() => {
            const tk2 = canvas.tokens.get(created.id);
            if (tk2) _removeTransporterMagic(tk2);
          }, 1800);
        } catch { /**/ }
      }, 2000);
      _playEffect(created, transporterType, effects);
    } catch (e) {
      console.error(`Transporter: error spawning ${info.displayName}:`, e);
      ui.notifications.error(`Failed to spawn ${info.displayName}.`);
    }
  }
  return true;  // beam-in completed — caller may clear queue
}

// ── Restore a buffered group ──────────────────────────────────────────────────

async function _spawnGroupEntries(group, transporterType, spacing, effects, pattern = "circle") {
  const { entries, transporterType: savedType, label } = group;
  const effectType = savedType ?? transporterType;
  const config     = effects[effectType];
  const total      = entries.length;

  const indicatorColor = _TRANSPORTER_COLORS[effectType] ?? 0x4488ff;

  const gridSize    = canvas.grid?.size ?? 100;
  const tokenRadius = Math.max(gridSize * 0.45, 25);
  const half        = gridSize / 2;
  const names       = entries.map(e => e.name);

  let spawnPositions = [];
  let panTarget;
  let currentPattern = pattern;

  if (pattern === "individual") {
    const placed = await _runIndividualPlacements(names, [], indicatorColor, half, tokenRadius);
    if (!placed) return false;   // aborted — buffer stays intact
    spawnPositions = placed;
    panTarget = placed[0];
  } else {
    const CYCLE  = ["circle", "line", "formation", "scatter", "individual"];
    const LABELS = { circle: "Circle", line: "Line", formation: "Formation", scatter: "Scatter", individual: "Individual" };

    const indicator = _createBeamIndicator();
    const firstClick = await new Promise(resolve => {
      function onMove() {
        const p = canvas.mousePosition;
        indicator.clear();
        if (currentPattern === "individual") {
          indicator.lineStyle(2, indicatorColor, 0.85);
          _drawDashedCircle(indicator, p.x, p.y, tokenRadius);
          indicator.lineStyle(1, indicatorColor, 0.4);
          indicator.moveTo(p.x - 8, p.y); indicator.lineTo(p.x + 8, p.y);
          indicator.moveTo(p.x, p.y - 8); indicator.lineTo(p.x, p.y + 8);
        } else if (currentPattern === "scatter") {
          const scatterRadius = _scatterMaxRadius(total);
          indicator.lineStyle(1, indicatorColor, 0.35);
          _drawDashedCircle(indicator, p.x, p.y, scatterRadius);
          indicator.lineStyle(1, indicatorColor, 0.4);
          indicator.moveTo(p.x - 8, p.y); indicator.lineTo(p.x + 8, p.y);
          indicator.moveTo(p.x, p.y - 8); indicator.lineTo(p.x, p.y + 8);
        } else {
          _drawTokenPositions(indicator, p.x, p.y, total, spacing, indicatorColor, currentPattern);
        }
      }
      function cleanup() {
        canvas.stage.off("mousemove", onMove);
        canvas.stage.off("mousedown", onClick);
        canvas.stage.off("rightdown", onAbort);
        document.removeEventListener("keydown", onKey);
        _destroyBeamIndicator(indicator);
      }
      function onAbort() { cleanup(); ui.notifications.warn("Transport aborted."); resolve(null); }
      function onKey(ev) {
        if (ev.key === "Escape") { onAbort(); return; }
        if (ev.key === "q" || ev.key === "Q") {
          const idx = CYCLE.indexOf(currentPattern);
          currentPattern = CYCLE[(idx + 1) % CYCLE.length];
          ui.notifications.info(`Pattern: ${LABELS[currentPattern]}`);
          onMove();
        }
      }
      function onClick(ev) {
        if (ev.button !== 0) return;
        cleanup();
        resolve({ x: canvas.mousePosition.x, y: canvas.mousePosition.y });
      }
      canvas.stage.on("mousemove", onMove);
      canvas.stage.on("mousedown", onClick);
      canvas.stage.on("rightdown", onAbort);
      document.addEventListener("keydown", onKey);
      ui.notifications.info(`Click to materialize "${label}" · [Q] cycle pattern · [RMB/Esc] abort`);
    });

    if (!firstClick) return false;   // aborted — buffer stays intact

    if (currentPattern === "individual") {
      const first = { x: firstClick.x - half, y: firstClick.y - half };
      spawnPositions.push(first);
      if (names.length > 1) {
        const rest = await _runIndividualPlacements(names.slice(1), [first], indicatorColor, half, tokenRadius);
        if (!rest) return false;
        spawnPositions.push(...rest);
      }
      panTarget = spawnPositions[0];
    } else {
      spawnPositions = _calcSpawnPositions(currentPattern, total, firstClick.x, firstClick.y, spacing);
      panTarget = firstClick;
    }
  }

  _playSound(config.sound);
  canvas.animatePan({ x: panTarget.x, y: panTarget.y, duration: 1000 });

  for (let i = 0; i < entries.length; i++) {
    const entry      = entries[i];
    const actor      = game.actors.get(entry.actorId);
    if (!actor) { console.warn(`Transporter: actor ${entry.actorId} not found.`); continue; }

    const { x, y } = spawnPositions[i] ?? spawnPositions[0];

    const proto = actor.prototypeToken;
    let img     = entry.resolvedImg ?? proto.texture?.src ?? proto.img;
    if (entry.isWildcard && !entry.resolvedImg) img = await _getWildcardImage(entry.wildcardPath);

    let newTokenData = foundry.utils.mergeObject(proto.toObject(), {
      name: entry.name, x, y, alpha: 0, actorId: actor.id,
    });
    if (entry.isWildcard || img !== (proto.texture?.src ?? proto.img)) {
      newTokenData.texture = foundry.utils.mergeObject(newTokenData.texture ?? {}, { src: img });
    }

    try {
      const [created] = await canvas.scene.createEmbeddedDocuments("Token", [newTokenData]);
      if (!created) throw new Error("Token creation returned nothing.");
      setTimeout(async () => {
        try {
          const td = created.document ?? created;
          // Apply sparkle rain right as the token begins to fade in so it's
          // visible from the very first frame of materialisation.
          const tk = canvas.tokens.get(created.id);
          if (tk) _applyTransporterMagic(tk, effectType);
          await td.update({ alpha: 1 }, { animate: true, animation: { duration: 800 } });
          // Let the effect shimmer briefly after fully materialising, then
          // clean up.  (800 ms fade + ~1 s visible = 1800 ms)
          setTimeout(() => {
            const tk2 = canvas.tokens.get(created.id);
            if (tk2) _removeTransporterMagic(tk2);
          }, 1800);
        } catch { /**/ }
      }, 2000);
      _playEffect(created, effectType, effects);
    } catch (e) {
      console.error(`Transporter: error restoring ${entry.name}:`, e);
      ui.notifications.error(`Failed to restore ${entry.name}.`);
    }
  }
  return true;  // materialization completed — caller may remove the buffer entry
}

// ── Dialog HTML builders ──────────────────────────────────────────────────────

function _buildBeamBufferHTML(groups) {
  if (!groups.length) return '<div class="sta2e-tp-buffer-empty">— NO PATTERNS HELD —</div>';

  const total     = groups.reduce((n, g) => n + g.entries.length, 0);
  const plural    = groups.length > 1 ? "S" : "";
  const groupRows = groups.map(g => {
    const names   = g.entries.map(e => e.name).join(" · ");
    const timeStr = new Date(g.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const ep      = g.entries.length > 1 ? "S" : "";
    return `
      <div class="sta2e-tp-buffer-group" data-group-id="${g.groupId}">
        <div class="sta2e-tp-buffer-header">
          <span class="sta2e-tp-buffer-icon">⚡</span>
          <div class="sta2e-tp-buffer-title">${g.label} — ${g.entries.length} PATTERN${ep}</div>
          <div class="sta2e-tp-buffer-meta">${timeStr}</div>
        </div>
        <div class="sta2e-tp-buffer-names">${names}</div>
        <div class="sta2e-tp-buffer-actions">
          <button class="sta2e-tp-group-btn sta2e-tp-group-restore" data-group-id="${g.groupId}">RESTORE</button>
          <button class="sta2e-tp-group-btn sta2e-tp-group-purge"   data-group-id="${g.groupId}">PURGE</button>
        </div>
      </div>`;
  }).join("");

  return `
    <div id="sta2e-tp-buffer-container">
      <div class="sta2e-tp-buffer-summary">
        <span>TRANSPORTER BUFFER — ${groups.length} GROUP${plural} / ${total} TOTAL PATTERNS</span>
        <span class="sta2e-tp-purge-all" id="sta2e-tp-purge-all">PURGE ALL</span>
      </div>
      ${groupRows}
    </div>`;
}


// ── Token item DOM builder ────────────────────────────────────────────────────

function _buildTokenItem(tokenData, selectedTokens, container) {
  const item = document.createElement("div");
  item.className = "sta2e-tp-token-item";
  item.dataset.id = tokenData.id;

  const img = document.createElement("img");
  img.src = tokenData.img;
  item.appendChild(img);

  const name = document.createElement("span");
  name.className   = "sta2e-tp-token-name";
  name.textContent = tokenData.name;
  item.appendChild(name);

  const badge = document.createElement("span");
  badge.className = `sta2e-tp-token-badge ${tokenData.isLinked ? "linked" : "wildcard"}`;
  badge.textContent = tokenData.isLinked ? "LINKED" : (tokenData.isWildcard ? "WILD" : "UNLINK");
  item.appendChild(badge);

  if (!tokenData.isLinked) {
    const qCtrl = document.createElement("div");
    qCtrl.className = "sta2e-tp-quantity-ctrl";
    const minus = document.createElement("span");
    minus.className   = "sta2e-tp-qty-btn";
    minus.textContent = "−";
    const display = document.createElement("span");
    display.className   = "sta2e-tp-qty-display";
    display.textContent = tokenData.quantity;
    const plus = document.createElement("span");
    plus.className   = "sta2e-tp-qty-btn";
    plus.textContent = "+";
    minus.addEventListener("click", () => {
      const t = selectedTokens.find(t => t.id === tokenData.id);
      if (t && t.quantity > 1) { t.quantity--; display.textContent = t.quantity; }
    });
    plus.addEventListener("click", () => {
      const t = selectedTokens.find(t => t.id === tokenData.id);
      if (t && t.quantity < 20) { t.quantity++; display.textContent = t.quantity; }
      else ui.notifications.warn("Maximum 20 copies per token.");
    });
    qCtrl.append(minus, display, plus);
    item.appendChild(qCtrl);
  }

  const remove = document.createElement("span");
  remove.className   = "sta2e-tp-remove-btn";
  remove.textContent = "✕";
  remove.addEventListener("click", () => {
    selectedTokens.splice(selectedTokens.findIndex(t => t.id === tokenData.id), 1);
    item.remove();
  });
  item.appendChild(remove);
  container.appendChild(item);
}

// ── Drop zone wiring ──────────────────────────────────────────────────────────

function _wireDropZone(html, selectedTokens) {
  const dropZone  = html.querySelector("#sta2e-tp-drop-zone");
  const tokenList = html.querySelector("#sta2e-tp-token-list");
  if (!dropZone || !tokenList) return;

  dropZone.addEventListener("dragover", e => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", async e => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");

    let data;
    try { data = JSON.parse(e.dataTransfer.getData("text/plain")); } catch { return; }

    let actor = null;
    if (data.type === "Token") {
      const token = canvas.tokens.get(data.tokenId) ?? canvas.tokens.get(data.id);
      actor = token?.actor;
    } else if (data.type === "Actor") {
      actor = await fromUuid(data.uuid) ?? game.actors.get(data.id);
    }
    if (!actor) {
      ui.notifications.warn("Could not resolve actor from drop.");
      return;
    }
    if (selectedTokens.find(t => t.actorId === actor.id)) {
      ui.notifications.warn(`${actor.name} is already in the queue.`);
      return;
    }

    const proto    = actor.prototypeToken;
    const isWild   = proto?.randomImg ?? false;
    const tokenData = {
      id:           `drop_${Date.now()}`,
      actorId:      actor.id,
      actor,
      name:         actor.name,
      img:          proto?.texture?.src ?? proto?.img ?? actor.img ?? "icons/svg/mystery-man.svg",
      isLinked:     proto?.actorLink ?? false,
      isWildcard:   isWild,
      wildcardPath: isWild ? (proto?.texture?.src ?? proto?.img) : null,
      quantity:     1,
    };

    selectedTokens.push(tokenData);
    _buildTokenItem(tokenData, selectedTokens, tokenList);
  });
}

// ── Buffer button wiring ──────────────────────────────────────────────────────

function _wireBufferButtons(html, transporterEffects, refresh) {
  const q = sel => html.querySelector(sel) ?? document.querySelector(`#sta2e-transporter-dialog ${sel}`);
  const getType    = () => q("#sta2e-tp-type")?.value    ?? "tngFed";
  const getSpacing = () => parseInt(q("#sta2e-tp-spacing")?.value ?? 350);
  const getPattern = () => q("#sta2e-tp-pattern")?.value ?? "circle";

  // Per-group restore
  html.querySelectorAll(".sta2e-tp-group-restore").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      btn.disabled = true;
      btn.style.opacity = "0.5";

      const groupId = btn.dataset.groupId;
      const groups  = await _getBeamGroups();
      const group   = groups.find(g => g.groupId === groupId);
      if (!group) { ui.notifications.warn("Group not found."); btn.disabled = false; btn.style.opacity = ""; return; }

      const spawned = await _spawnGroupEntries(group, getType(), getSpacing(), transporterEffects, getPattern());
      if (spawned) {
        await _removeBeamGroup(groupId);
        ui.notifications.info(`Group "${group.label}" materialized.`);
        await refresh?.();
      } else {
        btn.disabled = false;
        btn.style.opacity = "";
      }
    });
  });

  // Per-group purge
  html.querySelectorAll(".sta2e-tp-group-purge").forEach(btn => {
    btn.addEventListener("click", async () => {
      await _removeBeamGroup(btn.dataset.groupId);
      ui.notifications.info("Transport group purged.");
      await refresh?.();
    });
  });

  // Purge all
  html.querySelector("#sta2e-tp-purge-all")?.addEventListener("click", async () => {
    await _clearBeamGroups();
    ui.notifications.info("All transporter buffer groups purged.");
    await refresh?.();
  });
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function openTransporter() {
  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can operate the transporter.");
    return;
  }

  // Close any existing instance
  document.getElementById("sta2e-transporter-dialog")?.remove();

  const transporterEffects = _buildTransporterEffects();
  const gridScaleFactor    = (canvas.grid?.size ?? 100) / 100;
  const adjustedSpacing    = Math.round(350 * gridScaleFactor);
  let   selectedTokens     = [];

  // Shared state — current emitter type and spacing survive a refresh
  let currentType    = "tngFed";
  let currentSpacing = adjustedSpacing;

  const LC = getLcTokens();

  // ── Refresh helper ───────────────────────────────────────────────────────
  // Rebuilds only the buffer panel (right column) and the button row,
  // preserving the drop-zone queue and current select/input values.
  async function _refresh() {
    const app = document.getElementById("sta2e-transporter-dialog");
    if (!app) return;

    // Snapshot current control values before touching the DOM
    const typeEl    = app.querySelector("#sta2e-tp-type");
    const spacingEl = app.querySelector("#sta2e-tp-spacing");
    if (typeEl)    currentType    = typeEl.value;
    if (spacingEl) currentSpacing = parseInt(spacingEl.value) || currentSpacing;

    const groups = await _getBeamGroups();

    // Update buffer panel
    const colRight = app.querySelector(".sta2e-tp-col-right");
    if (colRight) {
      colRight.innerHTML = `
        <div class="sta2e-tp-section-label">Transporter Buffer</div>
        ${_buildBeamBufferHTML(groups)}
      `;
      _wireBufferButtons(colRight, transporterEffects, _refresh);
    }

    // Rebuild button row
    const oldBtnRow = app.querySelector("#sta2e-tp-btnrow");
    if (oldBtnRow) {
      const newBtnRow = _buildBtnRow(groups, transporterEffects, app, selectedTokens, _refresh, LC);
      oldBtnRow.replaceWith(newBtnRow);
    }
  }

  // ── Outer application window ─────────────────────────────────────────────
  const app = document.createElement("div");
  app.id = "sta2e-transporter-dialog";
  app.style.cssText = `
    position: fixed;
    top: 80px; left: 50%;
    transform: translateX(-50%);
    width: 760px;
    z-index: 9000;
    background: ${LC.bg};
    border: 1px solid ${LC.border};
    border-radius: 4px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.7);
    font-family: ${LC.font};
    color: ${LC.text};
    overflow: hidden;
  `;

  // ── Drag to reposition ───────────────────────────────────────────────────
  let dragging = false, dragOffX = 0, dragOffY = 0;

  const titleBar = document.createElement("div");
  titleBar.style.cssText = `
    display: flex; align-items: center;
    background: ${LC.panel};
    border-bottom: 1px solid ${LC.border};
    padding: 4px 10px;
    cursor: grab;
    user-select: none;
  `;
  titleBar.innerHTML = `
    <span style="font-size:10px;letter-spacing:2px;text-transform:uppercase;
      color:${LC.primary};flex:1;">⚡ Transporter Control</span>
    <span id="sta2e-tp-close" style="cursor:pointer;color:${LC.textDim};
      font-size:14px;padding:0 4px;line-height:1;" title="Close">×</span>
  `;

  titleBar.addEventListener("mousedown", e => {
    if (e.target.id === "sta2e-tp-close") return;
    dragging = true;
    dragOffX = e.clientX - app.getBoundingClientRect().left;
    dragOffY = e.clientY - app.getBoundingClientRect().top;
    titleBar.style.cursor = "grabbing";
  });
  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    app.style.left      = (e.clientX - dragOffX) + "px";
    app.style.top       = (e.clientY - dragOffY) + "px";
    app.style.transform = "none";
  });
  document.addEventListener("mouseup", () => {
    dragging = false;
    titleBar.style.cursor = "grab";
  });

  // ── Content area ─────────────────────────────────────────────────────────
  const existingGroups = await _getBeamGroups();
  const contentDiv = document.createElement("div");
  contentDiv.id = "sta2e-tp-content";
  contentDiv.innerHTML = `
    ${_buildThemeVars()}
    ${_buildInnerHTML(existingGroups, transporterEffects, adjustedSpacing, gridScaleFactor)}
  `;

  // ── Button row ────────────────────────────────────────────────────────────
  const btnRow = _buildBtnRow(existingGroups, transporterEffects, contentDiv, selectedTokens, _refresh, LC);

  // ── Assemble ─────────────────────────────────────────────────────────────
  app.appendChild(titleBar);
  app.appendChild(contentDiv);
  app.appendChild(btnRow);
  document.body.appendChild(app);

  app.querySelector("#sta2e-tp-close")?.addEventListener("click", () => app.remove());
  _wireDropZone(contentDiv, selectedTokens);
  _wireBufferButtons(contentDiv, transporterEffects, _refresh);
}

// ── Button row builder ────────────────────────────────────────────────────────
// Extracted so _refresh() can rebuild it when the buffer changes.

function _buildBtnRow(groups, transporterEffects, contentEl, selectedTokens, refresh, LC) {
  const theme = _getThemeKey();

  const row = document.createElement("div");
  row.id = "sta2e-tp-btnrow";
  row.style.cssText = `
    display: flex; gap: 6px; flex-wrap: wrap;
    padding: 6px 10px;
    background: ${LC.bg};
    border-top: 2px solid ${LC.border};
  `;

  // Theme-specific button shape overrides
  const btnShape = {
    "tos-panel":   { borderRadius: "2px",  clipPath: "none",  font: '"Helvetica Neue",Arial,sans-serif', letterSpacing: "1px" },
    "tmp-console": { borderRadius: "10px", clipPath: "none",  font: '"Helvetica Neue",Arial,sans-serif', letterSpacing: "2px" },
    "ent-panel":   { borderRadius: "1px",  clipPath: "none",  font: "Arial,sans-serif",                 letterSpacing: "3px" },
    "klingon":     { borderRadius: "0",    clipPath: "none",  font: '"Arial Narrow",Arial,sans-serif',  letterSpacing: "3px" },
    "romulan":     { borderRadius: "2px",  clipPath: "none",  font: '"Arial Narrow",Arial,sans-serif',  letterSpacing: "2px" },
  }[theme] ?? { borderRadius: "0", clipPath: "polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%)", font: LC.font, letterSpacing: "2px" };

  const mkBtn = (label, icon, color, flex = "1") => {
    const b = document.createElement("button");
    b.style.cssText = `
      flex: ${flex};
      background: ${LC.panel};
      border: 1px solid ${color};
      border-radius: ${btnShape.borderRadius};
      color: ${color};
      font-family: ${btnShape.font};
      font-size: 11px;
      letter-spacing: ${btnShape.letterSpacing};
      text-transform: uppercase;
      padding: 6px 10px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      clip-path: ${btnShape.clipPath};
      display: flex; align-items: center; justify-content: center; gap: 6px;
    `;
    if (icon) { const i = document.createElement("i"); i.className = icon; b.appendChild(i); }
    const t = document.createElement("span"); t.textContent = label; b.appendChild(t);
    b.addEventListener("mouseenter", () => { b.style.background = color; b.style.color = LC.bg; });
    b.addEventListener("mouseleave", () => { b.style.background = LC.panel; b.style.color = color; });
    return b;
  };

  const getEl      = id => contentEl.querySelector(id) ?? document.querySelector(`#sta2e-transporter-dialog ${id}`);
  const getType    = () => getEl("#sta2e-tp-type")?.value    ?? "tngFed";
  const getSpacing = () => parseInt(getEl("#sta2e-tp-spacing")?.value ?? 350);
  const getPattern = () => getEl("#sta2e-tp-pattern")?.value ?? "circle";

  const beamOutBtn = mkBtn("Beam Out + Hold", "fas fa-sign-out-alt", LC.primary);
  beamOutBtn.addEventListener("click", async () => {
    if (beamOutBtn.disabled) return;
    beamOutBtn.disabled = true;
    beamOutBtn.style.opacity = "0.5";
    await _beamOutSelected(getType(), transporterEffects);
    await refresh();
    // refresh() rebuilds the button row — no need to re-enable
  });

  const beamInBtn = mkBtn("Beam In", "fas fa-check", LC.green);
  beamInBtn.addEventListener("click", async () => {
    if (beamInBtn.disabled) return;
    beamInBtn.disabled = true;
    beamInBtn.style.opacity = "0.5";
    const beamed = await _beamInQueue(selectedTokens, getType(), getSpacing(), transporterEffects, getPattern());
    if (beamed) {
      selectedTokens.splice(0, selectedTokens.length);
      const tokenList = getEl("#sta2e-tp-token-list");
      if (tokenList) tokenList.innerHTML = "";
    }
    beamInBtn.disabled = false;
    beamInBtn.style.opacity = "1";
  });

  row.appendChild(beamOutBtn);
  row.appendChild(beamInBtn);

  if (groups.length) {
    const total = groups.reduce((n, g) => n + g.entries.length, 0);
    const restoreBtn = mkBtn(`Restore All (${total})`, "fas fa-history", LC.tertiary);
    restoreBtn.addEventListener("click", async () => {
      if (restoreBtn.disabled) return;
      restoreBtn.disabled = true;
      restoreBtn.style.opacity = "0.5";

      const type    = getType();
      const spacing = getSpacing();
      const latest  = await _getBeamGroups();
      let allSpawned = true;
      for (const group of latest) {
        const spawned = await _spawnGroupEntries(group, type, spacing, transporterEffects);
        if (!spawned) { allSpawned = false; break; }
        await _removeBeamGroup(group.groupId);
      }
      if (allSpawned) ui.notifications.info("All transporter buffer groups materialized.");
      await refresh();
    });
    row.appendChild(restoreBtn);
  }

  const cancelBtn = mkBtn("Cancel", "fas fa-times", LC.red, "0 0 auto");
  cancelBtn.addEventListener("click", () => document.getElementById("sta2e-transporter-dialog")?.remove());
  row.appendChild(cancelBtn);

  return row;
}

// ── Inner HTML builder (no outer wrapper — used by custom dialog) ─────────────

function _buildInnerHTML(groups, transporterEffects, adjustedSpacing, gridScaleFactor) {
  const typeOptions = Object.entries(transporterEffects)
    .map(([k, v]) => `<option value="${k}">${v.name}</option>`)
    .join("");

  const gridSize = Math.round((canvas.grid?.size ?? 100));
  const gridNote = gridScaleFactor !== 1
    ? `<div class="sta2e-tp-grid-note">AUTO-ADJ ${gridSize}px GRID (${gridScaleFactor.toFixed(1)}×)</div>`
    : "";

  const theme    = _getThemeKey();
  const dateLabel = _getCurrentDateLabel() ?? `STARDATE ${(49000 + Math.floor(Math.random() * 999)).toFixed(1)}`;

  return `
    <div class="sta2e-tp-dialog" data-theme="${theme}">
      <div class="sta2e-tp-header">
        <div class="sta2e-tp-header-pill">SYS</div>
        <div class="sta2e-tp-header-title">Transporter Control</div>
        <div class="sta2e-tp-header-stardate">${dateLabel}</div>
      </div>

      <div class="sta2e-tp-body">
        <div class="sta2e-tp-sidebar"></div>

        <div class="sta2e-tp-content">

          <div class="sta2e-tp-col-left">
            <div>
              <div class="sta2e-tp-section-label">Transporter Configuration</div>
              <div class="sta2e-tp-controls">
                <div>
                  <div class="sta2e-tp-label">Emitter Type</div>
                  <select id="sta2e-tp-type" class="sta2e-tp-select">${typeOptions}</select>
                </div>
                <div>
                  <div class="sta2e-tp-label">Token Spacing</div>
                  <input type="number" id="sta2e-tp-spacing" class="sta2e-tp-input" value="${adjustedSpacing}">
                  ${gridNote}
                </div>
                <div>
                  <div class="sta2e-tp-label">Beam-In Pattern</div>
                  <select id="sta2e-tp-pattern" class="sta2e-tp-select">
                    <option value="circle">Circle</option>
                    <option value="line">Line</option>
                    <option value="formation">Formation</option>
                    <option value="scatter">Scattered</option>
                    <option value="individual">Individual</option>
                  </select>
                </div>
              </div>
            </div>

            <div>
              <div class="sta2e-tp-section-label">Transport Queue — Drag Tokens / Actors Here</div>
              <div class="sta2e-tp-drop-zone" id="sta2e-tp-drop-zone">
                <div class="sta2e-tp-drop-hint">⟡ Drag tokens or actors from sidebar ⟡</div>
                <div class="sta2e-tp-token-list" id="sta2e-tp-token-list"></div>
              </div>
            </div>

            <div class="sta2e-tp-footer-bar"></div>
          </div>

          <div class="sta2e-tp-col-right">
            <div class="sta2e-tp-section-label">Transporter Buffer</div>
            ${_buildBeamBufferHTML(groups)}
          </div>

        </div>

        <div class="sta2e-tp-sidebar sta2e-tp-sidebar-right"></div>
      </div>
    </div>`;
}

// ── Settings registration helper (called from settings.js) ───────────────────
// Registers the beam buffer storage setting and all sound path settings.

export function registerTransporterSettings() {
  // Internal: beam buffer storage — world-scoped so all GMs share it
  game.settings.register(MODULE, "transporterBeamBuffer", {
    name:    "Transporter Beam Buffer",
    scope:   "world",
    config:  false,
    type:    Array,
    default: [],
  });

  // Managed via the "Sounds & Animations" config menu — config: false hides from main list
  const tSnd = (name) => ({
    name,
    hint:       "Audio file played when this transporter type activates. Leave blank for no sound.",
    scope:      "world",
    config:     false,
    type:       String,
    default:    "",
    filePicker: "audio",
  });

  game.settings.register(MODULE, "sndTransporterVoyFed",    tSnd("Transporter Sound — Voyager / Federation"));
  game.settings.register(MODULE, "sndTransporterTngFed",    tSnd("Transporter Sound — TNG Federation"));
  game.settings.register(MODULE, "sndTransporterTosFed",    tSnd("Transporter Sound — TOS Federation"));
  game.settings.register(MODULE, "sndTransporterTmpFed",    tSnd("Transporter Sound — TMP / Films"));
  game.settings.register(MODULE, "sndTransporterKlingon",   tSnd("Transporter Sound — Klingon"));
  game.settings.register(MODULE, "sndTransporterCardassian",tSnd("Transporter Sound — Cardassian"));
  game.settings.register(MODULE, "sndTransporterRomulan",   tSnd("Transporter Sound — Romulan"));
  game.settings.register(MODULE, "sndTransporterFerengi",   tSnd("Transporter Sound — Ferengi"));
  game.settings.register(MODULE, "sndTransporterBorg",      tSnd("Transporter Sound — Borg"));
}
