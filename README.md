# Horologium — a fractal time instrument

A homepage whose only job is to show the local date and time, and which turns that moment into a three-dimensional object you can travel through. Static HTML, CSS and JavaScript with one WebGL 2 canvas; no framework, no library, no build step, no network requests, no third-party code.

## Run

```sh
npx wrangler dev --ip 0.0.0.0 --port 8787   # serves ./public as Cloudflare Workers static assets
npm test                                     # unit tests for the time and space arithmetic (node --test)
npm run check                                # syntax check of the browser modules
```

Any static file server pointed at `public/` also works. The page uses ES modules, so it must be served over HTTP rather than opened from disk.

## How time becomes space

The present time is applied as three nested rotations, each clockwise about its own axis:

| Unit | Axis | Rate |
| --- | --- | --- |
| hours | Z | 30° per hour, one turn in 12 hours |
| minutes | Y | 6° per minute, one turn an hour |
| seconds | X | 6° per second, one turn a minute |

- **The tree.** The hour arm turns about Z. It is the axle the minute arms turn about; each minute arm is the axle for the second arms; then hour, minute, second repeat at a smaller scale for twelve generations (ten on small screens). Every arm is perpendicular to the one it grows from, so the only thing time changes is the twist at each joint.
- **NOW.** The tip of the principal hour → minute → second chain is the single point the present time solves to. Its wake shows where it has been: clear for the last seconds, barely visible after a minute, a coil over ten.
- **Three rings.** The hour ring is fixed, with Roman numerals. The minute ring is carried by the hour arm and the second ring by the minute arm, so the three behave as a gimbal. At a quarter past and a quarter to, the second ring falls into the hour plane (gimbal lock).
- **Alignment.** At `xx:xx:00` every second-twist is zero; at `xx:00:00` the minute-twists are too; at twelve all three are, the rings stand mutually square and the tree is a perfect axis-aligned lattice. None of this is scripted: it is what the rotations do.
- **Midnight and noon.** The tree breathes once a day. At midnight it is a dense core; at noon its ratio reaches 2^(-1/3), where a three-dimensional H-tree exactly fills space.
- **Day.** The outer 24-hour ring lies in the hour plane. ☉ rides it once a day, overhead at noon, and the gnomon's line falls opposite. Light arrives from the same side. This is an abstract sundial, not a solar ephemeris.
- **Year.** Far outside, a ring of one tick per day lies in the ecliptic, tilted 23.44° so that it crosses the hour plane at the equinoxes. The sun's position on it uses uniform motion (approximate). The twelve month sigils stand around it.
- **Moon.** A phase disc on a slightly inclined ring, standing at the mean elongation from the year ring's sun. It is a mean-lunation approximation, good to about a day; tap it for the numbers.

## Exploring

- **Drag** to orbit, **wheel** (or pinch) to travel through scale, **double-click**, `Esc` or *Overview* to return. Pitch and zoom are limited so the view is always recoverable.
- On touch screens only a drag that starts on the instrument turns it, and vertical swipes still scroll the page.
- With the instrument focused: arrow keys orbit, `+` / `-` zoom, `Esc` or `Home` returns.
- **Viewpoints** under the instrument: *Overview*, *Hours* (straight down Z, an ordinary clock face), *Minutes* (down the hour arm at the minute dial), *Seconds* (down the minute arm at the seconds dial), *Now* (follows the present point), *Year*.
- **Tap a joint** of the tree to travel to that generation.

## Reproducing any state

The instrument reads the real clock. Query parameters place it elsewhere, which is how the special states are tested:

| URL | Effect |
| --- | --- |
| `/?t=11:59:50` | Today at that time, running: watch the lattice close at noon |
| `/?t=12:00:00&freeze` | Hold an instant still |
| `/?t=2026-12-21T23:10:00` | Any date and time |
| `/?t=09:41:00&freeze&view=seconds` | Open on a viewpoint: `overview`, `hours`, `minutes`, `seconds`, `now`, `year` |
| `/?t=00:00:00&freeze&cam=40,25,0.6` | Pin the camera: yaw°, pitch°, and the world radius that fills the dial |

The dial element also exposes `data-view`, `data-fit`, `data-yaw` and `data-pitch` for automated checks.

## Performance notes

Geometry is static. The tree's 8,190 arms are instances whose positions the vertex shader derives from three angles, so time costs a few uniforms per frame and no geometry is rebuilt. Drawing is capped near 30 frames a second while only time moves, follows the display while the camera moves, stops entirely when nothing can change (`&freeze`, hidden tab), and drops to one frame a second under `prefers-reduced-motion`. Generations too small to see from the current distance are not drawn.

## Layout

```
public/
  index.html      markup for the readings around the instrument
  styles.css      layout and typography; colours are CSS variables driven by the time of day
  clock.js        time source, DOM readings, main loop
  space.js        WebGL 2 scene: shaders, static geometry, camera, pointer/touch/keyboard control
  space-math.js   pure geometry: time as rotation, the tree walk, camera and projection (unit-tested)
  engraving.js    stroke geometry for numerals and month sigils in space (unit-tested)
  time-math.js    pure time arithmetic (unit-tested)
  glyphs.js       SVG generators: month sigil, moon disc, cuneiform digits
  _headers        Content-Security-Policy and friends for Workers static assets
test/             node:test suites
wrangler.jsonc    assets-only Worker configuration
```
