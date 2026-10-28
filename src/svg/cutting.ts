import type { CuttingConfig, Point2D } from '../models/types';

/**
 * Cutting order and time. A laser cuts each closed outline in one go and then moves to the next one
 * with the beam off. The cutting length is fixed by the parts, but the length of those moves ("travel")
 * depends on the order the parts are cut in and on where each outline is started. All distances are in
 * millimetres on the sheet, with the head starting at the sheet's origin.
 */

export type Contour = Point2D[];

export const DEFAULT_CUTTING: CuttingConfig = { optimise: true, cutSpeed: 10, travelSpeed: 200 };

/** The head's starting position: the sheet's origin. */
export const HOME: Point2D = { x: 0, y: 0 };

/** One order of cutting: `order[k]` is the contour cut k-th and `entry[k]` the vertex it is started at. */
export interface CutPlan {
  order: number[];
  entry: number[];
}

const dist = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);

export function contourLength(c: Contour): number {
  let len = 0;
  for (let i = 0; i < c.length; i++) len += dist(c[i], c[(i + 1) % c.length]);
  return len;
}

/** The same outline, started at vertex `start`. */
export function rotateContour(c: Contour, start: number): Contour {
  return [...c.slice(start), ...c.slice(0, start)];
}

/** The contours cut in the order given, each from its first vertex. This is the order without optimisation. */
export function listedPlan(contours: Contour[]): CutPlan {
  return { order: contours.map((_, i) => i), entry: contours.map(() => 0) };
}

/** Length of the moves made without cutting: from the home position to the first start, then from start to start. */
export function planTravel(contours: Contour[], plan: CutPlan): number {
  let pos = HOME;
  let travel = 0;
  plan.order.forEach((ci, k) => {
    const v = contours[ci][plan.entry[k]];
    travel += dist(pos, v);
    pos = v;
  });
  return travel;
}

function nearestVertex(c: Contour, from: Point2D): { index: number; d: number } {
  let index = 0;
  let d = Infinity;
  c.forEach((v, i) => {
    const dv = dist(from, v);
    if (dv < d) {
      d = dv;
      index = i;
    }
  });
  return { index, d };
}

/** Travel of an order when each contour is started at the vertex nearest to where the head is. */
function greedyTravel(contours: Contour[], order: number[]): number {
  let pos = HOME;
  let travel = 0;
  for (const ci of order) {
    const { index, d } = nearestVertex(contours[ci], pos);
    travel += d;
    pos = contours[ci][index];
  }
  return travel;
}

/** Best start vertex for every contour of a fixed order, found by dynamic programming. */
export function bestEntries(contours: Contour[], order: number[]): CutPlan {
  if (order.length === 0) return { order: [], entry: [] };

  // cost[k][v]: shortest travel to start contour order[k] at vertex v; back[k][v]: the vertex chosen before it.
  const first = contours[order[0]];
  let cost = first.map(v => dist(HOME, v));
  const back: number[][] = [first.map(() => -1)];

  for (let k = 1; k < order.length; k++) {
    const prev = contours[order[k - 1]];
    const cur = contours[order[k]];
    const nextCost: number[] = [];
    const nextBack: number[] = [];
    cur.forEach(v => {
      let best = Infinity;
      let from = 0;
      prev.forEach((u, ui) => {
        const c = cost[ui] + dist(u, v);
        if (c < best) {
          best = c;
          from = ui;
        }
      });
      nextCost.push(best);
      nextBack.push(from);
    });
    cost = nextCost;
    back.push(nextBack);
  }

  let v = cost.indexOf(Math.min(...cost));
  const entry = new Array<number>(order.length);
  for (let k = order.length - 1; k >= 0; k--) {
    entry[k] = v;
    v = back[k][v];
  }
  return { order: [...order], entry };
}

/**
 * An order with little travel: nearest-neighbour to build a first order, 2-opt (reversing stretches of
 * the order) to improve it, then the best start vertex for every outline. It never returns more travel
 * than the listed order.
 */
export function optimisedPlan(contours: Contour[]): CutPlan {
  const n = contours.length;
  const listed = listedPlan(contours);
  if (n <= 1) return n === 1 ? bestEntries(contours, [0]) : listed;

  // First order: always go to the contour that is nearest to where the head is.
  const order: number[] = [];
  const left = new Set(contours.map((_, i) => i));
  let pos = HOME;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    let bestV = 0;
    for (const ci of left) {
      const { index, d } = nearestVertex(contours[ci], pos);
      if (d < bestD) {
        bestD = d;
        best = ci;
        bestV = index;
      }
    }
    order.push(best);
    left.delete(best);
    pos = contours[best][bestV];
  }

  // Improve it by reversing stretches while that shortens the travel.
  let current = greedyTravel(contours, order);
  for (let pass = 0; pass < 50; pass++) {
    let improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        const t = greedyTravel(contours, candidate);
        if (t < current - 1e-9) {
          order.splice(0, n, ...candidate);
          current = t;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const plan = bestEntries(contours, order);
  return planTravel(contours, plan) <= planTravel(contours, listed) ? plan : listed;
}

export interface CutStats {
  parts: number;
  /** Total length that is cut, in mm. */
  cutLength: number;
  /** Travel without cutting, in mm, for the listed order and for the optimised one. */
  travelListed: number;
  travelOptimised: number;
  cutSeconds: number;
  travelSecondsListed: number;
  travelSecondsOptimised: number;
  totalSecondsListed: number;
  totalSecondsOptimised: number;
}

export function cutStats(contours: Contour[], settings: CuttingConfig): CutStats {
  const cutLength = contours.reduce((sum, c) => sum + contourLength(c), 0);
  const travelListed = planTravel(contours, listedPlan(contours));
  const travelOptimised = planTravel(contours, optimisedPlan(contours));
  const cutSeconds = cutLength / settings.cutSpeed;
  const travelSecondsListed = travelListed / settings.travelSpeed;
  const travelSecondsOptimised = travelOptimised / settings.travelSpeed;
  return {
    parts: contours.length,
    cutLength,
    travelListed,
    travelOptimised,
    cutSeconds,
    travelSecondsListed,
    travelSecondsOptimised,
    totalSecondsListed: cutSeconds + travelSecondsListed,
    totalSecondsOptimised: cutSeconds + travelSecondsOptimised,
  };
}

/**
 * Length of straight edges that lie exactly on top of an edge of another outline. If parts touch (a gap
 * of 0), such a stretch could be cut once instead of twice, so this is the most that sharing cut lines
 * could save. All edges are along the axes, so only horizontal and vertical edges are compared.
 */
export function sharedLineLength(contours: Contour[]): number {
  const EPS = 1e-6;
  interface Edge { fixed: number; lo: number; hi: number; owner: number }
  const horizontal: Edge[] = [];
  const vertical: Edge[] = [];

  contours.forEach((c, owner) => {
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      if (Math.abs(a.y - b.y) < EPS) horizontal.push({ fixed: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), owner });
      else if (Math.abs(a.x - b.x) < EPS) vertical.push({ fixed: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), owner });
    }
  });

  const overlap = (edges: Edge[]) => {
    let total = 0;
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        const p = edges[i];
        const q = edges[j];
        if (p.owner === q.owner || Math.abs(p.fixed - q.fixed) > EPS) continue;
        total += Math.max(0, Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo));
      }
    }
    return total;
  };

  return overlap(horizontal) + overlap(vertical);
}
