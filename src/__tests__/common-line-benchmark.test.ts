import { describe, expect, it, vi } from 'vitest';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { applyJointToPanel } from '../geometry/JointEngine';
import { packPanels } from '../svg/BinPacker';
import { findCommonLines, orderPaths, pathsTravel } from '../svg/commonLine';
import { cutStats, DEFAULT_CUTTING } from '../svg/cutting';
import { layoutContours } from '../svg/SvgEngine';
import { decompose, tooClose, type PlacedShape } from '../svg/rectilinear';
import { PACKING_LABELS, type PackingAlgorithm } from '../svg/packers';
import { defaultSheetConfig } from '../utils/ProjectIO';
import type { BoxParams, Panel, SheetConfig } from '../models/types';
import { randomValidParams } from './helpers/randomBoxes';

vi.setConfig({ testTimeout: 600_000 });

/**
 * Cutting a line once where two parts touch, measured on 300 random boxes (the same ones every run). Run it
 * alone with `npm run benchmark` to see the tables.
 *
 * With common-line cutting on, parts are spaced by the kerf (less half the fit clearance), because each
 * outline is moved out by half of that. The packers place parts edge to edge, so the cut outlines then lie
 * on one another wherever two parts touch. "Today" is the same box packed with the usual 2 mm gap and
 * cut with the best order of whole outlines. Both keep a 2 mm margin at the edge of the sheet.
 */

const ALGORITHMS: PackingAlgorithm[] = ['maxrects', 'skyline', 'guillotine'];
const BOX_COUNT = 300;
const STRIP = { size: 'custom' as const, width: 420, height: 100000 };

interface Box {
  params: BoxParams;
  panels: Panel[];
}

function boxes(count: number, kerf: number): Box[] {
  return randomValidParams(count, 2024).map(params => {
    params.material.kerf = kerf;
    params.material.fitClearance = 0;
    const geo = buildBoxGeometry(params);
    geo.panels.forEach(p => applyJointToPanel(p, params.joint));
    return { params, panels: geo.panels };
  });
}

