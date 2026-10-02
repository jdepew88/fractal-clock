// The spatial instrument: a WebGL 2 scene in which the present time is a nested
// rotation (hours about Z, minutes about Y, seconds about X) and the recursive
// tree, its dials, the day ring, the moon and the year ring are all placed by it.
// Geometry is static; time enters as a handful of uniforms and matrices.

import { TAU, clamp, moon as lunar, smoothstep, solarAltitude, yearProgress, roman } from './time-math.js';
import {
  ECLIPTIC, FOCAL, IDENTITY, LUNAR, RADIUS, VIEWS, WAKE_OFFSETS, arm, cameraBasis, clampFit, clampPitch,
  clockAngles, dailySun, distanceFor, matFromQuat, onRing, principal, project, quatFromMat, slerp,
  solarLongitude, treeParams, viewGoal, viewProjection, wakeAlpha,
} from './space-math.js';
import { romanStrokes, sigilStrokes } from './engraving.js';

const INK = 0;
const ACCENT = 1;
const DEEP = 2;

// sprite kinds, matched in the fragment shader
const BEAD = 0;
const SUN = 1;
const GLOW = 2;
const MOON = 3;
const NOW = 4;

// ── shaders ──────────────────────────────────────────────────────────────────
const SEGMENT = `
uniform mat4 uViewProj;
uniform vec2 uViewport;
uniform float uNear;
uniform vec2 uFog;
in vec2 aCorner;
out float vAcross;
out float vHalf;
out vec4 vColor;

// Expands a world-space segment into a screen-space quad of a given pixel width,
// clipping it against the near plane so the camera can travel inside the tree.
vec4 segment(vec3 a, vec3 b, float widthPx, out float shade) {
  vec4 ca = uViewProj * vec4(a, 1.0);
  vec4 cb = uViewProj * vec4(b, 1.0);
  shade = 0.0;
  vAcross = 0.0;
  vHalf = 0.0;
  if (ca.w < uNear && cb.w < uNear) return vec4(2.0, 2.0, 2.0, 1.0);
  if (ca.w < uNear) ca = mix(ca, cb, (uNear - ca.w) / (cb.w - ca.w));
  else if (cb.w < uNear) cb = mix(cb, ca, (uNear - cb.w) / (ca.w - cb.w));
  vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * uViewport;
  float len = length(d);
  vec2 dir = len > 1e-5 ? d / len : vec2(1.0, 0.0);
  vec4 c = aCorner.x < 0.5 ? ca : cb;
  float w = max(widthPx, 1.0);
  float reach = w * 0.5 + 1.0;
  vAcross = aCorner.y * reach;
  vHalf = w * 0.5;
  shade = min(widthPx, 1.0) * (1.0 - 0.6 * smoothstep(uFog.x, uFog.y, c.w));
  vec2 ndc = c.xy / c.w + vec2(-dir.y, dir.x) * (aCorner.y * reach * 2.0) / uViewport;
  return vec4(ndc * c.w, c.z, c.w);
}
`;

// One step of the recursion, shared by the tree and the wake.
const TURN = `
mat3 turn(int unit, float c, float s) {
  if (unit == 0) return mat3(c, -s, 0.0, s, c, 0.0, 0.0, 0.0, 1.0);
  if (unit == 1) return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}
vec3 armOf(mat3 frame, int unit) {
  return unit == 0 ? frame[1] : unit == 1 ? frame[0] : frame[2];
}
`;

const TREE_VS = `#version 300 es
precision highp float;
${SEGMENT}
${TURN}
in float aPath;
in float aGeneration;
uniform vec3 uCos;
uniform vec3 uSin;
uniform float uRatio;
uniform float uL0;
uniform vec3 uTones[3];
uniform vec3 uEmphasis;
uniform float uFront;
uniform float uFocal;
uniform float uDpr;
uniform float uGain;
uniform float uDust; // extra light on the finest generations, strongest at midnight

void main() {
  mat3 frame = mat3(1.0);
  vec3 tip = vec3(0.0);
  vec3 base = tip;
  float len = uL0;
  float path = aPath;
  int generation = int(aGeneration + 0.5);
  for (int i = 0; i < 16; i++) {
    if (i > generation) break;
    int unit = i - (i / 3) * 3;
    float flip = 1.0 - 2.0 * mod(path, 2.0);
    path = floor(path * 0.5);
    frame = frame * turn(unit, uCos[unit] * flip, uSin[unit] * flip);
    base = tip;
    tip += armOf(frame, unit) * len;
    if (i < generation) len *= uRatio;
  }
  int unit = generation - (generation / 3) * 3;
  bool hand = aPath < 0.5 && generation < 3;

  float depth = max((uViewProj * vec4((base + tip) * 0.5, 1.0)).w, uNear);
  float lengthPx = len * uFocal / depth;
  float width = clamp(lengthPx * 0.03, 0.8 * uDpr, 3.2 * uDpr) * (hand ? 1.8 : 1.0);
  float shade;
  gl_Position = segment(base, tip, width, shade);

  float pulse = 1.0 + 1.4 * exp(-pow(uFront - aGeneration, 2.0) / 0.7);
  float alpha = (0.92 * pow(0.8, aGeneration) + 0.07 + uDust) * pulse * uEmphasis[unit] * uGain;
  alpha *= smoothstep(0.25, 1.6, lengthPx);
  vec3 tone = uTones[unit == 0 ? 2 : unit == 1 ? 1 : 0];
  if (hand) {
    tone = mix(tone, uTones[0], 0.5);
    alpha = max(alpha, 0.9);
  }
  vColor = vec4(tone, min(alpha, 1.0) * shade);
}
`;

