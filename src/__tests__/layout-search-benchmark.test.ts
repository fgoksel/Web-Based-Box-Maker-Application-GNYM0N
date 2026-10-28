import { describe, expect, it, vi } from 'vitest';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { applyJointToPanel } from '../geometry/JointEngine';
import { packPanels, SHEET_SIZES } from '../svg/BinPacker';
import { layoutScore } from '../svg/layoutSearch';
import { PACKING_LABELS, type PackingAlgorithm } from '../svg/packers';
import { defaultSheetConfig } from '../utils/ProjectIO';
import type { Panel, SheetConfig, SheetLayout } from '../models/types';
import { randomValidParams } from './helpers/randomBoxes';

vi.setConfig({ testTimeout: 600_000 });

/**
 * Compares packing once (each method on its own) with the layout search, on the same 300 random boxes
 * as the packing benchmark. Run it alone with `npm run benchmark` to see the table.
 *
 * - occupied: the rectangle from the sheet corner that encloses every part, which is what the search
 *   makes smaller. Measured on a 420 mm wide sheet of unlimited length. It is the area of a bounding
 *   rectangle, not the material the parts use (the parts have fingers and slots).
 * - fit rate: how often every part fits on a real A3 or A2 sheet.
 * - smallest sheet: the smallest standard sheet (A4, A3, A2, A1) that holds every part, averaged over
 *   the boxes that fit on A1 with every contender.
 * - ms per box: time to produce the layout.
 */

const ALGORITHMS: PackingAlgorithm[] = ['guillotine', 'maxrects', 'skyline'];
const BOX_COUNT = 300;
const CANDIDATES = 100;
const STRIP_WIDTH = 420;
const SHEETS = ['A4', 'A3', 'A2', 'A1'] as const;

function randomBoxes(count: number, seed: number): Panel[][] {
  return randomValidParams(count, seed).map(params => {
    const geo = buildBoxGeometry(params);
    geo.panels.forEach(p => applyJointToPanel(p, params.joint));
    return geo.panels;
  });
}

interface Contender {
  label: string;
  config: (over: Partial<SheetConfig>) => SheetConfig;
}

const contenders: Contender[] = [
  ...ALGORITHMS.map(algorithm => ({
    label: PACKING_LABELS[algorithm],
    config: (over: Partial<SheetConfig>): SheetConfig => ({ ...defaultSheetConfig(), ...over, algorithm, search: { enabled: false, candidates: 1 } }),
  })),
  {
    label: `Search (${CANDIDATES})`,
    config: (over: Partial<SheetConfig>): SheetConfig => ({ ...defaultSheetConfig(), ...over, search: { enabled: true, candidates: CANDIDATES } }),
  },
];

const area = (panels: Panel[]) => panels.reduce((sum, p) => sum + p.panelWidth * p.panelHeight, 0);
const pct = (flags: boolean[]) => `${((flags.filter(Boolean).length / flags.length) * 100).toFixed(1).padStart(6)}%`;

describe('layout search on random boxes', () => {
  const boxes = randomBoxes(BOX_COUNT, 2024);

  it('measures packing once against the search', () => {
    const strip = { size: 'custom' as const, width: STRIP_WIDTH, height: 100000 };

    const rows = contenders.map(c => {
      const layouts: SheetLayout[] = [];
      const start = performance.now();
      for (const panels of boxes) layouts.push(packPanels(panels, c.config(strip)));
      const ms = (performance.now() - start) / boxes.length;
      const occupied = layouts.map(l => layoutScore(l).extent);

      const fits = (size: (typeof SHEETS)[number]) =>
        boxes.map(panels => !packPanels(panels, c.config({ size })).placed.some(p => p.overflow));
      const fitsOn = Object.fromEntries(SHEETS.map(size => [size, fits(size)])) as Record<(typeof SHEETS)[number], boolean[]>;
      return { label: c.label, occupied, fitsOn, ms, wins: 0 };
    });

    const everyoneFits = boxes.map((_, i) => rows.every(r => r.fitsOn.A1[i]));
    const comparable = everyoneFits.filter(Boolean).length;
    const meanSheet = (r: (typeof rows)[number]) =>
      boxes.reduce((sum, _, i) => {
        if (!everyoneFits[i]) return sum;
        const [w, h] = SHEET_SIZES[SHEETS.find(s => r.fitsOn[s][i])!];
        return sum + w * h;
      }, 0) / comparable;

    for (let i = 0; i < boxes.length; i++) {
      const best = Math.min(...rows.map(r => r.occupied[i]));
      for (const r of rows) if (r.occupied[i] <= best + 1e-6) r.wins++;
    }

    const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const lines = [
      '',
      `Packing once against the layout search on ${boxes.length} random boxes (${STRIP_WIDTH} mm wide strip, gap 2 mm, ${CANDIDATES} orders per box)`,
      'method          occupied (cm2)   best or tied   fits A3   fits A2   smallest sheet (cm2)   ms per box',
      ...rows.map(r =>
        `${r.label.padEnd(15)} ${(meanOf(r.occupied) / 100).toFixed(0).padStart(14)}   ${String(r.wins).padStart(12)}   ${pct(r.fitsOn.A3)}  ${pct(r.fitsOn.A2)}  ${(meanSheet(r) / 100).toFixed(0).padStart(20)}   ${r.ms.toFixed(2).padStart(10)}`,
      ),
      `(smallest sheet is averaged over the ${comparable} boxes that fit on A1 with every contender)`,
      '',
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    // The search tries every method's own order first, so it can never be worse than any of them.
    const search = rows[rows.length - 1];
    for (const r of rows.slice(0, -1)) {
      expect(meanOf(search.occupied), r.label).toBeLessThanOrEqual(meanOf(r.occupied) + 1e-6);
      for (const size of ['A3', 'A2'] as const) {
        expect(search.fitsOn[size].filter(Boolean).length, `${r.label} ${size}`).toBeGreaterThanOrEqual(r.fitsOn[size].filter(Boolean).length);
      }
    }
    expect(area(boxes[0])).toBeGreaterThan(0);
  });
});
