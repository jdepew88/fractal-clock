import {
  bits, dayFractionSexagesimal, hourSync, julianDate, monthStarts, moon,
  palette, parts, phaseName, quadrant, roman, thirds, yearProgress,
} from './time-math.js';
import { cuneiform, monthGlyph, moonGlyph } from './glyphs.js';
import { createSpace } from './space.js';
import { RAD } from './space-math.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');

const main = $('instrument');
const dialEl = $('dial');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ── time source ──────────────────────────────────────────────────────────────
// ?t=11:59:50 (today) or ?t=2026-12-21T12:00:00 starts the instrument at another
// moment; adding &freeze holds it there. Without parameters this is the real clock.
const query = new URLSearchParams(location.search);
const clock = (() => {
  const start = Date.now();
  let offset = 0;
  const t = query.get('t');
  if (t) {
    const hms = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t);
    const target = hms ? new Date().setHours(+hms[1], +hms[2], +(hms[3] ?? 0), 0) : Date.parse(t);
    if (Number.isFinite(target)) offset = target - start;
  }
  const frozen = query.has('freeze');
  return () => new Date((frozen ? start : Date.now()) + offset);
})();

// ── DOM readings ─────────────────────────────────────────────────────────────
const shown = new Map();
function put(id, text) {
  if (shown.get(id) !== text) {
    shown.set(id, text);
    $(id).textContent = text;
  }
}

const dateFormat = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

const bitCells = ['H', 'M', 'S'].map(() => []);
function buildBinary() {
  const grid = $('binary');
  grid.append(document.createElement('span'));
  for (const weight of [32, 16, 8, 4, 2, 1]) {
    grid.append(Object.assign(document.createElement('span'), { textContent: weight }));
  }
  ['H', 'M', 'S'].forEach((name, row) => {
    grid.append(Object.assign(document.createElement('span'), { textContent: name }));
    for (let col = 0; col < 6; col++) {
      const cell = document.createElement('i');
      bitCells[row].push(cell);
      grid.append(cell);
    }
  });
}

function buildRuler(id, positions, isMajor) {
  const ruler = $(id);
  positions.forEach((at, i) => {
    const tick = document.createElement('b');
    if (isMajor(i)) tick.className = 'major';
    tick.style.left = `${at * 100}%`;
    ruler.append(tick);
  });
}

// Tap toggles a note open, for screens without hover.
document.addEventListener('click', (event) => {
  const target = event.target.closest('.mark');
  for (const open of document.querySelectorAll('.is-open')) {
    if (open !== target) open.classList.remove('is-open');
  }
  target?.classList.toggle('is-open');
});

let pal = palette(12);
let builtYear = null;

