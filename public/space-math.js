// Pure geometry for the spatial instrument: how time becomes rotation, where the
// recursive arms sit, and how the camera looks at them. No DOM or WebGL access,
// so it runs under node --test. The vertex shader in space.js repeats the tree walk.

import { TAU, clamp, smoothstep, solarAltitude } from './time-math.js';

export const RAD = Math.PI / 180;

// ── 3×3 matrices, column-major arrays of 9 ───────────────────────────────────
export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(a, b) {
  const out = new Array(9);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      out[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
    }
  }
  return out;
}

export const column = (m, i) => [m[i * 3], m[i * 3 + 1], m[i * 3 + 2]];
export const apply = (m, v) => [
  m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
  m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
  m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
];
export const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ── time as rotation ─────────────────────────────────────────────────────────
// Unit 0 is the HOUR and turns about Z, unit 1 the MINUTE about Y, unit 2 the
// SECOND about X. Each turns clockwise as seen from the positive end of its axis.

/** Rotation of one time unit through a clock angle (radians). */
export function turn(unit, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (unit === 0) return [c, -s, 0, s, c, 0, 0, 0, 1];
  if (unit === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

/**
 * Column of a frame along which each unit's arm points: the hour arm along Y,
 * the minute arm along X, the second arm along Z. Each arm is therefore the
 * axle about which the next unit turns, so every joint is a right angle.
 */
export const ARM = [1, 0, 2];

/**
 * A graduated dial for each unit, as a frame whose columns are [right, zero, axis]:
 * angles are read clockwise from `zero` when looking down `axis`. Multiply by
 * the frame the unit turns in. It is also the camera basis that faces that dial.
 */
export const DIAL = [IDENTITY, [0, 0, 1, 1, 0, 0, 0, 1, 0], [0, 1, 0, 0, 0, 1, 1, 0, 0]];

/** Clock angles in radians [hour, minute, second] from `parts()` output. */
export const clockAngles = (p) => [(p.hour % 12) * 30 * RAD, p.min * 6 * RAD, p.sec * 6 * RAD];

const SPACE_FILLING = 2 ** (-1 / 3); // ratio at which a 3D H-tree exactly fills space

/**
 * The tree breathes once a day. `expanse` runs 0 at midnight to 1 at noon: the
 * same 12-hour alignment is a dense core at midnight and, at noon, a
 * space-filling lattice whose face is inscribed in the hour ring. `reach` is
 * the radius of that aligned lattice's corner, the measure of the tree's size
 * that the default view frames.
 */
export function treeParams(dayFraction) {
  const expanse = (1 + solarAltitude(dayFraction)) / 2;
  const ratio = 0.64 + (SPACE_FILLING - 0.64) * expanse;
  const l0 = 0.3 + 0.08 * expanse;
  return { expanse, ratio, l0, reach: (l0 / (1 - ratio ** 3)) * Math.hypot(1, ratio, ratio * ratio) };
}

/**
 * Walks the tree to one arm. Generation i turns by unit i mod 3 (hour, minute,
 * second, hour, …) about the arm of the generation before it. Bit i of `path`
 * picks which of the two opposed arms to follow; path 0 is the principal chain.
 */
export function arm(path, generation, angles, { ratio, l0 }) {
  let frame = IDENTITY;
  let tip = [0, 0, 0];
  let base = tip;
  let length = l0;
  for (let i = 0; i <= generation; i++) {
    const unit = i % 3;
    frame = mul(frame, turn(unit, angles[unit] + ((path >> i) & 1) * Math.PI));
    base = tip;
    tip = add(tip, column(frame, ARM[unit]), length);
    if (i < generation) length *= ratio;
  }
  return { base, tip, frame, length, unit: generation % 3 };
}

/**
 * The principal chain: hour arm, then minute arm, then second arm. The tip of
 * the second arm is NOW, the single point the present time solves to.
 */
export function principal(angles, params) {
  const arms = [0, 1, 2].map((generation) => arm(0, generation, angles, params));
  return {
    arms,
    now: arms[2].tip,
    // the dials the minute and second arms sweep, carried by the arms before them
    dials: [IDENTITY, mul(arms[0].frame, DIAL[1]), mul(arms[1].frame, DIAL[2])],
  };
}

/** Where NOW was `dt` seconds ago, with the tree held at its present size. */
export function nowAt(angles, params, dt) {
  return arm(0, 2, [angles[0] - (dt / 120) * RAD, angles[1] - dt * 0.1 * RAD, angles[2] - dt * 6 * RAD], params).tip;
}

/** Sample offsets (seconds into the past) for the wake: dense for a minute, sparse for ten. */
export const WAKE_OFFSETS = (() => {
  const offsets = [];
  for (let t = 0; t <= 60; t += 0.5) offsets.push(t);
  for (let t = 62.5; t <= 600; t += 2.5) offsets.push(t);
  return offsets;
})();

/** Brightness of the wake: the last seconds are clear, a minute ago barely visible. */
export const wakeAlpha = (dt) => 0.85 * Math.exp(-dt / 12) + 0.1 * Math.exp(-dt / 240);

// ── larger scales: day, year, moon ───────────────────────────────────────────
export const OBLIQUITY = 23.44 * RAD;
// Each scale stands well outside the last, so pulling back reveals them in turn.
export const RADIUS = { second: 0.9, minute: 0.95, hour: 1, day: 1.5, moon: 2.2, year: 4 };

/** The year ring lies in the ecliptic: the hour plane tilted about X by the obliquity. */
export const ECLIPTIC = turn(2, -OBLIQUITY);
/** The moon's ring is inclined a further 5.14° to the ecliptic. */
export const LUNAR = mul(ECLIPTIC, turn(1, 5.14 * RAD));

const EQUINOX_DAY = 78.8; // days from 1 January 00:00 to the March equinox, near enough
const TROPICAL_YEAR = 365.2422;

/** Mean ecliptic longitude of the sun for a number of days into the year (uniform motion: approximate). */
export const solarLongitude = (days) => (TAU * (days - EQUINOX_DAY)) / TROPICAL_YEAR;

/** A point on a ring lying in the XY plane of `frame`, at a longitude counted from its X axis. */
export const onRing = (frame, longitude, radius) => apply(frame, [radius * Math.cos(longitude), radius * Math.sin(longitude), 0]);

/** The daily sun rides the 24-hour ring in the hour plane: overhead (+Y) at noon, underfoot at midnight. */
export function dailySun(dayFraction, radius = RADIUS.day) {
  const a = dayFraction * TAU + Math.PI;
  return [radius * Math.sin(a), radius * Math.cos(a), 0];
}

// ── quaternions [x, y, z, w], for turning the camera between views ───────────
export function quatFromMat(m) {
  const [m00, m10, m20, m01, m11, m21, m02, m12, m22] = m;
  const trace = m00 + m11 + m22;
  let q;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  return q;
}

export function matFromQuat([x, y, z, w]) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w),
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w),
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y),
  ];
}

