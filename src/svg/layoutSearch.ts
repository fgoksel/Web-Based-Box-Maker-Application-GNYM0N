/**
 * Layout search: instead of packing the parts once, largest first, try many placement orders with
 * every packing method and keep the best layout. Equal parts (see partSignature) are tried both
 * together and apart, because lining them up helps on some sheets and not on others.
 *
 * Everything here is deterministic: the orders come from a seeded generator and a fixed list, and a
 * tie always keeps the candidate tried first. The first candidate is always what packing once would
 * have produced, so the search never returns a worse layout than that. The only thing that can change
 * the outcome between runs is the time limit, which is a safety net for very large designs and is
 * reported when it is reached.
 */

import type { LayoutSearchConfig, LayoutSearchReport, Panel, PackingAlgorithm, SheetLayout } from '../models/types';
import { PACKERS, cutOut, intersects, pruneContained, type FreeRect, type Placement, type Size } from './packers';
import { groupParts } from './partSignature';

export const DEFAULT_SEARCH: LayoutSearchConfig = { enabled: false, candidates: 100 };

/** Stops the search after this long, so a huge design cannot freeze the page. */
export const SEARCH_TIME_LIMIT_MS = 2000;

const SEED = 20240611;

/** Methods are tried in this order after the one the user chose, which always goes first. */
const ALGORITHM_ORDER: PackingAlgorithm[] = ['maxrects', 'skyline', 'guillotine'];

/**
 * Compared in the order placedArea (larger is better), extent, fragmentation (smaller is better).
 * `placed` is only reported: when every part fits, all layouts have the same placedArea.
 */
export interface LayoutScore {
  /** Parts that fit on the sheet. */
  placed: number;
  /** Material area of the parts that fit, in mm2. The more of it fits the better, so a big part is not traded for a small one. */
  placedArea: number;
  /** Area of the rectangle from the sheet origin that encloses every part, in mm2. */
  extent: number;
  /** 0 when the free sheet is one open rectangle, towards 1 as it breaks into small pieces. */
  fragmentation: number;
}

const EPS = 1e-6;

/** True when `a` is strictly better than `b`. Equal scores are not "better", so the earlier candidate stays. */
export function isBetter(a: LayoutScore, b: LayoutScore): boolean {
  if (Math.abs(a.placedArea - b.placedArea) > EPS) return a.placedArea > b.placedArea;
  if (Math.abs(a.extent - b.extent) > EPS) return a.extent < b.extent;
  if (Math.abs(a.fragmentation - b.fragmentation) > EPS) return a.fragmentation < b.fragmentation;
  return false;
}

/**
 * Scores a packing. `items` are the rectangles that were packed (already including the gap) and
 * `spots` where each went; the free space is measured inside a binW x binH area.
 */
export function scoreLayout(
  items: Size[],
  spots: Array<Placement | null>,
  binW: number,
  binH: number,
  /** Material area of each item; defaults to the area of its rectangle. */
  areas: number[] = items.map(it => it.w * it.h),
): LayoutScore {
  const rects: FreeRect[] = [];
  let placedArea = 0;
  items.forEach((item, i) => {
    const s = spots[i];
    if (!s) return;
    placedArea += areas[i];
    rects.push({ x: s.x, y: s.y, w: s.rotated ? item.h : item.w, h: s.rotated ? item.w : item.h });
  });

  let maxX = 0;
  let maxY = 0;
  let used = 0;
  let free: FreeRect[] = [{ x: 0, y: 0, w: binW, h: binH }];
  for (const r of rects) {
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
    used += r.w * r.h;
    const next: FreeRect[] = [];
    for (const f of free) {
      if (intersects(f, r)) next.push(...cutOut(f, r));
      else next.push(f);
    }
    free = pruneContained(next);
  }

  const freeArea = binW * binH - used;
  const largest = free.reduce((m, f) => Math.max(m, f.w * f.h), 0);
  const fragmentation = freeArea > EPS ? Math.max(0, 1 - largest / freeArea) : 0;
  return { placed: rects.length, placedArea, extent: maxX * maxY, fragmentation };
}

