import {
  TAU, angles, bits, clamp, dayFractionSexagesimal, hourSync, julianDate, monthStarts, moon,
  palette, parts, phaseName, quadrant, roman, smoothstep, solarAltitude, thirds, yearProgress,
} from './time-math.js';
import { cuneiform, monthGlyph, moonGlyph } from './glyphs.js';

const RAD = Math.PI / 180;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

// Fractal: every hand ends in a child clock scaled by BRANCH_SCALE and turned to face along the hand.
const BRANCH_SCALE = 0.66;
const HAND_LENGTH = [0.55, 0.8, 1]; // hour, minute, second
const TREE_REACH = 0.72; // of the dial radius: the tree is scaled so its farthest tip lands here
const MAX_ROOT_HAND = 0.56; // of the dial radius: limit on that scaling when the tree folds up small

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const main = $('instrument');
const dialEl = $('dial');
const skyCanvas = $('sky');
const dialCanvas = $('orrery');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// ── time source ──────────────────────────────────────────────────────────────
// ?t=11:59:50 (today) or ?t=2026-12-21T12:00:00 starts the instrument at another
// moment; adding &freeze holds it there. Without parameters this is the real clock.
const clock = (() => {
  const query = new URLSearchParams(location.search);
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
  const label = `Fractal clock showing ${p.h % 12 || 12}:${pad(p.m)} ${meridiem}`;
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

  drawSky(now, p);
}

function everyFrame(p) {
  put('hora', `${p.h};${pad(p.m)},${pad(p.s)},${pad(thirds(p.ms))}`);
  const [a, b, c, d] = dayFractionSexagesimal(p.msOfDay);
  put('dies', `0;${pad(a)},${pad(b)},${pad(c)}${reducedMotion.matches ? '' : `,${pad(d)}`}`);
}

// ── canvases ─────────────────────────────────────────────────────────────────
let geo = null;
let skyCtx = null;
let dialCtx = null;
const ghostCanvas = document.createElement('canvas');
let ghostCtx = null;
let dirty = true;

function fit(canvas, width, height, maxDpr) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function layout() {
  const m = main.getBoundingClientRect();
  const d = dialEl.getBoundingClientRect();
  geo = {
    width: m.width,
    height: m.height,
    size: d.width,
    cx: d.left - m.left + d.width / 2,
    cy: d.top - m.top + d.height / 2,
  };
  // The sky spans the whole document on small screens; keep its backing store modest.
  skyCtx = fit(skyCanvas, geo.width, geo.height, geo.width * geo.height > 2.2e6 ? 1 : 2);
  dialCtx = fit(dialCanvas, geo.size, geo.size, 2);
  ghostCtx = fit(ghostCanvas, geo.size, geo.size, 2);
  dirty = true;
}

// Deterministic field of points for the night sky.
const stars = (() => {
  let seed = 0x9e3779b9;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 260 }, () => ({ r: Math.sqrt(random()), a: random() * TAU, m: random() ** 2 }));
})();

/**
 * Background: the ground the instrument sits on. A light source circles the dial
 * once a day (below the horizon line at night) and the gnomon at the centre
 * throws a shadow away from it, onto the outer 24-hour ring.
 */
