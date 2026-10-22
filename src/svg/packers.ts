/**
 * Rectangle packing methods. Each one takes rectangles (already including the gap between parts)
 * and a bin, and returns where every rectangle goes, or null when it does not fit. Rectangles may
 * be turned by 90 degrees. The rectangles are placed in the order given.
 */

import type { PackingAlgorithm } from '../models/types';
export type { PackingAlgorithm };

export interface Size {
  w: number;
  h: number;
}

export interface Placement {
  x: number;
  y: number;
  rotated: boolean;
}

export type Packer = (items: Size[], binW: number, binH: number) => Array<Placement | null>;

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The ways a rectangle can lie: as given, and (if it is not square) turned by 90 degrees. */
function orientations(item: Size): Array<{ w: number; h: number; rotated: boolean }> {
  const out = [{ w: item.w, h: item.h, rotated: false }];
  if (item.w !== item.h) out.push({ w: item.h, h: item.w, rotated: true });
  return out;
}

// ---------------------------------------------------------------------------
// Guillotine: free rectangles that never overlap, split by a straight cut.
// ---------------------------------------------------------------------------

function guillotineScore(w: number, h: number, fr: FreeRect): number {
  if (w > fr.w || h > fr.h) return Infinity;
  // Prefer tight fits that leave little wasted area, with a small preference for a smaller leftover short side.
  const rw = fr.w - w;
  const rh = fr.h - h;
  return rw * rh + Math.min(rw, rh) * 0.001;
}

function guillotineSplit(fr: FreeRect, w: number, h: number): FreeRect[] {
  const result: FreeRect[] = [];
  const rightW = fr.w - w;
  const bottomH = fr.h - h;

  if (fr.w - w > fr.h - h) {
    if (rightW > 0) result.push({ x: fr.x + w, y: fr.y, w: rightW, h: fr.h });
    if (bottomH > 0) result.push({ x: fr.x, y: fr.y + h, w, h: bottomH });
  } else {
    if (bottomH > 0) result.push({ x: fr.x, y: fr.y + h, w: fr.w, h: bottomH });
    if (rightW > 0) result.push({ x: fr.x + w, y: fr.y, w: rightW, h });
  }
  return result;
}

function pruneContained(rects: FreeRect[]): FreeRect[] {
  return rects.filter(a =>
    !rects.some(b =>
      b !== a &&
      b.x <= a.x &&
      b.y <= a.y &&
      b.x + b.w >= a.x + a.w &&
      b.y + b.h >= a.y + a.h,
    ),
  );
}

export const packGuillotine: Packer = (items, binW, binH) => {
  let free: FreeRect[] = [{ x: 0, y: 0, w: binW, h: binH }];
  return items.map(item => {
    let best = Infinity;
    let bestIdx = -1;
    let bestRotated = false;

    free.forEach((fr, i) => {
      for (const o of orientations(item)) {
        const s = guillotineScore(o.w, o.h, fr);
        if (s < best) {
          best = s;
          bestIdx = i;
          bestRotated = o.rotated;
        }
      }
    });
    if (bestIdx < 0) return null;

    const fr = free[bestIdx];
    const w = bestRotated ? item.h : item.w;
    const h = bestRotated ? item.w : item.h;
    free.splice(bestIdx, 1);
    free.push(...guillotineSplit(fr, w, h));
    free = pruneContained(free);
    return { x: fr.x, y: fr.y, rotated: bestRotated };
  });
};

// ---------------------------------------------------------------------------
// MaxRects: keeps every maximal free rectangle, so free areas may overlap.
// Best short side fit: put the item where the smaller leftover side is smallest.
// ---------------------------------------------------------------------------

