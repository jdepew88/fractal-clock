# Horologium — a fractal time instrument

A homepage whose only job is to show the local date and time, and which computes that moment a dozen different ways. Static HTML, CSS and JavaScript with two canvases; no framework, no build step, no network requests, no third-party code.

## Run

```sh
npx wrangler dev      # serves ./public as Cloudflare Workers static assets
npm test              # unit tests for the time arithmetic (node --test)
npm run check         # syntax check of the browser modules
```

Any static file server pointed at `public/` also works. The page uses ES modules, so it must be served over HTTP rather than opened from disk.

## Seeing other moments

The instrument reads the real clock. For previewing, a query string starts it elsewhere:

| URL | Effect |
| --- | --- |
| `/?t=11:59:50` | Today at that time, running — watch the 60-fold noon symmetry form |
| `/?t=14:59:55` | Top of an hour: the ordinary 12-fold synchronisation |
| `/?t=2026-12-21T23:10:00` | Any date and time |
| `/?t=06:40:00&freeze` | Hold that instant still |

## What everything means

- **Fractal clock** — every hand ends in a smaller clock (ratio 0.66) turned to face along that hand. Heavy branches turn by the hour angle, mid-tone by the minute, pale by the second. The tree is rescaled each frame so its farthest tip touches the same circle. A pulse leaves the centre each second; at `:00` the second-branches align; at the top of an hour all angles are zero, the tree collapses to one ray, and its rotations close into radial symmetry (12-fold, or 60-fold at noon and midnight).
- **Rings** — outer: 24 hours, read by the shadow, with ☉ opposite. Middle: 360°, where the bead is the second and the bright arc the minute (6° each). Inner: twelve hours at 30° each.
- **Shadow** — an abstract sundial, 15° per hour, longest at 06:00 and 18:00. It is not a solar ephemeris. Background colour, light direction and the star field follow the same 24-hour angle; the stars turn at the sidereal rate.
- **Marks** — angular, binary, base 60 (with Babylonian numerals), day and year progress, mean lunar age, Unix time and Julian Date. Hover, focus or tap any of them for how it is calculated.
- **Calendar** — twelve procedurally drawn sigils (see `public/glyphs.js` for the rules). Symbolic only; months are not lunar months. Hover a sigil to see its construction lines.

The strip of twelve sigils along the bottom edge is the intended seam for future navigation.

## Layout

```
public/
  index.html     markup for the readings around the dial
  styles.css     layout and typography; colours are CSS variables driven by the time of day
  clock.js       time source, DOM readings, sky canvas (sundial) and dial canvas (fractal)
  time-math.js   pure time arithmetic, unit-tested
  glyphs.js      SVG generators: month sigils, moon disc, cuneiform digits
  _headers       Content-Security-Policy and friends for Workers static assets
test/            node:test suite for time-math.js
wrangler.jsonc   assets-only Worker configuration
```
