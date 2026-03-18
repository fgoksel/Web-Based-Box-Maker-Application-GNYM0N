import { buildBoxGeometry } from './geometry/GeometryEngine';
import { applyJointToPanel } from './geometry/JointEngine';
import { BoxRenderer } from './rendering/BoxRenderer';
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

const canvas = document.createElement('canvas');
canvas.style.width  = '100vw';
canvas.style.height = '100vh';
canvas.style.display = 'block';
document.body.style.margin = '0';
document.body.appendChild(canvas);

const boxRenderer = new BoxRenderer(canvas);
boxRenderer.resize(window.innerWidth, window.innerHeight);
boxRenderer.loadGeometry(geometry);
boxRenderer.start();

window.addEventListener('resize', () => {
  boxRenderer.resize(window.innerWidth, window.innerHeight);
});

console.log('Web-Based Box Maker — Phase 4: 3D Rendering');
console.log('Panels loaded into Three.js scene:', geometry.panels.length);
