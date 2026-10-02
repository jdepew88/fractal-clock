// Calibration: the seven settings a visitor may adjust, and what each means to
// the two instruments. Both are drawn from the one `tuningFor(settings)`, so a
// setting cannot mean one thing on the planar dial and another in space.
// No DOM access, so it runs under node --test.

import { clamp } from './time-math.js';

/**
 * The scales. Every limit was chosen by looking: at either end the instrument
 * is still recognisably itself. `canonical` is the clock as designed.
 */
export const SCALES = {
  // how strongly each unit's arms are drawn, in percent: light, weight and length together
  hour: { min: 0, max: 150, step: 1, canonical: 100 },
  minute: { min: 0, max: 150, step: 1, canonical: 100 },
  second: { min: 0, max: 150, step: 1, canonical: 100 },
  // recursion, counted in levels of the planar clock; the canonical clock is the deepest
  iterations: { min: 3, max: 8, step: 1, canonical: 8 },
  // a child's length relative to its parent, as the planar clock states it
  ratio: { min: 0.6, max: 0.72, step: 0.01, canonical: 0.66 },
  // percent: how far the recursion opens away from what carries it
  depth: { min: 40, max: 150, step: 1, canonical: 100 },
  // degrees turned from the hue the hour of the day gives
  hue: { min: -180, max: 180, step: 1, canonical: 0 },
};

export const KEYS = Object.keys(SCALES);
export const CANONICAL = Object.freeze(Object.fromEntries(KEYS.map((key) => [key, SCALES[key].canonical])));

/** A value brought onto its scale: within the limits, on a step; anything unreadable is the canonical value. */
export function settle(key, value) {
  const { min, max, step, canonical } = SCALES[key];
  const v = typeof value === 'string' && value.trim() === '' ? NaN : Number(value ?? NaN);
  if (!Number.isFinite(v)) return canonical;
  const settled = clamp(min + Math.round((v - min) / step) * step, min, max);
  return Number(settled.toFixed(step < 1 ? 2 : 0)) + 0; // + 0: never −0
}

/** All seven settings, each settled; whatever is missing is canonical. */
export const calibration = (source = {}) => Object.fromEntries(KEYS.map((key) => [key, settle(key, source[key])]));

export const isCanonical = (settings) => KEYS.every((key) => settings[key] === CANONICAL[key]);

/** ?cal=hour,minute,second,iterations,ratio,depth,hue — an empty place keeps its canonical value. */
export function parseCalibration(query) {
  const places = (query.get('cal') ?? '').split(',');
  return calibration(Object.fromEntries(KEYS.map((key, i) => [key, places[i]])));
}

/** A setting as its scale shows it: short, and never a long fraction. */
export const formatSetting = (key, value) => (key === 'ratio' ? value.toFixed(2) : String(value));

/**
 * What the settings mean to the instruments. Per unit [hour, minute, second]:
 * `light` multiplies brightness, `stature` multiplies both line weight and arm
 * length, and `floor` is the least brightness of the three hands that tell the
 * time, which never vanish. At the canonical settings every factor is exactly 1.
 */
export function tuningFor(settings) {
  const s = calibration(settings);
  const influence = [s.hour, s.minute, s.second].map((v) => v / 100);
  return {
    iterations: s.iterations,
    ratio: s.ratio,
    // the spatial tree's own ratio changes through the day; it is raised to this power
    power: Math.log(s.ratio) / Math.log(CANONICAL.ratio),
    spread: s.depth / 100,
    hue: s.hue,
    // above 100 the gains are gentler: light adds to light, and a dense tree would burn out
    light: influence.map((w) => (w > 1 ? 1 + 0.5 * (w - 1) : w)),
    stature: influence.map((w) => (w > 1 ? 1 + 0.3 * (w - 1) : 0.6 + 0.4 * w)),
    floor: influence.map((w) => 0.55 + 0.45 * Math.min(1, w)),
  };
}

export const NEUTRAL = tuningFor(CANONICAL);

