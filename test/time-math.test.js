import test from 'node:test';
import assert from 'node:assert/strict';
import {
  angles, bits, dayFractionSexagesimal, hourSync, julianDate, monthStarts, moon, palette, parts,
  phaseName, quadrant, roman, solarAltitude, thirds, yearProgress,
} from '../public/time-math.js';

const near = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≉ ${expected}`);
const at = (h, m, s, ms = 0) => parts(new Date(2026, 9, 1, h, m, s, ms));

test('angles follow 6° per second and minute, 30° per hour', () => {
  const a = angles(at(16, 27, 36));
  near(a.sec, 216);
  near(a.min, 165.6);
  near(a.hour, 133.8);
  near(a.day, (16 + 27.6 / 60) * 15);
});

test('angles are zero at midnight and the hour hand wraps at noon', () => {
  assert.deepEqual(angles(at(0, 0, 0)), { sec: 0, min: 0, hour: 0, day: 0 });
  near(angles(at(12, 0, 0)).hour, 0);
  near(angles(at(12, 0, 0)).day, 180);
});

test('year progress: ordinal day and elapsed fraction', () => {
  const y = yearProgress(new Date(2026, 9, 1, 12, 0, 0));
  assert.equal(y.ordinal, 274);
  assert.equal(y.total, 365);
  near(y.fraction, 273.5 / 365);
  assert.equal(yearProgress(new Date(2028, 11, 31)).ordinal, 366);
  assert.equal(yearProgress(new Date(2026, 0, 1)).ordinal, 1);
  assert.equal(yearProgress(new Date(2026, 0, 1)).fraction, 0);
});

test('month starts on the year ruler', () => {
  const starts = monthStarts(2026);
  assert.equal(starts[0], 0);
  near(starts[1], 31 / 365);
  near(monthStarts(2028)[2], 60 / 366);
});

test('day fraction in base 60 is exact', () => {
  assert.deepEqual(dayFractionSexagesimal(at(16, 27, 36).msOfDay), [41, 9, 0, 0]);
  assert.deepEqual(dayFractionSexagesimal(at(12, 0, 0).msOfDay), [30, 0, 0, 0]);
  assert.deepEqual(dayFractionSexagesimal(at(23, 59, 59, 999).msOfDay), [59, 59, 59, 59]);
  assert.deepEqual(dayFractionSexagesimal(0), [0, 0, 0, 0]);
});

test('thirds divide the second into sixty', () => {
  assert.equal(thirds(0), 0);
  assert.equal(thirds(500), 30);
  assert.equal(thirds(999), 59);
});

test('binary digits are most significant first', () => {
  assert.deepEqual(bits(36, 6), [1, 0, 0, 1, 0, 0]);
  assert.deepEqual(bits(0, 6), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(bits(59, 6), [1, 1, 1, 0, 1, 1]);
});

test('julian date of the unix epoch', () => {
  assert.equal(julianDate(new Date(0)), 2440587.5);
});

test('mean moon: new at the reference lunation, full half a month later', () => {
  const newMoon = new Date((2451550.1 - 2440587.5) * 864e5 + 3600e3);
  assert.equal(moon(newMoon).name, 'new');
  assert.ok(moon(newMoon).illumination < 0.01);
  const full = moon(new Date(newMoon.getTime() + 14.765 * 864e5));
  assert.equal(full.name, 'full');
  assert.ok(full.illumination > 0.99);
  const at = (days) => moon(new Date(newMoon.getTime() + days * 864e5)).name;
  assert.deepEqual([3, 7.4, 11, 18, 22.1, 26, 29.4].map(at),
    ['waxing crescent', 'first quarter', 'waxing gibbous', 'waning gibbous', 'last quarter', 'waning crescent', 'new']);
});

test('roman numerals', () => {
  assert.deepEqual([1, 4, 9, 10, 12, 2026].map(roman), ['I', 'IV', 'IX', 'X', 'XII', 'MMXXVI']);
});

test('quadrants turn at the equinoxes and solstices', () => {
  assert.equal(quadrant(new Date(2026, 9, 1)), 'AUTUMNAL');
  assert.equal(quadrant(new Date(2026, 2, 19)), 'HIBERNAL');
  assert.equal(quadrant(new Date(2026, 2, 20)), 'VERNAL');
  assert.equal(quadrant(new Date(2026, 5, 21)), 'ESTIVAL');
  assert.equal(quadrant(new Date(2026, 11, 21)), 'HIBERNAL');
  assert.equal(quadrant(new Date(2026, 0, 1)), 'HIBERNAL');
});

test('abstract sun: below the horizon at midnight, overhead at noon', () => {
  near(solarAltitude(0), -1);
  near(solarAltitude(0.25), 0);
  near(solarAltitude(0.5), 1);
});

test('phase names cover the whole day', () => {
  assert.equal(phaseName(0), 'MIDNIGHT');
  assert.equal(phaseName(12), 'MERIDIAN');
  assert.equal(phaseName(16.46), 'AFTERNOON');
  assert.equal(phaseName(23.99), 'MIDNIGHT');
  for (let h = 0; h < 24; h += 0.25) assert.equal(typeof phaseName(h), 'string');
});

test('palette is continuous across midnight and always valid', () => {
  assert.deepEqual(palette(0), palette(23.9999999));
  for (let h = 0; h < 24; h += 0.1) {
    for (const color of Object.values(palette(h))) {
      assert.equal(color.length, 3);
      for (const v of color) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
    }
  }
  assert.deepEqual(palette(12.5).bg, [0x1a, 0x18, 0x13]);
});

test('hour synchronisation peaks on the hour and is 60-fold at noon and midnight', () => {
  assert.equal(hourSync(at(15, 0, 0)).e, 1);
  assert.equal(hourSync(at(15, 0, 0)).fold, 12);
  assert.equal(hourSync(at(15, 30, 0)).e, 0);
  assert.equal(hourSync(at(15, 0, 9)).e, 0);
  assert.ok(hourSync(at(14, 59, 58, 500)).e > 0);
  assert.deepEqual(hourSync(at(12, 0, 0)), { e: 1, fold: 60, meridian: true });
  assert.equal(hourSync(at(11, 59, 59)).fold, 60);
  assert.equal(hourSync(at(0, 0, 10)).fold, 60);
  assert.ok(hourSync(at(0, 0, 10)).e > 0);
  assert.equal(hourSync(at(23, 59, 59)).meridian, true);
});