const WAKE_VS = `#version 300 es
precision highp float;
${SEGMENT}
${TURN}
in vec3 aWake; // seconds ago at each end, brightness
uniform vec3 uAngles;
uniform float uRatio;
uniform float uL0;
uniform vec3 uTones[3];
uniform float uDpr;

vec3 nowAt(float dt) {
  vec3 a = uAngles - dt * vec3(0.00014544410, 0.0017453293, 0.10471976);
  mat3 frame = mat3(1.0);
  vec3 tip = vec3(0.0);
  float len = uL0;
  for (int unit = 0; unit < 3; unit++) {
    frame = frame * turn(unit, cos(a[unit]), sin(a[unit]));
    tip += armOf(frame, unit) * len;
    len *= uRatio;
  }
  return tip;
}

void main() {
  float shade;
  gl_Position = segment(nowAt(aWake.x), nowAt(aWake.y), 1.5 * uDpr, shade);
  vColor = vec4(mix(uTones[2], uTones[1], aWake.z), aWake.z * shade);
}
`;

const LINE_VS = `#version 300 es
precision highp float;
${SEGMENT}
in vec3 aA;
in vec3 aB;
in vec4 aStyle; // tone, alpha, width in px, position along its ring (0..1)
uniform mat4 uModel;
uniform vec3 uTones[3];
uniform float uLit;
uniform float uDim;
uniform float uGain;
uniform float uDpr;

void main() {
  float shade;
  gl_Position = segment((uModel * vec4(aA, 1.0)).xyz, (uModel * vec4(aB, 1.0)).xyz, aStyle.z * uDpr, shade);
  float lit = mix(uDim, 1.0, step(aStyle.w, uLit));
  vColor = vec4(uTones[int(aStyle.x + 0.5)], min(1.0, aStyle.y * lit * uGain) * shade);
}
`;

const LINE_FS = `#version 300 es
precision mediump float;
in float vAcross;
in float vHalf;
in vec4 vColor;
out vec4 color;
void main() {
  float a = vColor.a * clamp(vHalf + 0.5 - abs(vAcross), 0.0, 1.0);
  color = vec4(vColor.rgb * a, a);
}
`;

const SPRITE_VS = `#version 300 es
precision highp float;
uniform mat4 uViewProj;
uniform vec2 uViewport;
uniform float uNear;
uniform vec3 uTones[3];
in vec2 aCorner;
in vec3 aPos;
in vec4 aLook; // diameter in px, tone, alpha, kind
in float aParam;
out vec2 vUv;
out vec4 vColor;
out float vParam;
flat out int vKind;

void main() {
  vUv = vec2(aCorner.x * 2.0 - 1.0, aCorner.y);
  vColor = vec4(uTones[int(aLook.y + 0.5)], aLook.z);
  vKind = int(aLook.w + 0.5);
  vParam = aParam;
  vec4 c = uViewProj * vec4(aPos, 1.0);
  if (c.w < uNear) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = vec4((c.xy / c.w + vUv * aLook.x / uViewport) * c.w, c.z, c.w);
}
`;

const SPRITE_FS = `#version 300 es
precision mediump float;
in vec2 vUv;
in vec4 vColor;
in float vParam;
flat in int vKind;
out vec4 color;

float band(float x, float width) { return 1.0 - smoothstep(0.0, width, abs(x)); }

void main() {
  float r = length(vUv);
  float a;
  if (vKind == ${BEAD}) {
    a = 1.0 - smoothstep(0.55, 1.0, r);
  } else if (vKind == ${SUN}) {
    a = max(band(r - 0.78, 0.14), 1.0 - smoothstep(0.14, 0.3, r));
  } else if (vKind == ${GLOW}) {
    a = pow(max(0.0, 1.0 - r), 2.4);
  } else if (vKind == ${MOON}) {
    // lit on the right while waxing; the terminator is an ellipse of width cos(phase)
    float limb = sqrt(max(0.0, 0.7225 - vUv.y * vUv.y));
    float x = vParam < 0.5 ? vUv.x : -vUv.x;
    float lit = smoothstep(-0.05, 0.05, x - cos(6.2831853 * vParam) * limb);
    a = max((1.0 - smoothstep(0.8, 0.88, r)) * mix(0.1, 1.0, lit), 0.7 * band(r - 0.86, 0.08));
  } else {
    a = max(1.0 - smoothstep(0.13, 0.2, r), 0.5 * pow(max(0.0, 1.0 - r), 2.0));
    a = max(a, 0.75 * band(r - 0.62, 0.05));
  }
  a *= vColor.a;
  // a little noise keeps the wide, faint glow from banding
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  color = vec4(vColor.rgb * a + step(0.001, a) * grain / 255.0, a);
}
`;

