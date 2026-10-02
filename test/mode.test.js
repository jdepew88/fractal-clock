import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANAR, SPATIAL, initialMode, parseCamera, withMode } from '../public/mode.js';
import { palette, unitTones } from '../public/time-math.js';

const query = (text) => new URLSearchParams(text);

test('the page opens planar unless asked otherwise', () => {
  assert.equal(initialMode(query('')), PLANAR);
  assert.equal(initialMode(query('t=11:59:50')), PLANAR);
  assert.equal(initialMode(query('t=12:00:00&freeze')), PLANAR);
  assert.equal(initialMode(query('mode=3d')), SPATIAL);
  assert.equal(initialMode(query('mode=3D&t=12:00:00&freeze')), SPATIAL);
  assert.equal(initialMode(query('mode=2d')), PLANAR);
  // anything unrecognised is the default
  assert.equal(initialMode(query('mode=4d')), PLANAR);
  assert.equal(initialMode(query('mode=')), PLANAR);
});

test('links made for the spatial instrument still open it', () => {
  assert.equal(initialMode(query('t=09:41:00&freeze&view=seconds')), SPATIAL);
  assert.equal(initialMode(query('t=00:00:00&freeze&cam=40,25,0.6')), SPATIAL);
  // unless the mode is stated
  assert.equal(initialMode(query('view=now&mode=2d')), PLANAR);
  assert.equal(initialMode(query('mode=3d&view=now')), SPATIAL);
});

test('camera parameter: yaw°, pitch°, fit', () => {
  const camera = parseCamera(query('cam=40,-25,0.6'));
  assert.ok(Math.abs(camera.yaw - (40 * Math.PI) / 180) < 1e-12);
  assert.ok(Math.abs(camera.pitch + (25 * Math.PI) / 180) < 1e-12);
  assert.equal(camera.fit, 0.6);
  assert.equal(parseCamera(query('')), null);
  assert.equal(parseCamera(query('cam=40,25')), null);
  assert.equal(parseCamera(query('cam=a,b,c')), null);
  assert.equal(parseCamera(query('cam=1,2,0')), null);
  assert.equal(parseCamera(query('cam=1.2.3,2,1')), null);
});

test('changing mode rewrites only the mode, and keeps the test parameters readable', () => {
  assert.equal(withMode('', SPATIAL), '?mode=3d');
  assert.equal(withMode('?mode=3d', PLANAR), '');
  assert.equal(withMode('?t=12:00:00&freeze', SPATIAL), '?t=12:00:00&freeze&mode=3d');
  assert.equal(withMode('?t=12:00:00&freeze&mode=3d', PLANAR), '?t=12:00:00&freeze');
  assert.equal(withMode('?mode=3d&view=now', PLANAR), '?mode=2d&view=now');
  assert.equal(withMode('?t=00:00:00&freeze&cam=40,25,0.6', PLANAR), '?t=00:00:00&freeze&cam=40,25,0.6&mode=2d');
  assert.equal(withMode('?t=2026-12-21T23:10:00', SPATIAL), '?t=2026-12-21T23:10:00&mode=3d');
  // and whatever it writes, it reads back
  for (const search of ['', '?t=11:59:50', '?view=year', '?cam=1,2,3&freeze']) {
    for (const mode of [PLANAR, SPATIAL]) assert.equal(initialMode(query(withMode(search, mode))), mode);
  }
});

test('unit tones: one family, hours deepest, seconds palest, at every hour of the day', () => {
  const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  for (let hour = 0; hour < 24; hour += 0.5) {
    const pal = palette(hour);
    const { hour: h, minute: m, second: s } = unitTones(pal);
    for (const tone of [h, m, s]) for (const v of tone) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
    assert.deepEqual(m, pal.accent);
    assert.ok(luminance(h) < luminance(m) && luminance(m) < luminance(s), `hour ${hour}`);
    // each end is at least as far from the accent as the deep and ink of the palette itself
    assert.ok(distance(h, m) >= distance(pal.deep, m));
    assert.ok(distance(s, m) >= distance(pal.ink, m) - 1);
    // and a step between neighbours is one a viewer can see
    assert.ok(luminance(m) - luminance(h) > 20 && luminance(s) - luminance(m) > 20, `hour ${hour}`);
  }
});
