import type { SheetLayout, BoxParams } from '../models/types';
import type { GroupedSheetLayout } from './BinPacker';

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

function consolidatePaths(results: { colorGroup: string; pathD: string }[]): string {
  const byColor = new Map<string, string[]>();
  for (const r of results) {
    if (!byColor.has(r.colorGroup)) byColor.set(r.colorGroup, []);
    byColor.get(r.colorGroup)!.push(r.pathD);
  }
  let svg = '';
  for (const [color, paths] of byColor) {
    svg += `  <path fill="none" stroke="${color}" stroke-width="0.15" d="${paths.join(' ')}"/>\n`;
  }
  return svg;
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

  const pathResults = active.map((pl, idx) => {
    let outline = pl.panel.outline;
    if (pl.rotated) {
      outline = outline.map(pt => ({
        x: pl.panel.panelHeight - pt.y,
        y: pt.x,
      }));
    }
    return {
      colorGroup: svgColor(idx),
      pathD: buildPathD(outline, pl.x, pl.y),
    };
  });

  const paths = consolidatePaths(pathResults);

  const labels = active.map((pl, idx) => {
    const pw  = pl.rotated ? pl.panel.panelHeight : pl.panel.panelWidth;
    const ph  = pl.rotated ? pl.panel.panelWidth  : pl.panel.panelHeight;
    const col = svgColor(idx);
    const cx  = f(pl.x + pw / 2);
    const cy  = f(pl.y + ph / 2);
    let el = `<text x="${cx}" y="${cy}" dy=".35em" text-anchor="middle" font-size="3.5" font-weight="700" fill="${col}" font-family="monospace">${pl.panel.sequenceNumber}</text>`;
    if (pw > 18 && ph > 10) {
      const name = pl.panel.name.length > 15 ? pl.panel.name.slice(0, 14) + '…' : pl.panel.name;
      el += `<text x="${cx}" y="${f(pl.y + ph / 2 + 5)}" dy=".35em" text-anchor="middle" font-size="2.2" fill="${col}" fill-opacity=".6" font-family="monospace">${name}</text>`;
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
<!-- Web-Based Box Maker | Author: Ferhat Göksel | Sheet:${sw}x${sh}mm | Parts:${active.length}/${placed.length} | Efficiency:${(efficiency * 100).toFixed(1)}% | Kerf:${params.material.kerf}mm | ${new Date().toISOString()} -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${sw + 20} ${sh + 20}" width="${sw}mm" height="${sh}mm">
  <rect x="0" y="0" width="${f(sw)}" height="${f(sh)}" fill="#fafaf8" stroke="#cccccc" stroke-width="0.4"/>
${overflowComment}${paths}  <g id="labels">
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