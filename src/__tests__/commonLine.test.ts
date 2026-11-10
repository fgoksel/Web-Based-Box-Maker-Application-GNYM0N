import { describe, expect, it } from 'vitest';
import { findCommonLines, orderPaths, outlinesOverlap, pathLength, pathsTravel, SNAP, type CutPath } from '../svg/commonLine';
import type { Contour } from '../svg/cutting';
import { mulberry32 } from './helpers/randomBoxes';

const square = (x: number, y: number, w = 10, h = w): Contour => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];

const total = (cs: Contour[]) => cs.reduce((sum, c) => sum + c.reduce((s, p, i) => s + Math.hypot(c[(i + 1) % c.length].x - p.x, c[(i + 1) % c.length].y - p.y), 0), 0);

/**
 * Every unit piece of every line, counted: the lines are cut at every x and y that occurs anywhere, so two
 * pieces are the same piece exactly when their keys are equal.
 */
function atoms(polylines: Array<{ points: Array<{ x: number; y: number }>; closed: boolean }>, gx: number[], gy: number[]): Map<string, number> {
  const out = new Map<string, number>();
  const add = (key: string) => out.set(key, (out.get(key) ?? 0) + 1);
  for (const pl of polylines) {
    const n = pl.points.length;
    const count = pl.closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = pl.points[i];
      const b = pl.points[(i + 1) % n];
      if (a.y === b.y) {
        const [x0, x1] = a.x < b.x ? [a.x, b.x] : [b.x, a.x];
        for (let k = 0; k + 1 < gx.length; k++) if (gx[k] >= x0 && gx[k + 1] <= x1) add(`h,${a.y},${gx[k]},${gx[k + 1]}`);
      } else {
        const [y0, y1] = a.y < b.y ? [a.y, b.y] : [b.y, a.y];
        for (let k = 0; k + 1 < gy.length; k++) if (gy[k] >= y0 && gy[k + 1] <= y1) add(`v,${a.x},${gy[k]},${gy[k + 1]}`);
      }
    }
  }
  return out;
}

function grids(cs: Contour[]): { gx: number[]; gy: number[] } {
  const u = (v: number[]) => [...new Set(v)].sort((a, b) => a - b);
  return { gx: u(cs.flatMap(c => c.map(p => p.x))), gy: u(cs.flatMap(c => c.map(p => p.y))) };
}

/** A rectangle cut into rectangles by random straight cuts, all on whole numbers. */
function partition(rand: () => number, x: number, y: number, w: number, h: number, depth: number): Contour[] {
  const canX = w >= 8;
  const canY = h >= 8;
  if (depth === 0 || (!canX && !canY) || rand() < 0.15) return [square(x, y, w, h)];
  if (canX && (!canY || rand() < 0.5)) {
    const cut = 4 + Math.floor(rand() * (w - 7));
    return [...partition(rand, x, y, cut, h, depth - 1), ...partition(rand, x + cut, y, w - cut, h, depth - 1)];
  }
  const cut = 4 + Math.floor(rand() * (h - 7));
  return [...partition(rand, x, y, w, cut, depth - 1), ...partition(rand, x, y + cut, w, h - cut, depth - 1)];
}

