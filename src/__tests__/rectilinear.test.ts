import { describe, expect, it, vi } from 'vitest';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { applyJointToPanel } from '../geometry/JointEngine';
import { signedArea } from '../geometry/outline';
import { decompose, orient, shapeArea, tooClose, type PlacedShape, type Shape } from '../svg/rectilinear';
import { defaultBoxParams } from '../utils/ProjectIO';
import { mulberry32, randomValidParams } from './helpers/randomBoxes';
import type { BoxParams, Panel, Point2D } from '../models/types';

vi.setConfig({ testTimeout: 120_000 });

function build(params: BoxParams): Panel[] {
  const geo = buildBoxGeometry(params);
  geo.panels.forEach(p => applyJointToPanel(p, params.joint));
  return geo.panels;
}

/** Even-odd test of a point against a closed polygon. */
function inside(pts: Point2D[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function inShape(shape: Shape, x: number, y: number): boolean {
  return shape.rects.some(r => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);
}

/** Rectangles never overlap in area. */
function disjoint(shape: Shape): boolean {
  const rs = shape.rects;
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i];
      const b = rs[j];
      if (a.x0 < b.x1 - 1e-9 && a.x1 > b.x0 + 1e-9 && a.y0 < b.y1 - 1e-9 && a.y1 > b.y0 + 1e-9) return false;
    }
  }
  return true;
}

/** The shape must be exactly the polygon: same area, no overlap, and the same answer at sample points. */
function expectExact(outline: Point2D[], shape: Shape, label: string, samples = 400, seed = 3): void {
  expect(shapeArea(shape), `${label}: area`).toBeCloseTo(Math.abs(signedArea(outline)), 6);
  expect(disjoint(shape), `${label}: rectangles overlap`).toBe(true);
  const minX = Math.min(...outline.map(p => p.x));
  const minY = Math.min(...outline.map(p => p.y));
  const local = outline.map(p => ({ x: p.x - minX, y: p.y - minY }));
  const rand = mulberry32(seed);
  for (let i = 0; i < samples; i++) {
    const x = rand() * shape.w;
    const y = rand() * shape.h;
    expect(inShape(shape, x, y), `${label}: point ${x.toFixed(3)},${y.toFixed(3)}`).toBe(inside(local, x, y));
  }
}

const L: Point2D[] = [
  { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 },
];

/** A random column chart outline: concave, axis-aligned, with no holes. */
function histogram(rand: () => number, columns: number): Point2D[] {
  const widths = Array.from({ length: columns }, () => 2 + Math.floor(rand() * 9));
  const heights: number[] = [];
  for (let i = 0; i < columns; i++) {
    let h = 1 + Math.floor(rand() * 12);
    while (i > 0 && h === heights[i - 1]) h = 1 + Math.floor(rand() * 12);
    heights.push(h);
  }
  const pts: Point2D[] = [{ x: 0, y: 0 }];
  let x = 0;
  pts.push({ x: 0, y: heights[0] });
  for (let i = 0; i < columns; i++) {
    x += widths[i];
    pts.push({ x, y: heights[i] });
    if (i + 1 < columns) pts.push({ x, y: heights[i + 1] });
  }
  pts.push({ x, y: 0 });
  return pts;
}

