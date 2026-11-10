import type { SheetLayout, BoxParams, Point2D, PlacedPanel, CuttingConfig } from '../models/types';
import type { GroupedSheetLayout } from './BinPacker';
import { offsetOutline, translateOutline } from '../geometry/outline';
import { findCommonLines, orderPaths, outlinesOverlap, pathsTravel, type CommonLine, type CutPath } from './commonLine';
import { DEFAULT_CUTTING, contourLength, cutStats, listedPlan, optimisedPlan, planTravel, rotateContour, type Contour, type CutStats } from './cutting';

/**
 * The outline as it should be cut. The laser removes kerf/2 on each side of the path, so the path
 * moves outward by that much (tabs grow, slots shrink). The fit clearance then moves every edge in
 * by a quarter of the clearance: a tab gets narrower by half of it and a slot wider by half of it,
 * so that a slot ends up exactly `fitClearance` wider than the tab that goes in it.
 */
export function cutOutline(outline: Point2D[], kerf: number, fitClearance: number): Point2D[] {
  const d = kerf / 2 - fitClearance / 4;
  if (d === 0) return outline;
  return translateOutline(offsetOutline(outline, d), d, d);
}

function xmlEscape(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function f(n: number): string {
  return (Math.round(n * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
}

function removeCollinear(pts: { x: number; y: number }[], eps = 1e-4): { x: number; y: number }[] {
  const n = pts.length;
  if (n < 3) return pts;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n];
    const c = pts[i];
    const q = pts[(i + 1) % n];
    const cross = Math.abs((c.x - p.x) * (q.y - c.y) - (c.y - p.y) * (q.x - c.x));
    if (cross > eps) out.push(c);
  }
  return out.length >= 3 ? out : pts;
}

/** Path data of an open or closed cutting path: straight runs as H and V, closed paths ending in Z. */
function buildCutPathD(path: CutPath): string {
  const pts = path.points;
  if (pts.length < 2) return '';
  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    if (Math.abs(dy) < 1e-6)      d += `H${f(pts[i].x)}`;
    else if (Math.abs(dx) < 1e-6) d += `V${f(pts[i].y)}`;
    else                           d += `L${f(pts[i].x)},${f(pts[i].y)}`;
  }
  return path.closed ? d + 'Z' : d;
}

function buildPathD(pts: { x: number; y: number }[], ox: number, oy: number): string {
  const cl = removeCollinear(pts);
  if (cl.length < 2) return '';
  let d = `M${f(cl[0].x + ox)},${f(cl[0].y + oy)}`;
  for (let i = 1; i < cl.length; i++) {
    const dx = cl[i].x - cl[i - 1].x;
    const dy = cl[i].y - cl[i - 1].y;
    if (Math.abs(dy) < 1e-6)      d += `H${f(cl[i].x + ox)}`;
    else if (Math.abs(dx) < 1e-6) d += `V${f(cl[i].y + oy)}`;
    else                           d += `L${f(cl[i].x + ox)},${f(cl[i].y + oy)}`;
  }
  return d + 'Z';
}

const SVG_COLORS: string[] = [
  '#f0a500', '#00c8ff', '#39ff6e', '#ff6b9d',
  '#a78bfa', '#fbbf24', '#34d399', '#f87171',
  '#60a5fa', '#fb923c', '#e879f9', '#4ade80',
];

function svgColor(idx: number): string {
  return SVG_COLORS[idx % SVG_COLORS.length];
}

/**
 * The outline of a placed part as it lies on the sheet: turned if the packer turned it, moved by the
 * kerf and fit compensation (unless `compensate` is false, to get the nominal shape), and placed at its
 * position. Points that lie on a straight line are dropped.
 */
export function placedContour(pl: PlacedPanel, params: BoxParams, compensate = true): Contour {
  let outline = pl.panel.outline;
  if (pl.rotated) {
    outline = outline.map(pt => ({
      x: pl.panel.panelHeight - pt.y,
      y: pt.x,
    }));
  }
  if (compensate) outline = cutOutline(outline, params.material.kerf, params.material.fitClearance);
  return removeCollinear(outline).map(pt => ({ x: pt.x + pl.x, y: pt.y + pl.y }));
}