function config(algorithm: PackingAlgorithm | 'search', common: boolean): SheetConfig {
  const base = { ...defaultSheetConfig(), ...STRIP, gap: 2, commonLine: { enabled: common } };
  return algorithm === 'search'
    ? { ...base, search: { enabled: true, candidates: 100 } }
    : { ...base, algorithm, search: { enabled: false, candidates: 1 } };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('common-line cutting on random boxes', () => {
  const standard = boxes(BOX_COUNT, 0.1);

  it('keeps every part apart and shares only lines that separate two parts', () => {
    for (const algorithm of [...ALGORITHMS, 'search' as const]) {
      for (const [n, { params, panels }] of standard.slice(0, 60).entries()) {
        const layout = packPanels(panels, config(algorithm, true), params.material);
        const contours = layoutContours(layout, params);
        const result = findCommonLines(contours);
        expect(result.conflicts, `${algorithm} box ${n}`).toBe(0);

        // No two cut outlines overlap, checked rectangle by rectangle on the exact shapes.
        const shapes: PlacedShape[] = contours.map(c => {
          const minX = Math.min(...c.map(p => p.x));
          const minY = Math.min(...c.map(p => p.y));
          return { shape: decompose(c)!, x: minX, y: minY };
        });
        for (let a = 0; a < shapes.length; a++) {
          for (let b = a + 1; b < shapes.length; b++) {
            expect(tooClose(shapes[a], shapes[b], 0), `${algorithm} box ${n}: parts ${a} and ${b} overlap`).toBe(false);
          }
        }
      }
    }
  });

  it('measures how much is cut once', () => {
    const lines: string[] = [''];
    const rows: Array<{ label: string; total: number[]; shared: number[]; time: number[]; baseTime: number[]; area: number[]; baseArea: number[]; paths: number[]; parts: number[] }> = [];
    for (const algorithm of [...ALGORITHMS, 'search' as const]) {
      const row = { label: algorithm === 'search' ? 'Search (100)' : PACKING_LABELS[algorithm], total: [] as number[], shared: [] as number[], time: [] as number[], baseTime: [] as number[], area: [] as number[], baseArea: [] as number[], paths: [] as number[], parts: [] as number[] };
      for (const { params, panels } of standard) {
        const tight = packPanels(panels, config(algorithm, true), params.material);
        const contours = layoutContours(tight, params);
        const r = findCommonLines(contours);
        const travel = pathsTravel(orderPaths(r.paths));
        row.paths.push(r.paths.length);
        row.parts.push(contours.length);
        row.total.push(r.totalLength);
        row.shared.push(r.sharedLength);
        row.time.push(r.uniqueLength / DEFAULT_CUTTING.cutSpeed + travel / DEFAULT_CUTTING.travelSpeed);

        const today = packPanels(panels, config(algorithm, false), params.material);
        row.baseTime.push(cutStats(layoutContours(today, params), DEFAULT_CUTTING).totalSecondsOptimised);
        const extent = (l: typeof tight) => {
          const placed = l.placed.filter(p => !p.overflow);
          return Math.max(...placed.map(p => p.x + (p.rotated ? p.panel.panelHeight : p.panel.panelWidth))) *
            Math.max(...placed.map(p => p.y + (p.rotated ? p.panel.panelWidth : p.panel.panelHeight)));
        };
        row.area.push(extent(tight));
        row.baseArea.push(extent(today));
      }
      rows.push(row);
    }

    lines.push(`Cutting a shared line once, on ${standard.length} random boxes (kerf 0.1 mm, parts spaced by the kerf, 420 mm wide strip)`);
    lines.push('method          cut length   cut once   share   job time, shared   job time, today   time saved   occupied vs gap 2');
    for (const r of rows) {
      lines.push(
        `${r.label.padEnd(15)} ${mean(r.total).toFixed(0).padStart(7)} mm ${mean(r.shared).toFixed(0).padStart(7)} mm ${(mean(r.shared) / mean(r.total) * 100).toFixed(1).padStart(6)}% ${(mean(r.time) / 60).toFixed(2).padStart(13)} min ${(mean(r.baseTime) / 60).toFixed(2).padStart(13)} min ${((1 - mean(r.time) / mean(r.baseTime)) * 100).toFixed(1).padStart(9)}% ${((mean(r.area) / mean(r.baseArea) - 1) * 100).toFixed(1).padStart(14)}%`,
      );
    }
    lines.push('');
    lines.push('method          paths to cut   parts   (each path is a start of the laser, which the time above does not count)');
    for (const r of rows) {
      lines.push(`${r.label.padEnd(15)} ${mean(r.paths).toFixed(1).padStart(12)} ${mean(r.parts).toFixed(1).padStart(7)}`);
    }
    lines.push('(cut length: all outlines added up; cut once: the part of it that lies on another outline; time at 10 mm/s cutting, 200 mm/s travel, ordered)');
    lines.push('');
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));

    for (const r of rows) {
      expect(mean(r.shared)).toBeGreaterThan(0);
      expect(mean(r.time)).toBeLessThan(mean(r.baseTime));
    }
  });

  it('shows how the kerf changes it', () => {
    const lines = ['', 'Maxrects, parts spaced by the kerf, by kerf'];
    lines.push('kerf      cut once   share');
    for (const kerf of [0, 0.1, 0.2, 0.3]) {
      const set = boxes(100, kerf);
      const shared: number[] = [];
      const total: number[] = [];
      for (const { params, panels } of set) {
        const r = findCommonLines(layoutContours(packPanels(panels, config('maxrects', true), params.material), params));
        shared.push(r.sharedLength);
        total.push(r.totalLength);
      }
      lines.push(`${kerf.toFixed(1)} mm ${mean(shared).toFixed(0).padStart(8)} mm ${(mean(shared) / mean(total) * 100).toFixed(1).padStart(6)}%`);
    }
    lines.push('');
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
    expect(true).toBe(true);
  });
});
