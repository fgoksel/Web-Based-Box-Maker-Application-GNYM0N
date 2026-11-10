/**
 * Exact shapes for parts whose outline has only horizontal and vertical edges, which is every part this
 * application makes (finger joints, slots and divider notches are all square). Such an outline is cut
 * into a few rectangles with no approximation, so two parts can be tested against each other by
 * testing rectangles, and the part's real outline, not its bounding box, decides whether they collide.
 *
 * Tolerances: outline coordinates closer than SNAP (mm) are the same line, and two parts count as
 * apart when their distance is at least the gap minus CLEARANCE_EPS (mm), so a part placed exactly one
 * gap from another is accepted despite rounding error.
 */

import type { Point2D } from '../models/types';
import { cleanOutline } from '../geometry/outline';

export const SNAP = 1e-6;
export const CLEARANCE_EPS = 1e-9;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A part as rectangles that together are exactly its outline, with the bounding box starting at (0, 0). */
export interface Shape {
  rects: Rect[];
  w: number;
  h: number;
}

/** A shape standing on the sheet with its bounding box starting at (x, y). */
export interface PlacedShape {
  shape: Shape;
  x: number;
  y: number;
}

const near = (a: number, b: number) => Math.abs(a - b) <= SNAP;

/** Sorted values with those closer than SNAP merged into one. */
function distinct(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (!out.length || !near(out[out.length - 1], v)) out.push(v);
  return out;
}

/**
 * Cuts a closed outline into rectangles, or returns null when it cannot (an edge that is neither
 * horizontal nor vertical, fewer than four points, or no area). The outline must not cross itself and
 * has no holes, which holds for every part of this application.
 *
 * The outline is sliced between each pair of neighbouring y values; inside a slice the polygon is the
 * stretch between pairs of vertical edges. Slices that continue with the same stretch are joined, so a
 * plain rectangle stays one rectangle and a finger-jointed wall becomes a few dozen.
 */
export function decompose(outline: Point2D[]): Shape | null {
  // Repeated points, zero-width spikes and points on a straight line are removed first.
  const cleaned = cleanOutline(outline);
  const n = cleaned.length;
  if (n < 4) return null;

  const minX = Math.min(...cleaned.map(p => p.x));
  const minY = Math.min(...cleaned.map(p => p.y));
  const pts = cleaned.map(p => ({ x: p.x - minX, y: p.y - minY }));

  const verticals: Array<{ x: number; lo: number; hi: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (near(a.x, b.x) && near(a.y, b.y)) continue;
    if (near(a.x, b.x)) verticals.push({ x: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    else if (!near(a.y, b.y)) return null;
  }

  const ys = distinct(pts.map(p => p.y));
  if (ys.length < 2) return null;

  // Stretches [x0, x1] of each slice, then joined with the slice below when they are the same stretch.
  const open: Array<Rect> = [];
  const done: Rect[] = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    const mid = (ys[i] + ys[i + 1]) / 2;
    const xs = verticals.filter(v => v.lo < mid && mid < v.hi).map(v => v.x).sort((a, b) => a - b);
    if (xs.length % 2 !== 0) return null;

    const stretches: Array<[number, number]> = [];
    for (let k = 0; k < xs.length; k += 2) if (xs[k + 1] - xs[k] > SNAP) stretches.push([xs[k], xs[k + 1]]);

    const next: Rect[] = [];
    for (const [x0, x1] of stretches) {
      const j = open.findIndex(r => near(r.x0, x0) && near(r.x1, x1) && near(r.y1, ys[i]));
      if (j >= 0) {
        const r = open.splice(j, 1)[0];
        r.y1 = ys[i + 1];
        next.push(r);
      } else {
        next.push({ x0, y0: ys[i], x1, y1: ys[i + 1] });
      }
    }
    done.push(...open);
    open.length = 0;
    open.push(...next);
  }
  done.push(...open);
  if (!done.length) return null;

  const rects = done.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  return { rects, w: Math.max(...rects.map(r => r.x1)), h: Math.max(...rects.map(r => r.y1)) };
}

export function shapeArea(shape: Shape): number {
  return shape.rects.reduce((sum, r) => sum + (r.x1 - r.x0) * (r.y1 - r.y0), 0);
}

/**
 * The shape turned by `turns` quarter turns (the same turn the sheet layout uses: a point (x, y) goes to
 * (h - y, x)), after optionally mirroring left to right. The bounding box stays at (0, 0).
 */
export function orient(shape: Shape, turns: number, mirror = false): Shape {
  let { rects, w, h } = shape;
  if (mirror) rects = rects.map(r => ({ x0: w - r.x1, y0: r.y0, x1: w - r.x0, y1: r.y1 }));
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    rects = rects.map(r => ({ x0: h - r.y1, y0: r.x0, x1: h - r.y0, y1: r.x1 }));
    [w, h] = [h, w];
  }
  return { rects: [...rects].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0), w, h };
}

/**
 * True when the two parts are closer than `gap`. Distance is measured along the axes (a part is a
 * little bigger than it is), which is never less strict than the straight-line distance, so two parts
 * that pass are at least `gap` apart in every direction. This is also how the rectangle packers use
 * the gap. Bounding boxes are compared first; only parts whose boxes are close are looked at rectangle
 * by rectangle.
 */
export function tooClose(a: PlacedShape, b: PlacedShape, gap: number): boolean {
  const limit = gap - CLEARANCE_EPS;
  const boxDx = Math.max(b.x - (a.x + a.shape.w), a.x - (b.x + b.shape.w));
  const boxDy = Math.max(b.y - (a.y + a.shape.h), a.y - (b.y + b.shape.h));
  if (boxDx >= limit || boxDy >= limit) return false;

  for (const ra of a.shape.rects) {
    for (const rb of b.shape.rects) {
      const dx = Math.max(b.x + rb.x0 - (a.x + ra.x1), a.x + ra.x0 - (b.x + rb.x1));
      const dy = Math.max(b.y + rb.y0 - (a.y + ra.y1), a.y + ra.y0 - (b.y + rb.y1));
      if (dx < limit && dy < limit) return true;
    }
  }
  return false;
}
