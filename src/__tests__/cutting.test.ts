import { describe, expect, it } from 'vitest';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { applyJointToPanel } from '../geometry/JointEngine';
import { packPanels, packPanelsByThickness } from '../svg/BinPacker';
import {
  DEFAULT_CUTTING, HOME, bestEntries, contourLength, cutStats, listedPlan, optimisedPlan, planTravel,
  rotateContour, sharedLineLength, type Contour,
} from '../svg/cutting';
import { generateGroupedSVG, generateSVG, layoutContours, layoutsCutStats, placedContour } from '../svg/SvgEngine';
import { defaultBoxParams, defaultSheetConfig } from '../utils/ProjectIO';
import { mulberry32 } from './helpers/randomBoxes';

const rect = (x: number, y: number, w: number, h = w): Contour => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('contours', () => {
  it('measures the length of an outline', () => {
    expect(contourLength(rect(0, 0, 10))).toBeCloseTo(40, 9);
    expect(contourLength(rect(5, 5, 20, 10))).toBeCloseTo(60, 9);
  });

  it('starts an outline at another vertex without changing its shape', () => {
    const c = rect(0, 0, 10);
    const r = rotateContour(c, 2);
    expect(r[0]).toEqual(c[2]);
    expect(r).toHaveLength(4);
    expect(contourLength(r)).toBeCloseTo(contourLength(c), 9);
  });
});

describe('travel', () => {
  it('counts the move from home to the first start and from start to start', () => {
    const contours = [rect(200, 0, 10), rect(10, 0, 10)];
    // home -> (200,0), then (200,0) -> (10,0)
    expect(planTravel(contours, listedPlan(contours))).toBeCloseTo(200 + 190, 9);
  });

  it('is zero for no parts', () => {
    expect(planTravel([], listedPlan([]))).toBe(0);
    expect(optimisedPlan([])).toEqual({ order: [], entry: [] });
  });

  it('cuts the nearer part first', () => {
    const contours = [rect(200, 0, 10), rect(10, 0, 10)];
    const plan = optimisedPlan(contours);
    expect(plan.order).toEqual([1, 0]);
    // home -> (10,0), then (10,0) -> (200,0)
    expect(planTravel(contours, plan)).toBeCloseTo(10 + 190, 9);
  });

  it('starts an outline at its corner nearest to where the head is', () => {
    // The first vertex is the far corner; the nearest corner is index 2.
    const far: Contour = [{ x: 60, y: 70 }, { x: 50, y: 70 }, { x: 50, y: 60 }, { x: 60, y: 60 }];
    const plan = optimisedPlan([far]);
    expect(plan.entry).toEqual([2]);
    expect(planTravel([far], plan)).toBeCloseTo(dist(HOME, { x: 50, y: 60 }), 9);
    expect(planTravel([far], listedPlan([far]))).toBeCloseTo(dist(HOME, { x: 60, y: 70 }), 9);
  });

  it('chooses start vertices that are the best for the order given', () => {
    // Brute force over every combination of start vertices for a fixed order of three outlines.
    const contours = [rect(30, 40, 20, 15), rect(120, 10, 25), rect(70, 90, 12, 30)];
    const order = [0, 1, 2];
    let best = Infinity;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) {
      best = Math.min(best, planTravel(contours, { order, entry: [a, b, c] }));
    }
    expect(planTravel(contours, bestEntries(contours, order))).toBeCloseTo(best, 9);
  });

  it('never needs more travel than the listed order, and uses every outline once', () => {
    const rand = mulberry32(21);
    for (let trial = 0; trial < 150; trial++) {
      const n = 1 + Math.floor(rand() * 14);
      const contours = Array.from({ length: n }, () => rect(rand() * 400, rand() * 300, 5 + rand() * 80, 5 + rand() * 80));
      const plan = optimisedPlan(contours);
      expect([...plan.order].sort((a, b) => a - b), `trial ${trial}`).toEqual(contours.map((_, i) => i));
      plan.entry.forEach((v, k) => {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(contours[plan.order[k]].length);
      });
      expect(planTravel(contours, plan), `trial ${trial}`).toBeLessThanOrEqual(planTravel(contours, listedPlan(contours)) + 1e-9);
    }
  });

  it('gives the same answer every time', () => {
    const contours = [rect(30, 40, 20), rect(120, 10, 25), rect(70, 90, 12), rect(200, 200, 30)];
    expect(optimisedPlan(contours)).toEqual(optimisedPlan(contours));
  });
});

