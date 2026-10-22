import { describe, expect, it } from 'vitest';
import { PACKERS, packGuillotine, type PackingAlgorithm, type Size } from '../svg/packers';

const ALGORITHMS = Object.keys(PACKERS) as PackingAlgorithm[];

/** Small deterministic random numbers, so a failure can be reproduced. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function extent(item: Size, rotated: boolean): Size {
  return rotated ? { w: item.h, h: item.w } : item;
}

/** Checks a packing result: everything inside the bin, nothing overlapping, rotations only for non-squares. */
function expectValid(items: Size[], result: ReturnType<typeof packGuillotine>, binW: number, binH: number, label: string): void {
  expect(result, label).toHaveLength(items.length);
  const boxes: Array<{ x: number; y: number; w: number; h: number; i: number }> = [];
  result.forEach((spot, i) => {
    if (!spot) return;
    const { w, h } = extent(items[i], spot.rotated);
    if (spot.rotated) expect(items[i].w, `${label}: item ${i} is square`).not.toBe(items[i].h);
    expect(spot.x, `${label}: item ${i} left`).toBeGreaterThanOrEqual(0);
    expect(spot.y, `${label}: item ${i} top`).toBeGreaterThanOrEqual(0);
    expect(spot.x + w, `${label}: item ${i} right`).toBeLessThanOrEqual(binW + 1e-9);
    expect(spot.y + h, `${label}: item ${i} bottom`).toBeLessThanOrEqual(binH + 1e-9);
    boxes.push({ x: spot.x, y: spot.y, w, h, i });
  });
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const p = boxes[a];
      const q = boxes[b];
      const overlap = p.x < q.x + q.w - 1e-9 && p.x + p.w > q.x + 1e-9 && p.y < q.y + q.h - 1e-9 && p.y + p.h > q.y + 1e-9;
      expect(overlap, `${label}: items ${p.i} and ${q.i} overlap`).toBe(false);
    }
  }
}

describe.each(ALGORITHMS)('%s packer', (name) => {
  const pack = PACKERS[name];

  it('keeps every part inside the bin and apart from the others (random parts)', () => {
    const rand = mulberry32(7);
    for (let round = 0; round < 60; round++) {
      const items: Size[] = Array.from({ length: 4 + Math.floor(rand() * 16) }, () => ({
        w: 5 + rand() * 90,
        h: 5 + rand() * 90,
      }));
      const binW = 100 + rand() * 300;
      const binH = 100 + rand() * 300;
      expectValid(items, pack(items, binW, binH), binW, binH, `${name} round ${round}`);
    }
  });

  it('returns one answer per part, in the order given', () => {
    const items: Size[] = [{ w: 10, h: 10 }, { w: 500, h: 500 }, { w: 20, h: 5 }];
    const out = pack(items, 100, 100);
    expect(out).toHaveLength(3);
    expect(out[0]).not.toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).not.toBeNull();
  });

  it('puts nothing in an empty bin and leaves a part that is too big unplaced', () => {
    expect(pack([], 100, 100)).toEqual([]);
    expect(pack([{ w: 101, h: 101 }], 100, 100)).toEqual([null]);
  });

  it('turns a part to make it fit', () => {
    const [spot] = pack([{ w: 10, h: 50 }], 60, 20);
    expect(spot).not.toBeNull();
    expect(spot!.rotated).toBe(true);
  });

  it('does not turn a part that fits as it is', () => {
    const [spot] = pack([{ w: 50, h: 10 }], 60, 20);
    expect(spot!.rotated).toBe(false);
  });

  it('never turns a square', () => {
    const [spot] = pack([{ w: 10, h: 10 }], 60, 20);
    expect(spot!.rotated).toBe(false);
  });

  it('fills a row exactly', () => {
    const items: Size[] = Array.from({ length: 4 }, () => ({ w: 25, h: 10 }));
    const out = pack(items, 100, 10);
    expect(out.every(Boolean)).toBe(true);
    expectValid(items, out, 100, 10, `${name} row`);
  });

  it('fills a bin with four equal quarters', () => {
    const items: Size[] = Array.from({ length: 4 }, () => ({ w: 50, h: 50 }));
    const out = pack(items, 100, 100);
    expect(out.every(Boolean)).toBe(true);
    expectValid(items, out, 100, 100, `${name} quarters`);
  });

  it('gives the same answer every time', () => {
    const items: Size[] = [{ w: 40, h: 30 }, { w: 25, h: 25 }, { w: 60, h: 10 }, { w: 15, h: 45 }];
    expect(pack(items, 120, 80)).toEqual(pack(items, 120, 80));
  });
});
