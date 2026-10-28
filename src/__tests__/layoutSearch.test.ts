import { describe, expect, it, vi } from 'vitest';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { applyJointToPanel } from '../geometry/JointEngine';
import { packPanels, packPanelsByThickness } from '../svg/BinPacker';
import { PACKERS, type PackingAlgorithm } from '../svg/packers';
import { candidateOrders, isBetter, layoutScore, scoreLayout, searchLayout } from '../svg/layoutSearch';
import { defaultBoxParams, defaultSheetConfig } from '../utils/ProjectIO';
import { randomValidParams } from './helpers/randomBoxes';
import type { BoxParams, Panel, SheetConfig, SheetLayout } from '../models/types';

vi.setConfig({ testTimeout: 120_000 });

const ALGORITHMS: PackingAlgorithm[] = ['guillotine', 'maxrects', 'skyline'];

function build(params: BoxParams): Panel[] {
  const geo = buildBoxGeometry(params);
  geo.panels.forEach(p => applyJointToPanel(p, params.joint));
  return geo.panels;
}

const lidBox = (): BoxParams => {
  const p = defaultBoxParams();
  p.lid.enabled = true;
  return p;
};
const dividerBox = (): BoxParams => {
  const p = defaultBoxParams();
  p.divider.enabled = true;
  p.divider.columns = 4;
  p.divider.rows = 3;
  return p;
};

const CASES: Array<[string, BoxParams]> = [
  ['default box', defaultBoxParams()],
  ['box with a lid', lidBox()],
  ['box with dividers (repeated identical panels)', dividerBox()],
];

function sheet(over: Partial<SheetConfig>, search = true, candidates = 120): SheetConfig {
  return { ...defaultSheetConfig(), ...over, search: { enabled: search, candidates } };
}

function rectsOf(layout: SheetLayout) {
  return layout.placed
    .filter(p => !p.overflow)
    .map(p => ({
      x: p.x,
      y: p.y,
      w: p.rotated ? p.panel.panelHeight : p.panel.panelWidth,
      h: p.rotated ? p.panel.panelWidth : p.panel.panelHeight,
    }));
}

/** Parts lie inside the sheet, at least `gap` from its edge, and at least `gap` from each other. */
function expectValid(layout: SheetLayout, label: string): void {
  const { width, height, gap } = layout.config;
  const rects = rectsOf(layout);
  for (const r of rects) {
    expect(r.x, label).toBeGreaterThanOrEqual(gap - 1e-9);
    expect(r.y, label).toBeGreaterThanOrEqual(gap - 1e-9);
    expect(r.x + r.w, label).toBeLessThanOrEqual(width - gap + 1e-9);
    expect(r.y + r.h, label).toBeLessThanOrEqual(height - gap + 1e-9);
  }
  for (let a = 0; a < rects.length; a++) {
    for (let b = a + 1; b < rects.length; b++) {
      const p = rects[a];
      const q = rects[b];
      const apartX = p.x + p.w + gap <= q.x + 1e-9 || q.x + q.w + gap <= p.x + 1e-9;
      const apartY = p.y + p.h + gap <= q.y + 1e-9 || q.y + q.h + gap <= p.y + 1e-9;
      expect(apartX || apartY, `${label}: parts ${a} and ${b} closer than the gap`).toBe(true);
    }
  }
}

describe('scoreLayout', () => {
  const items = [{ w: 10, h: 10 }, { w: 10, h: 10 }];

  it('counts placed parts and measures the occupied rectangle', () => {
    const s = scoreLayout(items, [{ x: 0, y: 0, rotated: false }, { x: 10, y: 0, rotated: false }], 100, 50);
    expect(s.placed).toBe(2);
    expect(s.placedArea).toBe(200);
    expect(s.extent).toBe(20 * 10);
  });

  it('has no fragmentation when the free sheet is one rectangle', () => {
    const s = scoreLayout([{ w: 100, h: 20 }], [{ x: 0, y: 0, rotated: false }], 100, 50);
    expect(s.fragmentation).toBe(0);
  });

  it('is more fragmented when the free space is split up', () => {
    const middle = scoreLayout([{ w: 10, h: 50 }], [{ x: 45, y: 0, rotated: false }], 100, 50);
    const edge = scoreLayout([{ w: 10, h: 50 }], [{ x: 0, y: 0, rotated: false }], 100, 50);
    expect(middle.fragmentation).toBeGreaterThan(edge.fragmentation);
  });

  it('does not count a part that did not fit, and honours a turned part', () => {
    const s = scoreLayout([{ w: 30, h: 10 }, { w: 10, h: 10 }], [{ x: 0, y: 0, rotated: true }, null], 100, 100);
    expect(s.placed).toBe(1);
    expect(s.placedArea).toBe(300);
    expect(s.extent).toBe(10 * 30);
  });

  it('counts the material area given for each item instead of its rectangle', () => {
    const s = scoreLayout([{ w: 12, h: 12 }], [{ x: 0, y: 0, rotated: false }], 100, 100, [100]);
    expect(s.placedArea).toBe(100);
  });
});

