import { labelIssue } from '../../geometry/label';
import { layoutCompartments } from '../../geometry/compartments';
import { defaultBoxParams } from '../../utils/ProjectIO';
import type { BoxParams } from '../../models/types';

/** Small deterministic random numbers, so a failing case can be reproduced from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splits `total` into `n` positive parts that add up to it exactly, in 0.01 mm steps. */
function randomParts(rand: () => number, total: number, n: number): number[] | null {
  const units = Math.round(total * 100);
  if (units < n * 100) return null;
  const weights = Array.from({ length: n }, () => 0.5 + rand());
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map(w => Math.floor((w / sum) * units));
  parts[n - 1] = units - parts.slice(0, -1).reduce((a, b) => a + b, 0);
  return parts.every(p => p >= 100) ? parts.map(p => p / 100) : null;
}

/**
 * Random box settings that the application accepts: sizes, materials, a lid, dividers (equal or with
 * exact compartment sizes), an engraved label, kerf and fit clearance. Settings the application
 * would refuse are skipped, so every returned box can be built.
 */
export function randomValidParams(count: number, seed: number): BoxParams[] {
  const rand = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

  const boxes: BoxParams[] = [];
  while (boxes.length < count) {
    const params = defaultBoxParams();
    const t = pick([2, 3, 4, 6]);
    params.width = Math.round(between(60, 300));
    params.depth = Math.round(between(50, 250));
    params.height = Math.round(between(30, 150));
    params.material = {
      frameThickness: t,
      baseThickness: pick([t, 3, 6]),
      dividerThickness: pick([2, 3]),
      kerf: Math.round(between(0, 0.2) * 100) / 100,
      fitClearance: Math.round(between(0, 0.3) * 100) / 100,
    };
    params.joint.style = rand() < 0.9 ? 'finger' : 'none';
    params.joint.minTabCount = pick([1, 2, 3, 4, 5]);
    if (rand() < 0.25) params.joint.tabWidthOverride = Math.round(between(5, 20));

    const { frameThickness: tF, baseThickness: tB, dividerThickness: tD } = params.material;
    const iW = params.width - 2 * tF;
    const iD = params.depth - 2 * tF;
    const iH = params.height - tB;
    if (iH < 10) continue;

    if (rand() < 0.4) {
      params.lid.enabled = true;
      params.lid.height = Math.round(between(15, 40));
      params.lid.tolerance = Math.round(between(0, 0.5) * 100) / 100;
      if (params.lid.height <= tB) continue;
    }

    if (rand() < 0.5) {
      params.divider.enabled = true;
      params.divider.columns = 1 + Math.floor(rand() * 4);
      params.divider.rows = 1 + Math.floor(rand() * 4);
      if (rand() < 0.5) params.divider.heightOverride = Math.round(between(10, 25));
      if (params.divider.heightOverride > iH) continue;

      if (rand() < 0.4) {
        const cols = randomParts(rand, iW - tD * 2, 3);
        const rows = randomParts(rand, iD - tD, 2);
        if (!cols || !rows) continue;
        params.divider.columnWidths = cols;
        params.divider.rowDepths = rows;
      }
      if (layoutCompartments(iW, tD, params.divider.columns, params.divider.columnWidths, 'width').error) continue;
      if (layoutCompartments(iD, tD, params.divider.rows, params.divider.rowDepths, 'depth').error) continue;
    }

    if (rand() < 0.3) {
      params.label = {
        enabled: true,
        text: pick(['TEA', 'Screws', 'A&B <1>', 'Spare parts']),
        face: pick(['front', 'back', 'left', 'right', 'bottom', 'top'] as const),
        fontSize: Math.round(between(4, 12)),
      };
      if (labelIssue(params)) continue;
    }

    boxes.push(params);
  }
  return boxes;
}
