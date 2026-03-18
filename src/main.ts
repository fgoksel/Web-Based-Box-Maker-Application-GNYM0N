import { buildBoxGeometry } from './geometry/GeometryEngine';
import { applyJointToPanel, computeTabSpec } from './geometry/JointEngine';
import type { BoxParams } from './models/types';

const testParams: BoxParams = {
  width: 120,
  depth: 90,
  height: 55,
  material: {
    frameThickness: 3,
    baseThickness: 3,
    dividerThickness: 3,
    kerf: 0.1,
  },
  joint: {
    style: 'finger',
    minTabCount: 3,
    tabWidthOverride: 0,
  },
  divider: {
    enabled: false,
    columns: 2,
    rows: 2,
    heightOverride: 0,
  },
  lid: {
    enabled: false,
    height: 12,
    tolerance: 0.2,
  },
  inset: {
    enabled: false,
    compartments: [],
  },
  label: {
    enabled: false,
    text: '',
    face: 'front',
    fontSize: 8,
  },
};

const geometry = buildBoxGeometry(testParams);

geometry.panels.forEach(p => {
  applyJointToPanel(p, testParams.joint, testParams.material.kerf);
});

console.log('Web-Based Box Maker — Phase 3: Finger Joint Engine');
console.log('Panels with joints applied:');

geometry.panels.forEach(p => {
  const tabSpec = computeTabSpec(p.panelWidth, p.thickness, testParams.joint);
  console.log(`  [${p.sequenceNumber}] ${p.name} — outline points: ${p.outline.length} — tabs per edge: ${tabSpec.count} — tab width: ${tabSpec.tabWidth.toFixed(2)}mm`);
});
