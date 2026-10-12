import type { JointConfig, JointEdge, JointPlan, Panel, Point2D } from '../models/types';
import { cleanOutline, outlineBounds, translateOutline } from './outline';

export interface TabSpec {
  /** Number of fingers (tabs) along the jointed range. */
  count: number;
  tabWidth: number;
  gapWidth: number;
}

/**
 * Splits `edgeLength` into `2*count - 1` equal segments (tab, gap, ..., tab).
 * The pattern is symmetric, so two mating edges line up whichever way they are walked.
 */
export function computeTabSpec(
  edgeLength: number,
  matThickness: number,
  config: JointConfig,
): TabSpec {
  const minTabWidth = matThickness * 1.5;
  const segmentWidth = (count: number) => edgeLength / (2 * count - 1);

  let count: number;
  if (config.tabWidthOverride > 0) {
    const segments = Math.max(1, Math.round(edgeLength / config.tabWidthOverride));
    count = Math.max(1, Math.floor((segments + 1) / 2));
  } else {
    count = Math.max(1, Math.floor(config.minTabCount));
  }

  // Never allow fingers so small that they become fragile.
  while (count > 1 && segmentWidth(count) < minTabWidth) count--;

  const w = segmentWidth(count);
  return { count, tabWidth: w, gapWidth: w };
}

const FLAT_EDGE: JointEdge = { kind: 'flat', depth: 0, start: 0, length: 0, basis: 0 };

/** Points of one edge as (distance along the edge, offset outward from the panel). */
function edgeProfile(
  length: number,
  edge: JointEdge,
  config: JointConfig,
  reversed: boolean,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [[0, 0]];

  if (edge.kind === 'notches') {
    // Notch positions are given in panel axes; top and left edges are walked backwards.
    const slots = (edge.notches ?? [])
      .map(n => ({ ...n, s: reversed ? length - n.at : n.at }))
      .sort((a, b) => a.s - b.s);
    for (const n of slots) {
      const s0 = n.s - n.width / 2;
      const s1 = n.s + n.width / 2;
      pts.push([s0, 0], [s0, -n.depth], [s1, -n.depth], [s1, 0]);
    }
    pts.push([length, 0]);
    return pts;
  }

  if (edge.kind === 'flat' || edge.length <= 0) {
    pts.push([length, 0]);
    return pts;
  }

  const spec = computeTabSpec(edge.length, edge.basis, config);
  const segments = 2 * spec.count - 1;
  const offset = edge.kind === 'tab' ? edge.depth : -edge.depth;

  for (let i = 0; i < segments; i += 2) {
    const s0 = edge.start + i * spec.tabWidth;
    const s1 = s0 + spec.tabWidth;
    pts.push([s0, 0], [s0, offset], [s1, offset], [s1, 0]);
  }
  pts.push([length, 0]);
  return pts;
}

export function buildJointOutline(
  pw: number,
  ph: number,
  plan: JointPlan,
  config: JointConfig,
): Point2D[] {
  const pts: Point2D[] = [];
  for (const [s, o] of edgeProfile(pw, plan.bottom, config, false)) pts.push({ x: s, y: -o });
  for (const [s, o] of edgeProfile(ph, plan.right, config, false)) pts.push({ x: pw + o, y: s });
  for (const [s, o] of edgeProfile(pw, plan.top, config, true)) pts.push({ x: pw - s, y: ph + o });
  for (const [s, o] of edgeProfile(ph, plan.left, config, true)) pts.push({ x: -o, y: ph - s });
  return cleanOutline(pts);
}

/**
 * Replaces the panel's rectangle with its jointed outline. Safe to call repeatedly:
 * the nominal size is read back from `panel.body`.
 */
export function applyJointToPanel(panel: Panel, config: JointConfig): void {
  const pw = panel.body?.width ?? panel.panelWidth;
  const ph = panel.body?.height ?? panel.panelHeight;

  // Finger joints follow the chosen style; divider cross-halving slots are structural
  // and stay even when the style is "none".
  const jointed = config.style === 'finger' || config.style === 'box';
  const keep = (e: JointEdge): JointEdge => (jointed || e.kind === 'notches' ? e : FLAT_EDGE);
  const p = panel.jointPlan;
  const plan: JointPlan = p
    ? { bottom: keep(p.bottom), right: keep(p.right), top: keep(p.top), left: keep(p.left) }
    : { bottom: FLAT_EDGE, right: FLAT_EDGE, top: FLAT_EDGE, left: FLAT_EDGE };

  const raw = buildJointOutline(pw, ph, plan, config);
  const { minX, minY, maxX, maxY } = outlineBounds(raw);
  panel.outline = translateOutline(raw, -minX, -minY);
  panel.panelWidth = maxX - minX;
  panel.panelHeight = maxY - minY;
  // The nominal rectangle sat at (0,0)..(pw,ph) before normalising.
  panel.body = { x: -minX, y: -minY, width: pw, height: ph };
}