function everySecond(now, p) {
  pal = palette(p.hour);
  for (const key of ['bg', 'ink', 'accent', 'deep']) {
    const value = pal[key].join(' ');
    if (shown.get(key) !== value) {
      shown.set(key, value);
      document.documentElement.style.setProperty(`--${key}`, value);
    }
  }

  // standard time
  const clockText = `${p.h % 12 || 12}:${pad(p.m)}:${pad(p.s)}`;
  const meridiem = p.h < 12 ? 'AM' : 'PM';
  put('time', clockText);
  put('meridiem', meridiem);
  $('time').dateTime = `${pad(p.h)}:${pad(p.m)}:${pad(p.s)}`;
  put('date', dateFormat.format(now));
  const offset = -now.getTimezoneOffset();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Local time';
  put('zone', `${zone.replace(/_/g, ' ')} · UTC${offset < 0 ? '−' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`);
  const label = `Three-dimensional fractal clock showing ${p.h % 12 || 12}:${pad(p.m)} ${meridiem}. Arrow keys orbit, plus and minus zoom, Escape returns to the overview.`;
  if (shown.get('dial') !== label) {
    shown.set('dial', label);
    dialEl.setAttribute('aria-label', label);
  }

  // angular: whole-second values, so they agree with the digits above
  put('ang-s', `${(p.s * 6).toFixed(1)}°`);
  put('ang-m', `${((p.m + p.s / 60) * 6).toFixed(1)}°`);
  put('ang-h', `${(((p.h % 12) + p.m / 60 + p.s / 3600) * 30).toFixed(2)}°`);

  // binary
  [p.h, p.m, p.s].forEach((value, row) => {
    bits(value, 6).forEach((bit, col) => bitCells[row][col].classList.toggle('on', bit === 1));
  });

  // base 60
  const hms = `${p.h}-${p.m}-${p.s}`;
  if (shown.get('wedges') !== hms) {
    shown.set('wedges', hms);
    $('wedges').replaceChildren(cuneiform([p.h, p.m, p.s]));
  }

  // day and year
  put('day-pct', (p.dayFraction * 100).toFixed(3));
  $('day-ruler').querySelector('.index').style.left = `${p.dayFraction * 100}%`;
  const year = yearProgress(now);
  put('year-day', `DAY ${year.ordinal} / ${year.total}`);
  put('year-pct', (year.fraction * 100).toFixed(5));
  $('year-ruler').querySelector('.index').style.left = `${year.fraction * 100}%`;
  if (builtYear !== now.getFullYear()) {
    builtYear = now.getFullYear();
    for (const tick of $('year-ruler').querySelectorAll('b')) tick.remove();
    buildRuler('year-ruler', monthStarts(builtYear), (i) => i % 3 === 0);
  }

  // symbolic calendar
  const month = now.getMonth() + 1;
  if (shown.get('month') !== month) {
    shown.set('month', month);
    $('sigil-now').replaceChildren(monthGlyph(month));
  }
  put('cal-month', `MONTH ${roman(month)} · ${MONTHS[month - 1].toUpperCase()}`);
  put('cal-day', `DAY ${year.ordinal}`);
  put('cal-quadrant', `${quadrant(now)} QUADRANT`);

  // shadow, moon, machine
  put('umbra', `${(p.dayFraction * 360).toFixed(2)}°`);
  put('phase', phaseName(p.hour));
  const luna = moon(now);
  const lunaKey = luna.phase.toFixed(2);
  if (shown.get('moon-disc') !== lunaKey) {
    shown.set('moon-disc', lunaKey);
    $('moon-disc').replaceChildren(moonGlyph(luna.phase));
  }
  put('moon-age', `${luna.age.toFixed(1)} d · ${Math.round(luna.illumination * 100)}%`);
  put('moon-name', luna.name.toUpperCase());
  put('unix', String(Math.floor(now.getTime() / 1000)));
  put('jd', julianDate(now).toFixed(5));

  if (space) {
    const { generations, arms, ratio } = space.describe();
    put('recursion', `${generations} GENERATIONS · ${arms.toLocaleString('en-US')} ARMS · RATIO ${ratio.toFixed(3)}`);
  }
}

function everyFrame(p) {
  put('hora', `${p.h};${pad(p.m)},${pad(p.s)},${pad(thirds(p.ms))}`);
  const [a, b, c, d] = dayFractionSexagesimal(p.msOfDay);
  put('dies', `0;${pad(a)},${pad(b)},${pad(c)}${reducedMotion.matches ? '' : `,${pad(d)}`}`);
}

// ── the spatial instrument ───────────────────────────────────────────────────
// ?view=hours|minutes|seconds|now|year opens on that viewpoint, and
// ?cam=yaw,pitch,fit (degrees, degrees, world radius) pins the camera, so any
// state of the instrument can be reproduced exactly for testing.
const modeButtons = [...document.querySelectorAll('.modes button')];
const pinned = /^(-?[\d.]+),(-?[\d.]+),([\d.]+)$/.exec(query.get('cam') ?? '');
const space = createSpace({
  canvas: $('space'),
  main,
  dial: dialEl,
  labels: $('labels'),
  reducedMotion,
  initialView: query.get('view') ?? 'overview',
  initialCamera: pinned && { yaw: pinned[1] * RAD, pitch: pinned[2] * RAD, fit: +pinned[3] },
  onView: (name) => {
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.view === name));
  },
});
if (space) {
  for (const button of modeButtons) button.addEventListener('click', () => space.setView(button.dataset.view));
} else {
  main.classList.add('no-space');
}

// ── run ──────────────────────────────────────────────────────────────────────
let lastSecond = null;
let dirty = true;

function frame() {
  let now = clock();
  const second = Math.floor(now.getTime() / 1000);
  // With reduced motion the instrument steps once per second instead of sweeping.
  if (reducedMotion.matches) now = new Date(second * 1000);
  const p = parts(now);
  const ticked = second !== lastSecond || dirty;
  if (ticked) {
    lastSecond = second;
    dirty = false;
    everySecond(now, p);
  }
  if (ticked || !reducedMotion.matches) everyFrame(p);
  space?.frame(now, p, pal, hourSync(p));
  requestAnimationFrame(frame);
}

buildBinary();
buildRuler('day-ruler', Array.from({ length: 25 }, (_, i) => i / 24), (i) => i % 6 === 0);
new ResizeObserver(() => {
  space?.resize();
  dirty = true;
}).observe(main);
space?.resize();
requestAnimationFrame(frame);
