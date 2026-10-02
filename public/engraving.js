// Stroke geometry for things engraved on the rings in space: Roman numerals and
// the twelve month sigils. Pure functions returning line segments [x1, y1, x2, y2]
// with y pointing up. The sigils follow the same rules as the SVG ones in glyphs.js.

const TAU = Math.PI * 2;

/** Strokes for a Roman numeral, one unit tall and centred on the origin. */
export function romanStrokes(numeral) {
  const shapes = {
    I: { width: 0.3, lines: [[0.15, 0, 0.15, 1]] },
    V: { width: 0.62, lines: [[0.04, 1, 0.31, 0], [0.31, 0, 0.58, 1]] },
    X: { width: 0.62, lines: [[0.04, 0, 0.58, 1], [0.04, 1, 0.58, 0]] },
  };
  const total = [...numeral].reduce((w, ch) => w + shapes[ch].width, 0);
  const out = [];
  let x = -total / 2;
  for (const ch of numeral) {
    for (const [x1, y1, x2, y2] of shapes[ch].lines) out.push([x + x1, y1 - 0.5, x + x2, y2 - 0.5]);
    x += shapes[ch].width;
  }
  // serif bars above and below, as on an engraved dial
  out.push([-total / 2, 0.5, total / 2, 0.5], [-total / 2, -0.5, total / 2, -0.5]);
  return out;
}

function arc(out, radius, from, to, steps, cx = 0, cy = 0, rx = radius) {
  for (let i = 0; i < steps; i++) {
    const a = from + ((to - from) * i) / steps;
    const b = from + ((to - from) * (i + 1)) / steps;
    out.push([cx + rx * Math.cos(a), cy + radius * Math.sin(a), cx + rx * Math.cos(b), cy + radius * Math.sin(b)]);
  }
}

/**
 * Sigil for month m (1..12), scaled so its orbit circle has radius 40/54.
 * orbit: a body 30° per month clockwise from the top · phase: a disc running
 * new → full → new over the year, hatched where lit · season: △ barred (spring),
 * △ (summer), ▽ barred (autumn), ▽ (winter) · axis: a horizon through equinox
 * months, a vertical through solstice months.
 */
export function sigilStrokes(m) {
  const out = [];
  const clock = (r, deg) => [r * Math.sin((deg * Math.PI) / 180), r * Math.cos((deg * Math.PI) / 180)];
  const phase = (m - 0.5) / 12;
  const season = Math.floor((m % 12) / 3); // 0 winter, 1 spring, 2 summer, 3 autumn
  const up = season === 1 || season === 2;
  const barred = season === 1 || season === 3;

  arc(out, 40, 0, TAU, 40);
  const corners = (up ? [0, 120, 240] : [180, 300, 60]).map((deg) => clock(40, deg));
  corners.forEach((p, i) => out.push([...p, ...corners[(i + 1) % 3]]));
  if (barred) out.push([-16, up ? 22 : -22, 16, up ? 22 : -22]);
  if (m === 3 || m === 9) out.push([-52, 0, -14, 0], [14, 0, 52, 0]);
  if (m === 6 || m === 12) {
    const s = m === 6 ? 1 : -1;
    out.push([0, 14 * s, 0, 52 * s], [-4, 52 * s, 4, 52 * s]);
  }

  // phase disc: outline, terminator, and hatching across the lit part
  arc(out, 14, 0, TAU, 24);
  const k = Math.cos(TAU * phase);
  const side = phase < 0.5 ? 1 : -1;
  arc(out, 14, -Math.PI / 2, Math.PI / 2, 12, 0, 0, 14 * k * side);
  for (let y = -10.5; y <= 10.5; y += 3.5) {
    const half = Math.sqrt(14 * 14 - y * y);
    out.push([side * k * half, y, side * half, y]);
  }

  // the orbiting body
  const [bx, by] = clock(40, (m - 1) * 30);
  arc(out, 3.6, 0, TAU, 8, bx, by);

  return out.map((segment) => segment.map((v) => v / 54));
}
