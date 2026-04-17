/**
 * sta2e-toolkit | stardate-calc.js
 * Stardate calculation utilities for TOS and TNG/DS9/VOY eras.
 * All functions are pure — no side effects, no Foundry dependencies.
 */

// ---------------------------------------------------------------------------
// TNG/DS9/VOY Era  (approx. 2323 - 2400s)
// Formula: Stardate = (year - 2323) * 1000 + (dayOfYear / daysInYear * 1000)
// ---------------------------------------------------------------------------

/**
 * Calculate a TNG-era stardate from a calendar date and time.
 * @param {number} year
 * @param {number} month  1-indexed
 * @param {number} day    1-indexed
 * @param {number} hours  0-23
 * @param {number} minutes 0-59
 * @returns {number} stardate rounded to 1 decimal
 */
export function calcTNGStardate(year, month, day, hours = 0, minutes = 0) {
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const dayOfYear = getDayOfYear(year, month, day);
  const timeOfDay = (hours * 60 + minutes) / (24 * 60); // fraction of a day
  const fractionalDay = (dayOfYear - 1 + timeOfDay) / daysInYear;
  const stardate = (year - 2323) * 1000 + fractionalDay * 1000;
  return Math.round(stardate * 10) / 10;
}

/**
 * Reverse a TNG stardate back to an approximate calendar date.
 * @param {number} stardate
 * @returns {{ year, month, day, hours, minutes }}
 */
export function tngStardateToCalendar(stardate) {
  const year = Math.floor(stardate / 1000) + 2323;
  const fractional = (stardate % 1000) / 1000;
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const totalMinutes = Math.round(fractional * daysInYear * 24 * 60);
  const dayOfYear = Math.floor(totalMinutes / (24 * 60)) + 1;
  const minutesInDay = totalMinutes % (24 * 60);
  const hours = Math.floor(minutesInDay / 60);
  const minutes = minutesInDay % 60;
  const { month, day } = dayOfYearToMonthDay(year, dayOfYear);
  return { year, month, day, hours, minutes };
}

// ---------------------------------------------------------------------------
// TOS/TMP Era  (approx. 2245 - 2293)
// Formula: first two digits of stardate = last two digits of year.
//   Stardate = (year - 2200) * 100 + (dayOfYear / daysInYear * 100)
//
// Examples:
//   2269-01-01  →  6900.0   (TOS series era)
//   2285-06-15  →  8547.3   (Wrath of Khan / Search for Spock era)
//   2293-01-01  →  9300.0   (Undiscovered Country)
//
// 100 units per year = ~0.274 units per day.
// Calendar-driven just like TNG — no manual rate needed.
// ---------------------------------------------------------------------------

/**
 * Calculate a TOS/TMP-era stardate from a calendar date and time.
 * @param {number} year
 * @param {number} month  1-indexed
 * @param {number} day    1-indexed
 * @param {number} hours  0-23
 * @param {number} minutes 0-59
 * @returns {number} stardate rounded to 1 decimal
 */
export function calcTOSStardate(year, month, day, hours = 0, minutes = 0) {
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const dayOfYear = getDayOfYear(year, month, day);
  const timeOfDay = (hours * 60 + minutes) / (24 * 60);
  const fractionalDay = (dayOfYear - 1 + timeOfDay) / daysInYear;
  const stardate = (year - 2200) * 100 + fractionalDay * 100;
  return Math.round(stardate * 10) / 10;
}

/**
 * Reverse a TOS stardate back to an approximate calendar date.
 * @param {number} stardate
 * @returns {{ year, month, day, hours, minutes }}
 */
export function tosStardateToCalendar(stardate) {
  const year = Math.floor(stardate / 100) + 2200;
  const fractional = (stardate % 100) / 100;
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const totalMinutes = Math.round(fractional * daysInYear * 24 * 60);
  const dayOfYear = Math.floor(totalMinutes / (24 * 60)) + 1;
  const minutesInDay = totalMinutes % (24 * 60);
  const hours = Math.floor(minutesInDay / 60);
  const minutes = minutesInDay % 60;
  const { month, day } = dayOfYearToMonthDay(year, dayOfYear);
  return { year, month, day, hours, minutes };
}