// ── WebGL plumbing ───────────────────────────────────────────────────────────
function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const locations = new Map();
  const at = (name) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name);
  };
  return { program, at };
}

/** A set of instances drawn as one quad each. `layout` lists [attribute, components] in buffer order. */
function createBatch(gl, { program }, corners, layout, data, usage = gl.STATIC_DRAW) {
  const stride = layout.reduce((n, [, size]) => n + size, 0);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  const corner = gl.getAttribLocation(program, 'aCorner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  let offset = 0;
  for (const [name, size] of layout) {
    const location = gl.getAttribLocation(program, name);
    if (location >= 0) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride * 4, offset * 4);
      gl.vertexAttribDivisor(location, 1);
    }
    offset += size;
  }
  gl.bindVertexArray(null);
  const batch = {
    count: data.length / stride,
    draw(count = batch.count) {
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    },
    update(next, count) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, next);
      batch.count = count;
    },
    replace(next) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, next, usage);
      batch.count = next.length / stride;
    },
  };
  return batch;
}

const LINE_LAYOUT = [['aA', 3], ['aB', 3], ['aStyle', 4]];
const SPRITE_LAYOUT = [['aPos', 3], ['aLook', 4], ['aParam', 1]];

// ── engraved geometry ────────────────────────────────────────────────────────
class Lines {
  data = [];

  add(a, b, tone, alpha, width = 1, along = 0) {
    this.data.push(a[0], a[1], a[2] ?? 0, b[0], b[1], b[2] ?? 0, tone, alpha, width, along);
    return this;
  }

  array() {
    return new Float32Array(this.data);
  }
}

// a point on a unit dial: clock angle from +Y, clockwise seen from +Z
const dialPoint = (fraction, r = 1) => [r * Math.sin(fraction * TAU), r * Math.cos(fraction * TAU)];

/** Unit ring with 60 divisions, every fifth longer: serves hours (12 × 5), minutes and seconds alike. */
function dial60() {
  const lines = new Lines();
  for (let i = 0; i < 120; i++) lines.add(dialPoint(i / 120), dialPoint((i + 1) / 120), INK, 0.6, 1.1, i / 120);
  for (let i = 0; i < 60; i++) {
    const major = i % 5 === 0;
    lines.add(dialPoint(i / 60), dialPoint(i / 60, major ? 0.93 : 0.962), INK, major ? 0.9 : 0.5, major ? 1.3 : 1, i / 60);
  }
  return lines.array();
}

function circle(segments = 96) {
  const lines = new Lines();
  for (let i = 0; i < segments; i++) lines.add(dialPoint(i / segments), dialPoint((i + 1) / segments), INK, 0.5, 1, 0);
  return lines.array();
}

/** Roman numerals standing outside the hour ring. */
function numerals() {
  const lines = new Lines();
  for (let h = 1; h <= 12; h++) {
    const [cx, cy] = dialPoint(h / 12, 1.105);
    for (const [x1, y1, x2, y2] of romanStrokes(roman(h))) {
      lines.add([cx + x1 * 0.075, cy + y1 * 0.075], [cx + x2 * 0.075, cy + y2 * 0.075], INK, 0.62, 1, 0);
    }
  }
  return lines.array();
}

/** The 24-hour ring. `along` is the fraction of the day at which the sun passes each mark. */
function dayRing() {
  const lines = new Lines();
  const R = RADIUS.day;
  const sunPasses = (fraction) => (fraction + 0.5) % 1;
  for (let i = 0; i < 144; i++) lines.add(dialPoint(i / 144, R), dialPoint((i + 1) / 144, R), INK, 0.5, 1, sunPasses(i / 144));
  for (let i = 0; i < 48; i++) {
    const reach = i % 12 === 0 ? 0.06 : i % 2 === 0 ? 0.035 : 0.018;
    lines.add(dialPoint(i / 48, R), dialPoint(i / 48, R + reach), INK, i % 2 ? 0.45 : 0.8, 1, sunPasses(i / 48));
  }
  return lines.array();
}

/**
 * The year ring, in its own plane: one tick per day, longer where a month
 * begins, crossed at the equinoxes and solstices, with the twelve sigils
 * standing outside it at mid-month.
 */