export function slerp(a, b, t) {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = cos < 0 ? -1 : 1;
  cos *= sign;
  let ka = 1 - t;
  let kb = t;
  if (cos < 0.9995) {
    const angle = Math.acos(cos);
    ka = Math.sin((1 - t) * angle) / Math.sin(angle);
    kb = Math.sin(t * angle) / Math.sin(angle);
  }
  const q = a.map((v, i) => v * ka + b[i] * kb * sign);
  const n = Math.hypot(...q);
  return q.map((v) => v / n);
}

// ── camera ───────────────────────────────────────────────────────────────────
// The camera orbits a target. `fit` is the world radius that fills the dial, so
// zoom means the same thing on every screen. Yaw and pitch are offsets from a
// base orientation, which each view supplies.

export const LIMITS = { pitch: 1.35, fitMin: 0.03, fitMax: 12 };
export const FOCAL = 1 / Math.tan(15 * RAD); // 30° vertical field of view
const DIAL_FILL = 0.47; // fraction of the dial's width that `fit` occupies as a radius

export const clampPitch = (pitch) => clamp(pitch, -LIMITS.pitch, LIMITS.pitch);
export const clampFit = (fit) => clamp(fit, LIMITS.fitMin, LIMITS.fitMax);

/** Camera distance at which a sphere of radius `fit` fills the dial. */
export const distanceFor = (fit, canvasHeight, dialSize) => (fit * FOCAL * canvasHeight) / (2 * DIAL_FILL * dialSize);

