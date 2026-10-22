import { describe, expect, it } from 'vitest';
import { defaultBoxParams, defaultSheetConfig } from '../utils/ProjectIO';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { packPanels, packPanelsByThickness } from '../svg/BinPacker';

function rectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe('BinPacker', () => {
  it('marks overflow when sheet is too small', () => {
    const params = defaultBoxParams();
    const geo = buildBoxGeometry(params);

    const sheet = defaultSheetConfig();
    sheet.size = 'custom';
    sheet.width = 50;
    sheet.height = 50;
    sheet.gap = 1;

    const layout = packPanels(geo.panels, sheet);
    expect(layout.placed.some(p => p.overflow)).toBe(true);
  });

  it('does not place overlapping rectangles for non-overflow parts', () => {
    const params = defaultBoxParams();
    const geo = buildBoxGeometry(params);
    const sheet = defaultSheetConfig();
    sheet.size = 'A1';

    const layout = packPanels(geo.panels, sheet);
    const placed = layout.placed.filter(p => !p.overflow);

    const rects = placed.map(pl => {
      const w = pl.rotated ? pl.panel.panelHeight : pl.panel.panelWidth;
      const h = pl.rotated ? pl.panel.panelWidth : pl.panel.panelHeight;
      return { x: pl.x, y: pl.y, w, h, seq: pl.panel.sequenceNumber };
    });

    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const ov = rectsOverlap(rects[i], rects[j]);
        expect(ov, `rectangles overlap: #${rects[i].seq} vs #${rects[j].seq}`).toBe(false);
      }
    }
  });

  it('can group packing by thickness', () => {
    const params = defaultBoxParams();
    params.material.baseThickness = 4;
    params.material.frameThickness = 3;
    const geo = buildBoxGeometry(params);
    const sheet = defaultSheetConfig();
    sheet.size = 'A1';

    const grouped = packPanelsByThickness(geo.panels, sheet);
    expect(grouped.length).toBeGreaterThanOrEqual(1);
    // With different base/frame thickness, should typically produce >1 groups.
    // (Bottom uses base thickness; walls use frame thickness.)
    expect(grouped.length).toBeGreaterThanOrEqual(2);
    expect(grouped.every(g => g.layout.config.width > 0 && g.layout.config.height > 0)).toBe(true);
  });

  it('uses the packing method named in the sheet settings', () => {
    const params = defaultBoxParams();
    params.divider.enabled = true;
    params.divider.columns = 3;
    params.divider.rows = 3;
    const geo = buildBoxGeometry(params);

    const layouts = (['guillotine', 'maxrects', 'skyline'] as const).map(algorithm => {
      const layout = packPanels(geo.panels, { ...defaultSheetConfig(), algorithm });
      expect(layout.config.algorithm).toBe(algorithm);
      expect(layout.placed.some(p => p.overflow)).toBe(false);
      return layout.placed.map(p => `${p.panel.name}@${p.x.toFixed(1)},${p.y.toFixed(1)}${p.rotated ? 'R' : ''}`).join(' ');
    });
    // The methods really are different: they do not all produce the same arrangement.
    expect(new Set(layouts).size).toBeGreaterThan(1);
  });

  it('packs with guillotine when the settings name no method (older files)', () => {
    const geo = buildBoxGeometry(defaultBoxParams());
    const { algorithm: _ignored, ...withoutMethod } = defaultSheetConfig();
    const a = packPanels(geo.panels, withoutMethod);
    const b = packPanels(geo.panels, { ...withoutMethod, algorithm: 'guillotine' });
    expect(a.placed.map(p => [p.x, p.y, p.rotated])).toEqual(b.placed.map(p => [p.x, p.y, p.rotated]));
  });

  it('passes the method on when grouping by thickness', () => {
    const params = defaultBoxParams();
    params.material.baseThickness = 6;
    const geo = buildBoxGeometry(params);
    const groups = packPanelsByThickness(geo.panels, { ...defaultSheetConfig(), algorithm: 'skyline' });
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) expect(g.layout.config.algorithm).toBe('skyline');
  });
});