function drawSky(now, p) {
  const ctx = skyCtx;
  const { width, height, cx, cy } = geo;
  const R = geo.size / 2;
  const far = Math.max(Math.hypot(cx, cy), Math.hypot(width - cx, cy), Math.hypot(cx, height - cy), Math.hypot(width - cx, height - cy));
  const altitude = solarAltitude(p.dayFraction);
  const day = smoothstep(-0.2, 0.3, altitude);
  const shadowAngle = p.dayFraction * TAU;
  const sunAngle = shadowAngle + Math.PI;

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = rgba(pal.bg, 1);
  ctx.fillRect(0, 0, width, height);

  // light arriving from the sun's side of the page
  const sx = cx + Math.sin(sunAngle) * R * 2.1;
  const sy = cy - Math.cos(sunAngle) * R * 2.1;
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 3.4);
  glow.addColorStop(0, rgba(pal.accent, 0.05 + 0.17 * day));
  glow.addColorStop(0.45, rgba(pal.deep, 0.02 + 0.05 * day));
  glow.addColorStop(1, rgba(pal.deep, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // the dial plate, lit from the same side
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.99, 0, TAU);
  ctx.clip();
  const plate = ctx.createLinearGradient(sx, sy, 2 * cx - sx, 2 * cy - sy);
  plate.addColorStop(0.25, rgba(pal.ink, 0.03 + 0.07 * day));
  plate.addColorStop(0.75, rgba(pal.ink, 0.012 + 0.03 * day));
  ctx.fillStyle = plate;
  ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  ctx.restore();

  // drafting construction: polar grid and the horizon the sun rises over
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(pal.ink, 0.05);
  for (const k of [1.2, 1.5, 1.95, 2.6, 3.5]) {
    ctx.beginPath();
    ctx.arc(cx, cy, R * k, 0, TAU);
    ctx.stroke();
  }
  ctx.strokeStyle = rgba(pal.ink, 0.032);
  ctx.beginPath();
  for (let deg = 0; deg < 360; deg += 15) {
    const dx = Math.sin(deg * RAD);
    const dy = -Math.cos(deg * RAD);
    ctx.moveTo(cx + dx * R * 1.03, cy + dy * R * 1.03);
    ctx.lineTo(cx + dx * far, cy + dy * far);
  }
  ctx.stroke();
  ctx.strokeStyle = rgba(pal.ink, 0.11);
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(cx - R * 1.03, cy);
  ctx.moveTo(cx + R * 1.03, cy);
  ctx.lineTo(width, cy);
  ctx.stroke();

  // stars turn once per sidereal day: the solar day plus the year's slow advance
  const night = 1 - day;
  if (night > 0.02) {
    const turn = (p.dayFraction + yearProgress(now).fraction) * TAU;
    ctx.fillStyle = rgba(pal.ink, 1);
    for (const star of stars) {
      const r = R * 1.04 + star.r * (far - R * 1.04);
      ctx.globalAlpha = night * (0.18 + 0.6 * star.m);
      ctx.beginPath();
      ctx.arc(cx + Math.sin(star.a + turn) * r, cy - Math.cos(star.a + turn) * r, 0.5 + star.m * 0.9, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // the shadow: short at noon, stretching off the page toward dawn and dusk
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(shadowAngle);
  const low = 1 - Math.max(0, altitude);
  const length = R * (0.99 + 2.6 * low * low * day);
  const base = R * 0.009;
  const tip = base + length * 0.02;
  for (const [spread, alpha] of [[2.4, 0.22], [1, 0.62]]) {
    const umbra = ctx.createLinearGradient(0, 0, 0, -length);
    umbra.addColorStop(0, `rgba(0,0,0,${alpha * day})`);
    umbra.addColorStop(0.7, `rgba(0,0,0,${alpha * day * 0.55})`);
    umbra.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = umbra;
    ctx.beginPath();
    ctx.moveTo(-base * spread, 0);
    ctx.lineTo(base * spread, 0);
    ctx.lineTo(tip * spread, -length);
    ctx.lineTo(-tip * spread, -length);
    ctx.fill();
  }
  // drafted edges of the shadow by day; a single pale ray by night
  const edge = ctx.createLinearGradient(0, 0, 0, -length);
  edge.addColorStop(0, rgba(pal.deep, 0.55 * day));
  edge.addColorStop(1, rgba(pal.deep, 0));
  ctx.strokeStyle = edge;
  ctx.beginPath();
  ctx.moveTo(-base, 0);
  ctx.lineTo(-tip, -length);
  ctx.moveTo(base, 0);
  ctx.lineTo(tip, -length);
  ctx.stroke();
  ctx.strokeStyle = rgba(pal.ink, 0.3 * night);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -R * 0.99);
  ctx.stroke();
  ctx.restore();
}

// Built around the origin with a root second hand of length 1; `extent` is the farthest tip.
function buildTree(turn, depth) {
  const paths = Array.from({ length: depth + 1 }, () => [new Path2D(), new Path2D(), new Path2D()]);
  let extent = 0;
  const grow = (x, y, heading, scale, d) => {
    for (let hand = 0; hand < 3; hand++) {
      const a = heading + turn[hand];
      const length = HAND_LENGTH[hand] * scale;
      const x2 = x + length * Math.sin(a);
      const y2 = y - length * Math.cos(a);
      paths[d][hand].moveTo(x, y);
      paths[d][hand].lineTo(x2, y2);
      if (d < depth) grow(x2, y2, a, scale * BRANCH_SCALE, d + 1);
      else extent = Math.max(extent, x2 * x2 + y2 * y2);
    }
  };
  grow(0, 0, 0, 1, 0);
  return { paths, extent: Math.sqrt(extent) };
}

let treeDepth = 0;

/** Foreground: engraved scales, the fractal clock, and the markers that ride the rings. */
function drawDial(p) {
  const ctx = dialCtx;
  const size = geo.size;
  const c = size / 2;
  const R = c - 1;
  const small = size < 460;
  const { ink, accent, deep, bg } = pal;
  const a = angles(p);
  const sync = hourSync(p);
  const still = reducedMotion.matches;
  const lift = 1 + sync.e * 0.7;
  const at = (r, deg) => [c + R * r * Math.sin(deg * RAD), c - R * r * Math.cos(deg * RAD)];
  const ray = (path, r1, r2, deg) => {
    const dx = Math.sin(deg * RAD);
    const dy = -Math.cos(deg * RAD);
    path.moveTo(c + R * r1 * dx, c + R * r1 * dy);
    path.lineTo(c + R * r2 * dx, c + R * r2 * dy);
  };
  const stroke = (path, color, alpha, width = 1) => {
    ctx.strokeStyle = rgba(color, Math.min(1, alpha));
    ctx.lineWidth = width;
    ctx.stroke(path);
  };

  ctx.clearRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'butt';

  // ── engraved scales ──
  for (const [r, alpha] of [[0.99, 0.5], [0.955, 0.16], [0.86, 0.5], [0.76, 0.36]]) {
    const circle = new Path2D();
    circle.arc(c, c, R * r, 0, TAU);
    stroke(circle, ink, alpha * lift);
  }

  // outer ring: 24 hours, read by the shadow; ticks already passed today stay lit
  const dayLit = new Path2D();
  const dayDim = new Path2D();
  for (let i = 0; i < 48; i++) {
    ray(i * 7.5 <= a.day ? dayLit : dayDim, i % 2 ? 0.974 : 0.955, 0.99, i * 7.5);
  }
  stroke(dayLit, ink, 0.8);
  stroke(dayDim, ink, 0.26);

  // degree ring: 360°, a longer tick every 6° (one second, one minute), longest every 30° (one hour)
  const fine = new Path2D();
  const lit = new Path2D();
  const dim = new Path2D();
  const cardinal = new Path2D();
  for (let deg = 0; deg < 360; deg += small ? 2 : 1) {
    if (deg % 30 === 0) ray(cardinal, 0.82, 0.86, deg);
    else if (deg % 6 === 0) ray(deg <= a.sec ? lit : dim, 0.836, 0.86, deg);
    else ray(fine, 0.849, 0.86, deg);
  }
  stroke(fine, ink, 0.2);
  stroke(dim, ink, 0.34);
  stroke(lit, ink, 0.95);
  stroke(cardinal, ink, 0.85, 1.4);

  // hour ring
  const hourTicks = new Path2D();
  for (let deg = 0; deg < 360; deg += 6) ray(hourTicks, deg % 30 ? 0.752 : 0.742, 0.76, deg);
  stroke(hourTicks, ink, 0.45);

  // elapsed arcs: the minute along the degree ring, the hour along the hour ring
  for (const [r, deg, color] of [[0.86, a.min, accent], [0.76, a.hour, deep]]) {
    const arc = new Path2D();
    arc.arc(c, c, R * r, -Math.PI / 2, (deg - 90) * RAD);
    stroke(arc, color, 0.95, 2);
  }

  // inscriptions
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(7.5, R * 0.024)}px ${MONO}`;
  for (let h = 0; h < 24; h += small ? 6 : 3) {
    ctx.fillStyle = rgba(ink, h === Math.floor(p.h / 3) * 3 ? 0.9 : 0.5);
    ctx.fillText(pad(h), ...at(0.926, h * 15));
  }
  ctx.fillStyle = rgba(ink, 0.42);
  ctx.font = `${Math.max(7, R * 0.021)}px ${MONO}`;
  for (let deg = 30; deg < 360 && !small; deg += 30) {
    if (deg % 90 === 0) continue; // these bearings belong to the 24-hour numerals
    ctx.fillText(`${deg}°`, ...at(0.896, deg));
  }
  ctx.font = `${Math.max(9, R * 0.038)}px ${SERIF}`;
  for (let h = 1; h <= 12; h++) {
    ctx.fillStyle = rgba(ink, h === (p.h % 12 || 12) ? 0.95 : 0.5);
    ctx.fillText(roman(h), ...at(0.792, h * 30));
  }

  // ── the fractal clock ──
  const depth = small ? 6 : 7;
  if (depth !== treeDepth) {
    treeDepth = depth;
    put('recursion', `DEPTH ${depth + 1} · ${((3 ** (depth + 2) - 3) / 2).toLocaleString('en-US')} HANDS · RATIO ${BRANCH_SCALE}`);
  }
  const tree = buildTree([a.hour * RAD, a.min * RAD, a.sec * RAD], depth);
  // root second hand, as a fraction of R: the whole tree breathes to keep filling the dial
  const unit = Math.min(TREE_REACH / tree.extent, MAX_ROOT_HAND);
  const tones = [deep, accent, ink];
  const weight = clamp(size / 760, 0.7, 1.25);
  // a wavefront leaves the centre on each second and reaches the tips as the next one begins
  const front = still ? -9 : (p.sec % 1) * (depth + 3) - 1;
  const strokeTree = (target, levels, gain) => {
    target.save();
    target.globalCompositeOperation = 'lighter';
    target.lineCap = 'round';
    target.translate(c, c);
    target.scale(R * unit, R * unit);
    for (let d = 0; d < levels; d++) {
      const pulse = 1 + 1.5 * Math.exp(-((front - d) ** 2) / 0.6);
      for (let hand = 0; hand < 3; hand++) {
        const width = (hand === 0 ? 1.7 : 1) * Math.max(0.5, 2.1 * 0.76 ** d) * weight;
        target.strokeStyle = rgba(tones[hand], Math.min(1, (0.9 * 0.72 ** d + 0.045) * pulse * gain));
        target.lineWidth = width / (R * unit);
        target.stroke(tree.paths[d][hand]);
      }
    }
    target.restore();
  };
  strokeTree(ctx, depth + 1, 1);

  // synchronisation: at the top of the hour the tree is a single ray, and its
  // rotations by 360°/n close into perfect radial symmetry. The larger branches
  // are drawn once off-screen and stamped around the dial.
  if (sync.e > 0.004) {
    ghostCtx.clearRect(0, 0, size, size);
    strokeTree(ghostCtx, sync.fold === 60 ? 5 : 6, sync.e * 0.6);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(c, c);
    for (let k = 1; k < sync.fold; k++) {
      ctx.rotate(TAU / sync.fold);
      ctx.drawImage(ghostCanvas, -c, -c, size, size);
    }
    ctx.restore();
  }

  ctx.globalCompositeOperation = 'lighter';
  // a ring leaves the centre when the seconds return to zero
  if (!still && p.sec < 1.6) {
    const t = p.sec / 1.6;
    const ring = new Path2D();
    ring.arc(c, c, R * (0.06 + 0.8 * (1 - (1 - t) ** 3)), 0, TAU);
    stroke(ring, accent, 0.55 * (1 - t), 1.5);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'butt';

  // ── markers riding the rings, with hairlines back to the root hands ──
  const sights = new Path2D();
  [[a.hour, 0.76, 0], [a.min, 0.86, 1], [a.sec, 0.86, 2]].forEach(([deg, r, hand]) => {
    ray(sights, unit * HAND_LENGTH[hand], r, deg);
  });
  stroke(sights, ink, 0.1);

  const wedge = (deg, r, reach, halfWidth, color) => {
    ctx.beginPath();
    ctx.moveTo(...at(r, deg));
    ctx.lineTo(...at(r + reach, deg - halfWidth));
    ctx.lineTo(...at(r + reach, deg + halfWidth));
    ctx.closePath();
    ctx.fillStyle = rgba(color, 1);
    ctx.fill();
  };
  wedge(a.hour, 0.76, -0.028, 1.3, deep);
  wedge(a.min, 0.86, 0.024, 1, accent);
  wedge(a.day, 0.99, -0.03, 0.8, accent);

  // seconds bead, flaring as each second lands
  const flare = still ? 0 : Math.exp(-(p.sec % 1) * 5);
  const [bx, by] = at(0.86, a.sec);
  ctx.fillStyle = rgba(ink, 0.18 + 0.3 * flare);
  ctx.beginPath();
  ctx.arc(bx, by, 4 + 4 * flare, 0, TAU);
  ctx.fill();
  ctx.fillStyle = rgba(ink, 1);
  ctx.beginPath();
  ctx.arc(bx, by, 2.4, 0, TAU);
  ctx.fill();

  // ☉ on the 24-hour ring, opposite the shadow it casts
  const [ox, oy] = at(0.9725, a.day + 180);
  const sunRadius = Math.max(3, R * 0.012);
  ctx.fillStyle = rgba(bg, 1);
  ctx.strokeStyle = rgba(accent, 1);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(ox, oy, sunRadius, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = rgba(accent, 1);
  ctx.beginPath();
  ctx.arc(ox, oy, 1.1, 0, TAU);
  ctx.fill();

  // root hands, drawn solid so the plain analogue reading survives the fractal
  ctx.lineCap = 'round';
  [[a.hour, 0, deep, 3.2], [a.min, 1, accent, 2.2], [a.sec, 2, ink, 1.3]].forEach(([deg, hand, color, width]) => {
    const handPath = new Path2D();
    ray(handPath, 0, unit * HAND_LENGTH[hand], deg);
    stroke(handPath, color, 1, width * weight);
  });
  ctx.fillStyle = rgba(bg, 1);
  ctx.strokeStyle = rgba(ink, 1);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(c, c, 3.5 * weight, 0, TAU);
  ctx.fill();
  ctx.stroke();
}

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
  if (ticked || !reducedMotion.matches) {
    everyFrame(p);
    drawDial(p);
  }
  requestAnimationFrame(frame);
}

buildBinary();
buildRuler('day-ruler', Array.from({ length: 25 }, (_, i) => i / 24), (i) => i % 6 === 0);
buildSigils();
layout();
new ResizeObserver(layout).observe(main);
requestAnimationFrame(frame);