/** Columns [right, up, back] of the camera: drag right and the object turns right; drag down and its top tips toward you. */
export const cameraBasis = (base, yaw, pitch) => mul(base, mul(turn(1, yaw), turn(2, pitch)));

/**
 * Column-major 4×4 view-projection matrix. `centre` shifts the principal point
 * (in NDC) so the target lands on the dial rather than the middle of the canvas.
 */
export function viewProjection({ basis, target, distance, aspect, near, far, centre = [0, 0] }) {
  const right = column(basis, 0);
  const up = column(basis, 1);
  const back = column(basis, 2);
  const eye = add(target, back, distance);
  // rows of the view matrix
  const rows = [
    [...right, -dot(right, eye)],
    [...up, -dot(up, eye)],
    [...back, -dot(back, eye)],
  ];
  const a = FOCAL / aspect;
  const c = (far + near) / (near - far);
  const d = (2 * far * near) / (near - far);
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    const w = -rows[2][col];
    out[col * 4] = a * rows[0][col] + centre[0] * w;
    out[col * 4 + 1] = FOCAL * rows[1][col] + centre[1] * w;
    out[col * 4 + 2] = c * rows[2][col] + (col === 3 ? d : 0);
    out[col * 4 + 3] = w;
  }
  return out;
}

/** Projects a world point to CSS pixels; `w` ≤ 0 means behind the camera. */
export function project(m, [x, y, z], width, height) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return {
    x: ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w + 1) * 0.5 * width,
    y: (1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 * height,
    w,
  };
}

/** How far the tree's reach sits inside the frame of the default view. */
const OVERVIEW_FILL = 1.18;

/**
 * How strongly each larger scale is drawn from a camera of a given `fit`. The
 * default view holds the tree alone; the day and the moon arrive as the camera
 * pulls back, the year after them. `rings` is the hour, minute and second
 * rings, which also recede when they are far outside the frame or when the
 * camera is deep inside the tree.
 */
export function scaleGains(fit) {
  return {
    rings: (0.25 + 0.75 * smoothstep(0.12, 0.6, fit)) * (1 - 0.8 * smoothstep(1.15, 1.75, RADIUS.hour / fit)),
    // the numerals stand outside the hour ring, and leave before the frame's edge can cut them
    numerals: 1 - smoothstep(0.9, 1.04, RADIUS.hour / fit),
    day: smoothstep(1.35, 1.95, fit),
    moon: smoothstep(1.7, 2.7, fit),
    year: smoothstep(2.6, 4.4, fit),
  };
}

/**
 * The named viewpoints. Each gives a target, a base orientation, yaw and pitch
 * offsets, a fit radius, and how strongly to draw each unit's generations.
 */
export function viewGoal(name, chain, params, branch) {
  const { arms, dials, now } = chain;
  const l1 = params.l0 * params.ratio;
  const l2 = l1 * params.ratio;
  switch (name) {
    case 'hours':
      return { target: [0, 0, 0], base: IDENTITY, yaw: 0, pitch: 0, fit: 1.22, emphasis: [1.5, 0.45, 0.3] };
    case 'minutes':
      return { target: arms[0].tip, base: dials[1], yaw: 0, pitch: 0, fit: l1 * 2.1, emphasis: [0.5, 1.5, 0.5] };
    case 'seconds':
      return { target: arms[1].tip, base: dials[2], yaw: 0, pitch: 0, fit: l2 * 2.1, emphasis: [0.4, 0.6, 1.5] };
    case 'now':
      return { target: now, base: IDENTITY, yaw: -0.5, pitch: 0.3, fit: l2 * 1.1, emphasis: [0.7, 0.8, 1.2] };
    case 'year':
      return { target: [0, 0, 0], base: IDENTITY, yaw: -0.3, pitch: 0.62, fit: 5.3, emphasis: [1, 1, 1] };
    case 'branch':
      return { target: branch.tip, base: IDENTITY, yaw: null, pitch: null, fit: branch.length * 2.4, emphasis: [1, 1, 1] };
    default:
      // the tree itself fills the frame, whatever size the hour of the day has made it
      return { target: [0, 0, 0], base: IDENTITY, yaw: -0.5, pitch: 0.3, fit: params.reach * OVERVIEW_FILL, emphasis: [1, 1, 1] };
  }
}

export const VIEWS = ['overview', 'hours', 'minutes', 'seconds', 'now', 'year'];