describe('isBetter', () => {
  const base = { placed: 5, placedArea: 5000, extent: 1000, fragmentation: 0.3 };
  it('puts the area placed first, then extent, then fragmentation', () => {
    expect(isBetter({ ...base, placedArea: 5100, extent: 9999 }, base)).toBe(true);
    expect(isBetter({ ...base, placed: 9, placedArea: 4900, extent: 1 }, base)).toBe(false);
    expect(isBetter({ ...base, extent: 900, fragmentation: 0.9 }, base)).toBe(true);
    expect(isBetter({ ...base, fragmentation: 0.2 }, base)).toBe(true);
    expect(isBetter({ ...base, extent: 1100, fragmentation: 0 }, base)).toBe(false);
  });
  it('does not call an equal score better, so the first candidate stays', () => {
    expect(isBetter({ ...base }, base)).toBe(false);
    expect(isBetter({ ...base, extent: 1000 + 1e-9 }, base)).toBe(false);
  });
});

describe('candidateOrders', () => {
  const panels = build(dividerBox());

  it('starts with the panels as given', () => {
    expect(candidateOrders(panels, 50)[0]).toEqual(panels.map((_, i) => i));
  });

  it('gives only permutations of the panels, with no repeats', () => {
    const orders = candidateOrders(panels, 80);
    const keys = new Set(orders.map(o => o.join(',')));
    expect(keys.size).toBe(orders.length);
    for (const o of orders) expect([...o].sort((a, b) => a - b)).toEqual(panels.map((_, i) => i));
  });

  it('respects the budget', () => {
    expect(candidateOrders(panels, 1)).toHaveLength(1);
    expect(candidateOrders(panels, 7)).toHaveLength(7);
  });

  it('stops when no new order exists', () => {
    const three = build(defaultBoxParams()).slice(0, 3);
    expect(candidateOrders(three, 500).length).toBeLessThanOrEqual(6);
  });

  it('tries equal parts both together and apart', () => {
    const orders = candidateOrders(panels, 40);
    const together = (o: number[]) => {
      // Front Wall (1) and Back Wall (2) side by side.
      const names = o.map(i => panels[i].name);
      return Math.abs(names.indexOf('Front Wall') - names.indexOf('Back Wall')) === 1;
    };
    expect(orders.some(together)).toBe(true);
    expect(orders.some(o => !together(o))).toBe(true);
  });

  it('is the same every time', () => {
    expect(candidateOrders(panels, 60)).toEqual(candidateOrders(panels, 60));
  });
});

