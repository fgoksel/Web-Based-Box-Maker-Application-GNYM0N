import { describe, expect, it } from 'vitest';
import { applyJointToPanel, computeTabSpec } from '../geometry/JointEngine';
import { cleanOutline, offsetOutline, outlineBounds, signedArea } from '../geometry/outline';
import { defaultBoxParams } from '../utils/ProjectIO';
import { buildBoxGeometry } from '../geometry/GeometryEngine';

describe('JointEngine', () => {
  it('splits an edge into a symmetric tab/gap pattern of at least one tab', () => {
    const params = defaultBoxParams();
    const spec = computeTabSpec(100, params.material.frameThickness, params.joint);
    expect(spec.count).toBeGreaterThanOrEqual(1);
    expect(spec.tabWidth).toBeGreaterThan(0);
    // 2*count - 1 equal segments fill the edge exactly.
    expect(spec.tabWidth * (2 * spec.count - 1)).toBeCloseTo(100, 9);
  });

  it('keeps fingers at least 1.5 x the material thickness wide', () => {
    const params = defaultBoxParams();
    params.joint.minTabCount = 99;
    const spec = computeTabSpec(60, 3, params.joint);
    expect(spec.tabWidth).toBeGreaterThanOrEqual(4.5 - 1e-9);
  });

  it('applies a non-empty outline without NaNs', () => {
    const params = defaultBoxParams();
    const geo = buildBoxGeometry(params);
    const panel = geo.panels[0];
    applyJointToPanel(panel, params.joint);

    expect(panel.outline.length).toBeGreaterThan(3);
    for (const pt of panel.outline) {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
    }
  });

  it('normalises the outline to (0,0) and keeps the nominal body inside it', () => {
    const params = defaultBoxParams();
    const geo = buildBoxGeometry(params);
    for (const panel of geo.panels) {
      const nominalW = panel.panelWidth;
      const nominalH = panel.panelHeight;
      applyJointToPanel(panel, params.joint);
      const b = outlineBounds(panel.outline);
      expect(b.minX).toBeCloseTo(0, 9);
      expect(b.minY).toBeCloseTo(0, 9);
      expect(panel.panelWidth).toBeCloseTo(b.maxX, 9);
      expect(panel.panelHeight).toBeCloseTo(b.maxY, 9);
      expect(panel.body?.width).toBeCloseTo(nominalW, 9);
      expect(panel.body?.height).toBeCloseTo(nominalH, 9);
    }
  });

  it('is idempotent when applied twice', () => {
    const params = defaultBoxParams();
    const geo = buildBoxGeometry(params);
    const panel = geo.panels[1];
    applyJointToPanel(panel, params.joint);
    const once = JSON.stringify(panel.outline);
    applyJointToPanel(panel, params.joint);
    expect(JSON.stringify(panel.outline)).toBe(once);
  });

  it('leaves plain rectangles when the joint style is none', () => {
    const params = defaultBoxParams();
    params.joint.style = 'none';
    const geo = buildBoxGeometry(params);
    const panel = geo.panels[1];
    applyJointToPanel(panel, params.joint);
    expect(panel.outline).toHaveLength(4);
  });
});

describe('outline helpers', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('removes duplicates, spikes and collinear points', () => {
    const noisy = [
      { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 },
      { x: 10, y: 10 }, { x: 14, y: 10 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(cleanOutline(noisy)).toEqual(square);
  });

  it('offsets a square outward by d on every side', () => {
    const grown = offsetOutline(square, 0.5);
    const b = outlineBounds(grown);
    expect(b.minX).toBeCloseTo(-0.5, 9);
    expect(b.maxX).toBeCloseTo(10.5, 9);
    expect(signedArea(grown)).toBeCloseTo(121, 9);
  });

  it('offsets the same way whichever way the polygon is wound', () => {
    const grown = offsetOutline([...square].reverse(), 0.5);
    expect(Math.abs(signedArea(grown))).toBeCloseTo(121, 9);
  });
});