describe('decompose', () => {
  it('keeps a rectangle as one rectangle', () => {
    const shape = decompose([{ x: 5, y: 7 }, { x: 25, y: 7 }, { x: 25, y: 19 }, { x: 5, y: 19 }])!;
    expect(shape.rects).toHaveLength(1);
    expect(shape.w).toBe(20);
    expect(shape.h).toBe(12);
  });

  it('cuts an L into two rectangles with the exact area', () => {
    const shape = decompose(L)!;
    expect(shape.rects).toHaveLength(2);
    expect(shapeArea(shape)).toBe(40 * 10 + 10 * 20);
  });

  it('is exact for a U shape and a comb', () => {
    const U: Point2D[] = [
      { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 8 }, { x: 10, y: 8 }, { x: 10, y: 20 }, { x: 0, y: 20 },
    ];
    expectExact(U, decompose(U)!, 'U');
    expect(decompose(U)!.rects).toHaveLength(3);
  });

  it('gives the same rectangles whichever vertex the outline starts from, and whichever way it is walked', () => {
    const base = decompose(L)!.rects;
    for (let k = 1; k < L.length; k++) {
      expect(decompose([...L.slice(k), ...L.slice(0, k)])!.rects).toEqual(base);
    }
    expect(decompose([...L].reverse())!.rects).toEqual(base);
  });

  it('does not depend on where the part lies', () => {
    expect(decompose(L.map(p => ({ x: p.x + 17.25, y: p.y - 3.5 })))!.rects).toEqual(decompose(L)!.rects);
  });

  it('ignores points on a straight line, repeated points and a zero-width spike', () => {
    const noisy = [L[0], { x: 20, y: 0 }, L[1], L[1], L[2], { x: 20, y: 10 }, L[3], L[4], { x: 10, y: 40 }, { x: 10, y: 30 }, L[5]];
    expectExact(L, decompose(noisy)!, 'noisy L');
  });

  it('refuses outlines it cannot cut exactly', () => {
    expect(decompose([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }])).toBeNull();
    expect(decompose([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 12 }, { x: 0, y: 10 }])).toBeNull();
    expect(decompose([])).toBeNull();
    expect(decompose([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBeNull();
    expect(decompose([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }])).toBeNull();
  });

  it('is exact for random column outlines, in all four orientations', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 150; i++) {
      const outline = histogram(rand, 2 + Math.floor(rand() * 9));
      const shape = decompose(outline)!;
      expect(shape, `outline ${i}`).not.toBeNull();
      expectExact(outline, shape, `outline ${i}`, 150, i);
      for (const turns of [1, 2, 3]) {
        const turned = orient(shape, turns);
        expect(shapeArea(turned)).toBeCloseTo(shapeArea(shape), 6);
        expect(disjoint(turned)).toBe(true);
      }
    }
  });

  it('is exact for every panel of 120 random boxes (fingers, slots, notches, lids, dividers)', () => {
    for (const [n, params] of randomValidParams(120, 31).entries()) {
      for (const p of build(params)) {
        const shape = decompose(p.outline);
        expect(shape, `box ${n} ${p.name}`).not.toBeNull();
        expect(shape!.w).toBeCloseTo(p.panelWidth, 6);
        expect(shape!.h).toBeCloseTo(p.panelHeight, 6);
        expectExact(p.outline, shape!, `box ${n} ${p.name}`, 120, n);
      }
    }
  });
});

describe('orient', () => {
  const shape = decompose(L)!;

  it('turns as the sheet layout turns a part, and swaps width and height', () => {
    const turned = orient(shape, 1);
    expect(turned.w).toBe(shape.h);
    expect(turned.h).toBe(shape.w);
    // The outline turned by the layout's rule (x, y) -> (h - y, x) covers exactly the same area.
    const rule = L.map(p => ({ x: shape.h - p.y, y: p.x }));
    expectExact(rule, turned, 'turned L');
  });

  it('four quarter turns bring the part back', () => {
    expect(orient(shape, 4).rects).toEqual(shape.rects);
    expect(orient(orient(shape, 1), 3).rects).toEqual(shape.rects);
  });

  it('mirrors left to right', () => {
    const mirrored = orient(shape, 0, true);
    expect(mirrored.rects).toEqual(decompose(L.map(p => ({ x: shape.w - p.x, y: p.y })))!.rects);
    expect(shapeArea(mirrored)).toBe(shapeArea(shape));
  });

  it('keeps the area and the bounding box at the origin in every orientation', () => {
    for (const turns of [0, 1, 2, 3]) {
      for (const mirror of [false, true]) {
        const o = orient(shape, turns, mirror);
        expect(shapeArea(o)).toBeCloseTo(shapeArea(shape), 9);
        expect(Math.min(...o.rects.map(r => r.x0))).toBe(0);
        expect(Math.min(...o.rects.map(r => r.y0))).toBe(0);
        expect(Math.max(...o.rects.map(r => r.x1))).toBeCloseTo(o.w, 9);
        expect(Math.max(...o.rects.map(r => r.y1))).toBeCloseTo(o.h, 9);
      }
    }
  });
});

