import { describe, expect, it, vi } from 'vitest';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { applyJointToPanel } from '../geometry/JointEngine';
import { commonLineSpacing, packPanels, packPanelsByThickness } from '../svg/BinPacker';
import { findCommonLines, type CutPath } from '../svg/commonLine';
import { decompose, tooClose, type PlacedShape } from '../svg/rectilinear';
import { generateSVG, layoutCommonLines, layoutContours, layoutsCutStats, layoutsSharedLength } from '../svg/SvgEngine';
import { DEFAULT_CUTTING } from '../svg/cutting';
import { defaultBoxParams, defaultSheetConfig } from '../utils/ProjectIO';
import { randomValidParams } from './helpers/randomBoxes';
import type { BoxParams, MaterialConfig, Panel, SheetConfig, SheetLayout } from '../models/types';

vi.setConfig({ testTimeout: 120_000 });

function build(params: BoxParams): Panel[] {
  const geo = buildBoxGeometry(params);
  geo.panels.forEach(p => applyJointToPanel(p, params.joint));
  return geo.panels;
}

function boxWith(over: (p: BoxParams) => void, kerf = 0.1, fit = 0): BoxParams {
  const p = defaultBoxParams();
  p.material.kerf = kerf;
  p.material.fitClearance = fit;
  over(p);
  return p;
}

const CASES: Array<[string, BoxParams]> = [
  ['default box', boxWith(() => {})],
  ['box with a lid', boxWith(p => { p.lid.enabled = true; })],
  ['box with dividers', boxWith(p => { p.divider.enabled = true; p.divider.columns = 4; p.divider.rows = 3; })],
  ['larger kerf', boxWith(() => {}, 0.3)],
  ['kerf and fit clearance', boxWith(() => {}, 0.2, 0.1)],
];

function sheet(over: Partial<SheetConfig> = {}, common = true): SheetConfig {
  return { ...defaultSheetConfig(), ...over, commonLine: { enabled: common } };
}

const pack = (params: BoxParams, over: Partial<SheetConfig> = {}, common = true) =>
  packPanels(build(params), sheet(over, common), params.material);

function overlapping(layout: SheetLayout, params: BoxParams): string[] {
  const contours = layoutContours(layout, params);
  const shapes: PlacedShape[] = contours.map(c => ({
    shape: decompose(c)!,
    x: Math.min(...c.map(p => p.x)),
    y: Math.min(...c.map(p => p.y)),
  }));
  const bad: string[] = [];
  for (let a = 0; a < shapes.length; a++) {
    for (let b = a + 1; b < shapes.length; b++) if (tooClose(shapes[a], shapes[b], 0)) bad.push(`${a}/${b}`);
  }
  return bad;
}

/** Distance from a point to a segment. */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

type Seg = [number, number, number, number];

function segmentsOfPaths(paths: CutPath[]): Seg[] {
  const out: Seg[] = [];
  for (const p of paths) {
    const n = p.points.length;
    for (let i = 0; i < (p.closed ? n : n - 1); i++) {
      const a = p.points[i];
      const b = p.points[(i + 1) % n];
      out.push([a.x, a.y, b.x, b.y]);
    }
  }
  return out;
}

/** Parses the path data this application writes (M, H, V, L, Z) into segments. */
function segmentsOfSvg(svg: string): { segments: Seg[]; paths: number; closed: number } {
  const out: Seg[] = [];
  let count = 0;
  let closed = 0;
  for (const m of svg.matchAll(/<path id="(?:cut|part)-\d+"[^>]* d="([^"]+)"/g)) {
    count++;
    let x = 0, y = 0, sx = 0, sy = 0;
    for (const t of m[1].matchAll(/([MHVLZ])([-\d.,]*)/g)) {
      const nums = t[2].split(',').filter(Boolean).map(Number);
      const px = x, py = y;
      if (t[1] === 'M') { x = nums[0]; y = nums[1]; sx = x; sy = y; continue; }
      if (t[1] === 'H') x = nums[0];
      else if (t[1] === 'V') y = nums[0];
      else if (t[1] === 'L') { x = nums[0]; y = nums[1]; }
      else { out.push([x, y, sx, sy]); closed++; continue; }
      out.push([px, py, x, y]);
    }
  }
  return { segments: out, paths: count, closed };
}

const lengthOf = (segs: Seg[]) => segs.reduce((s, [a, b, c, d]) => s + Math.hypot(c - a, d - b), 0);

