import { describe, expect, it } from 'vitest';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { applyJointToPanel } from '../geometry/JointEngine';
import { layoutCompartments } from '../geometry/compartments';
import { packPanels, SHEET_SIZES } from '../svg/BinPacker';
import { PACKING_LABELS, type PackingAlgorithm } from '../svg/packers';
import { defaultBoxParams, defaultSheetConfig } from '../utils/ProjectIO';
import type { BoxParams, Panel, SheetConfig } from '../models/types';

/**
 * Compares the packing methods on 300 randomly generated boxes (the same ones every run).
 * Run it alone with `npm run benchmark` to see the table.
 *
 * Measures:
 * - strip use: pack onto a 420 mm wide sheet of unlimited length and see how much of the used
 *   rectangle is material. Higher is better and does not depend on a particular sheet size.
 * - fit rate: how often every panel fits on a real A3 or A2 sheet.
 * - smallest sheet: the smallest standard sheet (A4, A3, A2, A1) that holds every panel, averaged
 *   over the boxes that fit on A1 with every method. Lower means less material.
 * - time to pack one box.
 */

const ALGORITHMS: PackingAlgorithm[] = ['guillotine', 'maxrects', 'skyline'];
const BOX_COUNT = 300;
const STRIP_WIDTH = 420;
const SHEETS = ['A4', 'A3', 'A2', 'A1'] as const;

const pct = (flags: boolean[]) => `${((flags.filter(Boolean).length / flags.length) * 100).toFixed(1).padStart(6)}%`;

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBoxes(count: number, seed: number): Panel[][] {
  const rand = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

  const boxes: Panel[][] = [];
  while (boxes.length < count) {
    const params: BoxParams = defaultBoxParams();
    const t = pick([2, 3, 4, 6]);
    params.width = Math.round(between(60, 300));
    params.depth = Math.round(between(50, 250));
    params.height = Math.round(between(30, 150));
    params.material = { ...params.material, frameThickness: t, baseThickness: pick([t, 3, 6]), dividerThickness: pick([2, 3]) };
    if (rand() < 0.4) {
      params.lid.enabled = true;
      params.lid.height = Math.round(between(15, 40));
    }
    if (rand() < 0.5) {
      params.divider.enabled = true;
      params.divider.columns = 1 + Math.floor(rand() * 4);
      params.divider.rows = 1 + Math.floor(rand() * 4);
      if (rand() < 0.5) params.divider.heightOverride = Math.round(between(10, 25));
    }

    const { frameThickness: tF, baseThickness: tB, dividerThickness: tD } = params.material;
    const iW = params.width - 2 * tF;
    const iD = params.depth - 2 * tF;
    const iH = params.height - tB;
    if (iH < 10 || params.lid.enabled && params.lid.height <= tB) continue;
    if (params.divider.enabled) {
      if (params.divider.heightOverride > iH) continue;
      if (layoutCompartments(iW, tD, params.divider.columns, [], 'width').error) continue;
      if (layoutCompartments(iD, tD, params.divider.rows, [], 'depth').error) continue;
    }

    const geo = buildBoxGeometry(params);
    geo.panels.forEach(p => applyJointToPanel(p, params.joint));
    boxes.push(geo.panels);
  }
  return boxes;
}

function stripSheet(algorithm: PackingAlgorithm): SheetConfig {
  return { size: 'custom', width: STRIP_WIDTH, height: 100000, gap: 2, algorithm };
}

function usedHeight(layout: ReturnType<typeof packPanels>): number {
  return Math.max(...layout.placed.filter(p => !p.overflow).map(p => p.y + (p.rotated ? p.panel.panelWidth : p.panel.panelHeight)));
}

function area(panels: Panel[]): number {
  return panels.reduce((sum, p) => sum + p.panelWidth * p.panelHeight, 0);
}