describe('tooClose', () => {
  const square = decompose([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])!;
  const at = (shape: Shape, x: number, y: number): PlacedShape => ({ shape, x, y });

  it('accepts exactly one gap apart and rejects less', () => {
    expect(tooClose(at(square, 0, 0), at(square, 12, 0), 2)).toBe(false);
    expect(tooClose(at(square, 0, 0), at(square, 11.99, 0), 2)).toBe(true);
    expect(tooClose(at(square, 0, 0), at(square, 0, 12), 2)).toBe(false);
    expect(tooClose(at(square, 0, 0), at(square, 0, 11.9), 2)).toBe(true);
  });

  it('accepts touching parts when the gap is zero, and rejects overlap', () => {
    expect(tooClose(at(square, 0, 0), at(square, 10, 0), 0)).toBe(false);
    expect(tooClose(at(square, 0, 0), at(square, 9.9, 0), 0)).toBe(true);
    expect(tooClose(at(square, 0, 0), at(square, 3, 3), 0)).toBe(true);
  });

  it('is symmetric', () => {
    for (const [x, y] of [[12, 0], [11, 5], [5, 5], [13, 13], [0, 11]]) {
      expect(tooClose(at(square, 0, 0), at(square, x, y), 2)).toBe(tooClose(at(square, x, y), at(square, 0, 0), 2));
    }
  });

  it('is decided by the real outline: a part can sit inside the bounding box of an L', () => {
    const l = decompose(L)!;
    // A 5 x 5 square in the empty corner of the L (its bounding box is 40 x 30).
    const small = decompose([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }])!;
    expect(tooClose(at(l, 0, 0), at(small, 20, 15), 2)).toBe(false);
    expect(tooClose(at(l, 0, 0), at(small, 20, 8), 2)).toBe(true);
    expect(tooClose(at(l, 0, 0), at(small, 11, 12), 2)).toBe(true);
    expect(tooClose(at(l, 0, 0), at(small, 12, 12), 2)).toBe(false);
  });

  it('agrees with a brute-force check on random placements', () => {
    // Distance along the axes, sampled on a fine grid of points of each shape.
    const rand = mulberry32(9);
    const shapes = Array.from({ length: 6 }, (_, i) => decompose(histogram(mulberry32(100 + i), 3 + (i % 3)))!);
    const gap = 2;
    const grid = (s: PlacedShape): Array<[number, number]> => {
      const out: Array<[number, number]> = [];
      for (let x = 0.25; x < s.shape.w; x += 0.5) for (let y = 0.25; y < s.shape.h; y += 0.5) if (inShape(s.shape, x, y)) out.push([s.x + x, s.y + y]);
      return out;
    };
    for (let trial = 0; trial < 80; trial++) {
      const a = at(shapes[Math.floor(rand() * 6)], 0, 0);
      const b = at(shapes[Math.floor(rand() * 6)], rand() * 40 - 10, rand() * 40 - 10);
      // Two parts are closer than the gap if some point of one lies within the gap, along both axes, of a point of the other.
      const ga = grid(a);
      const gb = grid(b);
      let brute = false;
      outer: for (const [ax, ay] of ga) {
        for (const [bx, by] of gb) {
          if (Math.abs(ax - bx) < gap - 0.5 && Math.abs(ay - by) < gap - 0.5) { brute = true; break outer; }
        }
      }
      const exact = tooClose(a, b, gap);
      // The grid has a resolution of 0.5 mm, so only the clear cases are compared: a pair the grid says is
      // close must be close, and a pair that is closer than the gap by more than a grid step must be found.
      if (brute) expect(exact, `trial ${trial}`).toBe(true);
      const looser = tooClose(a, b, gap - 1);
      if (!exact) expect(looser, `trial ${trial}`).toBe(false);
    }
  });

  it('lets a thin part into the slot of a real divider, which its bounding box would forbid', () => {
    const params = defaultBoxParams();
    params.divider.enabled = true;
    params.divider.columns = 2;
    params.divider.rows = 2;
    const col = build(params).find(p => p.name === 'Col Divider 1')!;
    const divider = decompose(col.outline)!;
    // The divider has a slot 3 mm wide and 26 mm deep in one edge. Find where it is: a column of x that the
    // shape does not cover over the top 20 mm.
    let slotX = -1;
    for (let x = 0.25; x < divider.w; x += 0.5) {
      if (!inShape(divider, x, divider.h - 10) && inShape(divider, x - 2, divider.h - 10) && inShape(divider, x + 2, divider.h - 10)) slotX = x;
    }
    expect(slotX).toBeGreaterThan(0);

    const strip = decompose([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 20 }, { x: 0, y: 20 }])!;
    const placed = (x: number, y: number): PlacedShape => ({ shape: strip, x, y });
    const base = { shape: divider, x: 0, y: 0 };
    // Down in the slot, 1 mm wide with 1 mm to spare each side: allowed at a gap of 0.5, rejected at 1.5.
    const inSlot = placed(slotX - 0.5, divider.h - 20);
    expect(tooClose(base, inSlot, 0.5)).toBe(false);
    expect(tooClose(base, inSlot, 1.5)).toBe(true);
    // The same strip is far inside the divider's bounding box.
    expect(inSlot.x).toBeGreaterThan(0);
    expect(inSlot.x + 1).toBeLessThan(divider.w);
  });
});