/** The score of a finished layout, measured the same way the search measures its candidates. */
export function layoutScore(layout: SheetLayout): LayoutScore {
  const { width, height, gap } = layout.config;
  const parts = layout.placed;
  const items = parts.map(pl => ({ w: pl.panel.panelWidth + gap, h: pl.panel.panelHeight + gap }));
  const spots = parts.map(pl => (pl.overflow ? null : { x: pl.x - gap, y: pl.y - gap, rotated: pl.rotated }));
  return scoreLayout(items, spots, width - gap, height - gap, parts.map(pl => pl.panel.panelWidth * pl.panel.panelHeight));
}

/** Small deterministic random numbers (the same sequence for the same seed). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function perimeter(p: Panel): number {
  let sum = 0;
  for (let i = 0; i < p.outline.length; i++) {
    const a = p.outline[i];
    const b = p.outline[(i + 1) % p.outline.length];
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

const SORT_KEYS: Array<(p: Panel) => number> = [
  p => p.panelWidth * p.panelHeight,
  p => Math.max(p.panelWidth, p.panelHeight),
  p => p.panelWidth,
  p => p.panelHeight,
  perimeter,
];

/**
 * Different orders in which to place the panels, as lists of indices into `panels`. The first is the
 * panels as given (largest first, which is what packing once uses). Then each sort key is tried with
 * equal parts kept together and with the parts simply sorted, then seeded shuffles, until `count`
 * different orders exist or no new one can be found.
 */
export function candidateOrders(panels: Panel[], count: number): number[][] {
  const n = panels.length;
  const index = new Map<Panel, number>(panels.map((p, i) => [p, i]));
  const groups = groupParts(panels).map(g => g.members.map(m => index.get(m)!));

  const seen = new Set<string>();
  const orders: number[][] = [];
  const add = (order: number[]): void => {
    if (orders.length >= count) return;
    const key = order.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    orders.push(order);
  };

  add(panels.map((_, i) => i));

  for (const key of SORT_KEYS) {
    const value = (i: number) => key(panels[i]);
    add([...panels.keys()].sort((a, b) => value(b) - value(a) || a - b));
    add(
      [...groups]
        .sort((a, b) => value(b[0]) - value(a[0]) || a[0] - b[0])
        .flat(),
    );
  }

  const rand = mulberry32(SEED + n);
  const shuffle = <T,>(xs: T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  for (let attempt = 0; orders.length < count && attempt < count * 5; attempt++) {
    add(attempt % 2 === 0 ? shuffle(groups).flat() : shuffle([...panels.keys()]));
  }
  return orders;
}

export interface SearchOptions {
  candidates: number;
  /** The method the user chose; it is tried first and wins ties. */
  algorithm: PackingAlgorithm;
  timeLimitMs?: number;
}

export interface SearchResult {
  /** Where every item went, in the order the items were given; null for one that does not fit. */
  spots: Array<Placement | null>;
  report: LayoutSearchReport;
}

/**
 * Packs `items` (which belong to `panels`, one for one) in many orders with every method and returns
 * the best arrangement found.
 */
export function searchLayout(panels: Panel[], items: Size[], binW: number, binH: number, options: SearchOptions): SearchResult {
  const started = Date.now();
  const limit = options.timeLimitMs ?? SEARCH_TIME_LIMIT_MS;
  const algorithms = [options.algorithm, ...ALGORITHM_ORDER.filter(a => a !== options.algorithm)];
  const orders = candidateOrders(panels, Math.max(1, Math.floor(options.candidates)));

  const areas = panels.map(p => p.panelWidth * p.panelHeight);
  let best: { score: LayoutScore; spots: Array<Placement | null>; algorithm: PackingAlgorithm } | null = null;
  let packings = 0;
  let tried = 0;
  let stoppedEarly = false;

  for (const order of orders) {
    if (tried > 0 && Date.now() - started >= limit) {
      stoppedEarly = true;
      break;
    }
    tried++;
    const ordered = order.map(i => items[i]);
    for (const algorithm of algorithms) {
      const packed = PACKERS[algorithm](ordered, binW, binH);
      packings++;
      const score = scoreLayout(ordered, packed, binW, binH, order.map(i => areas[i]));
      if (!best || isBetter(score, best.score)) {
        const spots: Array<Placement | null> = new Array(items.length).fill(null);
        order.forEach((itemIndex, k) => {
          spots[itemIndex] = packed[k];
        });
        best = { score, spots, algorithm };
      }
    }
  }

  return {
    spots: best!.spots,
    report: {
      algorithm: best!.algorithm,
      orders: tried,
      packings,
      milliseconds: Date.now() - started,
      stoppedEarly,
    },
  };
}