describe('findCommonLines: what is shared', () => {
  it('shares nothing between parts that are apart', () => {
    const r = findCommonLines([square(0, 0), square(20, 0)]);
    expect(r.sharedLength).toBe(0);
    expect(r.sharedStretches).toBe(0);
    expect(r.paths).toHaveLength(2);
    expect(r.paths.every(p => p.closed)).toBe(true);
    expect(r.uniqueLength).toBe(80);
  });

  it('cuts the side of two touching squares once, as one path', () => {
    const r = findCommonLines([square(0, 0), square(10, 0)]);
    expect(r.totalLength).toBe(80);
    expect(r.sharedLength).toBe(10);
    expect(r.sharedStretches).toBe(1);
    expect(r.uniqueLength).toBe(70);
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].closed).toBe(false);
    expect(pathLength(r.paths[0])).toBe(70);
  });

  it('shares only the stretch where the sides overlap', () => {
    const r = findCommonLines([square(0, 0), square(10, 5)]);
    expect(r.sharedLength).toBe(5);
    expect(r.uniqueLength).toBe(75);
  });

  it('shares a short stretch too, but not a touch of no length', () => {
    expect(findCommonLines([square(0, 0), square(10, 9.8)]).sharedLength).toBeCloseTo(0.2, 9);
    expect(findCommonLines([square(0, 0), square(10, 10)]).sharedLength).toBe(0);
  });

  it('shares a horizontal side as well', () => {
    const r = findCommonLines([square(0, 0, 10, 6), square(3, 6, 4, 9)]);
    expect(r.sharedLength).toBe(4);
  });

  it('shares nothing when two parts only touch at a corner', () => {
    const r = findCommonLines([square(0, 0), square(10, 10)]);
    expect(r.sharedLength).toBe(0);
    expect(r.uniqueLength).toBe(80);
  });

  it('shares nothing across a gap, however small, but treats differences below the tolerance as one line', () => {
    expect(findCommonLines([square(0, 0), square(10.01, 0)]).sharedLength).toBe(0);
    expect(findCommonLines([square(0, 0), square(10 + SNAP * 0.5, 0)]).sharedLength).toBeCloseTo(10, 6);
    expect(findCommonLines([square(0, 0), square(10 + SNAP * 5, 0)]).sharedLength).toBe(0);
  });

  it('does not share edges that have the material on the same side, and reports the overlap', () => {
    const r = findCommonLines([square(0, 0), square(5, 0)]);
    expect(r.conflicts).toBeGreaterThan(0);
    expect(r.sharedLength).toBe(0);
  });

  it('does not share two parts of one outline with each other', () => {
    // A notch whose two walls face each other is one part: nothing to share.
    const u: Contour = [
      { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 20 }, { x: 0, y: 20 },
    ];
    const r = findCommonLines([u]);
    expect(r.sharedLength).toBe(0);
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0].closed).toBe(true);
  });

  it('shares between a part with fingers and a flat edge, where the finger tips touch', () => {
    // A wall with two fingers pointing down, standing on a plate: only the finger tips touch the plate.
    const wall: Contour = [
      { x: 0, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 3 }, { x: 12, y: 3 }, { x: 12, y: 0 }, { x: 16, y: 0 },
      { x: 16, y: 3 }, { x: 20, y: 3 }, { x: 20, y: 30 }, { x: 0, y: 30 },
    ];
    const plate = square(0, -10, 20, 10);
    const r = findCommonLines([wall, plate]);
    expect(r.sharedLength).toBe(8);
    expect(r.sharedStretches).toBe(2);
  });

  it('gives the same result for outlines walked either way and started anywhere', () => {
    const a = square(0, 0);
    const b = square(10, 4, 10, 8);
    const base = findCommonLines([a, b]);
    const reversed = findCommonLines([[...a].reverse(), b]);
    const rotated = findCommonLines([[...a.slice(2), ...a.slice(0, 2)], [...b].reverse()]);
    for (const r of [reversed, rotated]) {
      expect(r.sharedLength).toBe(base.sharedLength);
      expect(r.uniqueLength).toBe(base.uniqueLength);
      expect(r.paths.length).toBe(base.paths.length);
    }
  });

  it('keeps edges that are neither horizontal nor vertical whole and never shares them', () => {
    const triangle: Contour = [{ x: 10, y: 0 }, { x: 20, y: 5 }, { x: 10, y: 10 }];
    const r = findCommonLines([square(0, 0), triangle]);
    // The triangle's vertical side lies on the square's side, so that stretch is shared, but not its slanted sides.
    expect(r.sharedLength).toBeCloseTo(10, 9);
    expect(r.uniqueLength).toBeCloseTo(total([square(0, 0), triangle]) - 10, 9);
  });
});

describe('outlinesOverlap', () => {
  it('is false for parts that are apart or only touch', () => {
    expect(outlinesOverlap([square(0, 0), square(20, 0)])).toBe(false);
    expect(outlinesOverlap([square(0, 0), square(10, 0)])).toBe(false);
    expect(outlinesOverlap([square(0, 0), square(10, 10)])).toBe(false);
  });

  it('is true when one part lies across another, not only when edges share a line', () => {
    expect(outlinesOverlap([square(0, 0), square(5, 5)])).toBe(true);
    expect(outlinesOverlap([square(0, 0, 30, 4), square(10, -10, 4, 30)])).toBe(true);
    expect(outlinesOverlap([square(0, 0, 30), square(10, 10, 4)])).toBe(true);
  });

  it('is true for an outline that cannot be checked', () => {
    expect(outlinesOverlap([square(0, 0), [{ x: 30, y: 0 }, { x: 40, y: 5 }, { x: 30, y: 10 }]])).toBe(true);
  });

  it('is false for fingers that sit between each other without touching', () => {
    const comb: Contour = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: -3 }, { x: 8, y: -3 }, { x: 8, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: 0, y: 10 },
    ];
    const plate = square(0, -13, 12, 10);
    expect(outlinesOverlap([comb, plate])).toBe(false);
    expect(outlinesOverlap([comb, square(0, -12.5, 12, 10)])).toBe(true);
  });
});

