import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CANONICAL, KEYS, NEUTRAL, SCALES, calibration, formatSetting, hueOf, isCanonical, lightness, parseCalibration,
  planarLevels, recursionReading, rotateHue, settle, spatialGenerations, spatialRatio, tinted, tuningFor, warp,
} from '../public/calibration.js';
import { palette, parts, unitTones } from '../public/time-math.js';
import { arm, clockAngles, principal, scaleGains, treeParams, viewGoal } from '../public/space-math.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const at = (h, m, s) => parts(new Date(2026, 5, 15, h, m, s));
const query = (text) => new URLSearchParams(text);
/** Every position a scale can be set to. */
const positions = (key) => {
  const { min, max, step } = SCALES[key];
  return Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => settle(key, min + i * step));
};

test('there are exactly seven scales, and the canonical setting lies on each', () => {
  assert.deepEqual(KEYS, ['hour', 'minute', 'second', 'iterations', 'ratio', 'depth', 'hue']);
  for (const key of KEYS) {
    const { min, max, canonical } = SCALES[key];
    assert.ok(min < max && canonical >= min && canonical <= max, key);
    assert.equal(settle(key, canonical), canonical);
    assert.ok(positions(key).includes(canonical), key);
  }
  assert.deepEqual(CANONICAL, { hour: 100, minute: 100, second: 100, iterations: 8, ratio: 0.66, depth: 100, hue: 0 });
});

test('the markup carries the same limits as the scales', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const inputs = [...html.matchAll(/<input type="range" id="set-(\w+)" min="([^"]+)" max="([^"]+)" step="([^"]+)" value="([^"]+)" aria-label="[^"]+">/g)];
  assert.equal(inputs.length, 7);
  assert.deepEqual(inputs.map((m) => m[1]).sort(), [...KEYS].sort());
  for (const [, key, min, max, step, value] of inputs) {
    assert.deepEqual([+min, +max, +step, +value], [SCALES[key].min, SCALES[key].max, SCALES[key].step, SCALES[key].canonical], key);
  }
});

test('settling: values are clamped to the scale, land on a step, and junk is canonical', () => {
  assert.equal(settle('hour', -40), 0);
  assert.equal(settle('hour', 900), 150);
  assert.equal(settle('hour', 72.4), 72);
  assert.equal(settle('iterations', 99), 8);
  assert.equal(settle('iterations', 0), 3);
  assert.equal(settle('iterations', 5.6), 6);
  assert.equal(settle('ratio', 0.1), 0.6);
  assert.equal(settle('ratio', 2), 0.72);
  assert.equal(settle('ratio', '0.7'), 0.7);
  assert.equal(settle('ratio', 0.6649), 0.66);
  assert.equal(settle('depth', 10), 40);
  assert.equal(settle('depth', 1e9), 150);
  assert.equal(settle('hue', 720), 180);
  assert.equal(settle('hue', -181), -180);
  assert.ok(Object.is(settle('hue', -0.2), 0));
  for (const junk of [undefined, null, '', '  ', 'abc', NaN, Infinity, {}]) {
    for (const key of KEYS) assert.equal(settle(key, junk), CANONICAL[key], `${key} ← ${String(junk)}`);
  }
  // every position survives being read back from a range input's string
  for (const key of KEYS) for (const v of positions(key)) assert.equal(settle(key, String(v)), v);
});

test('readings are short: no long fractions at any position', () => {
  for (const key of KEYS) {
    for (const v of positions(key)) assert.match(formatSetting(key, v), /^-?\d{1,3}(\.\d\d)?$/, `${key} ${v}`);
  }
  assert.equal(formatSetting('ratio', 0.7), '0.70');
  assert.equal(formatSetting('hour', 100), '100');
  assert.equal(formatSetting('iterations', 8), '8');
});

test('canonical: every factor is exactly neutral, and reset returns there', () => {
  assert.deepEqual(NEUTRAL.light, [1, 1, 1]);
  assert.deepEqual(NEUTRAL.stature, [1, 1, 1]);
  assert.deepEqual(NEUTRAL.floor, [1, 1, 1]);
  assert.equal(NEUTRAL.power, 1);
  assert.equal(NEUTRAL.spread, 1);
  assert.equal(NEUTRAL.hue, 0);
  assert.equal(NEUTRAL.ratio, 0.66); // the planar clock's ratio, as first drawn
  assert.equal(planarLevels(NEUTRAL.iterations, false), 8);
  assert.equal(spatialGenerations(NEUTRAL.iterations, false), 12);
  assert.ok(isCanonical(calibration()));
  assert.ok(isCanonical(calibration({})));
  // moved, then reset as the page does it
  const settings = calibration({ hour: 20, iterations: 4, hue: -90 });
  assert.ok(!isCanonical(settings));
  Object.assign(settings, CANONICAL);
  assert.ok(isCanonical(settings));
  assert.deepEqual(tuningFor(settings), NEUTRAL);
  // one scale off canonical is enough to say so
  for (const key of KEYS) assert.ok(!isCanonical({ ...CANONICAL, [key]: SCALES[key].min }), key);
});