function yearRing(year, month) {
  const lines = new Lines();
  const R = RADIUS.year;
  const days = yearProgress(new Date(year, 11, 31)).total;
  const at = (day, r) => [r * Math.cos(solarLongitude(day)), r * Math.sin(solarLongitude(day))];
  for (let i = 0; i < 360; i++) {
    lines.add(at((i / 360) * days, R), at(((i + 1) / 360) * days, R), INK, 0.55, 1, i / 360);
  }
  for (let day = 0; day < days; day++) {
    const first = new Date(year, 0, day + 1).getDate() === 1;
    lines.add(at(day, R), at(day, R - (first ? 0.13 : 0.04)), INK, first ? 0.9 : 0.45, 1, day / days);
  }
  for (let quarter = 0; quarter < 4; quarter++) {
    const a = (quarter * TAU) / 4;
    lines.add([Math.cos(a) * (R - 0.2), Math.sin(a) * (R - 0.2)], [Math.cos(a) * (R + 0.2), Math.sin(a) * (R + 0.2)], ACCENT, 0.8, 1.2, 0);
  }
  for (let m = 1; m <= 12; m++) {
    const middle = (new Date(year, m - 1, 1) - new Date(year, 0, 1)) / 864e5 + new Date(year, m, 0).getDate() / 2;
    const a = solarLongitude(middle);
    const up = [Math.cos(a), Math.sin(a)];
    const right = [up[1], -up[0]];
    const centre = [up[0] * (R + 0.5), up[1] * (R + 0.5)];
    const place = (x, y) => [centre[0] + (right[0] * x + up[0] * y) * 0.32, centre[1] + (right[1] * x + up[1] * y) * 0.32];
    for (const [x1, y1, x2, y2] of sigilStrokes(m)) {
      lines.add(place(x1, y1), place(x2, y2), m === month ? ACCENT : INK, m === month ? 1 : 0.42, m === month ? 1.3 : 1, 0);
    }
  }
  return lines.array();
}

function treeInstances(generations) {
  const data = [];
  for (let g = 0; g < generations; g++) {
    for (let path = 0; path < 2 ** (g + 1); path++) data.push(path, g);
  }
  return new Float32Array(data);
}

function wakeInstances() {
  const data = [];
  for (let i = 0; i < WAKE_OFFSETS.length - 1; i++) {
    const a = WAKE_OFFSETS[i];
    const b = WAKE_OFFSETS[i + 1];
    data.push(a, b, wakeAlpha((a + b) / 2));
  }
  return new Float32Array(data);
}

function model(frame, scale = 1, at = [0, 0, 0]) {
  return [
    frame[0] * scale, frame[1] * scale, frame[2] * scale, 0,
    frame[3] * scale, frame[4] * scale, frame[5] * scale, 0,
    frame[6] * scale, frame[7] * scale, frame[8] * scale, 0,
    at[0], at[1], at[2], 1,
  ];
}

const wrapAngle = (a) => a - TAU * Math.round(a / TAU);

// ── the instrument ───────────────────────────────────────────────────────────
/**
 * Builds the scene on `canvas`. Returns null when WebGL 2 is unavailable.
 * `frame(now, p, palette, sync)` draws; `setView(name)` moves the camera.
 */
