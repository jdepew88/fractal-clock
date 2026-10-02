import test from 'node:test';
import assert from 'node:assert/strict';
import { parts } from '../public/time-math.js';
import {
  ARM, DIAL, ECLIPTIC, FOCAL, IDENTITY, LIMITS, RAD, RADIUS, VIEWS, WAKE_OFFSETS, apply, arm, cameraBasis,
  clampFit, clampPitch, clockAngles, column, dailySun, distanceFor, dot, matFromQuat, mul, nowAt, onRing,
  principal, project, quatFromMat, scaleGains, slerp, solarLongitude, treeParams, turn, viewGoal, viewProjection, wakeAlpha,
} from '../public/space-math.js';
import { romanStrokes, sigilStrokes } from '../public/engraving.js';

const near = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≉ ${expected}`);
const nearAll = (actual, expected, eps = 1e-9) => actual.forEach((v, i) => near(v, expected[i], eps));
const at = (h, m, s, ms = 0) => parts(new Date(2026, 9, 1, h, m, s, ms));
const NOON = treeParams(0.5);

test('each unit turns clockwise about its own axis', () => {
  // seen from +Z, a quarter turn carries 12 o'clock (+Y) to 3 o'clock (+X)
  nearAll(apply(turn(0, 90 * RAD), [0, 1, 0]), [1, 0, 0]);
  // seen from +Y with X up, a quarter turn carries X to +Z
  nearAll(apply(turn(1, 90 * RAD), [1, 0, 0]), [0, 0, 1]);
  // seen from +X with Z up, a quarter turn carries Z to +Y
  nearAll(apply(turn(2, 90 * RAD), [0, 0, 1]), [0, 1, 0]);
  // and each leaves its axis alone
  nearAll(apply(turn(0, 1), [0, 0, 1]), [0, 0, 1]);
  nearAll(apply(turn(1, 1), [0, 1, 0]), [0, 1, 0]);
  nearAll(apply(turn(2, 1), [1, 0, 0]), [1, 0, 0]);
});

test('clock angles: 6° per second and minute, 30° per hour', () => {
  const [h, m, s] = clockAngles(at(16, 27, 36));
  near(s / RAD, 216);
  near(m / RAD, 165.6);
  near(h / RAD, 133.8);
  nearAll(clockAngles(at(12, 0, 0)), [0, 0, 0]);
  nearAll(clockAngles(at(0, 0, 0)), [0, 0, 0]);
});

test('the hour arm reads as a clock hand from the front', () => {
  const three = arm(0, 0, clockAngles(at(15, 0, 0)), NOON);
  nearAll(three.tip, [NOON.l0, 0, 0]);
  const six = arm(0, 0, clockAngles(at(6, 0, 0)), NOON);
  nearAll(six.tip, [0, -NOON.l0, 0]);
  // the opposed arm of the same generation points the other way
  nearAll(arm(1, 0, clockAngles(at(15, 0, 0)), NOON).tip, [-NOON.l0, 0, 0]);
});

test('every arm is perpendicular to the arm it grows from', () => {
  const angles = clockAngles(at(16, 27, 36, 480));
  const direction = (a) => a.tip.map((v, i) => (v - a.base[i]) / a.length);
  for (const path of [0, 1, 5, 22, 87, 300]) {
    for (let g = 1; g < 9; g++) {
      const child = arm(path, g, angles, NOON);
      const parent = arm(path, g - 1, angles, NOON);
      near(dot(direction(child), direction(parent)), 0, 1e-9);
      nearAll(child.base, parent.tip);
      near(child.length, parent.length * NOON.ratio);
    }
  }
});

test('at twelve o\'clock every arm lies along a world axis', () => {
  const angles = clockAngles(at(12, 0, 0));
  for (let g = 0; g < 9; g++) {
    for (const path of [0, 1, 2, 2 ** g, 2 ** (g + 1) - 1]) {
      const a = arm(path, g, angles, NOON);
      const d = a.tip.map((v, i) => (v - a.base[i]) / a.length);
      const along = ARM[g % 3]; // hour arms along Y, minute along X, second along Z
      near(Math.abs(d[along]), 1, 1e-9);
    }
  }
});

test('NOW is the sum of the three principal arms', () => {
  const angles = clockAngles(at(12, 0, 0));
  const { l0, ratio } = NOON;
  nearAll(principal(angles, NOON).now, [l0 * ratio, l0, l0 * ratio * ratio]);
  // at 3:00:00 the whole chain has turned a quarter about Z
  nearAll(principal(clockAngles(at(15, 0, 0)), NOON).now, [l0, -l0 * ratio, l0 * ratio * ratio]);
});

test('NOW travels a circle about the minute arm once a minute', () => {
  const angles = clockAngles(at(9, 41, 17, 250));
  const chain = principal(angles, NOON);
  const radius = NOON.l0 * NOON.ratio ** 2;
  for (const dt of [0, 7, 22.5, 41]) {
    const past = nowAt(angles, NOON, dt);
    // measured from where the minute arm's tip was at that moment
    const centre = arm(0, 1, [angles[0] - (dt / 120) * RAD, angles[1] - dt * 0.1 * RAD, 0], NOON).tip;
    near(Math.hypot(...past.map((v, i) => v - centre[i])), radius, 1e-9);
  }
  nearAll(nowAt(angles, NOON, 0), chain.now);
});

test('the wake fades: clear for seconds, barely there after a minute', () => {
  assert.equal(WAKE_OFFSETS[0], 0);
  assert.equal(WAKE_OFFSETS.at(-1), 600);
  for (let i = 1; i < WAKE_OFFSETS.length; i++) assert.ok(WAKE_OFFSETS[i] > WAKE_OFFSETS[i - 1]);
  assert.ok(wakeAlpha(0) > 0.9);
  assert.ok(wakeAlpha(1) > wakeAlpha(10) && wakeAlpha(10) > wakeAlpha(60));
  assert.ok(wakeAlpha(60) < 0.1 && wakeAlpha(60) > 0.02);
});

test('the tree breathes: compact at midnight, space-filling at noon', () => {
  const midnight = treeParams(0);
  near(NOON.expanse, 1);
  near(midnight.expanse, 0);
  near(NOON.ratio ** 3, 0.5); // the ratio at which a 3D H-tree fills space
  assert.ok(midnight.ratio < NOON.ratio && midnight.l0 < NOON.l0);
  // `reach` is the corner of the aligned lattice: the sum of every arm along each axis
  const corner = ({ l0, ratio }) => (l0 / (1 - ratio ** 3)) * Math.hypot(1, ratio, ratio * ratio);
  near(NOON.reach, corner(NOON));
  near(midnight.reach, corner(midnight));
  assert.ok(midnight.reach < NOON.reach / 2);
  // at noon the face of the lattice is inscribed in the hour ring: its corner in the hour plane just reaches it
  const face = (NOON.l0 / (1 - NOON.ratio ** 3)) * Math.hypot(1, NOON.ratio);
  assert.ok(face < RADIUS.hour && face > 0.95 * RADIUS.hour);
  near(treeParams(0.25).expanse, 0.5);
});

test('reach is a fair measure of the tree at any time, not only when it is aligned', () => {
  for (const [h, m, s] of [[0, 20, 13], [3, 17, 41], [9, 41, 0], [16, 27, 36], [21, 5, 50]]) {
    const p = at(h, m, s);
    const params = treeParams(p.dayFraction);
    const angles = clockAngles(p);
    let farthest = 0;
    for (let path = 0; path < 2 ** 9; path++) farthest = Math.max(farthest, Math.hypot(...arm(path, 8, angles, params).tip));
    assert.ok(farthest > 0.75 * params.reach && farthest < 1.25 * params.reach, `${h}:${m}:${s} ${farthest} vs ${params.reach}`);
  }
});

test('the default view frames the tree itself, at midnight as at noon', () => {
  for (const dayFraction of [0, 0.2, 0.5, 0.7, 0.9]) {
    const params = treeParams(dayFraction);
    const goal = viewGoal('overview', principal([0, 0, 0], params), params);
    // the reach sits between 70% and 90% of the way to the edge of the frame
    assert.ok(params.reach / goal.fit > 0.7 && params.reach / goal.fit < 0.9);
    // and the day, the moon and the year are not yet in the picture
    const gains = scaleGains(goal.fit);
    assert.equal(gains.day, 0);
    assert.equal(gains.moon, 0);
    assert.equal(gains.year, 0);
  }
});

test('scales arrive in order as the camera pulls back: day, moon, year', () => {
  assert.ok(RADIUS.hour < RADIUS.day && RADIUS.day < RADIUS.moon && RADIUS.moon < RADIUS.year);
  const first = (key) => {
    for (let fit = 0.1; fit < LIMITS.fitMax; fit += 0.05) if (scaleGains(fit)[key] > 0.5) return fit;
    return Infinity;
  };
  assert.ok(first('day') < first('moon') && first('moon') < first('year'));
  // each is fully drawn by the time the camera holds its ring, and stays so
  for (const key of ['day', 'moon', 'year']) {
    assert.ok(scaleGains(RADIUS[key] * 1.3)[key] > 0.9, key);
    assert.equal(scaleGains(LIMITS.fitMax)[key], 1);
  }
  // the year view shows everything; the hour rings are whole whenever they fit the frame
  const year = scaleGains(viewGoal('year', principal([0, 0, 0], NOON), NOON).fit);
  assert.ok(year.day === 1 && year.moon === 1 && year.year > 0.95);
  near(scaleGains(1.3).rings, 1);
  near(scaleGains(1.3).numerals, 1);
  // deep inside the tree, and far inside the rings, they recede but never vanish
  assert.ok(scaleGains(0.05).rings > 0 && scaleGains(0.05).rings < 0.3);
  assert.equal(scaleGains(0.6).numerals, 0);
});

test('carried dials: zero where the hand rests, read clockwise', () => {
  const angles = clockAngles(at(16, 27, 36));
  const chain = principal(angles, NOON);
  // on each dial the hand sits at its clock angle from the dial's zero (column 1), toward its right (column 0)
  for (const unit of [1, 2]) {
    const dial = chain.dials[unit];
    const a = chain.arms[unit];
    const d = a.tip.map((v, i) => (v - a.base[i]) / a.length);
    near(dot(d, column(dial, 1)), Math.cos(angles[unit]), 1e-9);
    near(dot(d, column(dial, 0)), Math.sin(angles[unit]), 1e-9);
    near(dot(d, column(dial, 2)), 0, 1e-9);
  }
  nearAll(DIAL[0], IDENTITY);
});

test('gimbal lock: at a quarter past, the seconds ring falls into the hour plane', () => {
  const chain = principal(clockAngles(at(10, 15, 0)), NOON);
  // the seconds dial's axis is then the hour axis itself
  near(Math.abs(column(chain.dials[2], 2)[2]), 1, 1e-9);
  // while on the hour it stands square to it
  near(column(principal(clockAngles(at(10, 0, 0)), NOON).dials[2], 2)[2], 0, 1e-9);
});

test('quaternions round-trip rotations and interpolate between them', () => {
  const m = mul(turn(0, 0.7), mul(turn(1, -1.9), turn(2, 2.6)));
  nearAll(matFromQuat(quatFromMat(m)), m, 1e-9);
  for (const awkward of [turn(0, Math.PI), turn(1, Math.PI), turn(2, Math.PI)]) {
    nearAll(matFromQuat(quatFromMat(awkward)), awkward, 1e-9);
  }
  const a = quatFromMat(IDENTITY);
  const b = quatFromMat(turn(0, 1.2));
  nearAll(matFromQuat(slerp(a, b, 0)), IDENTITY, 1e-9);
  nearAll(matFromQuat(slerp(a, b, 1)), turn(0, 1.2), 1e-9);
  nearAll(matFromQuat(slerp(a, b, 0.5)), turn(0, 0.6), 1e-9);
  // the short way round, whichever sign the quaternion carries
  nearAll(matFromQuat(slerp(a, b.map((v) => -v), 0.5)), turn(0, 0.6), 1e-9);
});

test('camera limits keep the view recoverable', () => {
  assert.equal(clampPitch(9), LIMITS.pitch);
  assert.equal(clampPitch(-9), -LIMITS.pitch);
  assert.equal(clampPitch(0.2), 0.2);
  assert.equal(clampFit(1e-6), LIMITS.fitMin);
  assert.equal(clampFit(1e6), LIMITS.fitMax);
  assert.ok(LIMITS.fitMax > RADIUS.year && LIMITS.fitMin < treeParams(0).l0 * treeParams(0).ratio ** 2);
  assert.ok(LIMITS.pitch < Math.PI / 2);
});

test('camera basis: yaw swings the camera sideways, pitch lifts it', () => {
  nearAll(cameraBasis(IDENTITY, 0, 0), IDENTITY);
  const yawed = column(cameraBasis(IDENTITY, 0.4, 0), 2);
  assert.ok(yawed[0] < 0 && Math.abs(yawed[1]) < 1e-12);
  const pitched = column(cameraBasis(IDENTITY, 0, 0.4), 2);
  assert.ok(pitched[1] > 0 && Math.abs(pitched[0]) < 1e-12);
});

test('projection: the target lands on the dial, and fit fills it', () => {
  const width = 1600;
  const height = 1000;
  const dial = { size: 800, cx: 700, cy: 520 };
  const fit = 1.2;
  const m = viewProjection({
    basis: IDENTITY,
    target: [0.2, -0.1, 0.3],
    distance: distanceFor(fit, height, dial.size),
    aspect: width / height,
    near: 0.01,
    far: 100,
    centre: [(dial.cx - width / 2) / (width / 2), -(dial.cy - height / 2) / (height / 2)],
  });
  const centre = project(m, [0.2, -0.1, 0.3], width, height);
  near(centre.x, dial.cx, 1e-3);
  near(centre.y, dial.cy, 1e-3);
  assert.ok(centre.w > 0);
  // a point `fit` to the right of the target sits 47% of the dial's width away
  const edge = project(m, [0.2 + fit, -0.1, 0.3], width, height);
  near(edge.x - dial.cx, 0.47 * dial.size, 1e-2);
  // and one above it is the same distance up the screen
  const top = project(m, [0.2, -0.1 + fit, 0.3], width, height);
  near(dial.cy - top.y, 0.47 * dial.size, 1e-2);
  // behind the camera
  assert.ok(project(m, [0, 0, 1000], width, height).w < 0);
  near(FOCAL, 1 / Math.tan(15 * RAD));
});

test('viewpoints: each unit is faced along its own axis', () => {
  const angles = clockAngles(at(16, 27, 36));
  const chain = principal(angles, NOON);
  for (const name of VIEWS) {
    const goal = viewGoal(name, chain, NOON);
    assert.equal(goal.target.length, 3);
    assert.ok(goal.fit >= LIMITS.fitMin && goal.fit <= LIMITS.fitMax, name);
    assert.ok(Math.abs(goal.pitch) <= LIMITS.pitch, name);
  }
  // HOURS looks straight down Z at the origin
  nearAll(column(viewGoal('hours', chain, NOON).base, 2), [0, 0, 1]);
  // MINUTES looks down the hour arm at its tip; SECONDS down the minute arm
  const direction = (a) => a.tip.map((v, i) => (v - a.base[i]) / a.length);
  const minutes = viewGoal('minutes', chain, NOON);
  nearAll(column(minutes.base, 2), direction(chain.arms[0]), 1e-9);
  nearAll(minutes.target, chain.arms[0].tip);
  const seconds = viewGoal('seconds', chain, NOON);
  nearAll(column(seconds.base, 2), direction(chain.arms[1]), 1e-9);
  nearAll(viewGoal('now', chain, NOON).target, chain.now);
  // each closer view is a smaller world
  assert.ok(viewGoal('year', chain, NOON).fit > viewGoal('hours', chain, NOON).fit);
  assert.ok(viewGoal('hours', chain, NOON).fit > minutes.fit && minutes.fit > seconds.fit);
  // a picked branch keeps the present orientation
  const branch = arm(5, 4, angles, NOON);
  const picked = viewGoal('branch', chain, NOON, branch);
  assert.equal(picked.yaw, null);
  nearAll(picked.target, branch.tip);
});

test('day ring: the sun is overhead at noon and underfoot at midnight', () => {
  nearAll(dailySun(0.5), [0, RADIUS.day, 0], 1e-9);
  nearAll(dailySun(0), [0, -RADIUS.day, 0], 1e-9);
  // 06:00 on the left (rising), 18:00 on the right
  assert.ok(dailySun(0.25)[0] < 0 && dailySun(0.75)[0] > 0);
});

test('year ring: crosses the hour plane at the equinoxes, highest at the June solstice', () => {
  near(solarLongitude(78.8), 0);
  const equinox = onRing(ECLIPTIC, solarLongitude(78.8), RADIUS.year);
  nearAll(equinox, [RADIUS.year, 0, 0], 1e-9);
  const solstice = onRing(ECLIPTIC, solarLongitude(78.8 + 365.2422 / 4), RADIUS.year);
  near(solstice[2], RADIUS.year * Math.sin(23.44 * RAD), 1e-9);
  near(Math.hypot(...solstice), RADIUS.year, 1e-9);
});

test('engraving: numerals and sigils are finite, bounded strokes', () => {
  assert.equal(romanStrokes('I').length, 3);
  assert.equal(romanStrokes('VIII').length, 2 + 3 + 2);
  assert.equal(romanStrokes('XII').length, 2 + 2 + 2);
  for (const numeral of ['I', 'IV', 'IX', 'XII']) {
    for (const s of romanStrokes(numeral)) for (const v of s) assert.ok(Math.abs(v) <= 1.01);
  }
  const counts = new Set();
  for (let m = 1; m <= 12; m++) {
    const strokes = sigilStrokes(m);
    assert.ok(strokes.length > 80);
    for (const s of strokes) for (const v of s) assert.ok(Number.isFinite(v) && Math.abs(v) <= 1);
    counts.add(JSON.stringify(strokes));
  }
  assert.equal(counts.size, 12); // no two months share a sigil
});
