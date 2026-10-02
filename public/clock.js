import {
  bits, dayFractionSexagesimal, hourSync, julianDate, monthStarts, moon,
  palette, parts, phaseName, quadrant, roman, thirds, unitTones, yearProgress,
} from './time-math.js';
import { cuneiform, monthGlyph, moonGlyph } from './glyphs.js';
import { PLANAR, SPATIAL, initialMode, parseCamera, withMode } from './mode.js';
import {
  CANONICAL, KEYS, SCALES, formatSetting, hueOf, isCanonical, parseCalibration, recursionReading, settle, tinted, tuningFor,
} from './calibration.js';
import { createPlanar } from './planar.js';

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

function buildSigils() {
  const strip = $('sigils');
  MONTHS.forEach((name, i) => {
    const sigil = document.createElement('span');
    sigil.className = 'sigil';
    sigil.tabIndex = 0;
    sigil.setAttribute('role', 'img');
    sigil.setAttribute('aria-label', `${name}, month ${roman(i + 1)}`);
    const numeral = Object.assign(document.createElement('em'), { textContent: roman(i + 1) });
    const note = Object.assign(document.createElement('span'), { className: 'note', textContent: name });
    sigil.append(monthGlyph(i + 1), numeral, note);
    strip.append(sigil);
  });
}

// Tap toggles a note open, for screens without hover.
document.addEventListener('click', (event) => {
  const target = event.target.closest('.mark, .sigil');
  for (const open of document.querySelectorAll('.is-open')) {
    if (open !== target) open.classList.remove('is-open');
  }
  target?.classList.toggle('is-open');
});

// ── calibration ──────────────────────────────────────────────────────────────
// Seven scales adjust how the present time is drawn, never the time itself. One
// set of settings serves both instruments and lasts as long as the page does;
// ?cal=hour,minute,second,iterations,ratio,depth,hue opens on a given set.
const settings = parseCalibration(query);
let tuning = tuningFor(settings);

let pal = tinted(palette(12), tuning.hue);
let builtYear = null;

function everySecond(now, p) {
  // the palette of the hour, with the instrument's own tones turned by the hue scale
  pal = tinted(palette(p.hour), tuning.hue);
  const hue = `${hueOf(pal.accent)}°`;
  if (shown.get('read-hue') !== hue) $('set-hue').setAttribute('aria-valuetext', hue);
  put('read-hue', hue);
  for (const key of ['bg', 'ink', 'accent', 'deep']) {
    const value = pal[key].join(' ');
    if (shown.get(key) !== value) {
      shown.set(key, value);
      document.documentElement.style.setProperty(`--${key}`, value);
    }
  }
  // the tones the spatial tree gives each unit, for the samples beside its viewpoints
  for (const [key, tone] of Object.entries(unitTones(pal))) {
    const value = tone.join(' ');
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
  const reading = `${p.h % 12 || 12}:${pad(p.m)} ${meridiem}`;
  const label = mode === SPATIAL
    ? `Three-dimensional fractal clock showing ${reading}. Arrow keys orbit, plus and minus zoom, Escape returns to the overview.`
    : `Fractal clock showing ${reading}`;
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
    [...$('sigils').children].forEach((sigil, i) => sigil.classList.toggle('is-now', i + 1 === month));
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

  // Recursion: what is rendered, set against what the Iter scale asks for where a small screen renders less
  const spatial = mode === SPATIAL;
  const drawn = spatial ? space.describe(p.dayFraction) : planar.describe();
  const rendered = spatial ? drawn.generations : drawn.depth;
  const [summary, detail] = recursionReading({ spatial, drawn: rendered, full: drawn.full, count: spatial ? drawn.arms : drawn.hands, ratio: drawn.ratio });
  put('recursion', summary);
  put('recursion-detail', detail);
  const reduced = rendered !== drawn.full;
  const asked = !reduced ? String(settings.iterations)
    : `${settings.iterations}, rendered ${spatial ? `as ${rendered} of ${drawn.full} generations` : `at depth ${rendered}`} on this screen`;
  if (shown.get('asked') !== asked) {
    shown.set('asked', asked);
    main.classList.toggle('is-reduced', reduced);
    $('set-iterations').setAttribute('aria-valuetext', asked);
  }
}

function everyFrame(p) {
  put('hora', `${p.h};${pad(p.m)},${pad(p.s)},${pad(thirds(p.ms))}`);
  const [a, b, c, d] = dayFractionSexagesimal(p.msOfDay);
  put('dies', `0;${pad(a)},${pad(b)},${pad(c)}${reducedMotion.matches ? '' : `,${pad(d)}`}`);
}

// ── two instruments, one clock ───────────────────────────────────────────────
// The planar clock is what the page opens on; the spatial instrument is entered
// from the selector under the dial and loaded only then. Both are drawn from the
// same `parts(now)`, and only the one showing is drawn at all.
//   ?mode=2d|3d                          which instrument to open on
//   ?view=hours|minutes|seconds|now|year a viewpoint of the spatial instrument
//   ?cam=yaw,pitch,fit                   pins its camera (degrees, degrees, world radius)
const FADE = 700; // ms; matches the cross-fade in styles.css
const selectorButtons = [...document.querySelectorAll('.selector button')];
const viewButtons = [...document.querySelectorAll('.modes button')];
const planar = createPlanar({ sky: $('sky'), canvas: $('orrery'), main, dial: dialEl, reducedMotion, tuning });
let mode = PLANAR;
let space = null;
let spaceRequest = null;
let fadeUntil = 0; // until then the instrument being left is still drawn, so it can fade
let dirty = true;

function loadSpace() {
  spaceRequest ??= import('./space.js').then(({ createSpace }) => {
    const created = createSpace({
      canvas: $('space'),
      main,
      dial: dialEl,
      labels: $('labels'),
      reducedMotion,
      initialView: query.get('view') ?? 'overview',
      initialCamera: parseCamera(query),
      tuning,
      onView: (name) => {
        for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === name));
      },
    });
    if (created) {
      for (const button of viewButtons) button.addEventListener('click', () => created.setView(button.dataset.view));
    }
    return created;
  }).catch(() => null);
  return spaceRequest;
}

