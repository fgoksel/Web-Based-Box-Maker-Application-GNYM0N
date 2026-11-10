/**
 * Common-line cutting: where two parts lie side by side so that part of one's cut outline lies exactly on
 * part of the other's, that stretch is cut once instead of twice.
 *
 * What may be shared. The outlines handed in are the paths the laser follows (kerf and fit already
 * applied, parts already on the sheet). A stretch is shared only when an edge of one part and an edge of
 * another lie on the same horizontal or vertical line, overlap, and have the material on opposite sides:
 * the line then separates the two parts and cutting it once removes exactly the strip that cutting it
 * twice would have removed, so every part keeps its size. Parts that merely lie close to each other, or
 * touch at a corner, share nothing. Two edges with material on the same side that overlap mean two parts
 * overlap; they are reported as `conflicts` and never shared.
 *
 * Tolerance: coordinates closer than SNAP (mm) are the same line. All coordinates are snapped to one
 * representative before anything is compared, so afterwards equal means exactly equal.
 *
 * The result keeps the part outlines out of it: the unique cutting paths are a separate description (open
 * or closed polylines that together cover every cut line exactly once). The caller still has the outlines.
 */

import type { Point2D } from '../models/types';
import { HOME, type Contour } from './cutting';
import { decompose, tooClose, type PlacedShape } from './rectilinear';

export const SNAP = 1e-6;

export interface CutPath {
  /** The vertices in cutting order. A closed path does not repeat its first vertex. */
  points: Point2D[];
  closed: boolean;
}

export interface CommonLine {
  /** Cutting paths that together cover every cut line once. */
  paths: CutPath[];
  /** Length of all outlines added together: what is cut when nothing is shared. */
  totalLength: number;
  /** Length of `paths`. */
  uniqueLength: number;
  /** Length that is cut once instead of twice: the lengths of the shared stretches. */
  sharedLength: number;
  /** Number of stretches shared between two parts. */
  sharedStretches: number;
  /** Places where two edges with material on the same side overlap (parts overlap); never shared. */
  conflicts: number;
}

const dist = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);

/** Maps every value to the first value of its cluster (values within SNAP of a neighbour in the cluster). */
function snapper(values: number[]): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  const rep = new Map<number, number>();
  let start = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > SNAP) start = i;
    rep.set(sorted[i], sorted[start]);
  }
  return v => rep.get(v)!;
}

