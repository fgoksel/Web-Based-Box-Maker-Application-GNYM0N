import { describe, expect, it } from 'vitest';
import { applyJointToPanel, computeTabSpec } from '../geometry/JointEngine';
import { defaultBoxParams } from '../utils/ProjectIO';
import { buildBoxGeometry } from '../geometry/GeometryEngine';

describe('JointEngine', () => {
  it('computes an odd tab count >= 1', () => {
    const params = defaultBoxParams();
    const spec = computeTabSpec(100, params.material.frameThickness, params.joint);
    expect(spec.count).toBeGreaterThanOrEqual(1);
    expect(spec.count % 2).toBe(1);
    expect(spec.tabWidth).toBeGreaterThan(0);
  });

  it('applies a non-empty outline without NaNs', () => {
    const params = defaultBoxParams();
    const geo = buildBoxGeometry(params);
    const panel = geo.panels[0];
    applyJointToPanel(panel, params.joint, params.material.kerf);

    expect(panel.outline.length).toBeGreaterThan(3);
    for (const pt of panel.outline) {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
    }
  });
});

