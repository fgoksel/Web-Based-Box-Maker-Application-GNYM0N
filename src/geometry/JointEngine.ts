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

/** Points of one edge as (distance along the edge, offset outward from the panel). */
function edgeProfile(length: number, edge: JointEdge, config: JointConfig): Array<[number, number]> {
  const pts: Array<[number, number]> = [[0, 0]];
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
  for (const [s, o] of edgeProfile(pw, plan.bottom, config)) pts.push({ x: s, y: -o });
  for (const [s, o] of edgeProfile(ph, plan.right, config)) pts.push({ x: pw + o, y: s });
  for (const [s, o] of edgeProfile(pw, plan.top, config)) pts.push({ x: pw - s, y: ph + o });
  for (const [s, o] of edgeProfile(ph, plan.left, config)) pts.push({ x: -o, y: ph - s });
  return cleanOutline(pts);
}

/**
 * Replaces the panel's rectangle with its jointed outline. Safe to call repeatedly:
 * the nominal size is read back from `panel.body`.
 */
export function applyJointToPanel(panel: Panel, config: JointConfig): void {
  const pw = panel.body?.width ?? panel.panelWidth;
  const ph = panel.body?.height ?? panel.panelHeight;

  const jointed = config.style === 'finger' || config.style === 'box';
  if (!jointed || !panel.jointPlan) {
    panel.outline = [
      { x: 0, y: 0 },
      { x: pw, y: 0 },
      { x: pw, y: ph },
      { x: 0, y: ph },
    ];
    panel.panelWidth = pw;
    panel.panelHeight = ph;
    panel.body = { x: 0, y: 0, width: pw, height: ph };
    return;
  }

  const raw = buildJointOutline(pw, ph, panel.jointPlan, config);
  const { minX, minY, maxX, maxY } = outlineBounds(raw);
  panel.outline = translateOutline(raw, -minX, -minY);
  panel.panelWidth = maxX - minX;
  panel.panelHeight = maxY - minY;
  // The nominal rectangle sat at (0,0)..(pw,ph) before normalising.
  panel.body = { x: -minX, y: -minY, width: pw, height: ph };
}

export interface SlotSpec {
  slotWidth: number;
  slotDepth: number;
  positions: number[];
}

export function computeDividerSlots(
  panelLength: number,
  slotCount: number,
  spacing: number,
  matThickness: number,
  kerf: number,
): SlotSpec {
  const slotWidth = matThickness + kerf;
  const slotDepth = panelLength / 2;
  const positions: number[] = [];

  for (let i = 1; i <= slotCount; i++) {
    positions.push(i * spacing);
  }

  return { slotWidth, slotDepth, positions };
}