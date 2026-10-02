// Pure time arithmetic for the instrument. No DOM access, so it runs under node --test.

export const TAU = Math.PI * 2;

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Local clock reading, with continuous (fractional) seconds, minutes and hours. */
export function parts(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  const s = date.getSeconds();
  const ms = date.getMilliseconds();
  const sec = s + ms / 1000;
  const min = m + sec / 60;
  const hour = h + min / 60;
  return { h, m, s, ms, sec, min, hour, msOfDay: ((h * 60 + m) * 60 + s) * 1000 + ms, dayFraction: hour / 24 };
}

/** Rotations in degrees, clockwise from 12 o'clock. `day` is the 24-hour dial. */
export function angles(p) {
  return { sec: p.sec * 6, min: p.min * 6, hour: (p.hour % 12) * 30, day: p.dayFraction * 360 };
}

export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Ordinal day (1-based), days in the year, and the fraction of the year elapsed to this instant. */
export function yearProgress(date) {
  const y = date.getFullYear();
  const total = isLeapYear(y) ? 366 : 365;
  const ordinal = Math.round((Date.UTC(y, date.getMonth(), date.getDate()) - Date.UTC(y, 0, 1)) / 864e5) + 1;
  return { ordinal, total, fraction: (ordinal - 1 + parts(date).dayFraction) / total };
}

/** Left-edge position (0..1) of each month on a year ruler. */
export function monthStarts(year) {
  const total = isLeapYear(year) ? 366 : 365;
  return Array.from({ length: 12 }, (_, mo) => (Date.UTC(year, mo, 1) - Date.UTC(year, 0, 1)) / 864e5 / total);
}

/**
 * The elapsed day as a sexagesimal fraction 0;a,b,c,d — integer arithmetic so
 * digits never wobble: 1/60 d = 24 min, 1/60² d = 24 s, 1/60³ d = 0.4 s.
 */
export function dayFractionSexagesimal(msOfDay) {
  const a = Math.floor(msOfDay / 1440000);
  const r1 = msOfDay % 1440000;
  const b = Math.floor(r1 / 24000);
  const r2 = r1 % 24000;
  const c = Math.floor(r2 / 400);
  const d = Math.floor(((r2 % 400) * 3) / 20);
  return [a, b, c, d];
}

/** Thirds: the sexagesimal subdivision of a second (1/60 s). */
export function thirds(ms) {
  return Math.floor((ms * 60) / 1000);
}

/** Most-significant-bit-first binary digits. */
export function bits(n, width) {
  return Array.from({ length: width }, (_, i) => (n >> (width - 1 - i)) & 1);
}

export function julianDate(date) {
  return date.getTime() / 864e5 + 2440587.5;
}

const SYNODIC_MONTH = 29.530588853;

// The four principal phases are named only within ±3% of the cycle (about a day either side).
function moonName(phase) {
  const near = (x) => Math.abs(phase - x) < 0.03;
  if (near(0) || near(1)) return 'new';
  if (near(0.25)) return 'first quarter';
  if (near(0.5)) return 'full';
  if (near(0.75)) return 'last quarter';
  return `${phase < 0.5 ? 'waxing' : 'waning'} ${phase > 0.25 && phase < 0.75 ? 'gibbous' : 'crescent'}`;
}

/** Mean lunar age counted from the new moon of 6 January 2000 (JD 2451550.1). Good to about a day. */
export function moon(date) {
  const age = (((julianDate(date) - 2451550.1) % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const phase = age / SYNODIC_MONTH;
  return {
    age,
    phase,
    illumination: (1 - Math.cos(TAU * phase)) / 2,
    name: moonName(phase),
  };
}

export function roman(n) {
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [value, numeral] of table) {
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  }
  return out;
}

/** Boreal astronomical season, using fixed approximate solstice and equinox dates. */
export function quadrant(date) {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  if (md >= 320 && md < 621) return 'VERNAL';
  if (md >= 621 && md < 922) return 'ESTIVAL';
  if (md >= 922 && md < 1221) return 'AUTUMNAL';
  return 'HIBERNAL';
}

/** Abstract solar altitude: −1 at midnight, 0 at 06:00 and 18:00, +1 at noon. */
export function solarAltitude(dayFraction) {
  return -Math.cos(TAU * dayFraction);
}

const PHASES = [
  [1, 'MIDNIGHT'], [4.5, 'DEEP NIGHT'], [6, 'ASTRONOMICAL DAWN'], [7.5, 'SUNRISE'], [11, 'MORNING'],
  [13, 'MERIDIAN'], [17.5, 'AFTERNOON'], [19, 'SUNSET'], [21, 'TWILIGHT'], [23, 'NIGHT'], [24, 'MIDNIGHT'],
];

export function phaseName(hour) {
  return PHASES.find(([until]) => hour < until)[1];
}

const hex = (s) => [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));

// hour, ground, ink (fine lines and text), accent (minute tone), deep (hour tone)
const PALETTE = [
  [0, '07090f', 'b9c4d6', '7f9cc9', '4a66a8'],
  [4.5, '0b0b16', 'c3c2d8', '8f86c9', '6a5fb0'],
  [6.5, '140e10', 'e6d2c4', 'e08a5e', 'c2543f'],
  [9, '15130f', 'ece3d0', 'd9b166', 'b8763a'],
  [12.5, '1a1813', 'f3ecdb', 'e6c97a', 'b98a3e'],
  [16.5, '17130e', 'efe2c8', 'dba255', 'b86f34'],
  [19, '150c0b', 'ecc9b4', 'd9643f', 'a3382c'],
  [20.5, '0c0a14', 'c9c0d8', '9a7bc2', '6d4fa3'],
  [24, '07090f', 'b9c4d6', '7f9cc9', '4a66a8'],
].map(([hour, ...colors]) => [hour, ...colors.map(hex)]);

/** Colour of the instrument at a given hour (0..24), interpolated between keyframes. */
export function palette(hour) {
  const i = Math.max(1, PALETTE.findIndex(([h]) => h > hour));
  const [h0, ...from] = PALETTE[i - 1];
  const [h1, ...to] = PALETTE[i];
  const t = (hour - h0) / (h1 - h0);
  const [bg, ink, accent, deep] = from.map((c, k) => c.map((v, j) => Math.round(v + (to[k][j] - v) * t)));
  return { bg, ink, accent, deep };
}

/**
 * Synchronisation around the top of each hour, where every relative hand angle
 * is zero and the fractal collapses onto a single ray. `e` (0..1) is the
 * strength of the radial-symmetry state; noon and midnight get 60 folds and
 * hold longer than the ordinary 12-fold hours.
 */
export function hourSync(p) {
  const s = p.m * 60 + p.sec;
  const rel = s > 1800 ? s - 3600 : s;
  const meridian = Math.round(p.hour) % 12 === 0;
  const span = meridian ? 24 : 8;
  return {
    e: smoothstep(-3, 0, rel) * (1 - smoothstep(span / 2, span, rel)),
    fold: meridian ? 60 : 12,
    meridian,
  };
}
