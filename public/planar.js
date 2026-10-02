// The planar instrument: the fractal clock drawn on a flat dial, on the ground a
// sundial's shadow crosses. Two 2D canvases: the sky behind the page, redrawn
// once a second, and the dial, redrawn as the hands sweep.

import { TAU, angles, clamp, roman, smoothstep, solarAltitude, yearProgress } from './time-math.js';
import { planarLevels, warp } from './calibration.js';

const RAD = Math.PI / 180;
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

// Fractal: every hand ends in a child clock, scaled by the calibrated ratio and turned to face along the hand.
const HAND_LENGTH = [0.55, 0.8, 1]; // hour, minute, second
const TREE_REACH = 0.72; // of the dial radius: the tree is scaled so its farthest tip lands here
const MAX_ROOT_HAND = 0.56; // of the dial radius: limit on that scaling when the tree folds up small

const pad = (n) => String(n).padStart(2, '0');
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/**
 * Builds the planar instrument on its two canvases. `frame(now, p, palette, sync)`
 * draws whatever has changed; nothing is drawn while it is not active. `tuning`
 * is the calibration (see calibration.js), replaced through `tune()`.
 */
export function createPlanar({ sky, canvas, main, dial, reducedMotion, tuning }) {
  let pal = null;
  let active = false;
  let stale = true; // the canvases need sizing before the next draw
  let dirty = true;
  let retuned = false; // the calibration changed: the dial is redrawn at the next frame, the sky only if its colours moved
  let lastSky = '';
  let lastDrawn = null;
  let lastDraw = 0;

  let geo = null;
  let skyCtx = null;
  let dialCtx = null;
  const ghostCanvas = document.createElement('canvas');
  let ghostCtx = null;

  function fit(canvas, width, height, maxDpr) {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function layout() {
    stale = false;
    const m = main.getBoundingClientRect();
    const d = dial.getBoundingClientRect();
    geo = {
      width: m.width,
      height: m.height,
      size: d.width,
      cx: d.left - m.left + d.width / 2,
      cy: d.top - m.top + d.height / 2,
    };
    // The sky spans the whole document on small screens; keep its backing store modest.
    skyCtx = fit(sky, geo.width, geo.height, geo.width * geo.height > 2.2e6 ? 1 : 2);
    dialCtx = fit(canvas, geo.size, geo.size, 2);
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
  function buildTree(turn, depth, reach) {
    const paths = Array.from({ length: depth + 1 }, () => [new Path2D(), new Path2D(), new Path2D()]);
    // The three root hands show the true angles. Below them, the angle each hand
    // makes with the hand that carries it is narrowed or widened by the spread.
    const lean = turn.map((angle) => warp(angle, tuning.spread));
    let extent = 0;
    const grow = (x, y, heading, scale, d) => {
      for (let hand = 0; hand < 3; hand++) {
        const a = heading + (d ? lean : turn)[hand];
        const length = reach[hand] * scale;
        const x2 = x + length * Math.sin(a);
        const y2 = y - length * Math.cos(a);
        paths[d][hand].moveTo(x, y);
        paths[d][hand].lineTo(x2, y2);
        if (d < depth) grow(x2, y2, a, scale * tuning.ratio, d + 1);
        else extent = Math.max(extent, x2 * x2 + y2 * y2);
      }
    };
    grow(0, 0, 0, 1, 0);
    return { paths, extent: Math.sqrt(extent) };
  }

  // levels of recursion: the calibrated number, one fewer on a small dial
  const levels = () => planarLevels(tuning.iterations, geo.size < 460);

  /** Foreground: engraved scales, the fractal clock, and the markers that ride the rings. */
  function drawDial(p, sync) {
    const ctx = dialCtx;
    const size = geo.size;
    const c = size / 2;
    const R = c - 1;
    const small = size < 460;
    const { ink, accent, deep, bg } = pal;
    const a = angles(p);
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
    const depth = levels() - 1;
    // each unit's influence: the length and weight of its hands, and their light
    const { light, stature } = tuning;
    const reach = HAND_LENGTH.map((length, hand) => length * stature[hand]);
    const tree = buildTree([a.hour * RAD, a.min * RAD, a.sec * RAD], depth, reach);
    // root second hand, as a fraction of R: the whole tree breathes to keep filling the dial
    const unit = Math.min(TREE_REACH / tree.extent, MAX_ROOT_HAND);
    const tones = [deep, accent, pal.fine];
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
          const alpha = (0.9 * 0.72 ** d + 0.045) * pulse * gain * light[hand];
          if (alpha < 0.004) continue;
          const width = (hand === 0 ? 1.7 : 1) * Math.max(0.5, 2.1 * 0.76 ** d) * weight * stature[hand];
          target.strokeStyle = rgba(tones[hand], Math.min(1, alpha));
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
      strokeTree(ghostCtx, Math.min(depth + 1, sync.fold === 60 ? 5 : 6), sync.e * 0.6);
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
      ray(sights, unit * reach[hand], r, deg);
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
    ctx.fillStyle = rgba(pal.fine, 0.18 + 0.3 * flare);
    ctx.beginPath();
    ctx.arc(bx, by, 4 + 4 * flare, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rgba(pal.fine, 1);
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
    // (and any calibration: they thin and dim with their unit's influence, but stay)
    ctx.lineCap = 'round';
    [[a.hour, 0, deep, 3.2], [a.min, 1, accent, 2.2], [a.sec, 2, pal.fine, 1.3]].forEach(([deg, hand, color, width]) => {
      const handPath = new Path2D();
      ray(handPath, 0, unit * reach[hand], deg);
      stroke(handPath, color, tuning.floor[hand], width * weight * Math.max(0.8, stature[hand]));
    });
    ctx.fillStyle = rgba(bg, 1);
    ctx.strokeStyle = rgba(ink, 1);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(c, c, 3.5 * weight, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }

  /**
   * Draws the sky when the second or its colours change and the dial about 30
   * times a second, and nothing when time stands still. A change of calibration
   * redraws the dial at once.
   */
  function frame(now, p, palette, sync) {
    if (!active) return;
    if (stale) layout();
    pal = palette;
    const time = now.getTime();
    const skyKey = `${Math.floor(time / 1000)}|${pal.bg}|${pal.ink}|${pal.accent}|${pal.deep}`;
    if (skyKey !== lastSky || dirty) {
      lastSky = skyKey;
      drawSky(now, p);
    } else if (!retuned && (time === lastDrawn || performance.now() - lastDraw < 30)) {
      return;
    }
    dirty = false;
    retuned = false;
    lastDrawn = time;
    lastDraw = performance.now();
    drawDial(p, sync);
  }

  return {
    frame,
    resize() {
      stale = true;
      dirty = true;
    },
    setActive(on) {
      active = on;
      dirty = true;
    },
    /** Takes a new calibration; the next frame draws it, whether or not time is moving. */
    tune(next) {
      tuning = next;
      retuned = true;
    },
    describe() {
      if (stale) layout();
      const depth = levels();
      // `full` is what the calibration asks for; a small dial renders one level fewer
      return { depth, full: planarLevels(tuning.iterations, false), hands: (3 ** (depth + 1) - 3) / 2, ratio: tuning.ratio };
    },
  };
}