async function setMode(next, { initial = false } = {}) {
  if (next === SPATIAL && !space) {
    space = await loadSpace();
    if (!space) {
      // no WebGL 2: the planar clock stays, and the selector says why
      main.classList.add('no-space');
      selectorButtons.find((button) => button.dataset.mode === SPATIAL).disabled = true;
      next = PLANAR;
    }
  }
  if (next === mode && !initial) return;
  mode = next;
  main.dataset.mode = mode;
  for (const button of selectorButtons) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  planar.setActive(true); // through the fade; frame() rests it afterwards if it is not the one showing
  space?.setActive(mode === SPATIAL, { fromPlanar: !initial });
  fadeUntil = initial || reducedMotion.matches ? 0 : performance.now() + FADE;
  // the spatial instrument takes the keyboard; the planar one is a picture
  dialEl.setAttribute('role', mode === SPATIAL ? 'group' : 'img');
  if (mode === SPATIAL) dialEl.tabIndex = 0;
  else dialEl.removeAttribute('tabindex');
  dirty = true;
  if (!initial) history.replaceState(null, '', location.pathname + withMode(location.search, mode));
}

for (const button of selectorButtons) button.addEventListener('click', () => setMode(button.dataset.mode));
document.querySelector('.throw').addEventListener('click', () => setMode(mode === SPATIAL ? PLANAR : SPATIAL));

// The scales themselves. Their limits are in the markup (a test holds them to
// calibration.js); here they are read, shown, and handed to both instruments.
function showCalibration() {
  for (const key of KEYS) {
    const input = $(`set-${key}`);
    input.value = settings[key];
    input.closest('.scale').classList.toggle('is-moved', settings[key] !== CANONICAL[key]);
    if (key !== 'hue') put(`read-${key}`, formatSetting(key, settings[key])); // the hue scale reads the hue itself, each second
  }
  const modified = !isCanonical(settings);
  main.classList.toggle('is-modified', modified);
  put('calibration-state', modified ? 'Modified' : '');
  $('canonical').hidden = !modified;
}

function calibrate() {
  tuning = tuningFor(settings);
  planar.tune(tuning);
  space?.tune(tuning);
  showCalibration();
  dirty = true; // colours and readings follow at the next frame, even while time is frozen
}

for (const key of KEYS) {
  const input = $(`set-${key}`);
  const { min, max, canonical } = SCALES[key];
  input.closest('.rail').style.setProperty('--canonical', (canonical - min) / (max - min));
  input.addEventListener('input', () => {
    settings[key] = settle(key, input.value);
    calibrate();
  });
  // A finger that lands on a scale and then scrolls the page was not setting it: put it back.
  let before = settings[key];
  input.addEventListener('pointerdown', () => {
    before = settings[key];
  });
  input.addEventListener('pointercancel', () => {
    settings[key] = before;
    calibrate();
  });
}
$('canonical').addEventListener('click', () => {
  Object.assign(settings, CANONICAL);
  calibrate();
  $('set-hour').focus({ preventScroll: true }); // the button is about to leave the page
});
showCalibration();

// ── run ──────────────────────────────────────────────────────────────────────
let lastSecond = null;

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
  const fading = performance.now() < fadeUntil;
  if (!fading && mode === SPATIAL) planar.setActive(false);
  const sync = hourSync(p);
  if (mode === PLANAR || fading) planar.frame(now, p, pal, sync);
  if (space && (mode === SPATIAL || fading)) space.frame(now, p, pal, sync);
  requestAnimationFrame(frame);
}

buildBinary();
buildRuler('day-ruler', Array.from({ length: 25 }, (_, i) => i / 24), (i) => i % 6 === 0);
buildSigils();
new ResizeObserver(() => {
  planar.resize();
  space?.resize();
  dirty = true;
}).observe(main);
// Open directly on the instrument asked for; the cross-fade is for changes made afterwards.
main.dataset.mode = initialMode(query);
setMode(main.dataset.mode, { initial: true }).then(() => {
  requestAnimationFrame(frame);
  requestAnimationFrame(() => requestAnimationFrame(() => main.classList.add('is-live')));
});