describe('packing methods on random boxes', () => {
  const boxes = randomBoxes(BOX_COUNT, 2024);

  it('generates the same boxes every time', () => {
    const again = randomBoxes(5, 2024);
    expect(again.map(b => b.length)).toEqual(boxes.slice(0, 5).map(b => b.length));
    expect(boxes).toHaveLength(BOX_COUNT);
    expect(boxes.every(b => b.length >= 5)).toBe(true);
  });

  it('places every part inside the sheet without overlaps, for every method', () => {
    for (const algorithm of ALGORITHMS) {
      for (const [n, panels] of boxes.entries()) {
        const layout = packPanels(panels, { ...defaultSheetConfig(), algorithm });
        const placed = layout.placed.filter(p => !p.overflow);
        const { width, height } = layout.config;
        const rects = placed.map(p => ({
          x: p.x,
          y: p.y,
          w: p.rotated ? p.panel.panelHeight : p.panel.panelWidth,
          h: p.rotated ? p.panel.panelWidth : p.panel.panelHeight,
        }));
        for (const r of rects) {
          expect(r.x, `${algorithm} box ${n}`).toBeGreaterThanOrEqual(0);
          expect(r.y, `${algorithm} box ${n}`).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w, `${algorithm} box ${n}`).toBeLessThanOrEqual(width + 1e-9);
          expect(r.y + r.h, `${algorithm} box ${n}`).toBeLessThanOrEqual(height + 1e-9);
        }
        for (let a = 0; a < rects.length; a++) {
          for (let b = a + 1; b < rects.length; b++) {
            const p = rects[a];
            const q = rects[b];
            const overlap = p.x < q.x + q.w - 1e-9 && p.x + p.w > q.x + 1e-9 && p.y < q.y + q.h - 1e-9 && p.y + p.h > q.y + 1e-9;
            expect(overlap, `${algorithm} box ${n}: parts ${a} and ${b}`).toBe(false);
          }
        }
        // Every part is accounted for, placed or reported as overflow.
        expect(layout.placed).toHaveLength(panels.length);
      }
    }
  });

  it('keeps at least the gap between parts', () => {
    const gap = 2;
    for (const algorithm of ALGORITHMS) {
      for (const panels of boxes.slice(0, 60)) {
        const placed = packPanels(panels, { ...defaultSheetConfig(), gap, algorithm }).placed.filter(p => !p.overflow);
        const rects = placed.map(p => ({
          x: p.x, y: p.y,
          w: p.rotated ? p.panel.panelHeight : p.panel.panelWidth,
          h: p.rotated ? p.panel.panelWidth : p.panel.panelHeight,
        }));
        for (let a = 0; a < rects.length; a++) {
          for (let b = a + 1; b < rects.length; b++) {
            const p = rects[a];
            const q = rects[b];
            const apartX = p.x + p.w + gap <= q.x + 1e-9 || q.x + q.w + gap <= p.x + 1e-9;
            const apartY = p.y + p.h + gap <= q.y + 1e-9 || q.y + q.h + gap <= p.y + 1e-9;
            expect(apartX || apartY, `${algorithm}: parts ${a} and ${b} closer than the gap`).toBe(true);
          }
        }
      }
    }
  });

  it('measures the three methods', () => {
    const rows = ALGORITHMS.map(algorithm => {
      let utilisation = 0;
      let wins = 0;
      const start = performance.now();
      const heights: number[] = [];
      for (const panels of boxes) {
        const layout = packPanels(panels, stripSheet(algorithm));
        const h = usedHeight(layout);
        heights.push(h);
        utilisation += area(panels) / (STRIP_WIDTH * h);
      }
      const ms = (performance.now() - start) / boxes.length;

      const fits = (size: 'A4' | 'A3' | 'A2' | 'A1') =>
        boxes.map(panels => !packPanels(panels, { ...defaultSheetConfig(), size, algorithm }).placed.some(p => p.overflow));
      const fitsOn = Object.fromEntries(SHEETS.map(size => [size, fits(size)])) as Record<(typeof SHEETS)[number], boolean[]>;

      return { algorithm, utilisation: utilisation / boxes.length, heights, wins, fitsOn, ms };
    });

    // Smallest sheet per box, over the boxes that every method can fit on A1.
    const everyoneFits = boxes.map((_, i) => rows.every(r => r.fitsOn.A1[i]));
    const sheetArea = (r: (typeof rows)[number], i: number) => {
      const size = SHEETS.find(s => r.fitsOn[s][i])!;
      const [w, h] = SHEET_SIZES[size];
      return w * h;
    };
    const comparable = everyoneFits.filter(Boolean).length;
    const meanSheet = (r: (typeof rows)[number]) =>
      rows.length && comparable
        ? boxes.reduce((sum, _, i) => sum + (everyoneFits[i] ? sheetArea(r, i) : 0), 0) / comparable
        : 0;

    // A method "wins" a box when no other method needs a shorter strip (ties count for all).
    for (let i = 0; i < boxes.length; i++) {
      const best = Math.min(...rows.map(r => r.heights[i]));
      for (const r of rows) if (r.heights[i] <= best + 1e-6) r.wins++;
    }

    const lines = [
      '',
      `Packing methods on ${boxes.length} random boxes (strip ${STRIP_WIDTH} mm wide, gap 2 mm)`,
      'method       strip use   best or tied   fits A3   fits A2   smallest sheet (cm2)   ms per box',
      ...rows.map(r =>
        `${PACKING_LABELS[r.algorithm].padEnd(12)} ${(r.utilisation * 100).toFixed(1).padStart(8)}%  ${String(r.wins).padStart(12)}   ${pct(r.fitsOn.A3)}  ${pct(r.fitsOn.A2)}  ${(meanSheet(r) / 100).toFixed(0).padStart(20)}   ${r.ms.toFixed(3).padStart(10)}`,
      ),
      `(smallest sheet is averaged over the ${comparable} boxes that fit on A1 with every method)`,
      '',
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    for (const r of rows) {
      expect(r.utilisation).toBeGreaterThan(0.3);
      expect(r.utilisation).toBeLessThanOrEqual(1);
    }
  });
});
