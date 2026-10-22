import { describe, expect, it, vi } from 'vitest';
import { defaultBoxParams } from '../utils/ProjectIO';
import { assemble, countMismatches } from './helpers/assembly';

// The assembly checks sample the whole box volume, which is slow on modest machines.
vi.setConfig({ testTimeout: 120_000 });

describe('Assembly of jointed panels', () => {
  it('fills the tray exactly once: no overlaps, gaps or stray tabs', () => {
    const params = defaultBoxParams();
    const result = countMismatches(assemble(params));
    expect(result).toEqual({ overlap: 0, gap: 0, stray: 0 });
  });

  it('also holds when frame and base thickness differ', () => {
    const params = defaultBoxParams();
    params.material.frameThickness = 4;
    params.material.baseThickness = 6;
    const result = countMismatches(assemble(params));
    expect(result).toEqual({ overlap: 0, gap: 0, stray: 0 });
  });

  it('also holds for the lid', () => {
    const params = defaultBoxParams();
    params.lid.enabled = true;
    const result = countMismatches(assemble(params));
    expect(result).toEqual({ overlap: 0, gap: 0, stray: 0 });
  });

  it('also holds with a 3 x 2 divider grid that cross-halves at every crossing', () => {
    const params = defaultBoxParams();
    params.divider.enabled = true;
    params.divider.columns = 3;
    params.divider.rows = 2;
    const result = countMismatches(assemble(params));
    expect(result).toEqual({ overlap: 0, gap: 0, stray: 0 });
  });

  it('also holds for lower dividers and a 2 x 4 grid', () => {
    const params = defaultBoxParams();
    params.divider.enabled = true;
    params.divider.columns = 2;
    params.divider.rows = 4;
    params.divider.heightOverride = 30;
    params.material.dividerThickness = 2;
    const result = countMismatches(assemble(params));
    expect(result).toEqual({ overlap: 0, gap: 0, stray: 0 });
  });

  it('keeps the divider slots when the joint style is none', () => {
    const params = defaultBoxParams();
    params.joint.style = 'none';
    params.divider.enabled = true;
    params.divider.columns = 2;
    params.divider.rows = 2;
    const solids = assemble(params);
    const col = solids.find(s => s.panel.name === 'Col Divider 1')!.panel;
    const row = solids.find(s => s.panel.name === 'Row Divider 1')!.panel;
    expect(col.outline.length).toBe(8);
    expect(row.outline.length).toBe(8);
    const wall = solids.find(s => s.panel.name === 'Front Wall')!.panel;
    expect(wall.outline).toHaveLength(4);
  });

  it('also holds for dividers placed from exact compartment sizes', () => {
    const params = defaultBoxParams();
    params.divider.enabled = true;
    params.divider.columnWidths = [40, 30, 38];
    params.divider.rowDepths = [20, 25, 33];
    const result = countMismatches(assemble(params));
    expect(result).toEqual({ overlap: 0, gap: 0, stray: 0 });
  });
});