test('?cal= opens on a given calibration; empty places stay canonical', () => {
  assert.deepEqual(parseCalibration(query('')), { ...CANONICAL });
  assert.deepEqual(parseCalibration(query('t=12:00:00&freeze')), { ...CANONICAL });
  assert.deepEqual(parseCalibration(query('cal=40,100,150,6,0.70,60,-120')), { hour: 40, minute: 100, second: 150, iterations: 6, ratio: 0.7, depth: 60, hue: -120 });
  assert.deepEqual(parseCalibration(query('cal=,,,5')), { ...CANONICAL, iterations: 5 });
  assert.deepEqual(parseCalibration(query('cal=,,,,,,90')), { ...CANONICAL, hue: 90 });
  assert.deepEqual(parseCalibration(query('cal=999,-5,x,1,9,0,400')), { hour: 150, minute: 0, second: 100, iterations: 3, ratio: 0.72, depth: 40, hue: 180 });
});

test('influence: more is never less, the gains above 100 are modest, and the three hands never vanish', () => {
  for (const [i, key] of ['hour', 'minute', 'second'].entries()) {
    let last = null;
    for (const v of positions(key)) {
      const t = tuningFor({ [key]: v });
      for (const factor of ['light', 'stature', 'floor']) {
        if (last) assert.ok(t[factor][i] >= last[factor][i], `${key} ${factor} at ${v}`);
        // and the other two units are untouched
        for (const other of [0, 1, 2]) if (other !== i) assert.equal(t[factor][other], 1);
      }
      assert.ok(t.light[i] >= 0 && t.light[i] <= 1.25);
      assert.ok(t.stature[i] >= 0.6 && t.stature[i] <= 1.15);
      assert.ok(t.floor[i] >= 0.55 && t.floor[i] <= 1);
      last = t;
    }
    assert.equal(tuningFor({ [key]: 0 }).light[i], 0);
  }
});

