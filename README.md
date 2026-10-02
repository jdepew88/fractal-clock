# Horologium — a fractal time instrument

A homepage whose only job is to show the local date and time. It opens on a flat fractal clock, and from there you can step into the same moment as a three-dimensional object you can travel through. Static HTML, CSS and JavaScript; no framework, no library, no build step, no network requests, no third-party code.

## Run

```sh
npx wrangler dev --ip 0.0.0.0 --port 8787   # serves ./public as Cloudflare Workers static assets
npm test                                     # unit tests for the time, space, mode and calibration logic (node --test)
npm run check                                # syntax check of the browser modules
```

Any static file server pointed at `public/` also works. The page uses ES modules, so it must be served over HTTP rather than opened from disk.

## Two instruments, one clock

The selector under the dial, **Planar 2D ◆ Spatial 3D**, switches between two drawings of the same instant. Both are fed by the same `parts(now)` each frame, so they cannot disagree, and the readings around them (digital time, date, calendar, angular, binary, base 60, day, year, shadow, moon, Unix, Julian Date) stay where they are.

- **Planar** is what the page opens on: the fractal clock on a flat dial, immediately readable.
- **Spatial** is entered on purpose. Its code is not loaded, and no WebGL context is created, until the first time it is chosen. The view starts face-on, as the planar clock was drawn, and turns into depth.

Only the instrument showing is drawn. The other does no drawing work at all until it is chosen again.

### Planar (2D)

- **Fractal clock** — every hand ends in a smaller clock (ratio 0.66 as designed) turned to face along that hand. Heavy branches turn by the hour angle, mid-tone by the minute, pale by the second. The tree is rescaled each frame so its farthest tip touches the same circle. A pulse leaves the centre each second; at `:00` the second-branches align; at the top of an hour all angles are zero, the tree collapses to one ray, and its rotations close into radial symmetry (12-fold, or 60-fold at noon and midnight).
- **Rings** — outer: 24 hours, read by the shadow, with ☉ opposite. Middle: 360°, where the bead is the second and the bright arc the minute (6° each). Inner: twelve hours at 30° each.
- **Shadow** — an abstract sundial, 15° per hour, longest at 06:00 and 18:00. Background colour, light direction and the star field follow the same 24-hour angle.
- **Sigils** — the twelve months stand under the dial; hover one to see its construction lines.

### Spatial (3D)

The present time is applied as three nested rotations, each clockwise about its own axis:

| Unit | Axis | Rate | Drawn |
| --- | --- | --- | --- |
| hours | Z | 30° per hour, one turn in 12 hours | heavy, deepest tone, a soft steady glow |
| minutes | Y | 6° per minute, one turn an hour | plain, the accent tone; swells as each minute turns over |
| seconds | X | 6° per second, one turn a minute | fine, palest tone; answers the pulse of every second |

The three tones are derived from the palette of the hour (`unitTones` in `time-math.js`), so they are always one family. The strokes beside *Hours*, *Minutes* and *Seconds* under the instrument are drawn in the same tones and weights, and serve as the legend. Brightness falls by the octave (each hour → minute → second triple) rather than by the generation, so every third generation is visibly heavy again and the repetition can be read.

- **The tree.** The hour arm turns about Z. It is the axle the minute arms turn about; each minute arm is the axle for the second arms; then hour, minute, second repeat at a smaller scale for twelve generations (ten on small screens). Every arm is perpendicular to the one it grows from, so the only thing time changes is the twist at each joint.
- **NOW.** The tip of the principal hour → minute → second chain is the single point the present time solves to. Its wake shows where it has been: clear for the last seconds, barely visible after a minute, a coil over ten.
- **Three rings.** The hour ring is fixed, with Roman numerals. The minute ring is carried by the hour arm and the second ring by the minute arm, so the three behave as a gimbal; each is tinted with its unit's tone. At a quarter past and a quarter to, the second ring falls into the hour plane (gimbal lock).
- **Alignment.** At `xx:xx:00` every second-twist is zero; at `xx:00:00` the minute-twists are too; at twelve all three are, the rings stand mutually square and the tree is a perfect axis-aligned lattice. None of this is scripted: it is what the rotations do.
- **Midnight and noon.** The tree breathes once a day. At midnight it is a dense core; at noon its ratio reaches 2^(-1/3), where a three-dimensional H-tree exactly fills space, and the face of the lattice is inscribed in the hour ring.