// ---------------------------------------------------------------------------
// Custom Era — manual baseline + configurable daily rate (for edge cases)
// ---------------------------------------------------------------------------

/**
 * Advance a custom-era stardate by a duration at a fixed daily rate.
 * @param {number} currentStardate
 * @param {number} days
 * @param {number} hours
 * @param {number} minutes
 * @param {number} dailyRate  stardate units per in-game day
 * @returns {number} new stardate rounded to 1 decimal
 */
export function advanceCustomStardate(currentStardate, days, hours, minutes, dailyRate = 1.0) {
  const totalDays = days + hours / 24 + minutes / (24 * 60);
  const newStardate = currentStardate + totalDays * dailyRate;
  return Math.round(newStardate * 10) / 10;
}

// ---------------------------------------------------------------------------
// Shared duration math — used by all eras when advancing time
// ---------------------------------------------------------------------------

/**
 * Add a duration to a { calendarDate, time } object.
 * Handles rollovers: minutes → hours → days → month → year.
 * @param {string|null} calendarDate  ISO date string "YYYY-MM-DD" or null
 * @param {{ hours: number, minutes: number }} time
 * @param {{ days?: number, hours?: number, minutes?: number }} delta  can be negative
 * @returns {{ calendarDate: string|null, time: { hours: number, minutes: number } }}
 */
export function advanceCalendarTime(calendarDate, time, delta) {
  let totalMinutes = time.hours * 60 + time.minutes;
  totalMinutes += (delta.minutes ?? 0);
  totalMinutes += (delta.hours ?? 0) * 60;

  let extraDays = delta.days ?? 0;

  // Handle minute/hour rollover
  if (totalMinutes < 0) {
    const borrow = Math.ceil(-totalMinutes / (24 * 60));
    totalMinutes += borrow * 24 * 60;
    extraDays -= borrow;
  }
  extraDays += Math.floor(totalMinutes / (24 * 60));
  totalMinutes = totalMinutes % (24 * 60);

  const newTime = {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60
  };

  let newCalendarDate = calendarDate;

  // Apply months first (calendar-aware — respects varying month lengths)
  if (calendarDate && (delta.months ?? 0) !== 0) {
    const date = parseDateString(calendarDate);
    const targetMonth = date.getMonth() + (delta.months ?? 0);
    // setMonth handles year rollover automatically and clamps day to month end
    date.setDate(1); // avoid day-clamping bugs when jumping months
    date.setMonth(targetMonth);
    // Restore original day clamped to new month's length
    const orig = parseDateString(calendarDate).getDate();
    const daysInNewMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(orig, daysInNewMonth));
    newCalendarDate = formatDateString(date);
  }

  // Then apply extra days
  if (newCalendarDate && extraDays !== 0) {
    const date = parseDateString(newCalendarDate);
    date.setDate(date.getDate() + extraDays);
    newCalendarDate = formatDateString(date);
  }

  return { calendarDate: newCalendarDate, time: newTime };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec"
];

/**
 * Format a calendar date for HUD display.
 * @param {string} isoDate  "YYYY-MM-DD"
 * @returns {string}  e.g. "14 Mar 2372"
 */
