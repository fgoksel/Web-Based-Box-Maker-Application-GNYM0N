import { describe, expect, it } from 'vitest';
import { buildBoxGeometry, computeInternalDimensions } from '../geometry/GeometryEngine';
import { defaultBoxParams } from '../utils/ProjectIO';

describe('GeometryEngine', () => {
  it('computes positive internal dimensions for defaults', () => {
    const params = defaultBoxParams();
    const { iW, iD, iH } = computeInternalDimensions(params);
    expect(iW).toBeGreaterThan(0);
    expect(iD).toBeGreaterThan(0);
    expect(iH).toBeGreaterThan(0);
  });

  it('builds expected base panels', () => {
    const params = defaultBoxParams();
    params.lid.enabled = false;
    params.divider.enabled = false;
    params.inset.enabled = false;

    const geo = buildBoxGeometry(params);
    const names = geo.panels.map(p => p.name);
    expect(names).toContain('Bottom');
    expect(names).toContain('Front Wall');
    expect(names).toContain('Back Wall');
    expect(names).toContain('Left Wall');
    expect(names).toContain('Right Wall');
    expect(geo.panels.length).toBe(5);
  });

  it('adds lid panels when enabled', () => {
    const params = defaultBoxParams();
    params.lid.enabled = true;
    params.divider.enabled = false;

    const geo = buildBoxGeometry(params);
    const names = geo.panels.map(p => p.name);
    expect(names).toContain('Lid Bottom');
    expect(names).toContain('Lid Front Wall');
    expect(names).toContain('Lid Back Wall');
    expect(names).toContain('Lid Left Wall');
    expect(names).toContain('Lid Right Wall');
  });

  it('aligns bottom and wall panels to external height correctly', () => {
    const params = defaultBoxParams();
    params.width = 120;
    params.depth = 90;
    params.height = 55;
    params.material.baseThickness = 3;
    params.material.frameThickness = 3;

    const geo = buildBoxGeometry(params);
    const bottom = geo.panels.find(p => p.name === 'Bottom')!;
    const front = geo.panels.find(p => p.name === 'Front Wall')!;

    const { iH } = computeInternalDimensions(params);
    const expectedBottomY = params.material.baseThickness / 2;
    const expectedWallY = params.material.baseThickness + iH / 2;

    expect(bottom.position3D.y).toBeCloseTo(expectedBottomY, 6);
    expect(front.position3D.y).toBeCloseTo(expectedWallY, 6);
    expect(bottom.rotation3D.x).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('places dividers on the internal floor', () => {
    const params = defaultBoxParams();
    params.height = 55;
    params.material.baseThickness = 3;
    params.divider.enabled = true;
    params.divider.columns = 2;
    params.divider.rows = 1;
    params.divider.heightOverride = 20;

    const geo = buildBoxGeometry(params);
    const div = geo.panels.find(p => p.name.startsWith('Col Divider'))!;

    const floorY = params.material.baseThickness;
    const expectedCenterY = floorY + params.divider.heightOverride / 2;
    expect(div.position3D.y).toBeCloseTo(expectedCenterY, 6);
  });
});

