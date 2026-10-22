import { describe, expect, it } from 'vitest';
import { defaultBoxParams, defaultSheetConfig } from '../utils/ProjectIO';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { packPanels } from '../svg/BinPacker';
import { cutOutline, generateSVG } from '../svg/SvgEngine';

describe('SvgEngine', () => {
  it('generates a valid svg document with at least one path', () => {
    const params = defaultBoxParams();
    const geo = buildBoxGeometry(params);
    const sheet = defaultSheetConfig();
    const layout = packPanels(geo.panels, sheet);
    const svg = generateSVG(layout, params);

    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg.includes('<svg')).toBe(true);
    expect(svg.includes('<path')).toBe(true);
  });

  it('includes an overflow comment when parts overflow', () => {
    const params = defaultBoxParams();
    const geo = buildBoxGeometry(params);
    const sheet = defaultSheetConfig();
    sheet.size = 'custom';
    sheet.width = 60;
    sheet.height = 60;
    sheet.gap = 1;

    const layout = packPanels(geo.panels, sheet);
    const svg = generateSVG(layout, params);
    expect(svg.includes('OVERFLOW')).toBe(true);
  });
});


describe('cutOutline (kerf and fit clearance)', () => {
  const rect = (w: number, h: number) => [
    { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h },
  ];
  const width = (pts: { x: number }[]) => Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x));
  const minX = (pts: { x: number }[]) => Math.min(...pts.map(p => p.x));

  it('leaves the outline alone when kerf and clearance cancel', () => {
    expect(cutOutline(rect(10, 10), 0, 0)).toEqual(rect(10, 10));
  });

  it('grows the path by the kerf so the finished part has its nominal size', () => {
    expect(width(cutOutline(rect(10, 10), 0.2, 0))).toBeCloseTo(10.2, 9);
  });

  it('keeps the outline starting at zero', () => {
    expect(minX(cutOutline(rect(10, 10), 0.2, 0))).toBeCloseTo(0, 9);
    expect(minX(cutOutline(rect(10, 10), 0, 0.4))).toBeCloseTo(0, 9);
  });

  it('leaves a slot exactly the clearance wider than its tab once the laser kerf is removed', () => {
    const kerf = 0.1;
    for (const clearance of [0, 0.1, 0.25, 0.5]) {
      // A tab is a 4 mm wide part; a slot is a 4 mm gap, which loses what a part of that width gains.
      const grow = width(cutOutline(rect(4, 3), kerf, clearance)) - 4;
      const tabAfterCut = 4 + grow - kerf;
      const slotAfterCut = 4 - grow + kerf;
      expect(slotAfterCut - tabAfterCut).toBeCloseTo(clearance, 9);
    }
  });
});