#### Scale

The default view frames the tree itself: its reach sits about 80% of the way to the edge of the dial, whatever size the hour of the day has made it. Everything larger waits further out and arrives as the camera pulls back:

| Pull back to | What appears |
| --- | --- |
| the default view | the tree, NOW, the orbit each hand sweeps; the hour, minute and second rings when the tree is large enough to fill them |
| a little further | the three rings and numerals whole; then the 24-hour ring with ☉ riding it and the gnomon's line opposite |
| further | the moon on its inclined ring, at the mean elongation from the year's sun (tap it for the numbers) |
| *Year* | the year ring in the ecliptic, one tick per day, tilted 23.44°, with the twelve sigils around it |

The day ring is an abstract sundial, the sun's place on the year ring uses uniform motion, and the moon is a mean-lunation approximation good to about a day. None is an ephemeris.

#### Exploring

- **Drag** to orbit, **wheel** (or pinch) to travel through scale, **double-click**, `Esc` or *Overview* to return. Pitch and zoom are limited so the view is always recoverable, and **Planar** is always one tap away.
- On touch screens only a drag that starts on the instrument turns it, and vertical swipes still scroll the page.
- With the instrument focused: arrow keys orbit, `+` / `-` zoom, `Esc` or `Home` returns.
- **Viewpoints** under the instrument: *Overview*, *Hours* (straight down Z, an ordinary clock face), *Minutes* (down the hour arm at the minute dial), *Seconds* (down the minute arm at the seconds dial), *Now* (follows the present point), *Year*.
- **Tap a joint** of the tree to travel to that generation.

## Calibration

Seven scales adjust how the present time is drawn. None of them changes the time, and at their canonical settings the instrument is exactly as designed. Six stand together in the lower left, above the inscription; the hue stands alone in the upper right. One set of settings serves both instruments, so it carries across a change between Planar and Spatial. It lasts as long as the page does: nothing is stored.

| Scale | Range | Canonical | Planar (2D) | Spatial (3D) |
| --- | --- | --- | --- | --- |
| Hour, Minute, Second | 0 – 150 | 100 | brightness, line weight and length of that unit's hands at every level | the same three for that unit's arms in every octave, and the size of the orbit its hand sweeps |
| Iter (iterations) | 3 – 8 | 8 | levels of recursion, 3 to 8 (one fewer on a small dial) | 5, 6, 8, 10, 11 or 12 generations (two fewer on a small screen): about as many arms as the planar clock has hands |
| Ratio | 0.60 – 0.72 | 0.66 | a child clock's size relative to its parent | the day's own ratio raised to the matching power: 0.58 – 0.70 at midnight, 0.75 – 0.83 at noon |
| Spread / Depth | 40 – 150 | 100 | the angle each hand makes with the hand carrying it is narrowed or widened; the three root hands keep their true angles | the tree, its rings and its wake are pressed toward the plane of the hours or drawn out of it |
| Hue | −180° – +180° | 0° | turns the accent, the hour tone and the pale tone of the seconds together | the same tones, on the tree, its rings, the beads and NOW |

- The three hands that tell the time never vanish: at zero influence they dim to just over half and shorten, but stay.
- Above 100 the gains are deliberately gentle (light adds to light), so the densest tree does not burn out.
- Hue is turned in OKLCH, so every tone keeps its lightness and hour, minute and second stay as far apart as the palette of the hour made them. The ground, the text and the engraved scales are not recoloured. The scale reads the resulting hue of the minute tone, which drifts through the day at the canonical setting.
- When any scale is off its canonical place its lozenge fills, its reading takes the accent, and MODIFIED appears on the inscription's line with RESET beside it.
- Keyboard: each scale is a range input (arrows, Page Up/Down, Home, End).
- Under a finger (`pointer: coarse`) each scale is a 44px-tall target. Only its row grows; the ruled line and the lozenge stay the size they are. A swipe that sets off up or down across a scale scrolls the page and leaves the scale where it was.
- A small screen renders less recursion than *Iter* asks for: one level fewer on a dial under 460px, two generations fewer in space on a page under 700px. The Recursion reading then names both numbers, `RENDER DEPTH 7 OF 8` or `RENDER 10 OF 12 GENERATIONS`, with the count of what is actually drawn on the line below. On a full-size screen it reads `DEPTH 8 · 9,840 HANDS · RATIO 0.66` as before.