/** The width of the material around (x, y) along one axis, until the strip the laser removes on either side. */
function extentAlong(x: number, y: number, horizontal: boolean, segs: Seg[], kerf: number): number {
  const free = (px: number, py: number) => segs.every(([a, b, c, d]) => distToSegment(px, py, a, b, c, d) > kerf / 2);
  const step = 0.005;
  let lo = 0;
  let hi = 0;
  while (free(horizontal ? x - lo - step : x, horizontal ? y : y - lo - step) && lo < 400) lo += step;
  while (free(horizontal ? x + hi + step : x, horizontal ? y : y + hi + step) && hi < 400) hi += step;
  return lo + hi;
}

describe('commonLineSpacing', () => {
  const m = (kerf: number, fit: number): MaterialConfig => ({ ...defaultBoxParams().material, kerf, fitClearance: fit });
  it('is the kerf, less half the fit clearance', () => {
    expect(commonLineSpacing(m(0.1, 0))).toBeCloseTo(0.1, 12);
    expect(commonLineSpacing(m(0.2, 0.1))).toBeCloseTo(0.15, 12);
    expect(commonLineSpacing(m(0, 0))).toBe(0);
  });
  it('is zero when the fit clearance is so large that the outlines move in', () => {
    expect(commonLineSpacing(m(0.1, 0.5))).toBe(0);
  });
});

describe('packing for common-line cutting', () => {
  it('changes nothing when it is off', () => {
    const params = boxWith(() => {});
    const panels = build(params);
    const plain = packPanels(panels, { ...defaultSheetConfig() });
    const off = packPanels(panels, sheet({}, false), params.material);
    expect(off.placed.map(p => [p.x, p.y, p.rotated])).toEqual(plain.placed.map(p => [p.x, p.y, p.rotated]));
    expect(off.spacing).toBe(off.config.gap);
  });

  it('does nothing without the material, which it needs for the kerf', () => {
    const panels = build(boxWith(() => {}));
    const a = packPanels(panels, sheet({}, true));
    const b = packPanels(panels, sheet({}, false));
    expect(a.placed.map(p => [p.x, p.y])).toEqual(b.placed.map(p => [p.x, p.y]));
  });

  for (const [name, params] of CASES) {
    it(`spaces parts by the kerf, keeps the margin, and keeps every cut outline apart: ${name}`, () => {
      for (const algorithm of ['maxrects', 'skyline', 'guillotine'] as const) {
        const layout = pack(params, { algorithm });
        const spacing = commonLineSpacing(params.material);
        expect(layout.spacing).toBeCloseTo(spacing, 12);
        const { width, height, gap } = layout.config;
        const rects = layout.placed.filter(p => !p.overflow).map(p => ({
          x: p.x, y: p.y,
          w: p.rotated ? p.panel.panelHeight : p.panel.panelWidth,
          h: p.rotated ? p.panel.panelWidth : p.panel.panelHeight,
        }));
        for (const r of rects) {
          expect(r.x).toBeGreaterThanOrEqual(gap - 1e-9);
          expect(r.y).toBeGreaterThanOrEqual(gap - 1e-9);
          expect(r.x + r.w).toBeLessThanOrEqual(width - gap + 1e-9);
          expect(r.y + r.h).toBeLessThanOrEqual(height - gap + 1e-9);
        }
        for (let a = 0; a < rects.length; a++) {
          for (let b = a + 1; b < rects.length; b++) {
            const p = rects[a];
            const q = rects[b];
            const apartX = p.x + p.w + spacing <= q.x + 1e-9 || q.x + q.w + spacing <= p.x + 1e-9;
            const apartY = p.y + p.h + spacing <= q.y + 1e-9 || q.y + q.h + spacing <= p.y + 1e-9;
            expect(apartX || apartY, `${algorithm}: parts ${a} and ${b} closer than the spacing`).toBe(true);
          }
        }
        expect(overlapping(layout, params), `${algorithm}: cut outlines overlap`).toEqual([]);
      }
    });
  }

  it('shares lines on a sheet packed this way, and none on a sheet packed with the usual gap', () => {
    const params = boxWith(() => {});
    const tight = layoutCommonLines(pack(params, {}), params)!;
    expect(tight).not.toBeNull();
    expect(tight.sharedLength).toBeGreaterThan(0);
    expect(tight.conflicts).toBe(0);
    const usual = findCommonLines(layoutContours(pack(params, {}, false), params));
    expect(usual.sharedLength).toBe(0);
  });

  it('shares nothing, but stays valid, when the fit clearance is too large for the outlines to meet', () => {
    const params = boxWith(() => {}, 0.1, 0.5);
    const layout = pack(params);
    expect(layout.spacing).toBe(0);
    expect(findCommonLines(layoutContours(layout, params)).sharedLength).toBe(0);
    expect(overlapping(layout, params)).toEqual([]);
  });

  it('works with the layout search, and with parts grouped by thickness', () => {
    const params = boxWith(p => { p.divider.enabled = true; p.divider.columns = 3; p.divider.rows = 2; p.material.baseThickness = 4; });
    const searched = packPanels(build(params), { ...sheet(), search: { enabled: true, candidates: 60 } }, params.material);
    expect(overlapping(searched, params)).toEqual([]);
    expect(layoutCommonLines(searched, params)!.sharedLength).toBeGreaterThan(0);

    const groups = packPanelsByThickness(build(params), sheet(), params.material);
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const g of groups) {
      expect(g.layout.spacing).toBeCloseTo(commonLineSpacing(params.material), 12);
      expect(overlapping(g.layout, params)).toEqual([]);
    }
  });

  it('is valid on random boxes', () => {
    for (const [n, params] of randomValidParams(40, 5).entries()) {
      const layout = pack(params, { size: 'A2' });
      expect(overlapping(layout, params), `box ${n}`).toEqual([]);
      const found = layoutCommonLines(layout, params);
      expect(found, `box ${n}`).not.toBeNull();
      expect(found!.conflicts, `box ${n}`).toBe(0);
    }
  });
});

