import * as THREE from 'three';
import { buildBoxGeometry } from '../../geometry/GeometryEngine';
import { applyJointToPanel } from '../../geometry/JointEngine';
import type { BoxParams, Panel, Point2D } from '../../models/types';

/**
 * Builds a box, puts its panels in 3D and compares the real (jointed) material with the nominal
 * one at sample points. A perfect assembly has every point of nominal material covered by exactly
 * one panel, and nothing outside it.
 */

export interface Solid {
  panel: Panel;
  inverse: THREE.Matrix4;
  /** Centre of the panel body in outline coordinates (what the 3D renderer centres on). */
  cx: number;
  cy: number;
  /** Nominal (joint-free) body size. */
  bw: number;
  bh: number;
  /** Points farther than this from the panel centre cannot be inside it. */
  reach: number;
}

function insidePolygon(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function assemble(params: BoxParams): Solid[] {
  const geo = buildBoxGeometry(params);
  const nominal = geo.panels.map(p => ({ w: p.panelWidth, h: p.panelHeight }));
  geo.panels.forEach(p => applyJointToPanel(p, params.joint));

  return geo.panels.map((panel, i) => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(panel.position3D.x, panel.position3D.y, panel.position3D.z),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(panel.rotation3D.x, panel.rotation3D.y, panel.rotation3D.z, 'XYZ'),
      ),
      new THREE.Vector3(1, 1, 1),
    );
    const body = panel.body;
    return {
      panel,
      inverse: m.invert(),
      cx: body ? body.x + body.width / 2 : panel.panelWidth / 2,
      cy: body ? body.y + body.height / 2 : panel.panelHeight / 2,
      bw: nominal[i].w,
      bh: nominal[i].h,
      reach: Math.hypot(panel.panelWidth, panel.panelHeight) + panel.thickness,
    };
  });
}

/** Material hits of the real (jointed) outlines and of the nominal rectangles at a world point. */
function hits(solids: Solid[], x: number, y: number, z: number) {
  let actual = 0;
  let nominal = 0;
  const v = new THREE.Vector3();
  for (const s of solids) {
    const c = s.panel.position3D;
    if (Math.abs(x - c.x) > s.reach || Math.abs(y - c.y) > s.reach || Math.abs(z - c.z) > s.reach) continue;
    v.set(x, y, z).applyMatrix4(s.inverse);
    if (Math.abs(v.z) > s.panel.thickness / 2) continue;
    if (Math.abs(v.x) <= s.bw / 2 && Math.abs(v.y) <= s.bh / 2) nominal++;
    const local = { x: v.x + s.cx, y: v.y + s.cy };
    if (insidePolygon(local, s.panel.outline)) actual++;
  }
  return { actual, nominal };
}

export function countMismatches(solids: Solid[], step = 1): { overlap: number; gap: number; stray: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const s of solids) {
    const r = Math.max(s.panel.panelWidth, s.panel.panelHeight) + 5;
    const p = s.panel.position3D;
    minX = Math.min(minX, p.x - r); maxX = Math.max(maxX, p.x + r);
    minY = Math.min(minY, p.y - r); maxY = Math.max(maxY, p.y + r);
    minZ = Math.min(minZ, p.z - r); maxZ = Math.max(maxZ, p.z + r);
  }

  const out = { overlap: 0, gap: 0, stray: 0 };
  for (let x = minX + 0.37; x < maxX; x += step) {
    for (let y = minY + 0.37; y < maxY; y += step) {
      for (let z = minZ + 0.37; z < maxZ; z += step) {
        const { actual, nominal } = hits(solids, x, y, z);
        if (actual > 1) out.overlap++;
        else if (nominal > 0 && actual === 0) out.gap++;
        else if (nominal === 0 && actual > 0) out.stray++;
      }
    }
  }
  return out;
}