function intersects(a: FreeRect, b: FreeRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Cuts `placed` out of `fr`, returning the (up to four) maximal rectangles that remain. */
function cutOut(fr: FreeRect, placed: FreeRect): FreeRect[] {
  const out: FreeRect[] = [];
  if (placed.x > fr.x) out.push({ x: fr.x, y: fr.y, w: placed.x - fr.x, h: fr.h });
  if (placed.x + placed.w < fr.x + fr.w) {
    out.push({ x: placed.x + placed.w, y: fr.y, w: fr.x + fr.w - (placed.x + placed.w), h: fr.h });
  }
  if (placed.y > fr.y) out.push({ x: fr.x, y: fr.y, w: fr.w, h: placed.y - fr.y });
  if (placed.y + placed.h < fr.y + fr.h) {
    out.push({ x: fr.x, y: placed.y + placed.h, w: fr.w, h: fr.y + fr.h - (placed.y + placed.h) });
  }
  return out;
}

export const packMaxRects: Packer = (items, binW, binH) => {
  let free: FreeRect[] = [{ x: 0, y: 0, w: binW, h: binH }];
  return items.map(item => {
    let bestShort = Infinity;
    let bestLong = Infinity;
    let best: { fr: FreeRect; w: number; h: number; rotated: boolean } | null = null;

    for (const fr of free) {
      for (const o of orientations(item)) {
        if (o.w > fr.w || o.h > fr.h) continue;
        const leftoverA = fr.w - o.w;
        const leftoverB = fr.h - o.h;
        const short = Math.min(leftoverA, leftoverB);
        const long = Math.max(leftoverA, leftoverB);
        if (short < bestShort || (short === bestShort && long < bestLong)) {
          bestShort = short;
          bestLong = long;
          best = { fr, w: o.w, h: o.h, rotated: o.rotated };
        }
      }
    }
    if (!best) return null;

    const placed: FreeRect = { x: best.fr.x, y: best.fr.y, w: best.w, h: best.h };
    const next: FreeRect[] = [];
    for (const fr of free) {
      if (intersects(fr, placed)) next.push(...cutOut(fr, placed));
      else next.push(fr);
    }
    free = pruneContained(next);
    return { x: placed.x, y: placed.y, rotated: best.rotated };
  });
};

// ---------------------------------------------------------------------------
// Skyline: remembers only the top edge of what has been placed, lowest position first.
// ---------------------------------------------------------------------------

interface SkylineNode {
  x: number;
  y: number;
  w: number;
}

/** The height a w x h rectangle would rest at if its left edge sat on node `i`, or -1 if it does not fit. */
function skylineRestHeight(skyline: SkylineNode[], i: number, w: number, h: number, binW: number, binH: number): number {
  const x = skyline[i].x;
  if (x + w > binW) return -1;
  let y = skyline[i].y;
  let remaining = w;
  for (let j = i; remaining > 0; j++) {
    if (j >= skyline.length) return -1;
    y = Math.max(y, skyline[j].y);
    if (y + h > binH) return -1;
    remaining -= skyline[j].w;
  }
  return y;
}

function skylineAdd(skyline: SkylineNode[], i: number, x: number, y: number, w: number, h: number): void {
  skyline.splice(i, 0, { x, y: y + h, w });

  // The new level covers part of the nodes that follow it; trim or drop them.
  for (let j = i + 1; j < skyline.length; j++) {
    const prev = skyline[j - 1];
    const cur = skyline[j];
    if (cur.x >= prev.x + prev.w) break;
    const shrink = prev.x + prev.w - cur.x;
    cur.x += shrink;
    cur.w -= shrink;
    if (cur.w > 0) break;
    skyline.splice(j, 1);
    j--;
  }

  // Merge neighbours that ended up at the same height.
  for (let j = 0; j < skyline.length - 1; j++) {
    if (skyline[j].y === skyline[j + 1].y) {
      skyline[j].w += skyline[j + 1].w;
      skyline.splice(j + 1, 1);
      j--;
    }
  }
}

export const packSkyline: Packer = (items, binW, binH) => {
  const skyline: SkylineNode[] = [{ x: 0, y: 0, w: binW }];
  return items.map(item => {
    let bestTop = Infinity;
    let bestX = Infinity;
    let best: { i: number; x: number; y: number; w: number; h: number; rotated: boolean } | null = null;

    for (let i = 0; i < skyline.length; i++) {
      for (const o of orientations(item)) {
        const y = skylineRestHeight(skyline, i, o.w, o.h, binW, binH);
        if (y < 0) continue;
        const top = y + o.h;
        const x = skyline[i].x;
        if (top < bestTop || (top === bestTop && x < bestX)) {
          bestTop = top;
          bestX = x;
          best = { i, x, y, w: o.w, h: o.h, rotated: o.rotated };
        }
      }
    }
    if (!best) return null;

    skylineAdd(skyline, best.i, best.x, best.y, best.w, best.h);
    return { x: best.x, y: best.y, rotated: best.rotated };
  });
};

export const PACKERS: Record<PackingAlgorithm, Packer> = {
  guillotine: packGuillotine,
  maxrects: packMaxRects,
  skyline: packSkyline,
};

export const PACKING_LABELS: Record<PackingAlgorithm, string> = {
  guillotine: 'Guillotine',
  maxrects: 'MaxRects',
  skyline: 'Skyline',
};