describe('every part keeps its size when a line is shared', () => {
  // A box with plain edges, so that every wall is a rectangle whose size is known.
  for (const [kerf, fit] of [[0.1, 0], [0.3, 0], [0.2, 0.1]] as const) {
    it(`kerf ${kerf} mm, fit clearance ${fit} mm: the material left between the cuts has the same size as without sharing`, () => {
      const params = boxWith(p => { p.joint.style = 'none'; }, kerf, fit);
      const common = pack(params, { size: 'A3' });
      const apart = pack(params, { size: 'A3' }, false);
      const sharedPaths = layoutCommonLines(common, params)!;
      expect(sharedPaths.sharedLength).toBeGreaterThan(0);

      const sharedSegs = segmentsOfPaths(sharedPaths.paths);
      const apartSegs = segmentsOfPaths(layoutContours(apart, params).map(points => ({ points, closed: true })));

      const measure = (layout: SheetLayout, segs: Seg[]) =>
        layout.placed.map(pl => {
          const w = pl.rotated ? pl.panel.panelHeight : pl.panel.panelWidth;
          const h = pl.rotated ? pl.panel.panelWidth : pl.panel.panelHeight;
          // The middle of the part as it lies on the sheet, moved by the compensation.
          const cx = pl.x + w / 2 + (kerf / 2 - fit / 4);
          const cy = pl.y + h / 2 + (kerf / 2 - fit / 4);
          return {
            w: extentAlong(cx, cy, true, segs, kerf),
            h: extentAlong(cx, cy, false, segs, kerf),
            nominalW: w,
            nominalH: h,
          };
        });

      for (const m of [...measure(common, sharedSegs), ...measure(apart, apartSegs)]) {
        // What is left of a part is its nominal size, less half the fit clearance, to within the step of the measurement.
        expect(Math.abs(m.w - (m.nominalW - fit / 2))).toBeLessThan(0.011);
        expect(Math.abs(m.h - (m.nominalH - fit / 2))).toBeLessThan(0.011);
      }
    });
  }
});

