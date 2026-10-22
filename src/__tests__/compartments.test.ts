import { describe, expect, it } from 'vitest';
import { layoutCompartments, parseSizeList } from '../geometry/compartments';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { defaultBoxParams } from '../utils/ProjectIO';

describe('layoutCompartments', () => {
  it('splits the space into equal compartments', () => {
    const l = layoutCompartments(114, 3, 3);
    expect(l.error).toBeNull();
    expect(l.sizes).toEqual([36, 36, 36]);
    // first divider starts after 36 mm, so its centre is 36 + 1.5; the next after 36 + 3 + 36.
    expect(l.dividerCenters[0]).toBeCloseTo(37.5, 9);
    expect(l.dividerCenters[1]).toBeCloseTo(76.5, 9);
    expect(l.requiredInner).toBeCloseTo(114, 9);
  });

  it('gives no dividers for a single compartment', () => {
    expect(layoutCompartments(100, 3, 1).dividerCenters).toEqual([]);
  });

  it('uses exact sizes when they fill the space', () => {
    const l = layoutCompartments(114, 3, 2, [40, 30, 38]);
    expect(l.error).toBeNull();
    expect(l.sizes).toEqual([40, 30, 38]);
    expect(l.dividerCenters[0]).toBeCloseTo(41.5, 9);
    expect(l.dividerCenters[1]).toBeCloseTo(74.5, 9);
  });

  it('ignores the count when exact sizes are given', () => {
    expect(layoutCompartments(114, 3, 7, [40, 30, 38]).sizes).toHaveLength(3);
  });

  it('says how much space the sizes need when they do not fit', () => {
    const l = layoutCompartments(114, 3, 1, [40, 30, 30], 'width');
    expect(l.error).toContain('inside width of 106.00 mm');
    expect(l.error).toContain('114.00 mm');
    expect(l.requiredInner).toBeCloseTo(106, 9);
  });

  it('accepts sizes within a hundredth of a millimetre', () => {
    expect(layoutCompartments(114.004, 3, 1, [40, 30, 38]).error).toBeNull();
  });

  it('rejects sizes that are not positive numbers', () => {
    expect(layoutCompartments(114, 3, 1, [40, -2, 38]).error).toMatch(/greater than 0/);
    expect(layoutCompartments(114, 3, 1, [40, NaN]).error).toMatch(/greater than 0/);
  });

  it('reports equal compartments that cannot fit', () => {
    expect(layoutCompartments(10, 3, 5, [], 'depth').error).toBe('5 compartments do not fit the inside depth');
  });
});

describe('parseSizeList', () => {
  it('reads numbers separated by commas, semicolons or spaces', () => {
    expect(parseSizeList('40, 30; 50 12.5')).toEqual([40, 30, 50, 12.5]);
  });

  it('treats empty text as no sizes', () => {
    expect(parseSizeList('')).toEqual([]);
    expect(parseSizeList('   ')).toEqual([]);
  });

  it('turns anything that is not a number into NaN', () => {
    const out = parseSizeList('a, 3');
    expect(Number.isNaN(out[0])).toBe(true);
    expect(out[1]).toBe(3);
  });
});

describe('dividers with exact compartment sizes', () => {
  function customParams() {
    const params = defaultBoxParams();
    params.divider.enabled = true;
    params.divider.columnWidths = [40, 30, 38];
    params.divider.rowDepths = [20, 25, 33];
    return params; // inside 114 x 84 mm with 3 mm dividers fits these exactly
  }

  it('puts every divider where the sizes say', () => {
    const geo = buildBoxGeometry(customParams());
    const cols = geo.panels.filter(p => p.name.startsWith('Col Divider'));
    const rows = geo.panels.filter(p => p.name.startsWith('Row Divider'));
    expect(cols).toHaveLength(2);
    expect(rows).toHaveLength(3 - 1);
    expect(cols[0].position3D.x).toBeCloseTo(-57 + 41.5, 9);
    expect(cols[1].position3D.x).toBeCloseTo(-57 + 74.5, 9);
    expect(rows[0].position3D.z).toBeCloseTo(-42 + 21.5, 9);
    expect(rows[1].position3D.z).toBeCloseTo(-42 + 49.5, 9);
  });

  it('refuses sizes that do not fill the box', () => {
    const params = customParams();
    params.divider.columnWidths = [40, 30, 30];
    expect(() => buildBoxGeometry(params)).toThrow(/inside width/);
  });

  it('matches the equal layout when the sizes are equal', () => {
    const equal = defaultBoxParams();
    equal.divider.enabled = true;
    equal.divider.columns = 3;
    equal.divider.rows = 2;
    const exact = defaultBoxParams();
    exact.divider.enabled = true;
    exact.divider.columnWidths = [36, 36, 36];
    exact.divider.rowDepths = [40.5, 40.5];
    const a = buildBoxGeometry(equal).panels.map(p => [p.name, p.position3D.x, p.position3D.z]);
    const b = buildBoxGeometry(exact).panels.map(p => [p.name, p.position3D.x, p.position3D.z]);
    expect(b).toEqual(a.map(([n, x, z]) => [n, expect.closeTo(x as number, 9), expect.closeTo(z as number, 9)]));
  });
});