function signedArea(c: Contour): number {
  let a = 0;
  for (let i = 0; i < c.length; i++) {
    const p = c[i];
    const q = c[(i + 1) % c.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

interface Edge {
  contour: number;
  horizontal: boolean;
  /** The coordinate that is the same along the edge: y for a horizontal edge, x for a vertical one. */
  line: number;
  lo: number;
  hi: number;
  /** Which way the material lies across the line: +1 or -1 along the other axis, as seen from this edge. */
  side: 1 | -1;
}

interface Segment {
  a: Point2D;
  b: Point2D;
}

/** Cuts the interval [lo, hi] by the given sub-intervals (which lie inside it) and returns what is left. */
function subtract(lo: number, hi: number, cuts: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...cuts].sort((p, q) => p[0] - q[0]);
  const out: Array<[number, number]> = [];
  let at = lo;
  for (const [a, b] of sorted) {
    if (a > at) out.push([at, a]);
    at = Math.max(at, b);
  }
  if (at < hi) out.push([at, hi]);
  return out;
}

/**
 * Finds the shared stretches between the outlines and the unique cutting paths. Outlines may be listed in
 * either direction. Edges that are not horizontal or vertical are kept whole and never shared.
 */
export function findCommonLines(contours: Contour[]): CommonLine {
  const xs = snapper(contours.flatMap(c => c.map(p => p.x)));
  const ys = snapper(contours.flatMap(c => c.map(p => p.y)));
  const snapped = contours.map(c => c.map(p => ({ x: xs(p.x), y: ys(p.y) })));

  const totalLength = snapped.reduce((sum, c) => sum + perimeter(c), 0);

  const edges: Edge[] = [];
  const oblique: Segment[] = [];
  snapped.forEach((raw, ci) => {
    // Walk every outline counter-clockwise so the material is always on the left of the walking direction.
    const c = signedArea(raw) >= 0 ? raw : [...raw].reverse();
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      if (a.x === b.x && a.y === b.y) continue;
      if (a.y === b.y) {
        // Walking right with material on the left (above, towards larger y) or left with material below.
        edges.push({ contour: ci, horizontal: true, line: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), side: b.x > a.x ? 1 : -1 });
      } else if (a.x === b.x) {
        // Walking up with material on the left (towards smaller x) or down with material on the right.
        edges.push({ contour: ci, horizontal: false, line: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), side: b.y > a.y ? -1 : 1 });
      } else {
        oblique.push({ a, b });
      }
    }
  });

  // Edges on the same line, grouped.
  const lines = new Map<string, Edge[]>();
  for (const e of edges) {
    const key = `${e.horizontal ? 'h' : 'v'}${e.line}`;
    const list = lines.get(key);
    if (list) list.push(e);
    else lines.set(key, [e]);
  }

  const shared = new Map<Edge, Array<[number, number]>>();
  const sharedSegments: Segment[] = [];
  let conflicts = 0;
  for (const list of lines.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i];
        const q = list[j];
        if (p.contour === q.contour) continue;
        const lo = Math.max(p.lo, q.lo);
        const hi = Math.min(p.hi, q.hi);
        if (hi - lo <= SNAP) continue;
        if (p.side === q.side) {
          conflicts++;
          continue;
        }
        for (const e of [p, q]) {
          const cuts = shared.get(e);
          if (cuts) cuts.push([lo, hi]);
          else shared.set(e, [[lo, hi]]);
        }
        const a = p.horizontal ? { x: lo, y: p.line } : { x: p.line, y: lo };
        const b = p.horizontal ? { x: hi, y: p.line } : { x: p.line, y: hi };
        sharedSegments.push({ a, b });
      }
    }
  }

  // Every edge without its shared stretches, plus each shared stretch once.
  const segments: Segment[] = [...oblique, ...sharedSegments];
  for (const e of edges) {
    for (const [lo, hi] of subtract(e.lo, e.hi, shared.get(e) ?? [])) {
      segments.push(
        e.horizontal ? { a: { x: lo, y: e.line }, b: { x: hi, y: e.line } } : { a: { x: e.line, y: lo }, b: { x: e.line, y: hi } },
      );
    }
  }

  const paths = trails(segments);
  const uniqueLength = segments.reduce((sum, s) => sum + dist(s.a, s.b), 0);
  return {
    paths,
    totalLength,
    uniqueLength,
    sharedLength: sharedSegments.reduce((sum, s) => sum + dist(s.a, s.b), 0),
    sharedStretches: sharedSegments.length,
    conflicts,
  };
}

/**
 * True when two outlines overlap, or when one cannot be checked (it has an edge that is not horizontal or
 * vertical). Checked on the exact shapes, so a part lying across another is found, not only edges on one
 * line. Outlines that only touch are fine.
 */
export function outlinesOverlap(contours: Contour[]): boolean {
  const shapes: PlacedShape[] = [];
  for (const c of contours) {
    const shape = decompose(c);
    if (!shape) return true;
    shapes.push({ shape, x: Math.min(...c.map(p => p.x)), y: Math.min(...c.map(p => p.y)) });
  }
  for (let a = 0; a < shapes.length; a++) {
    for (let b = a + 1; b < shapes.length; b++) if (tooClose(shapes[a], shapes[b], 0)) return true;
  }
  return false;
}

function perimeter(c: Contour): number {
  let len = 0;
  for (let i = 0; i < c.length; i++) len += dist(c[i], c[(i + 1) % c.length]);
  return len;
}

/**
 * Joins the segments into as few paths as it can, each segment used once. Where cut lines meet, a path
 * continues through the meeting; a path starts at a point where an odd number of lines meet when there is
 * one (it must end at another such point), and a loop with no such point is a closed path.
 */