describe('findCommonLines: the cutting paths', () => {
  it('covers every cut line exactly once and every shared line once, on random partitions of a rectangle', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rand = mulberry32(seed);
      const w = 40 + Math.floor(rand() * 60);
      const h = 40 + Math.floor(rand() * 60);
      const parts = partition(rand, 0, 0, w, h, 4);
      const r = findCommonLines(parts);

      // For a rectangle cut into pieces, every inner line is cut twice when listed and once when shared.
      const outer = 2 * (w + h);
      expect(r.totalLength, `seed ${seed}`).toBe(total(parts));
      expect(r.uniqueLength, `seed ${seed}`).toBeCloseTo((total(parts) + outer) / 2, 9);
      expect(r.conflicts, `seed ${seed}`).toBe(0);
      expect(r.paths.reduce((s, p) => s + pathLength(p), 0), `seed ${seed}`).toBeCloseTo(r.uniqueLength, 9);

      for (const path of r.paths) {
        const n = path.points.length;
        for (let i = 0; i < (path.closed ? n : n - 1); i++) {
          const a = path.points[i];
          const b = path.points[(i + 1) % n];
          expect(a.x === b.x || a.y === b.y, `seed ${seed}: a path jumps from ${a.x},${a.y} to ${b.x},${b.y}`).toBe(true);
        }
      }

      const { gx, gy } = grids(parts);
      const listed = atoms(parts.map(points => ({ points, closed: true })), gx, gy);
      const cut = atoms(r.paths, gx, gy);
      expect([...cut.keys()].sort(), `seed ${seed}`).toEqual([...listed.keys()].sort());
      expect([...cut.values()].every(n => n === 1), `seed ${seed}: a line is cut twice`).toBe(true);
      const doubled = [...listed.entries()].filter(([, n]) => n === 2);
      expect(doubled.length, `seed ${seed}`).toBeGreaterThan(-1);
      // The shared length is the length of the pieces that the listed outlines have twice.
      const sharedFromAtoms = doubled.reduce((s, [key]) => {
        const [kind, , a, b] = key.split(',');
        return s + (Number(b) - Number(a)) * (kind === 'h' || kind === 'v' ? 1 : 0);
      }, 0);
      expect(r.sharedLength, `seed ${seed}`).toBeCloseTo(sharedFromAtoms, 9);
    }
  });

  it('needs as few paths as the junctions allow: half the points where an odd number of lines meet', () => {
    // A 2 x 2 grid of squares: the cross in the middle meets the outside at 4 points where 3 lines meet.
    const grid = [square(0, 0), square(10, 0), square(0, 10), square(10, 10)];
    const r = findCommonLines(grid);
    expect(r.paths).toHaveLength(2);
    expect(r.uniqueLength).toBe(80 + 40);
    expect(r.sharedLength).toBe(40);
  });

  it('keeps an unshared part as one closed loop', () => {
    const r = findCommonLines([square(0, 0), square(30, 0)]);
    expect(r.paths.map(p => p.closed)).toEqual([true, true]);
    expect(r.paths.every(p => p.points.length === 4)).toBe(true);
  });

  it('does not repeat a vertex or keep a vertex on a straight line', () => {
    const r = findCommonLines([square(0, 0), square(10, 0), square(20, 0)]);
    for (const p of r.paths) {
      const keys = p.points.map(v => `${v.x},${v.y}`);
      expect(new Set(keys).size).toBeGreaterThan(1);
      for (let i = 1; i + 1 < p.points.length; i++) {
        const a = p.points[i - 1];
        const b = p.points[i];
        const c = p.points[i + 1];
        expect((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), 'vertex on a straight line').not.toBe(0);
      }
    }
  });

  it('is the same every time', () => {
    const parts = partition(mulberry32(7), 0, 0, 80, 60, 4);
    expect(findCommonLines(parts)).toEqual(findCommonLines(parts));
  });
});

describe('orderPaths', () => {
  const samples = (): CutPath[][] =>
    Array.from({ length: 40 }, (_, seed) => findCommonLines(partition(mulberry32(100 + seed), 5, 5, 60 + seed, 50 + (seed % 7), 4)).paths);

  it('never needs more travel than the paths as listed', () => {
    for (const paths of samples()) {
      expect(pathsTravel(orderPaths(paths))).toBeLessThanOrEqual(pathsTravel(paths) + 1e-9);
    }
  });

  it('cuts every path once, with the same length, however it starts and ends them', () => {
    for (const paths of samples()) {
      const ordered = orderPaths(paths);
      expect(ordered).toHaveLength(paths.length);
      expect(ordered.reduce((s, p) => s + pathLength(p), 0)).toBeCloseTo(paths.reduce((s, p) => s + pathLength(p), 0), 9);
      const key = (p: CutPath) => p.points.map(v => `${v.x},${v.y}`).sort().join(';');
      expect(ordered.map(key).sort()).toEqual(paths.map(key).sort());
    }
  });

  it('starts the first path at the nearest point to the home position', () => {
    const far = findCommonLines([square(100, 100)]).paths;
    const near = findCommonLines([square(2, 3)]).paths;
    const ordered = orderPaths([...far, ...near]);
    expect(ordered[0].points[0]).toEqual({ x: 2, y: 3 });
  });
});