describe('cutting figures', () => {
  it('turns lengths into times with the speeds given', () => {
    const contours = [rect(200, 0, 10), rect(10, 0, 10)];
    const s = cutStats(contours, { optimise: true, cutSpeed: 10, travelSpeed: 200 });
    expect(s.parts).toBe(2);
    expect(s.cutLength).toBeCloseTo(80, 9);
    expect(s.cutSeconds).toBeCloseTo(8, 9);
    expect(s.travelListed).toBeCloseTo(390, 9);
    expect(s.travelOptimised).toBeCloseTo(200, 9);
    expect(s.travelSecondsListed).toBeCloseTo(390 / 200, 9);
    expect(s.totalSecondsListed).toBeCloseTo(8 + 390 / 200, 9);
    expect(s.totalSecondsOptimised).toBeCloseTo(8 + 200 / 200, 9);
  });

  it('has defaults that are plain numbers to start from', () => {
    expect(DEFAULT_CUTTING.optimise).toBe(true);
    expect(DEFAULT_CUTTING.cutSpeed).toBeGreaterThan(0);
    expect(DEFAULT_CUTTING.travelSpeed).toBeGreaterThan(DEFAULT_CUTTING.cutSpeed);
  });
});

describe('cut lines that could be shared', () => {
  it('finds an edge that two touching parts have in common', () => {
    expect(sharedLineLength([rect(0, 0, 10), rect(10, 0, 10)])).toBeCloseTo(10, 9);
  });

  it('counts only the stretch that overlaps', () => {
    expect(sharedLineLength([rect(0, 0, 10), rect(10, 5, 10)])).toBeCloseTo(5, 9);
  });

  it('finds nothing when parts have a gap, or only meet at a corner', () => {
    expect(sharedLineLength([rect(0, 0, 10), rect(11, 0, 10)])).toBe(0);
    expect(sharedLineLength([rect(0, 0, 10), rect(10, 10, 10)])).toBe(0);
  });

  it('does not count the edges of one part against themselves', () => {
    expect(sharedLineLength([rect(0, 0, 10)])).toBe(0);
  });

  it('finds horizontal and vertical edges alike', () => {
    expect(sharedLineLength([rect(0, 0, 10), rect(0, 10, 10)])).toBeCloseTo(10, 9);
    expect(sharedLineLength([rect(0, 0, 10), rect(10, 0, 10), rect(0, 10, 20, 10)])).toBeCloseTo(10 + 10 + 10, 9);
  });
});

function packed(params = defaultBoxParams(), sheet = defaultSheetConfig()) {
  const geo = buildBoxGeometry(params);
  geo.panels.forEach(p => applyJointToPanel(p, params.joint));
  return packPanels(geo.panels, sheet);
}

describe('placed contours', () => {
  it('lies on the sheet where the part is placed', () => {
    const layout = packed();
    const params = defaultBoxParams();
    for (const pl of layout.placed.filter(p => !p.overflow)) {
      const c = placedContour(pl, params, false);
      const xs = c.map(p => p.x);
      const ys = c.map(p => p.y);
      const w = pl.rotated ? pl.panel.panelHeight : pl.panel.panelWidth;
      const h = pl.rotated ? pl.panel.panelWidth : pl.panel.panelHeight;
      expect(Math.min(...xs)).toBeCloseTo(pl.x, 6);
      expect(Math.min(...ys)).toBeCloseTo(pl.y, 6);
      expect(Math.max(...xs)).toBeCloseTo(pl.x + w, 6);
      expect(Math.max(...ys)).toBeCloseTo(pl.y + h, 6);
    }
  });

  it('is a little larger once the kerf is allowed for', () => {
    const layout = packed();
    const params = defaultBoxParams();
    params.material.kerf = 0.4;
    params.material.fitClearance = 0;
    const pl = layout.placed[0];
    const nominal = contourLength(placedContour(pl, params, false));
    expect(contourLength(placedContour(pl, params, true))).toBeGreaterThan(nominal);
  });

  it('leaves out parts that did not fit', () => {
    const params = defaultBoxParams();
    const small = packed(params, { ...defaultSheetConfig(), size: 'custom', width: 130, height: 100 });
    expect(small.placed.some(p => p.overflow)).toBe(true);
    expect(layoutContours(small, params)).toHaveLength(small.placed.filter(p => !p.overflow).length);
  });

  it('adds up the figures of several sheets', () => {
    const params = defaultBoxParams();
    params.material.baseThickness = 6;
    const geo = buildBoxGeometry(params);
    geo.panels.forEach(p => applyJointToPanel(p, params.joint));
    const groups = packPanelsByThickness(geo.panels, defaultSheetConfig());
    const sheets = groups.map(g => g.layout);
    const total = layoutsCutStats(sheets, params, DEFAULT_CUTTING);
    const each = sheets.map(l => layoutsCutStats([l], params, DEFAULT_CUTTING));
    expect(total.parts).toBe(each.reduce((s, e) => s + e.parts, 0));
    expect(total.cutLength).toBeCloseTo(each.reduce((s, e) => s + e.cutLength, 0), 6);
    expect(total.travelOptimised).toBeCloseTo(each.reduce((s, e) => s + e.travelOptimised, 0), 6);
  });
});

