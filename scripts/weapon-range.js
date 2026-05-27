import { getZoneDistance } from "./zone-data.js";

export const WEAPON_RANGE_WARNING = "Outside listed range; traits may extend this.";

const RANGE_RANK = Object.freeze({
  Contact: 0,
  Close: 0,
  Medium: 1,
  Long: 2,
  Extreme: 3,
});

export function normalizeRangeBand(rangeBand) {
  const value = String(rangeBand ?? "").trim().toLowerCase();
  if (value === "contact") return "Contact";
  if (value === "close") return "Close";
  if (value === "medium") return "Medium";
  if (value === "long") return "Long";
  if (value === "extreme") return "Extreme";
  return null;
}

export function normalizeWeaponRange(range) {
  const value = String(range ?? "").trim().toLowerCase();
  if (!value) return null;
  if (/\blong\b/.test(value)) return "Long";
  if (/\bmedium\b/.test(value)) return "Medium";
  if (/\bclose\b/.test(value) || /\bcontact\b/.test(value)) return "Close";
  return null;
}

export function getStarshipWeapons(actor) {
  return Array.from(actor?.items ?? []).filter(item => item.type === "starshipweapon2e");
}

export function evaluateWeaponRange(weapon, zoneInfo) {
  const listedRange = normalizeWeaponRange(weapon?.system?.range);
  const actualRange = normalizeRangeBand(zoneInfo?.rangeBand);
  const zoneCount = Number(zoneInfo?.zoneCount ?? -1);

  if (!listedRange) {
    return {
      known: false,
      within: true,
      listedRange: null,
      actualRange,
      label: "Range unknown",
      warning: null,
    };
  }

  if (!actualRange || zoneCount < 0) {
    return {
      known: true,
      within: false,
      listedRange,
      actualRange: null,
      label: `${listedRange} listed range`,
      warning: WEAPON_RANGE_WARNING,
    };
  }

  const within = (RANGE_RANK[actualRange] ?? Infinity) <= RANGE_RANK[listedRange];
  return {
    known: true,
    within,
    listedRange,
    actualRange,
    label: `${listedRange} vs ${actualRange}`,
    warning: within ? null : WEAPON_RANGE_WARNING,
  };
}

export function evaluateWeaponRangeBetweenTokens(weapon, sourceToken, targetToken, zones) {
  if (!sourceToken || !targetToken || !zones?.length) {
    return evaluateWeaponRange(weapon, null);
  }
  const sourceCenter = {
    x: (sourceToken.x ?? 0) + (sourceToken.w ?? 0) / 2,
    y: (sourceToken.y ?? 0) + (sourceToken.h ?? 0) / 2,
  };
  const targetCenter = {
    x: (targetToken.x ?? 0) + (targetToken.w ?? 0) / 2,
    y: (targetToken.y ?? 0) + (targetToken.h ?? 0) / 2,
  };
  const zoneInfo = getZoneDistance(sourceCenter, targetCenter, zones);
  return { ...evaluateWeaponRange(weapon, zoneInfo), zoneInfo };
}

export function getWeaponRangeSummary(weapon, sourceToken, targets, zones) {
  const results = Array.from(targets ?? []).map(target => ({
    target,
    ...evaluateWeaponRangeBetweenTokens(weapon, sourceToken, target, zones),
  }));
  const warnings = results.filter(result => result.known && !result.within);
  return {
    results,
    hasWarning: warnings.length > 0,
    warnings,
  };
}