function trails(segments: Segment[]): CutPath[] {
  // Vertices by coordinates (already snapped, so equal means exactly equal).
  const ids = new Map<string, number>();
  const verts: Point2D[] = [];
  const idOf = (p: Point2D): number => {
    const key = `${p.x},${p.y}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = verts.length;
      ids.set(key, id);
      verts.push(p);
    }
    return id;
  };

  const adj: Array<Array<{ to: number; seg: number }>> = [];
  segments.forEach((s, k) => {
    const a = idOf(s.a);
    const b = idOf(s.b);
    while (adj.length < verts.length) adj.push([]);
    adj[a].push({ to: b, seg: k });
    adj[b].push({ to: a, seg: k });
  });

  const used = new Array<boolean>(segments.length).fill(false);
  const left = (v: number) => adj[v].filter(e => !used[e.seg]).length;

  // Walks from `v` along unused segments until none is left at the end; returns the vertices visited.
  const walk = (v: number): number[] => {
    const path = [v];
    for (;;) {
      const e = adj[v].find(x => !used[x.seg]);
      if (!e) return path;
      used[e.seg] = true;
      v = e.to;
      path.push(v);
    }
  };

  // Goes round the lines left over at the places a path passes through. Only used when every point has an
  // even number of lines left, so a walk from one of them always comes back to it.
  const spliceLoops = (path: number[]): void => {
    for (let i = 0; i < path.length; i++) {
      if (left(path[i]) === 0) continue;
      path.splice(i, 1, ...walk(path[i]));
      i--;
    }
  };

  const order = verts.map((_, i) => i);
  const finished: number[][] = [];

  // First the open paths: each starts at a point with an odd number of lines left and ends at another one.
  for (;;) {
    const start = order.find(v => left(v) % 2 === 1);
    if (start === undefined) break;
    finished.push(walk(start));
  }
  // Every point now has an even number of lines left: what is left is loops. Those that touch a path are
  // made part of it; the others are closed paths of their own.
  finished.forEach(spliceLoops);
  for (;;) {
    const start = order.find(v => left(v) > 0);
    if (start === undefined) break;
    const path = walk(start);
    spliceLoops(path);
    finished.push(path);
  }

  return finished.map(path => {
    const closed = path.length > 2 && path[0] === path[path.length - 1];
    const pts = (closed ? path.slice(0, -1) : path).map(v => verts[v]);
    return { points: dropStraight(pts, closed), closed };
  });
}

/** Removes vertices that lie on a straight line between their neighbours. */
function dropStraight(pts: Point2D[], closed: boolean): Point2D[] {
  const n = pts.length;
  if (n < 3) return pts;
  const keep = (i: number): boolean => {
    if (!closed && (i === 0 || i === n - 1)) return true;
    const p = pts[(i - 1 + n) % n];
    const c = pts[i];
    const q = pts[(i + 1) % n];
    return (c.x - p.x) * (q.y - c.y) - (c.y - p.y) * (q.x - c.x) !== 0;
  };
  const out = pts.filter((_, i) => keep(i));
  return out.length >= 2 ? out : pts;
}

export function pathLength(p: CutPath): number {
  let len = 0;
  for (let i = 0; i + 1 < p.points.length; i++) len += dist(p.points[i], p.points[i + 1]);
  if (p.closed && p.points.length > 1) len += dist(p.points[p.points.length - 1], p.points[0]);
  return len;
}

/** The path started at its other end (open) or at another vertex (closed). */
function startedAt(p: CutPath, from: 'first' | 'last' | number): CutPath {
  if (from === 'first') return p;
  if (from === 'last') return { points: [...p.points].reverse(), closed: p.closed };
  return { points: [...p.points.slice(from), ...p.points.slice(0, from)], closed: p.closed };
}

/** Moves with the beam off, from the home position through the start of every path in the order given. */
export function pathsTravel(paths: CutPath[]): number {
  let pos = HOME;
  let travel = 0;
  for (const p of paths) {
    travel += dist(pos, p.points[0]);
    pos = p.closed ? p.points[0] : p.points[p.points.length - 1];
  }
  return travel;
}

/**
 * The paths in an order with little travel: always go to the nearest start still to cut (either end of an
 * open path, the nearest vertex of a closed one), and cut it from there. This is a greedy order, not the
 * best one. If the paths as listed need less travel, they are returned unchanged.
 */
export function orderPaths(paths: CutPath[]): CutPath[] {
  const todo = paths.map((_, i) => i);
  const ordered: CutPath[] = [];
  let pos = HOME;
  while (todo.length) {
    let best = { k: 0, d: Infinity, from: 'first' as 'first' | 'last' | number };
    todo.forEach((pi, k) => {
      const p = paths[pi];
      if (p.closed) {
        p.points.forEach((v, vi) => {
          const d = dist(pos, v);
          if (d < best.d) best = { k, d, from: vi };
        });
      } else {
        const df = dist(pos, p.points[0]);
        const dl = dist(pos, p.points[p.points.length - 1]);
        if (df < best.d) best = { k, d: df, from: 'first' };
        if (dl < best.d) best = { k, d: dl, from: 'last' };
      }
    });
    const chosen = startedAt(paths[todo[best.k]], best.from);
    todo.splice(best.k, 1);
    ordered.push(chosen);
    pos = chosen.closed ? chosen.points[0] : chosen.points[chosen.points.length - 1];
  }
  return pathsTravel(ordered) <= pathsTravel(paths) ? ordered : paths;
}