describe('cut order in the SVG', () => {
  const ids = (svg: string) => [...svg.matchAll(/<path id="part-(\d+)"/g)].map(m => Number(m[1]));
  const firstPoint = (svg: string, seq: number) => {
    const m = svg.match(new RegExp(`<path id="part-${seq}"[^>]* d="M([-\\d.]+),([-\\d.]+)`))!;
    return { x: Number(m[1]), y: Number(m[2]) };
  };

  function bigBox() {
    const params = defaultBoxParams();
    params.divider.enabled = true;
    params.divider.columns = 3;
    params.divider.rows = 3;
    return params;
  }

  it('writes one path per part, in the planned order, started at the planned corner', () => {
    const params = bigBox();
    const layout = packed(params);
    const active = layout.placed.filter(p => !p.overflow);
    const contours = layoutContours(layout, params);
    const plan = optimisedPlan(contours);
    const svg = generateSVG(layout, params);

    expect(ids(svg)).toEqual(plan.order.map(ci => active[ci].panel.sequenceNumber));
    plan.order.forEach((ci, k) => {
      const start = contours[ci][plan.entry[k]];
      const got = firstPoint(svg, active[ci].panel.sequenceNumber);
      expect(got.x).toBeCloseTo(start.x, 2);
      expect(got.y).toBeCloseTo(start.y, 2);
    });
  });

  it('writes the parts in the listed order when the ordering is switched off', () => {
    const params = bigBox();
    const sheet = { ...defaultSheetConfig(), cutting: { ...DEFAULT_CUTTING, optimise: false } };
    const layout = packed(params, sheet);
    const active = layout.placed.filter(p => !p.overflow);
    const contours = layoutContours(layout, params);
    const svg = generateSVG(layout, params);

    expect(ids(svg)).toEqual(active.map(pl => pl.panel.sequenceNumber));
    const start = contours[0][0];
    const got = firstPoint(svg, active[0].panel.sequenceNumber);
    expect(got.x).toBeCloseTo(start.x, 2);
    expect(got.y).toBeCloseTo(start.y, 2);
  });

  it('needs less travel in the file than the listed order does', () => {
    const params = bigBox();
    const on = generateSVG(packed(params), params);
    const off = generateSVG(packed(params, { ...defaultSheetConfig(), cutting: { ...DEFAULT_CUTTING, optimise: false } }), params);
    const travel = (svg: string) => Number(svg.match(/Travel:([\d.]+)mm/)![1]);
    expect(travel(on)).toBeLessThan(travel(off));
    expect(on).toContain('Order:optimised');
    expect(off).toContain('Order:listed');
  });

  it('cuts exactly the same length whatever the order', () => {
    const params = bigBox();
    const cut = (svg: string) => Number(svg.match(/Cut:([\d.]+)mm/)![1]);
    const on = generateSVG(packed(params), params);
    const off = generateSVG(packed(params, { ...defaultSheetConfig(), cutting: { ...DEFAULT_CUTTING, optimise: false } }), params);
    expect(cut(on)).toBeCloseTo(cut(off), 2);
  });

  it('gives a part the same colour on its path and on its number', () => {
    const params = bigBox();
    const svg = generateSVG(packed(params), params);
    for (const seq of ids(svg)) {
      const path = svg.match(new RegExp(`<path id="part-${seq}" fill="none" stroke="(#[0-9a-f]{6})"`))![1];
      const label = svg.match(new RegExp(`fill="(#[0-9a-f]{6})" font-family="monospace">${seq}</text>`))![1];
      expect(label, `part ${seq}`).toBe(path);
    }
  });

  it('also orders the parts of every sheet when grouped by thickness', () => {
    const params = defaultBoxParams();
    params.material.baseThickness = 6;
    const geo = buildBoxGeometry(params);
    geo.panels.forEach(p => applyJointToPanel(p, params.joint));
    const groups = packPanelsByThickness(geo.panels, defaultSheetConfig());
    const svg = generateGroupedSVG(groups, params);
    expect(ids(svg).sort((a, b) => a - b)).toEqual(geo.panels.map(p => p.sequenceNumber));
  });
});
