// Procedural SVG: month sigils, lunar discs and Babylonian numerals.

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs, parent) {
  const node = document.createElementNS(NS, name);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  parent?.append(node);
  return node;
}

const f = (n) => +n.toFixed(2);
const pt = (r, deg) => [f(r * Math.sin((deg * Math.PI) / 180)), f(-r * Math.cos((deg * Math.PI) / 180))];

/** Outline of the lit part of a disc of radius r at phase p (0 new, 0.5 full, waxing on the right). */
export function phasePath(p, r) {
  const k = Math.cos(2 * Math.PI * p);
  const rx = f(Math.abs(k) * r);
  const waxing = p < 0.5;
  const crescent = k > 0;
  const limb = waxing ? 1 : 0;
  const terminator = crescent === waxing ? 0 : 1;
  return `M0 ${-r}A${r} ${r} 0 0 ${limb} 0 ${r}A${rx} ${r} 0 0 ${terminator} 0 ${-r}Z`;
}

/**
 * Sigil for month m (1..12). Each is built from the same four rules:
 *   orbit    – a body on a 12-fold orbit, 30° per month from the top
 *   phase    – a central disc whose symbolic phase runs new → full → new over the year
 *   season   – an inscribed triangle: △ barred (spring), △ (summer), ▽ barred (autumn), ▽ (winter)
 *   axis     – equinox months carry a horizon line, solstice months a vertical one
 * The `.construct` layer holds the scaffolding, revealed on hover.
 */
export function monthGlyph(m) {
  const svg = el('svg', { viewBox: '-54 -54 108 108', class: 'glyph', 'aria-hidden': 'true' });
  const phase = (m - 0.5) / 12;
  const season = Math.floor((m % 12) / 3); // 0 winter, 1 spring, 2 summer, 3 autumn
  const up = season === 1 || season === 2;
  const barred = season === 1 || season === 3;

  const scaffold = el('g', { class: 'construct' }, svg);
  for (let i = 0; i < 12; i++) {
    const [x, y] = pt(50, i * 30);
    el('line', { x1: 0, y1: 0, x2: x, y2: y }, scaffold);
  }
  el('circle', { r: 20 }, scaffold);
  el('circle', { r: 50 }, scaffold);
  el('ellipse', { rx: f(Math.abs(Math.cos(2 * Math.PI * phase)) * 14), ry: 14 }, scaffold);

  const ink = el('g', { class: 'ink' }, svg);
  el('circle', { r: 40 }, ink);
  const vertices = (up ? [0, 120, 240] : [180, 300, 60]).map((deg) => pt(40, deg).join(','));
  el('polygon', { points: vertices.join(' ') }, ink);
  if (barred) {
    const y = up ? -22 : 22;
    el('line', { x1: -16, y1: y, x2: 16, y2: y }, ink);
  }
  if (m === 3 || m === 9) {
    el('line', { x1: -52, y1: 0, x2: -14, y2: 0 }, ink);
    el('line', { x1: 14, y1: 0, x2: 52, y2: 0 }, ink);
  }
  if (m === 6 || m === 12) {
    const s = m === 6 ? -1 : 1;
    el('line', { x1: 0, y1: 14 * s, x2: 0, y2: 52 * s }, ink);
    el('line', { x1: -4, y1: 52 * s, x2: 4, y2: 52 * s }, ink);
  }
  el('circle', { r: 14 }, ink);
  el('path', { d: phasePath(phase, 14), class: 'solid' }, ink);
  const [bx, by] = pt(40, (m - 1) * 30);
  el('circle', { cx: bx, cy: by, r: 3.6, class: 'solid' }, ink);
  return svg;
}

/** Small disc showing an actual lunar phase. */
export function moonGlyph(phase) {
  const svg = el('svg', { viewBox: '-16 -16 32 32', class: 'glyph moon', 'aria-hidden': 'true' });
  const ink = el('g', { class: 'ink' }, svg);
  el('circle', { r: 14 }, ink);
  el('path', { d: phasePath(phase, 14), class: 'solid' }, ink);
  return svg;
}

// One Babylonian digit (0..59) drawn into g; returns its advance width.
function cuneiformDigit(g, n) {
  if (n === 0) {
    // Late Babylonian placeholder: two slanted wedges.
    el('path', { d: 'M2 5l6 4M2 12l6 4' }, g);
    return 10;
  }
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  let w = 0;
  for (let t = 0; t < tens; t++) {
    el('path', { d: `M${w + 7} 2L${w} 10L${w + 7} 18` }, g);
    w += 5;
  }
  if (tens) w += 6;
  if (ones) {
    const rows = Math.ceil(ones / 3);
    const rowH = 20 / rows;
    for (let i = 0; i < ones; i++) {
      const x = w + (i % 3) * 6 + 3;
      const y = Math.floor(i / 3) * rowH;
      const head = Math.min(4, rowH * 0.4);
      el('path', { d: `M${x - 2.4} ${f(y)}h4.8L${x} ${f(y + head)}Z`, class: 'solid' }, g);
      el('path', { d: `M${x} ${f(y + head)}V${f(y + rowH - 1.5)}` }, g);
    }
    w += Math.min(ones, 3) * 6;
  }
  return w;
}

/** A sexagesimal number written in Babylonian wedges, one group per digit. */
export function cuneiform(digits) {
  const svg = el('svg', { class: 'cuneiform', 'aria-hidden': 'true' });
  let x = 0;
  for (const n of digits) {
    x += cuneiformDigit(el('g', { transform: `translate(${x} 0)` }, svg), n) + 11;
  }
  svg.setAttribute('viewBox', `-2 -2 ${x - 7} 24`);
  return svg;
}
