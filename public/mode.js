// Which instrument the page opens on, read from and written back to the query
// string. Pure, so it runs under node --test.

export const PLANAR = '2d';
export const SPATIAL = '3d';

const RAD = Math.PI / 180;

/**
 * `?mode=2d|3d` chooses the instrument. Without it the page opens planar, except
 * that a link naming a spatial viewpoint or camera (`view=`, `cam=`) still opens
 * the spatial instrument it was made for.
 */
export function initialMode(query) {
  const mode = query.get('mode')?.toLowerCase();
  if (mode === PLANAR || mode === SPATIAL) return mode;
  return query.has('view') || query.has('cam') ? SPATIAL : PLANAR;
}

/** `?cam=yaw,pitch,fit` (degrees, degrees, world radius filling the dial) as a camera, or null. */
export function parseCamera(query) {
  const pinned = /^(-?[\d.]+),(-?[\d.]+),([\d.]+)$/.exec(query.get('cam') ?? '');
  if (!pinned) return null;
  const [yaw, pitch, fit] = pinned.slice(1).map(Number);
  return [yaw, pitch, fit].every(Number.isFinite) && fit > 0 ? { yaw: yaw * RAD, pitch: pitch * RAD, fit } : null;
}

/**
 * The query string that reopens the page in `mode`, keeping every other
 * parameter. The planar default is left unsaid unless a spatial parameter
 * would otherwise imply the spatial instrument.
 */
export function withMode(search, mode) {
  const query = new URLSearchParams(search);
  if (mode === SPATIAL || query.has('view') || query.has('cam')) query.set('mode', mode);
  else query.delete('mode');
  // keep hand-written forms readable: ?t=12:00:00&freeze rather than ?t=12%3A00%3A00&freeze=
  const text = query.toString().replace(/%3A/gi, ':').replace(/%2C/gi, ',').replace(/=(?=&|$)/g, '');
  return text ? `?${text}` : '';
}