test('iterations: one scale, the same recursion on both instruments', () => {
  const planar = positions('iterations').map((n) => planarLevels(n, false));
  const spatial = positions('iterations').map((n) => spatialGenerations(n, false));
  assert.deepEqual(planar, [3, 4, 5, 6, 7, 8]);
  assert.deepEqual(spatial, [5, 6, 8, 10, 11, 12]);
  // near enough the same number of arms: 3 per joint on the dial, 2 in space
  planar.slice(0, -1).forEach((levels, i) => {
    const hands = (3 ** (levels + 1) - 3) / 2;
    const arms = 2 ** (spatial[i] + 1) - 2;
    assert.ok(arms / hands > 0.5 && arms / hands < 2.2, `${levels} levels: ${hands} hands, ${arms} arms`);
  });
  // a small screen draws a little less, as it always has, and never nothing
  assert.deepEqual(positions('iterations').map((n) => planarLevels(n, true)), [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(positions('iterations').map((n) => spatialGenerations(n, true)), [3, 4, 6, 8, 9, 10]);
});

test('ratio: the spatial tree takes the same proportional change, and stays a tree all day', () => {
  near(spatialRatio(0.7, NEUTRAL), 0.7);
  for (const dayFraction of [0, 0.2, 0.5, 0.8]) {
    const canonical = treeParams(dayFraction).ratio;
    let last = 0;
    for (const v of positions('ratio')) {
      const { ratio } = treeParams(dayFraction, tuningFor({ ratio: v }));
      assert.ok(ratio > last, 'rises with the scale');
      assert.ok(ratio > 0.55 && ratio < 0.84, `${v} at ${dayFraction}: ${ratio}`);
      assert.equal(Math.sign(ratio - canonical), Math.sign(v - CANONICAL.ratio));
      last = ratio;
    }
  }
});

test('shared state: the spatial geometry is drawn from the same tuning as the planar clock', () => {
  // the default and the canonical tuning are the same tree
  assert.deepEqual(treeParams(0.4), treeParams(0.4, NEUTRAL));
  assert.deepEqual(treeParams(0.4), treeParams(0.4, tuningFor(CANONICAL)));
  const tuning = tuningFor({ hour: 150, minute: 50, second: 0, ratio: 0.7, depth: 60 });
  const params = treeParams(0.4, tuning);
  assert.equal(params.span, tuning.stature);
  assert.equal(params.depth, tuning.spread);
  const angles = clockAngles(at(9, 41, 17));
  const plain = principal(angles, treeParams(0.4, tuningFor({ ratio: 0.7 })));
  const tuned = principal(angles, params);
  // each unit's arm is scaled by its own influence, and by nothing else
  tuned.arms.forEach((each, unit) => near(each.length / plain.arms[unit].length, tuning.stature[unit]));
  // depth scales Z alone: the hour arm lies in the plane of the hours and does not move
  const deep = principal(angles, treeParams(0.4, tuningFor({ depth: 150 })));
  const flat = principal(angles, treeParams(0.4, tuningFor({ depth: 40 })));
  const canon = principal(angles, treeParams(0.4));
  for (const which of [1, 2]) {
    near(deep.arms[which].tip[2], canon.arms[which].tip[2] * 1.5);
    near(flat.arms[which].tip[2], canon.arms[which].tip[2] * 0.4);
    near(deep.arms[which].tip[0], canon.arms[which].tip[0]);
    near(flat.arms[which].tip[1], canon.arms[which].tip[1]);
  }
  assert.deepEqual(deep.arms[0].tip, canon.arms[0].tip);
  // the time itself is never touched: the same rotations at any calibration
  assert.deepEqual(tuned.arms.map((each) => each.frame), canon.arms.map((each) => each.frame));
});

test('the default view still holds the tree at any calibration, and does not close in on a dimmed one', () => {
  const extremes = [
    {}, { hour: 0, minute: 0, second: 0 }, { hour: 150, minute: 150, second: 150 }, { depth: 40 }, { depth: 150 },
    { ratio: 0.6 }, { ratio: 0.72 }, { hour: 150, minute: 150, second: 150, ratio: 0.72, depth: 150 },
  ];
  for (const settings of extremes) {
    const tuning = tuningFor(settings);
    for (const [h, m, s] of [[0, 20, 13], [9, 41, 17], [12, 0, 0], [16, 27, 36]]) {
      const p = at(h, m, s);
      const params = treeParams(p.dayFraction, tuning);
      const angles = clockAngles(p);
      let farthest = 0;
      for (let path = 0; path < 2 ** 9; path++) farthest = Math.max(farthest, Math.hypot(...arm(path, 8, angles, params).tip));
      const { fit } = viewGoal('overview', principal(angles, params), params);
      assert.ok(farthest < fit * 1.12, `${JSON.stringify(settings)} at ${h}:${m}: tree ${farthest} in a frame of ${fit}`);
      // the view never closes in on a tree that was only dimmed or pressed flat
      const dimmed = tuning.stature.every((v) => v <= 1) && tuning.spread <= 1 && tuning.power === 1;
      if (dimmed) near(fit, viewGoal('overview', principal(angles, treeParams(p.dayFraction)), treeParams(p.dayFraction)).fit);
      // and the year ring is never dragged into the default view
      assert.equal(scaleGains(fit).year, 0);
    }
  }
});

test('spread: canonical leaves every angle alone; otherwise it is continuous and keeps the quarters', () => {
  for (let deg = -180; deg <= 180; deg += 7) near(Math.cos(warp(deg * Math.PI / 180, 1) - deg * Math.PI / 180), 1);
  for (const v of [SCALES.depth.min, 70, 130, SCALES.depth.max]) {
    const spread = tuningFor({ depth: v }).spread;
    near(warp(0, spread), 0);
    near(warp(Math.PI / 2, spread), Math.PI / 2);
    near(Math.abs(warp(Math.PI, spread)), Math.PI);
    // a hand sweeping once round is drawn sweeping once round, without a jump
    let last = warp(0, spread);
    let total = 0;
    for (let i = 1; i <= 3600; i++) {
      const next = warp((i / 3600) * 2 * Math.PI, spread);
      const step = Math.atan2(Math.sin(next - last), Math.cos(next - last));
      assert.ok(step > 0 && step < 0.01, `spread ${spread} at ${i / 10}°`);
      total += step;
      last = next;
    }
    near(total, 2 * Math.PI, 1e-6);
    // narrower below 100, wider above
    assert.equal(Math.sign(warp(Math.PI / 4, spread) - Math.PI / 4), Math.sign(spread - 1));
  }
});

test('hue: one turn moves the whole family and keeps hour, minute and second apart', () => {
  const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (let hour = 0; hour < 24; hour += 1.5) {
    const pal = palette(hour);
    // canonical: the palette of the hour, untouched
    const canon = tinted(pal, 0);
    assert.deepEqual([canon.bg, canon.ink, canon.accent, canon.deep, canon.fine], [pal.bg, pal.ink, pal.accent, pal.deep, pal.ink]);
    assert.deepEqual(unitTones(canon), unitTones(pal));
    for (const degrees of positions('hue').filter((v) => v % 15 === 0)) {
      const turned = tinted(pal, degrees);
      // the ground and the ink of the text are never recoloured
      assert.equal(turned.bg, pal.bg);
      assert.equal(turned.ink, pal.ink);
      for (const key of ['accent', 'deep', 'fine']) {
        for (const v of turned[key]) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
        // each tone keeps its lightness, so the three stay as far apart as they were
        assert.ok(Math.abs(lightness(turned[key]) - lightness(pal[key === 'fine' ? 'ink' : key])) < 0.02, `${key} at ${hour}h ${degrees}°`);
      }
      const { hour: h, minute: m, second: s } = unitTones(turned);
      assert.deepEqual(m, turned.accent);
      assert.ok(luminance(h) < luminance(m) && luminance(m) < luminance(s), `${hour}h ${degrees}°`);
      assert.ok(lightness(m) - lightness(h) > 0.07 && lightness(s) - lightness(m) > 0.07, `${hour}h ${degrees}°`);
    }
    // the scale closes on itself: both ends are the same colour
    assert.deepEqual(tinted(pal, 180), tinted(pal, -180));
  }
});

test('hue: the turn is a turn', () => {
  const gold = [230, 201, 122];
  assert.equal(rotateHue(gold, 0), gold);
  // a turn and its opposite return, within rounding
  const back = rotateHue(rotateHue(gold, 60), -60);
  back.forEach((v, i) => assert.ok(Math.abs(v - gold[i]) <= 2));
  // a grey has no hue to turn
  rotateHue([128, 128, 128], 90).forEach((v) => assert.ok(Math.abs(v - 128) <= 1));
  // what the scale reads
  assert.equal(hueOf([255, 0, 0]), 0);
  assert.equal(hueOf([0, 255, 0]), 120);
  assert.equal(hueOf([0, 0, 255]), 240);
  assert.equal(hueOf([40, 40, 40]), 0);
  assert.equal(hueOf(palette(0).accent), 216);
  // the reading moves the way the scale does, all the way round
  const seen = new Set();
  for (let degrees = -180; degrees < 180; degrees += 20) seen.add(Math.floor(hueOf(rotateHue(gold, degrees)) / 60));
  assert.equal(seen.size, 6);
});

test('the Recursion reading states what is rendered, and says so when that is less than was asked for', () => {
  const hands = (levels) => (3 ** (levels + 1) - 3) / 2;
  const arms = (generations) => 2 ** (generations + 1) - 2;
  const planar = (iterations, small) => {
    const drawn = planarLevels(iterations, small);
    return recursionReading({ spatial: false, drawn, full: planarLevels(iterations, false), count: hands(drawn), ratio: 0.66 });
  };
  const spatial = (iterations, small) => {
    const drawn = spatialGenerations(iterations, small);
    return recursionReading({ spatial: true, drawn, full: spatialGenerations(iterations, false), count: arms(drawn), ratio: 0.65 });
  };
  // a full-size screen renders what the scale asks for: one line, as before
  assert.deepEqual(planar(8, false), ['DEPTH 8 · 9,840 HANDS · RATIO 0.66', '']);
  assert.deepEqual(planar(5, false), ['DEPTH 5 · 363 HANDS · RATIO 0.66', '']);
  assert.deepEqual(spatial(8, false), ['12 GENERATIONS · 8,190 ARMS · RATIO 0.650', '']);
  // a small one renders less, and the reading names both numbers; the count is of what is drawn
  assert.deepEqual(planar(8, true), ['RENDER DEPTH 7 OF 8', '3,279 HANDS · RATIO 0.66']);
  assert.deepEqual(planar(3, true), ['RENDER DEPTH 2 OF 3', '12 HANDS · RATIO 0.66']);
  assert.deepEqual(spatial(8, true), ['RENDER 10 OF 12 GENERATIONS', '2,046 ARMS · RATIO 0.650']);
  assert.deepEqual(spatial(3, true), ['RENDER 3 OF 5 GENERATIONS', '14 ARMS · RATIO 0.650']);
  for (const iterations of positions('iterations')) {
    for (const reading of [planar(iterations, true), spatial(iterations, true)]) {
      // never the asked-for number alone, and short enough for a 320px screen
      assert.match(reading[0], /^RENDER (DEPTH )?\d+ OF \d+/);
      for (const line of reading) assert.ok(line.length <= 30, line);
    }
    // on the planar clock the number asked for is the number on the Iter scale
    assert.ok(planar(iterations, true)[0].endsWith(` OF ${iterations}`));
    assert.ok(planar(iterations, false)[0].startsWith(`DEPTH ${iterations} `));
  }
});
