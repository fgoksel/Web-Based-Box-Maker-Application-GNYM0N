import type { Panel, Point2D, JointConfig } from '../models/types';

export interface TabSpec {
  count: number;
  tabWidth: number;
  gapWidth: number;
}

export function computeTabSpec(
  edgeLength: number,
  matThickness: number,
  config: JointConfig,
): TabSpec {
  const minTabWidth = matThickness * 1.5;

  if (config.tabWidthOverride > 0) {
    const tw = config.tabWidthOverride;
    const rawCount = Math.round(edgeLength / (tw * 2));
    let count = Math.max(1, rawCount % 2 === 0 ? rawCount - 1 : rawCount);
    // Even with an override, don't allow fingers so small they become fragile.
    while (count > 1 && edgeLength / (count * 2) < minTabWidth) {
      count -= 2;
    }
    const tabWidth = edgeLength / (count * 2);
    return { count, tabWidth, gapWidth: tabWidth };
  }

  let count = config.minTabCount;
  if (count % 2 === 0) count += 1;

  while (count >= 1) {
    const tabWidth = edgeLength / (count * 2);
    if (tabWidth >= minTabWidth) {
      return { count, tabWidth, gapWidth: tabWidth };
    }
    count -= 2;
  }

  return { count: 1, tabWidth: edgeLength / 2, gapWidth: edgeLength / 2 };
}

export function buildFingerJointOutline(
  pw: number,
  ph: number,
  matThickness: number,
  kerf: number,
  config: JointConfig,
): Point2D[] {
  const t = matThickness;
  const k = kerf;
  const pts: Point2D[] = [];

  const topSpec   = computeTabSpec(pw, t, config);
  const rightSpec = computeTabSpec(ph, t, config);
  const botSpec   = computeTabSpec(pw, t, config);
  const leftSpec  = computeTabSpec(ph, t, config);

  let cx = k;
  for (let i = 0; i < topSpec.count * 2; i++) {
    const tab = i % 2 === 0;
    const sw  = topSpec.tabWidth;
    if (tab) {
      pts.push({ x: cx,      y: -t + k });
      pts.push({ x: cx + sw, y: -t + k });
      pts.push({ x: cx + sw, y: k });
    } else {
      pts.push({ x: cx,      y: k });
      pts.push({ x: cx + sw, y: k });
    }
    cx += sw;
  }

  let cy = k;
  for (let i = 0; i < rightSpec.count * 2; i++) {
    const tab = i % 2 === 0;
    const sh  = rightSpec.tabWidth;
    if (tab) {
      pts.push({ x: pw + t - k, y: cy });
      pts.push({ x: pw + t - k, y: cy + sh });
      pts.push({ x: pw - k,     y: cy + sh });
    } else {
      pts.push({ x: pw - k, y: cy });
      pts.push({ x: pw - k, y: cy + sh });
    }
    cy += sh;
  }

  let bx = pw - k;
  for (let i = 0; i < botSpec.count * 2; i++) {
    const tab = i % 2 === 0;
    const sw  = botSpec.tabWidth;
    if (tab) {
      pts.push({ x: bx,      y: ph + t - k });
      pts.push({ x: bx - sw, y: ph + t - k });
      pts.push({ x: bx - sw, y: ph - k });
    } else {
      pts.push({ x: bx,      y: ph - k });
      pts.push({ x: bx - sw, y: ph - k });
    }
    bx -= sw;
  }

  let ly = ph - k;
  for (let i = 0; i < leftSpec.count * 2; i++) {
    const tab = i % 2 === 0;
    const sh  = leftSpec.tabWidth;
    if (tab) {
      pts.push({ x: -t + k, y: ly });
      pts.push({ x: -t + k, y: ly - sh });
      pts.push({ x: k,      y: ly - sh });
    } else {
      pts.push({ x: k, y: ly });
      pts.push({ x: k, y: ly - sh });
    }
    ly -= sh;
  }

  return pts;
}

export function applyJointToPanel(
  panel: Panel,
  config: JointConfig,
  kerf: number,
): void {
  const { panelWidth: pw, panelHeight: ph, thickness: t } = panel;
  const k = kerf / 2;

  switch (config.style) {
    case 'finger':
    case 'box':
      panel.outline = buildFingerJointOutline(pw, ph, t, k, config);
      {
        // Normalize outline to (0,0) so width/height reflect the real cut size.
        // Finger/box joints can extend beyond the original rectangle by thickness.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of panel.outline) {
          if (pt.x < minX) minX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y > maxY) maxY = pt.y;
        }

        if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
          const dx = -minX;
          const dy = -minY;
          panel.outline = panel.outline.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
          panel.panelWidth = maxX - minX;
          panel.panelHeight = maxY - minY;
        }
      }
      break;
    case 'none':
    default:
      panel.outline = [
        { x: k,      y: k },
        { x: pw - k, y: k },
        { x: pw - k, y: ph - k },
        { x: k,      y: ph - k },
      ];
      break;
  }
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