describe('SVG with common-line cutting', () => {
  const params = boxWith(p => { p.divider.enabled = true; p.divider.columns = 3; p.divider.rows = 2; });

  it('writes each cut line once, and the same lines as the outlines together make', () => {
    const layout = pack(params);
    const svg = generateSVG(layout, params);
    const { segments, paths } = segmentsOfSvg(svg);
    const common = layoutCommonLines(layout, params)!;
    expect(paths).toBe(common.paths.length);

    // No piece of line is written twice: cut every written segment at the points where others end, and count.
    const key = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;
    const ends = new Set(segments.flatMap(([a, b, c, d]) => [key(a, b), key(c, d)]));
    const pieces = new Map<string, number>();
    for (const [a, b, c, d] of segments) {
      const horizontal = Math.abs(b - d) < 1e-6;
      const lo = horizontal ? Math.min(a, c) : Math.min(b, d);
      const hi = horizontal ? Math.max(a, c) : Math.max(b, d);
      const line = horizontal ? b : a;
      const cuts = [...ends]
        .map(k => k.split(',').map(Number))
        .filter(([x, y]) => (horizontal ? Math.abs(y - line) < 1e-6 : Math.abs(x - line) < 1e-6))
        .map(([x, y]) => (horizontal ? x : y))
        .filter(v => v > lo + 1e-6 && v < hi - 1e-6)
        .sort((p, q) => p - q);
      const stops = [lo, ...cuts, hi];
      for (let i = 0; i + 1 < stops.length; i++) {
        const k = `${horizontal ? 'h' : 'v'}${line.toFixed(3)},${stops[i].toFixed(3)},${stops[i + 1].toFixed(3)}`;
        pieces.set(k, (pieces.get(k) ?? 0) + 1);
      }
    }
    expect([...pieces.values()].every(n => n === 1), 'a line is written twice').toBe(true);

    // Every outline lies on the written lines, and every written line lies on an outline.
    const outlineSegs = segmentsOfPaths(layoutContours(layout, params).map(points => ({ points, closed: true })));
    const near = (px: number, py: number, segs: Seg[]) => segs.some(([a, b, c, d]) => distToSegment(px, py, a, b, c, d) < 0.002);
    for (const [a, b, c, d] of outlineSegs) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(near(a + (c - a) * t, b + (d - b) * t, segments)).toBe(true);
    }
    for (const [a, b, c, d] of segments) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(near(a + (c - a) * t, b + (d - b) * t, outlineSegs)).toBe(true);
    }

    // The length matches what the application reports.
    expect(lengthOf(segments)).toBeCloseTo(common.uniqueLength, 1);
    expect(svg).toMatch(/Common-line:on \| Shared:\d/);
    expect(Number(svg.match(/Cut:([\d.]+)mm/)![1])).toBeCloseTo(common.uniqueLength, 2);
    expect(Number(svg.match(/Shared:([\d.]+)mm/)![1])).toBeCloseTo(common.sharedLength, 2);
  });

  it('is shorter to cut than the same layout with every outline on its own', () => {
    const layout = pack(params);
    const apart: SheetLayout = { ...layout, config: { ...layout.config, commonLine: { enabled: false } } };
    const a = layoutsCutStats([layout], params, DEFAULT_CUTTING);
    const b = layoutsCutStats([apart], params, DEFAULT_CUTTING);
    expect(a.cutLength).toBeLessThan(b.cutLength);
    expect(a.totalSecondsOptimised).toBeLessThan(b.totalSecondsOptimised);
    const { shared, total } = layoutsSharedLength([layout], params);
    expect(total - shared).toBeCloseTo(a.cutLength, 6);
  });

  it('keeps the labels, the engraving and the overflow note', () => {
    const labelled = boxWith(p => { p.label = { enabled: true, text: 'Tools', face: 'front', fontSize: 8 }; });
    const svg = generateSVG(pack(labelled), labelled);
    expect(svg).toContain('id="engrave"');
    expect(svg).toContain('id="labels"');
    const small = generateSVG(pack(params, { size: 'custom', width: 120, height: 100 }), params);
    expect(small).toContain('OVERFLOW');
  });

  it('writes one closed path per part when nothing can be shared', () => {
    const noShare = boxWith(() => {}, 0.1, 0.5);
    const svg = generateSVG(pack(noShare), noShare);
    const { paths, closed } = segmentsOfSvg(svg);
    expect(paths).toBe(5);
    expect(closed).toBe(5);
    expect(svg).toMatch(/Shared:0mm/);
  });

  it('is written as before when common-line cutting is off', () => {
    const svg = generateSVG(pack(params, {}, false), params);
    expect(svg).toContain('id="part-1"');
    expect(svg).not.toContain('Common-line');
  });

  it('falls back to one path per part, and says so, if two outlines overlap', () => {
    const layout = pack(params);
    const moved: SheetLayout = {
      ...layout,
      placed: layout.placed.map((p, i) => (i === 1 ? { ...p, x: layout.placed[0].x + 2, y: layout.placed[0].y + 2 } : p)),
    };
    expect(layoutCommonLines(moved, params)).toBeNull();
    const svg = generateSVG(moved, params);
    expect(svg).toContain('id="part-');
    expect(svg).toContain('Common-line:off (outlines overlap)');
  });
});