export function createSpace({ canvas, main, dial, labels, reducedMotion, onView, initialView, initialCamera }) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) return null;

  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);

  const treeProgram = createProgram(gl, TREE_VS, LINE_FS);
  const wakeProgram = createProgram(gl, WAKE_VS, LINE_FS);
  const lineProgram = createProgram(gl, LINE_VS, LINE_FS);
  const spriteProgram = createProgram(gl, SPRITE_VS, SPRITE_FS);

  const small = () => main.clientWidth < 700;
  let generations = small() ? 10 : 12;
  const tree = createBatch(gl, treeProgram, corners, [['aPath', 1], ['aGeneration', 1]], treeInstances(12));
  const wake = createBatch(gl, wakeProgram, corners, [['aWake', 3]], wakeInstances());
  const dialBatch = createBatch(gl, lineProgram, corners, LINE_LAYOUT, dial60());
  const circleBatch = createBatch(gl, lineProgram, corners, LINE_LAYOUT, circle());
  const numeralBatch = createBatch(gl, lineProgram, corners, LINE_LAYOUT, numerals());
  const dayBatch = createBatch(gl, lineProgram, corners, LINE_LAYOUT, dayRing());
  const yearBatch = createBatch(gl, lineProgram, corners, LINE_LAYOUT, new Float32Array(10), gl.DYNAMIC_DRAW);
  const looseData = new Float32Array(10 * 8);
  const looseBatch = createBatch(gl, lineProgram, corners, LINE_LAYOUT, looseData, gl.DYNAMIC_DRAW);
  const spriteData = new Float32Array(8 * 16);
  const sprites = createBatch(gl, spriteProgram, corners, SPRITE_LAYOUT, spriteData, gl.DYNAMIC_DRAW);
  let yearKey = '';

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // light adds to light; nothing occludes

  // ── camera ──
  const camera = {
    view: VIEWS.includes(initialView) ? initialView : 'overview',
    branch: null,
    base: quatFromMat(IDENTITY),
    target: [0, 0, 0],
    emphasis: [1, 1, 1],
    yaw: 0,
    pitch: 0,
    fit: 1,
    goalYaw: 0,
    goalPitch: 0,
    goalFit: 1,
    snap: true,
    forced: null, // a fixed yaw, pitch and fit from ?cam=, until the user moves
  };
  let started = false;

  const state = { viewProj: null, chain: null, params: null, angles: null, moonAt: null, width: 1, height: 1 };
  let geometry = { width: 1, height: 1, dpr: 1, size: 1, cx: 0, cy: 0 };
  let lastDrawn = '';
  let dirty = true; // the canvas was cleared or something outside time changed: draw at the next frame regardless
  let lastReal = performance.now();
  let lastDraw = 0;
  let held = 0;
  let moonOpen = false;

  function setView(name, { snap = false, branch = null } = {}) {
    camera.view = name;
    camera.branch = branch;
    camera.snap = snap || reducedMotion.matches;
    camera.forced = null;
    if (state.chain) {
      const goal = viewGoal(name, state.chain, state.params, branch && arm(branch.path, branch.generation, state.angles, state.params));
      if (goal.yaw !== null) {
        camera.yaw = wrapAngle(camera.yaw);
        camera.goalYaw = goal.yaw;
        camera.goalPitch = goal.pitch;
      }
      camera.goalFit = goal.fit;
    }
    held = 20;
    dial.dataset.view = name;
    onView(name);
  }

  function resize() {
    const mainBox = main.getBoundingClientRect();
    const dialBox = dial.getBoundingClientRect();
    const size = dialBox.width;
    const top = dialBox.top - mainBox.top;
    // The scene fills the page on a wide layout; on a stacked one it ends a little below the dial.
    const height = Math.min(mainBox.height, top + size * 1.3);
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (mainBox.width * height * dpr * dpr > 5e6) dpr = Math.sqrt(5e6 / (mainBox.width * height));
    canvas.style.height = `${height}px`;
    labels.style.height = `${height}px`;
    canvas.width = Math.round(mainBox.width * dpr);
    canvas.height = Math.round(height * dpr);
    geometry = { width: mainBox.width, height, dpr, size, cx: dialBox.left - mainBox.left + size / 2, cy: top + size / 2 };
    generations = small() ? 10 : 12;
    dirty = true;
  }

  // ── interaction ──
  const pointers = new Map();
  let gesture = null;

  const explored = () => main.classList.add('has-explored');

  function orbitBy(dx, dy) {
    camera.goalYaw += dx * 0.0055;
    camera.goalPitch = clampPitch(camera.goalPitch + dy * 0.0055);
    camera.yaw = camera.goalYaw;
    camera.pitch = camera.goalPitch;
    camera.forced = null;
    held = 20;
  }

  function zoomBy(factor) {
    camera.goalFit = clampFit(camera.goalFit * factor);
    camera.forced = null;
    held = 20;
  }

  main.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.mark, .modes, button, a')) return;
    // Touch only takes hold on the instrument itself, so the rest of the page scrolls normally.
    if (event.pointerType !== 'mouse' && !dial.contains(event.target)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.pointerType === 'mouse') event.preventDefault(); // no text selection while turning
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) gesture = { x: event.clientX, y: event.clientY, travelled: 0, at: performance.now() };
    try {
      main.setPointerCapture(event.pointerId);
    } catch {
      // synthetic pointers cannot be captured
    }
    main.classList.add('is-turning');
  });

  main.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    if (pointers.size === 1) {
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      gesture.travelled += Math.abs(dx) + Math.abs(dy);
      if (gesture.travelled > 4) {
        orbitBy(dx, dy);
        explored();
      }
    } else if (pointers.size === 2) {
      const [other] = [...pointers].filter(([id]) => id !== event.pointerId).map(([, point]) => point);
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 0 && after > 0) zoomBy(before / after);
      gesture.travelled += 99;
      explored();
    }
    pointers.set(event.pointerId, next);
  });

  function release(event) {
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size === 0) {
      main.classList.remove('is-turning');
      if (event.type === 'pointerup' && gesture.travelled <= 4 && performance.now() - gesture.at < 500) pick(event);
      gesture = null;
    }
  }
  main.addEventListener('pointerup', release);
  main.addEventListener('pointercancel', release);

  main.addEventListener('wheel', (event) => {
    if (event.target.closest('.note')) return;
    // Where the page itself scrolls, the wheel belongs to the page unless Ctrl is held.
    const pageScrolls = document.documentElement.scrollHeight > window.innerHeight + 2;
    if (pageScrolls && !event.ctrlKey) return;
    event.preventDefault();
    zoomBy(Math.exp(clamp(event.deltaY, -120, 120) * 0.0016));
    explored();
  }, { passive: false });

  main.addEventListener('dblclick', (event) => {
    if (!event.target.closest('.mark, .modes, button, a')) setView('overview');
  });

  dial.addEventListener('keydown', (event) => {
    const step = 0.12 / 0.0055;
    const keys = {
      ArrowLeft: () => orbitBy(-step, 0),
      ArrowRight: () => orbitBy(step, 0),
      ArrowUp: () => orbitBy(0, -step),
      ArrowDown: () => orbitBy(0, step),
      '+': () => zoomBy(1 / 1.25),
      '=': () => zoomBy(1 / 1.25),
      '-': () => zoomBy(1.25),
      Escape: () => setView('overview'),
      Home: () => setView('overview'),
    };
    if (keys[event.key]) {
      keys[event.key]();
      explored();
      event.preventDefault();
    }
  });

  // A tap on the moon opens its reading; a tap on a joint of the tree flies to that generation.
  function pick(event) {
    if (!state.viewProj) return;
    const box = main.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const near = (point) => {
      const s = project(state.viewProj, point, geometry.width, geometry.height);
      return s.w > 0 ? Math.hypot(s.x - x, s.y - y) : Infinity;
    };
    if (near(state.moonAt) < 22) {
      moonOpen = !moonOpen;
      dirty = true;
      return;
    }
    let best = null;
    let bestDistance = 24;
    for (let g = 0; g < 6; g++) {
      for (let path = 0; path < 2 ** (g + 1); path++) {
        const d = near(arm(path, g, state.angles, state.params).tip);
        if (d < bestDistance) {
          bestDistance = d;
          best = { path, generation: g };
        }
      }
    }
    if (best) {
      setView('branch', { branch: best });
      explored();
    }
  }

  // ── drawing ──
  function useLines(tones, gainAll) {
    gl.useProgram(lineProgram.program);
    common(lineProgram, tones);
    gl.uniform1f(lineProgram.at('uDim'), 0.32);
    return (batch, matrix, lit = 1, gain = 1) => {
      gl.uniformMatrix4fv(lineProgram.at('uModel'), false, matrix);
      gl.uniform1f(lineProgram.at('uLit'), lit);
      gl.uniform1f(lineProgram.at('uGain'), gain * gainAll);
      batch.draw();
    };
  }

  function common(program, tones) {
    gl.uniformMatrix4fv(program.at('uViewProj'), false, state.viewProj);
    gl.uniform2f(program.at('uViewport'), canvas.width, canvas.height);
    gl.uniform1f(program.at('uNear'), state.near);
    gl.uniform2f(program.at('uFog'), state.fog[0], state.fog[1]);
    gl.uniform3fv(program.at('uTones[0]'), tones);
    gl.uniform1f(program.at('uDpr'), geometry.dpr);
  }

  let spriteCount = 0;
  function sprite(at, diameter, tone, alpha, kind, param = 0) {
    spriteData.set([at[0], at[1], at[2], diameter * geometry.dpr, tone, alpha, kind, param], spriteCount * 8);
    spriteCount++;
  }

  let looseCount = 0;
  function loose(a, b, tone, alpha, width = 1) {
    looseData.set([a[0], a[1], a[2], b[0], b[1], b[2], tone, alpha, width, 0], looseCount * 10);
    looseCount++;
  }

  function place(label, point, dx, dy, visible) {
    const s = visible ? project(state.viewProj, point, geometry.width, geometry.height) : null;
    const show = s && s.w > 0 && s.x > -50 && s.x < geometry.width + 50 && s.y > -20 && s.y < geometry.height + 20;
    label.style.opacity = show ? 1 : 0;
    if (show) label.style.transform = `translate(${(s.x + dx).toFixed(1)}px, ${(s.y + dy).toFixed(1)}px)`;
  }

  /** Advances the camera and draws, unless nothing has changed since the last frame drawn. */
  function frame(now, p, pal, sync) {
    const real = performance.now();
    // nothing below needs to run more than ~30 times a second unless the camera is in motion
    if (started && !dirty && held <= 0 && !pointers.size && real - lastReal < 30) return;
    const dt = Math.min(0.1, (real - lastReal) / 1000);
    lastReal = real;
    const still = reducedMotion.matches;

    const angles = clockAngles(p);
    const params = treeParams(p.dayFraction);
    const chain = principal(angles, params);
    Object.assign(state, { angles, params, chain });
    if (!started) {
      started = true;
      setView(camera.view, { snap: true });
      camera.forced = initialCamera;
    }

    // camera: ease toward the view's goal; tracking views follow their moving joint
    const branch = camera.branch && arm(camera.branch.path, camera.branch.generation, angles, params);
    const goal = viewGoal(camera.view, chain, params, branch);
    const k = camera.snap || still ? 1 : 1 - Math.exp(-dt * 5.5);
    camera.base = slerp(camera.base, quatFromMat(goal.base), k);
    camera.target = camera.target.map((v, i) => v + (goal.target[i] - v) * k);
    camera.emphasis = camera.emphasis.map((v, i) => v + (goal.emphasis[i] - v) * k);
    camera.yaw += (camera.goalYaw - camera.yaw) * k;
    camera.pitch += (camera.goalPitch - camera.pitch) * k;
    camera.fit *= (camera.goalFit / camera.fit) ** k;
    if (camera.forced) Object.assign(camera, camera.forced, { goalYaw: camera.forced.yaw, goalPitch: camera.forced.pitch, goalFit: camera.forced.fit });
    camera.snap = false;
    const settled = Math.abs(camera.goalYaw - camera.yaw) < 1e-3 && Math.abs(camera.goalPitch - camera.pitch) < 1e-3
      && Math.abs(Math.log(camera.goalFit / camera.fit)) < 2e-3
      && Math.hypot(...camera.target.map((v, i) => v - goal.target[i])) < camera.fit * 0.03;
    if (!settled || pointers.size) held = 20;
    const active = held-- > 0;

    // Skip the draw when the scene cannot have changed. While only time moves, about
    // 30 draws a second is plenty; while the camera moves, follow the display up to ~80.
    const signature = `${now.getTime()}|${pal.bg}|${active}`;
    if (!dirty) {
      if (!active && signature === lastDrawn) return;
      if (real - lastDraw < (active ? 12 : 30)) return;
    }
    dirty = false;
    lastDrawn = signature;
    lastDraw = real;

    draw(now, p, pal, sync, still);

    dial.dataset.fit = camera.fit.toFixed(3);
    dial.dataset.yaw = camera.yaw.toFixed(3);
    dial.dataset.pitch = camera.pitch.toFixed(3);
  }

  function draw(now, p, pal, sync, still) {
    const { width, height, dpr, size, cx, cy } = geometry;
    const { angles, params, chain } = state;
    const distance = distanceFor(camera.fit, height, size);
    state.near = Math.max(0.0015, distance * 0.02);
    state.fog = [distance + camera.fit * 0.2, distance + camera.fit * 2.6];
    state.viewProj = viewProjection({
      basis: cameraBasis(matFromQuat(camera.base), camera.yaw, camera.pitch),
      target: camera.target,
      distance,
      aspect: width / height,
      near: state.near,
      far: distance + 80,
      centre: [(cx - width / 2) / (width / 2), -(cy - height / 2) / (height / 2)],
    });
    const focal = (FOCAL * height) / 2; // CSS px per world unit at unit depth
    const tones = new Float32Array([...pal.ink, ...pal.accent, ...pal.deep].map((v) => v / 255));
    const day = smoothstep(-0.2, 0.3, solarAltitude(p.dayFraction));
    const lift = 1 + sync.e * 0.6;
    const l1 = params.l0 * params.ratio;
    const l2 = l1 * params.ratio;
    const year = yearProgress(now);
    const luna = lunar(now);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(pal.bg[0] / 255, pal.bg[1] / 255, pal.bg[2] / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // ── the larger scales: year, moon, day ──
    const key = `${now.getFullYear()}-${now.getMonth()}`;
    if (key !== yearKey) {
      yearKey = key;
      yearBatch.replace(yearRing(now.getFullYear(), now.getMonth() + 1));
    }
    const far = smoothstep(1.3, 2.8, camera.fit); // the year comes forward as the camera pulls back
    const sunLongitude = solarLongitude((year.fraction * year.total));
    const annualSun = onRing(ECLIPTIC, sunLongitude, RADIUS.year);
    const moonAt = onRing(LUNAR, sunLongitude + luna.phase * TAU, RADIUS.moon);
    const sun = dailySun(p.dayFraction);
    state.moonAt = moonAt;

    const line = useLines(tones, 1);
    line(yearBatch, model(ECLIPTIC), year.fraction, 0.16 + 0.84 * far);
    line(circleBatch, model(LUNAR, RADIUS.moon), 1, 0.3 + 0.4 * far);
    // seen from inside the tree, the great rings recede so they do not cut across the view
    const rings = (0.25 + 0.75 * smoothstep(0.12, 0.9, camera.fit)) * lift;
    line(dayBatch, model(IDENTITY), p.dayFraction, 0.8 * rings);

    // ── three nested rings: hours fixed, minutes carried by the hour, seconds by the minute ──
    const minuteFlash = still ? 0 : Math.exp(-p.sec * 2.2);
    line(dialBatch, model(IDENTITY, RADIUS.hour), angles[0] / TAU, 0.95 * rings);
    line(numeralBatch, model(IDENTITY), 1, rings);
    line(dialBatch, model(chain.dials[1], RADIUS.minute), angles[1] / TAU, 0.62 * rings);
    line(dialBatch, model(chain.dials[2], RADIUS.second), angles[2] / TAU, (0.5 + 0.9 * minuteFlash) * rings);
    // the orbits the three hands actually sweep
    line(dialBatch, model(IDENTITY, params.l0), angles[0] / TAU, 0.42);
    line(dialBatch, model(chain.dials[1], l1, chain.arms[0].tip), angles[1] / TAU, 0.5);
    line(dialBatch, model(chain.dials[2], l2, chain.arms[1].tip), angles[2] / TAU, 0.6);

    // loose lines: the gnomon's shadow across the day ring, and the sight from the centre to the annual sun
    looseCount = 0;
    loose([0, 0, 0], sun.map((v) => -v), DEEP, 0.25 + 0.5 * day, 1.6);
    loose([0, 0, 0], sun, ACCENT, 0.12, 1);
    loose([0, 0, 0], annualSun, ACCENT, 0.3 * far, 1);
    loose(moonAt, annualSun, INK, 0.12 * far, 1);
    looseBatch.update(looseData, looseCount);
    line(looseBatch, model(IDENTITY));

    // ── the tree ──
    gl.useProgram(treeProgram.program);
    common(treeProgram, tones);
    gl.uniform3f(treeProgram.at('uCos'), Math.cos(angles[0]), Math.cos(angles[1]), Math.cos(angles[2]));
    gl.uniform3f(treeProgram.at('uSin'), Math.sin(angles[0]), Math.sin(angles[1]), Math.sin(angles[2]));
    gl.uniform1f(treeProgram.at('uRatio'), params.ratio);
    gl.uniform1f(treeProgram.at('uL0'), params.l0);
    gl.uniform3fv(treeProgram.at('uEmphasis'), camera.emphasis);
    gl.uniform1f(treeProgram.at('uFocal'), focal * dpr);
    gl.uniform1f(treeProgram.at('uGain'), lift);
    gl.uniform1f(treeProgram.at('uDust'), 0.16 * (1 - params.expanse));
    // a wavefront leaves the centre on each second and reaches the last generation as the next begins
    gl.uniform1f(treeProgram.at('uFront'), still ? -9 : (p.sec % 1) * (generations + 2) - 1);
    // generations too small to see from here are not drawn at all
    const nearest = Math.max(distance - params.l0 * 3, state.near);
    let visible = 1;
    while (visible < generations && (params.l0 * params.ratio ** visible * focal) / nearest > 0.25) visible++;
    tree.draw(2 ** (visible + 1) - 2);

    // ── the wake of NOW ──
    gl.useProgram(wakeProgram.program);
    common(wakeProgram, tones);
    gl.uniform3fv(wakeProgram.at('uAngles'), angles);
    gl.uniform1f(wakeProgram.at('uRatio'), params.ratio);
    gl.uniform1f(wakeProgram.at('uL0'), params.l0);
    wake.draw();

    // ── beads, sun, moon, NOW ──
    const px = (point, radius, least) => {
      const s = project(state.viewProj, point, width, height);
      return s.w > 0 ? Math.max(least, (2 * radius * focal) / s.w) : 0;
    };
    spriteCount = 0;
    sprite(sun.map((v) => v * 2.6), size * 2.2, ACCENT, 0.05 + 0.16 * day, GLOW);
    // at night the contracted tree gathers light at the centre
    sprite([0, 0, 0], px([0, 0, 0], params.l0 * 2.6, 40), ACCENT, 0.3 * (1 - params.expanse) ** 2, GLOW);
    sprite(sun, px(sun, 0.03, 9), ACCENT, 1, SUN);
    sprite(annualSun, px(annualSun, 0.07, 7), ACCENT, 0.15 + 0.85 * far, SUN);
    sprite(moonAt, px(moonAt, 0.04, 11), INK, 0.95, MOON, luna.phase);
    const hourAt = chain.arms[0].tip.map((v) => (v / params.l0) * RADIUS.hour);
    const minuteAt = column3(chain.arms[1].frame, 0).map((v) => v * RADIUS.minute);
    const secondAt = column3(chain.arms[2].frame, 2).map((v) => v * RADIUS.second);
    sprite(hourAt, 9, DEEP, 1, BEAD);
    sprite(minuteAt, 8, ACCENT, 1, BEAD);
    const tick = still ? 0 : Math.exp(-(p.sec % 1) * 5);
    sprite(secondAt, 7 + 7 * tick, INK, 0.9, BEAD);
    sprite(chain.arms[0].tip, px(chain.arms[0].tip, params.l0 * 0.035, 5), DEEP, 0.9, BEAD);
    sprite(chain.arms[1].tip, px(chain.arms[1].tip, params.l0 * 0.03, 5), ACCENT, 0.9, BEAD);
    sprite([0, 0, 0], 6, INK, 0.9, BEAD);
    sprite(chain.now, px(chain.now, l2 * 0.2, 26) * (1 + 0.25 * tick), INK, 1, NOW);
    gl.useProgram(spriteProgram.program);
    gl.uniformMatrix4fv(spriteProgram.at('uViewProj'), false, state.viewProj);
    gl.uniform2f(spriteProgram.at('uViewport'), canvas.width, canvas.height);
    gl.uniform1f(spriteProgram.at('uNear'), state.near);
    gl.uniform3fv(spriteProgram.at('uTones[0]'), tones);
    sprites.update(spriteData, spriteCount);
    sprites.draw();

    // ── labels that live in space ──
    place(labelNow, chain.now, 14, -18, true);
    labelMoon.textContent = `MOON · ${luna.age.toFixed(1)} d · ${Math.round(luna.illumination * 100)}% lit · mean phase`;
    place(labelMoon, moonAt, 14, -8, moonOpen);
    labelDay.textContent = `DAY ${year.ordinal}`;
    place(labelDay, annualSun, 14, -8, far > 0.5);
  }

  const column3 = (m, i) => [m[i * 3], m[i * 3 + 1], m[i * 3 + 2]];
  const [labelNow, labelMoon, labelDay] = ['NOW', '', ''].map((text) => {
    const label = document.createElement('span');
    label.textContent = text;
    labels.append(label);
    return label;
  });

  canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  dial.dataset.view = camera.view;
  return {
    frame,
    resize,
    setView,
    get view() {
      return camera.view;
    },
    describe: () => ({ generations, arms: 2 ** (generations + 1) - 2, ratio: state.params?.ratio ?? 0 }),
  };
}