describe('layout search', () => {
  it('leaves packing unchanged when the search is off', () => {
    const panels = build(lidBox());
    const plain = packPanels(panels, { ...defaultSheetConfig() });
    const off = packPanels(panels, sheet({}, false));
    expect(off.placed.map(p => [p.x, p.y, p.rotated])).toEqual(plain.placed.map(p => [p.x, p.y, p.rotated]));
    expect(off.search).toBeUndefined();
  });

  for (const [name, params] of CASES) {
    for (const algorithm of ALGORITHMS) {
      it(`is never worse than packing once with ${algorithm}: ${name}`, () => {
        const panels = build(params);
        for (const size of ['A4', 'A3', 'A2'] as const) {
          const once = packPanels(panels, sheet({ size, algorithm }, false));
          const found = packPanels(panels, sheet({ size, algorithm }));
          expect(isBetter(layoutScore(once), layoutScore(found)), `${size}`).toBe(false);
          expectValid(found, `${name} ${algorithm} ${size}`);
        }
      });
    }
  }

  it('lists every panel once, in the same order as packing once', () => {
    const panels = build(dividerBox());
    const once = packPanels(panels, sheet({}, false));
    const found = packPanels(panels, sheet({}));
    expect(found.placed.map(p => p.panel)).toEqual(once.placed.map(p => p.panel));
    expect(found.placed).toHaveLength(panels.length);
  });

  it('reports what it did', () => {
    const found = packPanels(build(defaultBoxParams()), sheet({}, true, 30));
    expect(found.search).toBeDefined();
    expect(found.search!.orders).toBeGreaterThan(0);
    expect(found.search!.orders).toBeLessThanOrEqual(30);
    expect(found.search!.packings).toBe(found.search!.orders * 3);
    expect(found.search!.stoppedEarly).toBe(false);
    expect(ALGORITHMS).toContain(found.search!.algorithm);
  });

  it('gives the same layout every time', () => {
    const panels = build(dividerBox());
    const a = packPanels(panels, sheet({ size: 'A3' }));
    const b = packPanels(panels, sheet({ size: 'A3' }));
    expect(b.placed.map(p => [p.x, p.y, p.rotated, p.overflow])).toEqual(a.placed.map(p => [p.x, p.y, p.rotated, p.overflow]));
    expect(b.search!.algorithm).toBe(a.search!.algorithm);
  });

  it('keeps the margins and the gap on a custom sheet with another gap', () => {
    const panels = build(dividerBox());
    for (const gap of [0.5, 3, 6]) {
      expectValid(packPanels(panels, sheet({ size: 'custom', width: 500, height: 400, gap })), `gap ${gap}`);
    }
  });

  it('still reports overflow when the sheet is too small, and fits at least as much material as packing once', () => {
    const panels = build(dividerBox());
    const small = { size: 'custom' as const, width: 150, height: 110 };
    const once = packPanels(panels, sheet(small, false));
    const found = packPanels(panels, sheet(small));
    expect(found.placed.some(p => p.overflow)).toBe(true);
    expect(found.efficiency).toBeGreaterThanOrEqual(once.efficiency - 1e-12);
    expect(found.sheetsRequired).toBe(2);
    expectValid(found, 'overflow');
  });

  it('searches each thickness group on its own', () => {
    const params = defaultBoxParams();
    params.material.baseThickness = 4;
    const groups = packPanelsByThickness(build(params), sheet({}));
    expect(groups.length).toBeGreaterThanOrEqual(2);
    for (const g of groups) {
      expect(g.layout.search).toBeDefined();
      expectValid(g.layout, `thickness ${g.label}`);
    }
  });

  it('stops at the time limit but still returns a valid layout, and says so', () => {
    const panels = build(dividerBox());
    const items = panels.map(p => ({ w: p.panelWidth + 2, h: p.panelHeight + 2 }));
    const result = searchLayout(panels, items, 418, 295, { candidates: 500, algorithm: 'maxrects', timeLimitMs: 0 });
    expect(result.report.stoppedEarly).toBe(true);
    expect(result.report.orders).toBe(1);
    // With one order tried, the result is the best of the methods on that order: no worse than the chosen one.
    const once = scoreLayout(items, PACKERS.maxrects(items, 418, 295), 418, 295);
    expect(isBetter(once, scoreLayout(items, result.spots, 418, 295))).toBe(false);
  });

  it('finds a fit that packing once misses', () => {
    // Search a set of awkward sheets until one is found where packing once leaves parts out.
    const panels = build(dividerBox());
    let improved = 0;
    for (let w = 150; w <= 330; w += 6) {
      for (const algorithm of ALGORITHMS) {
        const cfg = { size: 'custom' as const, width: w, height: 240, algorithm };
        const once = packPanels(panels, sheet(cfg, false));
        const found = packPanels(panels, sheet(cfg));
        if (isBetter(layoutScore(found), layoutScore(once))) improved++;
      }
    }
    expect(improved).toBeGreaterThan(0);
  });

  it('is never worse and always valid on random boxes', () => {
    for (const [n, params] of randomValidParams(25, 77).entries()) {
      const panels = build(params);
      const algorithm = ALGORITHMS[n % 3];
      const cfg = { size: 'A2' as const, algorithm };
      const once = packPanels(panels, sheet(cfg, false));
      const found = packPanels(panels, sheet(cfg, true, 60));
      expect(isBetter(layoutScore(once), layoutScore(found)), `box ${n}`).toBe(false);
      expectValid(found, `box ${n}`);
    }
  });
});