/** The outlines of every part that fits on the sheet, in the order the parts are listed. */
export function layoutContours(layout: SheetLayout, params: BoxParams, compensate = true): Contour[] {
  return layout.placed.filter(p => !p.overflow).map(pl => placedContour(pl, params, compensate));
}

/**
 * The cut lines of a sheet laid out for common-line cutting, or null when the layout does not use it (or two
 * outlines overlap, in which case nothing is shared and every outline is cut on its own).
 */
export function layoutCommonLines(layout: SheetLayout, params: BoxParams): CommonLine | null {
  if (!layout.config.commonLine?.enabled) return null;
  const contours = layoutContours(layout, params);
  if (outlinesOverlap(contours)) return null;
  const result = findCommonLines(contours);
  return result.conflicts === 0 ? result : null;
}

/** Cutting figures for a sheet cut with shared lines: the unique paths and the travel between them. */
function commonLineStats(layout: SheetLayout, common: CommonLine, settings: CuttingConfig): CutStats {
  const travelListed = pathsTravel(common.paths);
  const travelOptimised = pathsTravel(orderPaths(common.paths));
  const cutSeconds = common.uniqueLength / settings.cutSpeed;
  const travelSecondsListed = travelListed / settings.travelSpeed;
  const travelSecondsOptimised = travelOptimised / settings.travelSpeed;
  return {
    parts: layout.placed.filter(p => !p.overflow).length,
    cutLength: common.uniqueLength,
    travelListed,
    travelOptimised,
    cutSeconds,
    travelSecondsListed,
    travelSecondsOptimised,
    totalSecondsListed: cutSeconds + travelSecondsListed,
    totalSecondsOptimised: cutSeconds + travelSecondsOptimised,
  };
}

/** Length cut once instead of twice on the given sheets, and the length of all outlines added up. */
export function layoutsSharedLength(layouts: SheetLayout[], params: BoxParams): { shared: number; total: number } {
  let shared = 0;
  let total = 0;
  for (const layout of layouts) {
    const common = layoutCommonLines(layout, params);
    if (common) {
      shared += common.sharedLength;
      total += common.totalLength;
    } else {
      total += layoutContours(layout, params).reduce((sum, c) => sum + contourLength(c), 0);
    }
  }
  return { shared, total };
}

/** Cutting figures for one or more sheets, added together (the head starts at the origin of each sheet). */
export function layoutsCutStats(layouts: SheetLayout[], params: BoxParams, settings: CuttingConfig): CutStats {
  const total: CutStats = {
    parts: 0, cutLength: 0, travelListed: 0, travelOptimised: 0, cutSeconds: 0,
    travelSecondsListed: 0, travelSecondsOptimised: 0, totalSecondsListed: 0, totalSecondsOptimised: 0,
  };
  for (const layout of layouts) {
    const common = layoutCommonLines(layout, params);
    const s = common ? commonLineStats(layout, common, settings) : cutStats(layoutContours(layout, params), settings);
    for (const key of Object.keys(total) as Array<keyof CutStats>) total[key] += s[key];
  }
  return total;
}