/** Levels of the planar clock: one fewer on a small dial, as it has always drawn. */
export const planarLevels = (iterations, small) => iterations - (small ? 1 : 0);

/**
 * Generations of the spatial tree. It doubles where the planar clock triples,
 * so it takes log2(3) generations per planar level to carry as many arms; the
 * canonical twelve are the most it draws, ten on a small screen.
 */
export const spatialGenerations = (iterations, small) => Math.min(12, Math.round(iterations * Math.log2(3))) - (small ? 2 : 0);

/**
 * The Recursion reading, as one or two lines. `drawn` is what the instrument is
 * rendering and `full` what the Iter scale asks for on a full-size screen. Where
 * a small screen renders less, the reading says so rather than state either
 * number alone; the count beside it is always of what is actually drawn.
 */
export function recursionReading({ spatial, drawn, full, count, ratio }) {
  const size = `${count.toLocaleString('en-US')} ${spatial ? 'ARMS' : 'HANDS'} · RATIO ${ratio.toFixed(spatial ? 3 : 2)}`;
  if (drawn === full) return [`${spatial ? `${drawn} GENERATIONS` : `DEPTH ${drawn}`} · ${size}`, ''];
  return [spatial ? `RENDER ${drawn} OF ${full} GENERATIONS` : `RENDER DEPTH ${drawn} OF ${full}`, size];
}

/** The spatial tree's ratio for the day's own `base`: the same proportional change the planar ratio has had. */
export const spatialRatio = (base, tuning) => base ** tuning.power;

/**
 * The planar spread. The angle a hand makes with the hand that carries it is
 * drawn as if that child clock were narrowed (spread < 1) or widened across
 * its carrier: continuous in the angle, and 0°, 90° and 180° stay where they are.
 */
export const warp = (angle, spread) => Math.atan2(spread * Math.sin(angle), Math.cos(angle));

// ── hue ──────────────────────────────────────────────────────────────────────
// Colours are turned in OKLCH, so a tone keeps its lightness and its strength
// and only its hue moves: hour, minute and second stay as far apart as they were.

const toLinear = (v) => (v <= 10.31475 ? v / 3294.6 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const toGamma = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function oklab(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function linearFromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLab lightness (0..1) of an [r, g, b] colour. */
export const lightness = (rgb) => oklab(rgb)[0];

/** An [r, g, b] colour with its hue turned by `degrees`, at the same lightness and, where the screen allows, the same chroma. */
export function rotateHue(rgb, degrees) {
  if (!degrees) return rgb;
  const [L, a, b] = oklab(rgb);
  const chroma = Math.hypot(a, b);
  const hue = Math.atan2(b, a) + (degrees * Math.PI) / 180;
  const at = (k) => linearFromOklab([L, chroma * k * Math.cos(hue), chroma * k * Math.sin(hue)]);
  const shows = (linear) => linear.every((v) => v >= -1e-4 && v <= 1.0001);
  let k = 1;
  if (!shows(at(1))) {
    let within = 0;
    let beyond = 1;
    for (let i = 0; i < 14; i++) {
      const middle = (within + beyond) / 2;
      if (shows(at(middle))) within = middle;
      else beyond = middle;
    }
    k = within;
  }
  return at(k).map((v) => Math.round(clamp(toGamma(clamp(v, 0, 1)), 0, 255)));
}

/**
 * The palette of the hour with the instrument's own tones turned: the accent
 * (minutes), the deep tone (hours) and `fine`, the pale tone of the seconds and
 * of NOW. The ground and the ink of the text and the engraved scales are left alone.
 */
export function tinted(pal, degrees) {
  return {
    bg: pal.bg,
    ink: pal.ink,
    accent: rotateHue(pal.accent, degrees),
    deep: rotateHue(pal.deep, degrees),
    fine: rotateHue(pal.ink, degrees),
  };
}

/** Hue of a colour in whole degrees, 0..359, as HSL counts it: what the hue scale reads. */
export function hueOf([r, g, b]) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const sector = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((Math.round(sector * 60) % 360) + 360) % 360;
}
