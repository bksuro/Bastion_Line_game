/**
 * Pure path geometry (agent 3). Tile units throughout; no Phaser.
 */
import type { PathSegmentId, PathWaypoint, TileCoord, Vec2 } from '../types';
import type { PathProjection, SegmentRange } from './mapTypes';

/** Half-width of a bend segment around its bend waypoint, used only when a MapDef has no segment ranges. */
const FALLBACK_BEND_HALF_WIDTH = 2.5;

export function tileKey(tile: TileCoord): string {
  return `${tile.x},${tile.y}`;
}

export function tileCenter(tile: TileCoord): Vec2 {
  return { x: tile.x + 0.5, y: tile.y + 0.5 };
}

/** Cumulative distances for raw polyline points. */
export function cumulativeDistances(points: readonly Vec2[]): number[] {
  const out: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    out.push(total);
  }
  return out;
}

/** Point at a path distance (clamped). */
export function pointAt(path: readonly PathWaypoint[], distance: number): Vec2 {
  const last = path[path.length - 1];
  const d = Math.max(0, Math.min(last.distance, distance));
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (d <= b.distance) {
      const len = b.distance - a.distance;
      const t = len > 0 ? (d - a.distance) / len : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  return { x: last.x, y: last.y };
}

/** Segment at a path distance: the range with start <= d < end; the last range also takes d = pathLength. */
export function segmentAt(segments: readonly SegmentRange[], distance: number): PathSegmentId {
  for (const s of segments) {
    if (distance < s.end) return s.id;
  }
  return segments[segments.length - 1].id;
}

/** Closest point on the polyline; ties keep the smaller path distance. */
export function projectOntoPath(path: readonly PathWaypoint[], pos: Vec2): PathProjection {
  let best: PathProjection = { distance: 0, offset: Infinity, pos: { x: path[0].x, y: path[0].y } };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((pos.x - a.x) * dx + (pos.y - a.y) * dy) / len2)) : 0;
    const p = { x: a.x + dx * t, y: a.y + dy * t };
    const offset = Math.hypot(pos.x - p.x, pos.y - p.y);
    if (offset < best.offset - 1e-9) {
      best = { distance: a.distance + (b.distance - a.distance) * t, offset, pos: p };
    }
  }
  return best;
}

/** Length of the polyline inside a circle (analytic circle/segment intersection per edge). */
export function pathLengthWithin(path: readonly PathWaypoint[], center: Vec2, radius: number): number {
  if (radius <= 0) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    // Solve |a + t*(b-a) - c| = r for t in [0, 1].
    const fx = a.x - center.x;
    const fy = a.y - center.y;
    const A = len * len;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - radius * radius;
    const disc = B * B - 4 * A * C;
    if (disc <= 0) continue;
    const sq = Math.sqrt(disc);
    const t0 = Math.max(0, (-B - sq) / (2 * A));
    const t1 = Math.min(1, (-B + sq) / (2 * A));
    if (t1 > t0) total += (t1 - t0) * len;
  }
  return total;
}

/**
 * Segment ranges for a MapDef that carries none (e.g. a hand-built MapDef in a test): every interior
 * waypoint is a bend whose segment (its tag) spans +-2.5 tiles around it; the stretch before the first
 * bend is 'entrance', between bends 'long_straight', after the last bend 'core_approach'.
 * On the SPEC 2.4 reference layout this gives exactly the SPEC ranges.
 */
export function fallbackSegments(path: readonly PathWaypoint[]): SegmentRange[] {
  const length = path[path.length - 1].distance;
  const bends = path.slice(1, -1);
  const out: SegmentRange[] = [];
  let cursor = 0;
  const push = (id: PathSegmentId, end: number) => {
    const e = Math.min(length, end);
    if (e > cursor) {
      out.push({ id, start: cursor, end: e });
      cursor = e;
    }
  };
  bends.forEach((b, i) => {
    push(i === 0 ? 'entrance' : 'long_straight', b.distance - FALLBACK_BEND_HALF_WIDTH);
    push(b.segment, b.distance + FALLBACK_BEND_HALF_WIDTH);
  });
  push(bends.length === 0 ? 'entrance' : 'core_approach', length);
  if (out.length === 0) out.push({ id: 'entrance', start: 0, end: length });
  return out;
}
