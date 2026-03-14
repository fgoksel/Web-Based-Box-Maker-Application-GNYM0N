import { buildBoxGeometry, computeInternalDimensions } from './geometry/GeometryEngine';
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
const internal = computeInternalDimensions(testParams);

console.log('Web-Based Box Maker — Phase 2: Geometry Engine');
console.log('External dimensions:', testParams.width, 'x', testParams.depth, 'x', testParams.height, 'mm');
console.log('Internal dimensions:', internal.iW, 'x', internal.iD, 'x', internal.iH, 'mm');
console.log('Total panels generated:', geometry.panels.length);
console.log('Total material area:', geometry.totalMaterialArea.toFixed(2), 'mm²');
console.log('Panels:');
geometry.panels.forEach(p => {
  console.log(`  [${p.sequenceNumber}] ${p.name} — ${p.panelWidth}x${p.panelHeight}mm`);
});