export function generateSVG(
  layout: SheetLayout,
  params: BoxParams,
): string {
  const { config, placed, efficiency } = layout;
  const sw = config.width;
  const sh = config.height;

  const active   = placed.filter(p => !p.overflow);
  const overflow = placed.filter(p => p.overflow);

  // One path per part, written in the order the parts are cut. Most cutter software follows the order of
  // the paths in the file, so the order chosen here is the order the head will move in.
  const contours = active.map(pl => placedContour(pl, params));
  const cutting = config.cutting ?? DEFAULT_CUTTING;

  // With common-line cutting the file holds the unique cut lines (a shared side once), not one path per part.
  // If two outlines overlap, nothing is shared and the file is written as usual.
  const shared = layoutCommonLines(layout, params);

  let paths: string;
  let cutLength: number;
  let travel: number;
  if (shared) {
    const cutPaths = cutting.optimise ? orderPaths(shared.paths) : shared.paths;
    paths = cutPaths
      .map((p, k) => `  <path id="cut-${k + 1}" fill="none" stroke="#e03131" stroke-width="0.15" d="${buildCutPathD(p)}"/>\n`)
      .join('');
    cutLength = shared.uniqueLength;
    travel = pathsTravel(cutPaths);
  } else {
    const plan = cutting.optimise ? optimisedPlan(contours) : listedPlan(contours);
    paths = plan.order
      .map((ci, k) => {
        const pl = active[ci];
        const d = buildPathD(rotateContour(contours[ci], plan.entry[k]), 0, 0);
        return `  <path id="part-${pl.panel.sequenceNumber}" fill="none" stroke="${svgColor(pl.panel.sequenceNumber - 1)}" stroke-width="0.15" d="${d}"/>\n`;
      })
      .join('');
    cutLength = contours.reduce((sum, c) => sum + contourLength(c), 0);
    travel = planTravel(contours, plan);
  }
  const commonNote = !config.commonLine?.enabled
    ? ''
    : shared
      ? ` | Common-line:on | Shared:${f(shared.sharedLength)}mm`
      : ' | Common-line:off (outlines overlap)';

  // Engraved text goes in its own group so the cutter software can give it a separate (engrave) setting.
  // It is placed like the cut path: moved by the same compensation and turned with a rotated panel.
  const shift = params.material.kerf / 2 - params.material.fitClearance / 4;
  const engraved = active
    .filter(pl => pl.panel.engrave)
    .map(pl => {
      const { text, fontSize } = pl.panel.engrave!;
      const body = pl.panel.body ?? { x: 0, y: 0, width: pl.panel.panelWidth, height: pl.panel.panelHeight };
      const cx = body.x + body.width / 2;
      const cy = body.y + body.height / 2;
      const px = pl.rotated ? pl.panel.panelHeight - cy : cx;
      const py = pl.rotated ? cx : cy;
      const x = f(pl.x + px + shift);
      const y = f(pl.y + py + shift);
      const turn = pl.rotated ? ` transform="rotate(90 ${x} ${y})"` : '';
      return `<text x="${x}" y="${y}" font-size="${f(fontSize)}" text-anchor="middle" dominant-baseline="central"${turn}>${xmlEscape(text)}</text>`;
    });
  const engraveGroup = engraved.length
    ? `  <g id="engrave" fill="#1d4ed8" stroke="none" font-family="Arial, Helvetica, sans-serif">\n  ${engraved.join('\n  ')}\n  </g>\n`
    : '';

  const labels = active.map(pl => {
    const pw  = pl.rotated ? pl.panel.panelHeight : pl.panel.panelWidth;
    const ph  = pl.rotated ? pl.panel.panelWidth  : pl.panel.panelHeight;
    const col = svgColor(pl.panel.sequenceNumber - 1);
    // On a panel with engraved text the part number moves to the bottom so the two do not overlap.
    const numberY = pl.panel.engrave ? Math.max(ph / 2, ph - 8) : ph / 2;
    const cx  = f(pl.x + pw / 2);
    const cy  = f(pl.y + numberY);
    let el = `<text x="${cx}" y="${cy}" dy=".35em" text-anchor="middle" font-size="3.5" font-weight="700" fill="${col}" font-family="monospace">${pl.panel.sequenceNumber}</text>`;
    if (pw > 18 && ph > 10) {
      const name = pl.panel.name.length > 15 ? pl.panel.name.slice(0, 14) + '…' : pl.panel.name;
      el += `<text x="${cx}" y="${f(pl.y + numberY + 5)}" dy=".35em" text-anchor="middle" font-size="2.2" fill="${col}" fill-opacity=".6" font-family="monospace">${name}</text>`;
    }
    if (pl.rotated) {
      el += `<text x="${f(pl.x + 1.5)}" y="${f(pl.y + 3.5)}" font-size="2" fill="${col}" fill-opacity=".45" font-family="monospace">R</text>`;
    }
    return el;
  }).join('\n  ');

  const overflowComment = overflow.length
    ? `  <!-- OVERFLOW (${overflow.length}): ${overflow.map(p => '#' + p.panel.sequenceNumber + ' ' + p.panel.name).join(', ')} -->\n`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Web-Based Box Maker | Author: Ferhat Göksel | Sheet:${sw}x${sh}mm | Parts:${active.length}/${placed.length} | Efficiency:${(efficiency * 100).toFixed(1)}% | Kerf:${params.material.kerf}mm | Fit clearance:${params.material.fitClearance}mm | Cut:${f(cutLength)}mm | Travel:${f(travel)}mm | Order:${cutting.optimise ? 'optimised' : 'listed'}${commonNote} | ${new Date().toISOString()} -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${sw + 20} ${sh + 20}" width="${sw}mm" height="${sh}mm">
  <rect x="0" y="0" width="${f(sw)}" height="${f(sh)}" fill="#fafaf8" stroke="#cccccc" stroke-width="0.4"/>
${overflowComment}${paths}${engraveGroup}  <g id="labels">
  ${labels}
  </g>
  <g fill="none" stroke="#888888" stroke-width="0.3" font-size="2.8" font-family="monospace">
    <line x1="0" y1="${f(sh + 5)}" x2="${f(sw)}" y2="${f(sh + 5)}"/>
    <text x="${f(sw / 2)}" y="${f(sh + 9)}" text-anchor="middle" fill="#888888">${sw} mm</text>
    <line x1="${f(sw + 5)}" y1="0" x2="${f(sw + 5)}" y2="${f(sh)}"/>
    <text x="${f(sw + 9)}" y="${f(sh / 2)}" text-anchor="middle" fill="#888888" transform="rotate(90,${f(sw + 9)},${f(sh / 2)})">${sh} mm</text>
  </g>
</svg>`;
}

export function generateGroupedSVG(
  grouped: GroupedSheetLayout[],
  params: BoxParams,
): string {
  if (!grouped.length) {
    return generateSVG({ config: { size: 'custom', width: 10, height: 10, gap: 0 }, placed: [], efficiency: 0, sheetsRequired: 1 }, params);
  }

  const sw = grouped[0].layout.config.width;
  const sh = grouped[0].layout.config.height;
  const margin = 18;
  const sectionGap = 24;
  const totalH = grouped.length * sh + (grouped.length - 1) * sectionGap + margin * 2;
  const totalW = sw + margin * 2;

  let body = '';
  grouped.forEach((g, idx) => {
    const yOff = margin + idx * (sh + sectionGap);
    const svg = generateSVG(g.layout, params);

    // Extract inner content between the first <rect .../> and closing </svg>
    const inner = svg.split('\n').slice(3, -1).join('\n');
    body += `  <g transform="translate(${margin},${yOff})">\n`;
    body += `    <text x="0" y="-6" font-size="4" font-family="monospace" fill="#555555">Thickness: ${g.label}</text>\n`;
    body += inner.replace(/^/gm, '    ') + '\n';
    body += '  </g>\n';
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Web-Based Box Maker | Grouped by thickness | Sheets:${grouped.length} | ${new Date().toISOString()} -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="${totalW}mm" height="${totalH}mm">
${body}</svg>`;
}

export function downloadSVG(svgContent: string, filename = 'web-box-maker-laser.svg'): void {
  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

export interface SvgStats {
  byteSize:    number;
  pathCount:   number;
  colorGroups: number;
}

export function analyseSVG(svgContent: string): SvgStats {
  const byteSize   = new TextEncoder().encode(svgContent).length;
  const pathCount  = (svgContent.match(/<path/g) ?? []).length;
  return { byteSize, pathCount, colorGroups: pathCount };
}