export function formatCalendarDate(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Format time for HUD display in military time.
 * @param {{ hours: number, minutes: number }} time
 * @param {boolean} showMinutes
 * @returns {string}  e.g. "13:43 HRS" or "13 HRS"
 */
export function formatTime(time, showMinutes = true) {
  const h = String(time.hours).padStart(2, "0");
  if (!showMinutes) return `${h} HRS`;
  const m = String(time.minutes).padStart(2, "0");
  return `${h}:${m} HRS`;
}

/**
 * Format a stardate for display.
 * @param {number} stardate
 * @returns {string}  e.g. "49523.7"
 */
export function formatStardate(stardate) {
  if (stardate == null || isNaN(stardate)) return "——.—";
  return stardate.toFixed(1);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getDayOfYear(year, month, day) {
  const start = new Date(year, 0, 0);
  const date = new Date(year, month - 1, day);
  const diff = date - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function dayOfYearToMonthDay(year, dayOfYear) {
  const date = new Date(year, 0, dayOfYear);
  return { month: date.getMonth() + 1, day: date.getDate() };
}

function parseDateString(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Klingon Calendar — Year of Kahless (YK)
// Based on Memory Beta / Mangels-Martin / Bennett DTI notes:
//   YK = CE year − 1374  (YK 1 ≈ 1375 CE)
//   9 months per year, ~40 days each, 6-day week
//   Month names from DS9 canon + Excelsior: Forged in Fire novel
// ---------------------------------------------------------------------------

export const KLINGON_MONTHS = [
  "Doqath", "Lo'Bral", "Maktag", "Merruthj", "nay'Poq",
  "Soo'jen", "Xan'lahr", "batlh", "QuSten"
];

// Days per month (9 months × ~40 days = ~363 days/year, leap day in month 5)
const KL_MONTH_DAYS = [40, 40, 43, 40, 41, 40, 40, 40, 40]; // 364 base

export const KLINGON_WEEKDAYS = [
  "DaSjaj", "povjaj", "ghItlhjaj", "loghjaj", "buqjaj", "lojmItjaj"
];

/**
 * Convert a Gregorian ISO date string to a Klingon date object.
 * @param {string} isoDate  "YYYY-MM-DD"
 * @returns {{ yk: number, month: number, monthName: string, day: number, weekday: string, dayOfYear: number }}
 */
export function isoToKlingon(isoDate) {
  if (!isoDate) return null;
  const [ceYear, ceMonth, ceDay] = isoDate.split("-").map(Number);

  // Day of year in Gregorian
  const doy = getDayOfYear(ceYear, ceMonth, ceDay);

  // Klingon year — roughly aligned to CE year
  // YK year starts ~Jan 1 (close enough for game purposes)
  const yk = ceYear - 1374;

  // Map Gregorian day-of-year into Klingon month/day
  // KL year has 364 days; we spread remainder across last month
  let remaining = doy - 1;
  let klMonth = 0;
  for (let i = 0; i < KL_MONTH_DAYS.length; i++) {
    if (remaining < KL_MONTH_DAYS[i]) { klMonth = i; break; }
    remaining -= KL_MONTH_DAYS[i];
    if (i === KL_MONTH_DAYS.length - 1) { klMonth = i; remaining = Math.min(remaining, KL_MONTH_DAYS[i] - 1); }
  }
  const klDay = remaining + 1;

  // 6-day Klingon week, day 0 = DaSjaj
  const weekday = KLINGON_WEEKDAYS[Math.floor((doy - 1) % 6)];

  return {
    yk,
    month:     klMonth + 1,
    monthName: KLINGON_MONTHS[klMonth],
    day:       klDay,
    weekday,
    dayOfYear: doy,
  };
}

/**
 * Format a Klingon date for HUD display.
 * e.g. "YK 998 · jaj 14 Maktag · DaSjaj"
 */
export function formatKlingonDate(isoDate) {
  const kd = isoToKlingon(isoDate);
  if (!kd) return "——";
  return `YK ${kd.yk} · jaj ${kd.day} ${kd.monthName}`;
}

/**
 * Format Klingon date for date editor display (verbose).
 */
export function formatKlingonDateVerbose(isoDate) {
  const kd = isoToKlingon(isoDate);
  if (!kd) return "——";
  return `${kd.weekday}, jaj ${kd.day} jar ${kd.month} (${kd.monthName}), DIS ${kd.yk} (YK)`;
}

// ---------------------------------------------------------------------------
// Romulan Calendar — After Settlement (AS)
// Based on Diane Duane's "The Romulan Way" + Bennett DTI notes:
//   Settlement c. 533 CE → AS year = CE year − 533
//   Rihan year ~387 days, 12 months
//   Month names adapted from Diane Duane's Rihannsu novels
// ---------------------------------------------------------------------------

export const ROMULAN_MONTHS = [
  "d'Ranov",    // 1  — month of winds
  "d'Kaleh",    // 2  — month of storms
  "d'Nanov",    // 3  — month of fire
  "d'Stelev",   // 4  — month of the sword
  "d'Arhai",    // 5  — month of the sun
  "d'Thraiin",  // 6  — month of the hunt
  "d'Rihanha",  // 7  — month of ch'Rihan
  "d'Lahai",    // 8  — month of waiting
  "d'Khellian", // 9  — month of the raptor
  "d'Verahin",  // 10 — month of blood
  "d'Ahai",     // 11 — month of ancestors
  "d'Mnheia",   // 12 — month of the senate
];

// 12 months, Rihan year ~387 days (rounding to 387 for simplicity)
// Distribute as: 10 months × 32 days + 2 months × 33 days = 354... too short
// Use: 9 × 32 + 3 × 33 = 288 + 99 = 387 days total
const ROM_MONTH_DAYS = [32, 32, 33, 32, 32, 33, 32, 32, 33, 32, 32, 32]; // 387 days

/**
 * Convert a Gregorian ISO date to a Romulan AS date.
 * Because the Rihan year (387d) is longer than Earth year (365d), we track
 * accumulated days from the settlement epoch (533 CE Jan 1) rather than
 * trying to align year boundaries.
 * @param {string} isoDate "YYYY-MM-DD"
 * @returns {{ as: number, month: number, monthName: string, day: number }}
 */
export function isoToRomulan(isoDate) {
  if (!isoDate) return null;
  const [ceYear, ceMonth, ceDay] = isoDate.split("-").map(Number);

  // Total Earth days since settlement epoch (533 CE Jan 1)
  const epochYear = 533;
  let totalEarthDays = 0;
  for (let y = epochYear; y < ceYear; y++) {
    totalEarthDays += isLeapYear(y) ? 366 : 365;
  }
  totalEarthDays += getDayOfYear(ceYear, ceMonth, ceDay) - 1;

  // Convert to Rihan days (1 Rihan day = 1.027 Earth days per Duane)
  // We simplify to 1:1 for game tracking — the year length difference
  // is what matters for the year number
  const RIHAN_YEAR = 387;
  const asYear = Math.floor(totalEarthDays / RIHAN_YEAR) + 1;
  const dayInYear = (totalEarthDays % RIHAN_YEAR) + 1;

  let remaining = dayInYear - 1;
  let romMonth = 0;
  for (let i = 0; i < ROM_MONTH_DAYS.length; i++) {
    if (remaining < ROM_MONTH_DAYS[i]) { romMonth = i; break; }
    remaining -= ROM_MONTH_DAYS[i];
    if (i === ROM_MONTH_DAYS.length - 1) { romMonth = i; remaining = Math.min(remaining, ROM_MONTH_DAYS[i] - 1); }
  }
  const romDay = remaining + 1;

  return {
    as:        asYear,
    month:     romMonth + 1,
    monthName: ROMULAN_MONTHS[romMonth],
    day:       romDay,
    dayOfYear: dayInYear,
  };
}

/**
 * Format a Romulan date for HUD display.
 * e.g. "1839 AS · 14 d'Khellian"
 */
export function formatRomulanDate(isoDate) {
  const rd = isoToRomulan(isoDate);
  if (!rd) return "——";
  return `${rd.as} AS · ${rd.day} ${rd.monthName}`;
}

/**
 * Format Romulan date verbose for date editor.
 */
export function formatRomulanDateVerbose(isoDate) {
  const rd = isoToRomulan(isoDate);
  if (!rd) return "——";
  return `${rd.day} ${rd.monthName}, ${rd.as} AS (Month ${rd.month} of 12)`;
}