The limits are in `calibration.js` and were chosen by looking at both instruments at each end, at noon, at midnight and in between.

## Reproducing any state

The instrument reads the real clock. Query parameters place it elsewhere, which is how the special states are tested:

| URL | Effect |
| --- | --- |
| `/` | The planar clock, live |
| `/?mode=3d` | Open on the spatial instrument (`mode=2d` is the default) |
| `/?t=11:59:50` | Today at that time, running: watch the 60-fold noon symmetry form |
| `/?t=11:59:50&mode=3d` | The same ten seconds in space: watch the lattice close |
| `/?t=12:00:00&freeze` | Hold an instant still |
| `/?t=2026-12-21T23:10:00` | Any date and time |
| `/?t=09:41:00&freeze&mode=3d&view=seconds` | Open on a spatial viewpoint: `overview`, `hours`, `minutes`, `seconds`, `now`, `year` |
| `/?t=00:00:00&freeze&mode=3d&cam=40,25,0.6` | Pin the spatial camera: yaw°, pitch°, and the world radius that fills the dial |
| `/?cal=40,100,150,6,0.70,60,-120` | Open on a calibration: hour, minute, second, iterations, ratio, depth, hue. An empty place keeps its canonical value (`cal=,,,5`) |

`cal` is only read: moving a scale does not rewrite the address. `view` and `cam` belong to the spatial instrument, so a link that carries either opens it even without `mode=3d`; `mode=2d` overrides that. Switching instruments rewrites `mode` in the address bar and leaves every other parameter alone, so a reload returns to the same instrument.

For automated checks, `#instrument` exposes `data-mode`, and in the spatial instrument `#dial` exposes `data-view`, `data-fit`, `data-yaw` and `data-pitch`.

## Performance notes

- One instrument draws at a time. During the 0.7 s cross-fade both do; afterwards the hidden one is skipped entirely.
- The planar dial is redrawn about 30 times a second and its background once a second.
- The spatial geometry is static. The tree's 8,190 arms are instances whose positions the vertex shader derives from three angles, so time costs a few uniforms per frame and no geometry is rebuilt. Drawing is capped near 30 frames a second while only time moves and follows the display while the camera moves. Generations too small to see from the current distance, and scales the camera has not reached, are not drawn.
- Moving a scale redraws the instrument showing at the next frame, also while time is frozen; the planar background is redrawn only when its colours change. No geometry is rebuilt for the spatial tree: the calibration reaches it as uniforms. When the scale is released the pacing above resumes.
- Both stop entirely when nothing can change (`&freeze`, hidden tab), and drop to one frame a second under `prefers-reduced-motion`, which also replaces the cross-fade and camera travel with cuts.

## Layout

```
public/
  index.html      markup for the readings around the instrument
  styles.css      layout and typography; colours are CSS variables driven by the time of day
  clock.js        time source, DOM readings, the choice of instrument, main loop
  mode.js         which instrument to open, read from and written to the query string (unit-tested)
  calibration.js  the seven scales: limits, canonical values, what each means to both instruments, hue (unit-tested)
  planar.js       the 2D instrument: sky canvas (sundial) and dial canvas (fractal)
  space.js        the 3D instrument: WebGL 2 shaders, static geometry, camera, pointer/touch/keyboard control
  space-math.js   pure geometry: time as rotation, the tree walk, scale, camera and projection (unit-tested)
  engraving.js    stroke geometry for numerals and month sigils in space (unit-tested)
  time-math.js    pure time arithmetic and palette (unit-tested)
  glyphs.js       SVG generators: month sigils, moon disc, cuneiform digits
  _headers        Content-Security-Policy and friends for Workers static assets
test/             node:test suites
wrangler.jsonc    assets-only Worker configuration
```
