import { describe, expect, it, vi } from 'vitest';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { applyJointToPanel } from '../geometry/JointEngine';
import { packPanels } from '../svg/BinPacker';
import { DEFAULT_CUTTING, cutStats, sharedLineLength } from '../svg/cutting';
import { PACKING_LABELS, type PackingAlgorithm } from '../svg/packers';
import { layoutContours } from '../svg/SvgEngine';
import { defaultSheetConfig } from '../utils/ProjectIO';
import type { BoxParams, Panel, SheetConfig } from '../models/types';
import { randomValidParams } from './helpers/randomBoxes';

vi.setConfig({ testTimeout: 120_000 });

/**
 * How much do tighter spacing and a better cut order save? The same 300 random boxes as the packing
 * benchmark are packed onto a 420 mm wide strip of unlimited length, and for every layout the head's
 * travel is measured with the parts cut in the listed order and in the optimised order. Times use the
 * default speeds (10 mm/s cutting, 200 mm/s travel). Run it alone with `npm run benchmark`.
 */

const BOX_COUNT = 300;
const STRIP_WIDTH = 420;
const SPEEDS = DEFAULT_CUTTING;

const boxes: Array<{ params: BoxParams; panels: Panel[] }> = randomValidParams(BOX_COUNT, 2024).map(params => {
  const geo = buildBoxGeometry(params);
  geo.panels.forEach(p => applyJointToPanel(p, params.joint));
  return { params, panels: geo.panels };
});

function strip(gap: number, algorithm: PackingAlgorithm): SheetConfig {
  return { ...defaultSheetConfig(), size: 'custom', width: STRIP_WIDTH, height: 100000, gap, algorithm };
}

function usedHeight(layout: ReturnType<typeof packPanels>): number {
  return Math.max(...layout.placed.map(p => p.y + (p.rotated ? p.panel.panelWidth : p.panel.panelHeight)));
}

interface Scenario {
  stripUse: number;
  travelListed: number;
  travelOptimised: number;
  /** Share of the whole job time saved by the ordering. */
  timeSaved: number;
  jobSeconds: number;
  cutLength: number;
  shared: number;
}

function measure(gap: number, algorithm: PackingAlgorithm, perBox?: (i: number, listed: number, optimised: number, cut: number) => void): Scenario {
  const sum = { stripUse: 0, travelListed: 0, travelOptimised: 0, timeSaved: 0, jobSeconds: 0, cutLength: 0, shared: 0 };
  boxes.forEach(({ params, panels }, i) => {
    const layout = packPanels(panels, strip(gap, algorithm));
    const area = panels.reduce((s, p) => s + p.panelWidth * p.panelHeight, 0);
    const s = cutStats(layoutContours(layout, params), SPEEDS);
    sum.stripUse += area / (STRIP_WIDTH * usedHeight(layout));
    sum.travelListed += s.travelListed;
    sum.travelOptimised += s.travelOptimised;
    sum.timeSaved += (s.totalSecondsListed - s.totalSecondsOptimised) / s.totalSecondsListed;
    sum.jobSeconds += s.totalSecondsOptimised;
    sum.cutLength += s.cutLength;
    sum.shared += sharedLineLength(layoutContours(layout, params, false)) / s.cutLength;
    perBox?.(i, s.travelListed, s.travelOptimised, s.cutLength);
  });
  const n = boxes.length;
  return {
    stripUse: sum.stripUse / n,
    travelListed: sum.travelListed / n,
    travelOptimised: sum.travelOptimised / n,
    timeSaved: sum.timeSaved / n,
    jobSeconds: sum.jobSeconds / n,
    cutLength: sum.cutLength / n,
    shared: sum.shared / n,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

describe('cutting time on random boxes', () => {
  it('never needs more travel with the optimised order, and cuts the same length', () => {
    for (const algorithm of ['guillotine', 'maxrects', 'skyline'] as const) {
      measure(1, algorithm, (i, listed, optimised) => {
        expect(optimised, `${algorithm} box ${i}`).toBeLessThanOrEqual(listed + 1e-9);
      });
    }
    // The cut length depends on the parts, not on how close they sit.
    const lengths = [2, 1, 0.5, 0].map(gap => {
      const out: number[] = [];
      measure(gap, 'maxrects', (_, __, ___, cut) => out.push(cut));
      return out;
    });
    lengths[0].forEach((len, i) => {
      for (const other of lengths) expect(other[i]).toBeCloseTo(len, 6);
    });
  });

  it('measures the effect of the gap, the ordering and the packing method', () => {
    const gaps = [2, 1, 0.5].map(gap => ({ gap, ...measure(gap, 'maxrects') }));
    const methods = (['guillotine', 'maxrects', 'skyline'] as const).map(algorithm => ({ algorithm, ...measure(1, algorithm) }));
    const touching = measure(0, 'maxrects');

    const header = 'travel is the head moving without cutting; mean over the boxes';
    const lines = [
      '',
      `Cutting on ${boxes.length} random boxes (strip ${STRIP_WIDTH} mm wide, ${SPEEDS.cutSpeed} mm/s cutting, ${SPEEDS.travelSpeed} mm/s travel); ${header}`,
      '',
      'Gap between parts (MaxRects):',
      'gap      strip use   travel listed   travel optimised   saved   job time   time saved by ordering',
      ...gaps.map(g =>
        `${String(g.gap).padEnd(5)} mm ${pct(g.stripUse).padStart(8)}   ${g.travelListed.toFixed(0).padStart(9)} mm   ${g.travelOptimised.toFixed(0).padStart(11)} mm   ${pct(1 - g.travelOptimised / g.travelListed).padStart(6)}   ${(g.jobSeconds / 60).toFixed(1).padStart(5)} min   ${pct(g.timeSaved).padStart(8)}`,
      ),
      '',
      'Packing method (gap 1 mm):',
      'method       strip use   travel listed   travel optimised',
      ...methods.map(m =>
        `${PACKING_LABELS[m.algorithm].padEnd(12)} ${pct(m.stripUse).padStart(8)}   ${m.travelListed.toFixed(0).padStart(9)} mm   ${m.travelOptimised.toFixed(0).padStart(11)} mm`,
      ),
      '',
      `Touching parts (gap 0, MaxRects): cut length ${touching.cutLength.toFixed(0)} mm per box; edges lying exactly on another part's edge = ${pct(touching.shared)} of it (the most that sharing cut lines could save)`,
      '',
    ];
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    for (const g of gaps) {
      expect(g.travelOptimised).toBeLessThanOrEqual(g.travelListed);
      expect(g.stripUse).toBeGreaterThan(0.3);
    }
    // Closer parts use no more of the strip.
    expect(gaps[1].stripUse).toBeGreaterThanOrEqual(gaps[0].stripUse - 1e-9);
    expect(gaps[2].stripUse).toBeGreaterThanOrEqual(gaps[1].stripUse - 1e-9);
  });
});
