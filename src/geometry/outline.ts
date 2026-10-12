import type { Point2D } from '../models/types';

const EPS = 1e-6;

export function outlineBounds(pts: Point2D[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function signedArea(pts: Point2D[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

const same = (a: Point2D, b: Point2D) => Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;

/**
 * Removes duplicate points, zero-width spikes (A,B,A) and collinear points
 * from a closed polygon until nothing more changes.
 */
export function cleanOutline(input: Point2D[]): Point2D[] {
  let pts = input.map(p => ({ ...p }));
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const n = pts.length;
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];
      const cross = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
      if (same(cur, next) || same(prev, next) || Math.abs(cross) < EPS) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return pts;
}

/** Moves every edge of a closed polygon outward by `d` (inward when negative), mitring the corners. */
export function offsetOutline(pts: Point2D[], d: number): Point2D[] {
  if (d === 0 || pts.length < 3) return pts.map(p => ({ ...p }));
  const sign = signedArea(pts) >= 0 ? 1 : -1;
  const n = pts.length;
  const normals = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: (sign * dy) / len, y: (-sign * dx) / len };
  });
  return pts.map((p, i) => {
    const a = normals[(i - 1 + n) % n];
    const b = normals[i];
    const k = d / (1 + a.x * b.x + a.y * b.y);
    return { x: p.x + (a.x + b.x) * k, y: p.y + (a.y + b.y) * k };
  });
}

export function translateOutline(pts: Point2D[], dx: number, dy: number): Point2D[] {
  return pts.map(p => ({ x: p.x + dx, y: p.y + dy }));
}
