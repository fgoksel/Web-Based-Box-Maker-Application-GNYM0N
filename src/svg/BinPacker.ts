import type { Panel, PlacedPanel, SheetConfig, SheetLayout } from '../models/types';

export const SHEET_SIZES: Record<string, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
};

export function resolveSheetDimensions(config: SheetConfig): { w: number; h: number } {
  if (config.size === 'custom') {
    return { w: config.width, h: config.height };
  }
  const [w, h] = SHEET_SIZES[config.size];
  return { w, h };
}

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function fitScore(pw: number, ph: number, fr: FreeRect): number {
  if (pw > fr.w || ph > fr.h) return Infinity;
  // Prefer tight fits that leave minimal wasted area, but still
  // slightly bias toward a smaller leftover short-side for stability.
  const rw = fr.w - pw;
  const rh = fr.h - ph;
  const wasteArea = rw * rh;
  const shortSide = Math.min(rw, rh);
  return wasteArea + shortSide * 0.001;
}

function guillotineSplit(fr: FreeRect, pw: number, ph: number, gap: number): FreeRect[] {
  const result: FreeRect[] = [];
  const rightW  = fr.w - pw - gap;
  const bottomH = fr.h - ph - gap;

  if (fr.w - pw > fr.h - ph) {
    if (rightW  > 0) result.push({ x: fr.x + pw + gap, y: fr.y, w: rightW, h: fr.h });
    if (bottomH > 0) result.push({ x: fr.x, y: fr.y + ph + gap, w: pw, h: bottomH });
  } else {
    if (bottomH > 0) result.push({ x: fr.x, y: fr.y + ph + gap, w: fr.w, h: bottomH });
    if (rightW  > 0) result.push({ x: fr.x + pw + gap, y: fr.y, w: rightW, h: ph });
  }

  return result;
}

function pruneSubsumed(freeRects: FreeRect[]): FreeRect[] {
  return freeRects.filter(a =>
    !freeRects.some(b =>
      b !== a &&
      b.x <= a.x &&
      b.y <= a.y &&
      b.x + b.w >= a.x + a.w &&
      b.y + b.h >= a.y + a.h,
    ),
  );
}

export function packPanels(panels: Panel[], config: SheetConfig): SheetLayout {
  const { w: shW, h: shH } = resolveSheetDimensions(config);
  const gap = config.gap;

  const sorted = [...panels].sort(
    (a, b) => b.panelWidth * b.panelHeight - a.panelWidth * a.panelHeight,
  );

  let freeRects: FreeRect[] = [
    { x: gap, y: gap, w: shW - gap * 2, h: shH - gap * 2 },
  ];

  const placed: PlacedPanel[] = [];
  let usedArea = 0;

  for (const panel of sorted) {
    const pw = panel.panelWidth;
    const ph = panel.panelHeight;

    let bestScore   = Infinity;
    let bestFrIdx   = -1;
    let bestRotated = false;

    for (let i = 0; i < freeRects.length; i++) {
      const fr = freeRects[i];
      const s0 = fitScore(pw + gap, ph + gap, fr);
      if (s0 < bestScore) {
        bestScore   = s0;
        bestFrIdx   = i;
        bestRotated = false;
      }
      if (pw !== ph) {
        const s1 = fitScore(ph + gap, pw + gap, fr);
        if (s1 < bestScore) {
          bestScore   = s1;
          bestFrIdx   = i;
          bestRotated = true;
        }
      }
    }

    if (bestFrIdx >= 0) {
      const fr  = freeRects[bestFrIdx];
      const aPw = bestRotated ? ph : pw;
      const aPh = bestRotated ? pw : ph;

      placed.push({ panel, x: fr.x, y: fr.y, rotated: bestRotated, overflow: false });
      usedArea += pw * ph;

      freeRects.splice(bestFrIdx, 1);
      freeRects.push(...guillotineSplit(fr, aPw, aPh, gap));
      freeRects = pruneSubsumed(freeRects);
    } else {
      placed.push({ panel, x: 0, y: 0, rotated: false, overflow: true });
    }
  }

  const efficiency = Math.min(1, usedArea / (shW * shH));

  return {
    config: { ...config, width: shW, height: shH },
    placed,
    efficiency,
    sheetsRequired: placed.some(p => p.overflow) ? 2 : 1,
  };
}

export interface GroupedSheetLayout {
  key: string;
  label: string;
  layout: SheetLayout;
}

export function packPanelsByThickness(panels: Panel[], config: SheetConfig): GroupedSheetLayout[] {
  const groups = new Map<string, Panel[]>();
  for (const p of panels) {
    const key = String(Math.round(p.thickness * 1000) / 1000);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const keys = [...groups.keys()].sort((a, b) => Number(a) - Number(b));
  return keys.map((k) => ({
    key: k,
    label: `${k} mm`,
    layout: packPanels(groups.get(k)!, config),
  }));
}

const PREVIEW_COLORS: string[] = [
  '#f0a500', '#00c8ff', '#39ff6e', '#ff6b9d',
  '#a78bfa', '#fbbf24', '#34d399', '#f87171',
  '#60a5fa', '#fb923c', '#e879f9', '#4ade80',
];

export function renderSheetPreview(
  canvas: HTMLCanvasElement,
  layout: SheetLayout,
  highlightSeq = -1,
): void {
  const vp = canvas.parentElement;
  if (vp) {
    canvas.width = vp.clientWidth;
    canvas.height = vp.clientHeight;
  } else {
    // Support offscreen / detached canvases used by grouped preview.
    canvas.width = Math.max(1, canvas.width || 1);
    canvas.height = Math.max(1, canvas.height || 1);
  }

  const ctx = canvas.getContext('2d')!;
  const { config, placed, efficiency } = layout;
  const sw = config.width;
  const sh = config.height;

  const PAD    = 36;
  const scaleX = (canvas.width  - PAD * 2) / sw;
  const scaleY = (canvas.height - PAD * 2) / sh;
  const sc     = Math.min(scaleX, scaleY);
  const ox     = (canvas.width  - sw * sc) / 2;
  const oy     = (canvas.height - sh * sc) / 2;

  ctx.fillStyle = '#080b0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#f5f5f0';
  ctx.fillRect(ox, oy, sw * sc, sh * sc);

  ctx.strokeStyle = '#e0e0da';
  ctx.lineWidth   = 0.4;
  for (let x = 0; x <= sw; x += 10) {
    ctx.beginPath();
    ctx.moveTo(ox + x * sc, oy);
    ctx.lineTo(ox + x * sc, oy + sh * sc);
    ctx.stroke();
  }
  for (let y = 0; y <= sh; y += 10) {
    ctx.beginPath();
    ctx.moveTo(ox, oy + y * sc);
    ctx.lineTo(ox + sw * sc, oy + y * sc);
    ctx.stroke();
  }

  ctx.strokeStyle = '#aaaaaa';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(ox, oy, sw * sc, sh * sc);

  placed.forEach((pl, idx) => {
    if (pl.overflow) return;
    const pw  = pl.rotated ? pl.panel.panelHeight : pl.panel.panelWidth;
    const ph  = pl.rotated ? pl.panel.panelWidth  : pl.panel.panelHeight;
    const px  = ox + pl.x * sc;
    const py  = oy + pl.y * sc;
    const pW  = pw * sc;
    const pH  = ph * sc;
    const col = PREVIEW_COLORS[idx % PREVIEW_COLORS.length];
    const isHL = pl.panel.sequenceNumber === highlightSeq;

    ctx.globalAlpha = 0.13;
    ctx.fillStyle   = col;
    ctx.fillRect(px, py, pW, pH);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = col;
    ctx.lineWidth   = isHL ? 2.5 : 1.2;
    if (isHL) {
      ctx.shadowColor = col;
      ctx.shadowBlur  = 8;
    }
    ctx.strokeRect(px, py, pW, pH);
    ctx.shadowBlur = 0;

    const fs = Math.max(9, Math.min(20, pW * 0.22));
    ctx.fillStyle    = col;
    ctx.font         = `bold ${fs}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(pl.panel.sequenceNumber), px + pW / 2, py + pH / 2);

    if (pW > 52 && pH > 28) {
      const name = pl.panel.name.length > 15
        ? pl.panel.name.slice(0, 14) + '…'
        : pl.panel.name;
      ctx.fillStyle = '#333333';
      ctx.font      = `${Math.max(7, fs * 0.52)}px monospace`;
      ctx.fillText(name, px + pW / 2, py + pH / 2 + fs * 0.8);
    }

    if (pl.rotated) {
      ctx.fillStyle = col;
      ctx.font      = '8px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('R', px + 3, py + 9);
    }
  });

  const ov = placed.filter(p => p.overflow);
  if (ov.length) {
    ctx.fillStyle    = '#ff4757';
    ctx.font         = 'bold 11px monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`⚠ ${ov.length} panel(s) overflow — use larger sheet`, ox + 2, oy - 15);
  }

  ctx.fillStyle    = '#888888';
  ctx.font         = '10px monospace';
  ctx.textAlign    = 'center';
  ctx.fillText(`${sw} × ${sh} mm`, ox + sw * sc / 2, oy - 7);

  const barY = oy + sh * sc + 7;
  const barW = sw * sc;
  const eff  = efficiency * 100;

  ctx.fillStyle = '#1a2232';
  ctx.fillRect(ox, barY, barW, 4);
  ctx.fillStyle = eff > 68 ? '#39ff6e' : eff > 42 ? '#f0a500' : '#ff4757';
  ctx.fillRect(ox, barY, barW * efficiency, 4);

  ctx.fillStyle    = '#888888';
  ctx.font         = '9px monospace';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`Sheet efficiency: ${eff.toFixed(1)}%`, ox, barY + 7);
}

export function renderGroupedSheetPreview(
  canvas: HTMLCanvasElement,
  grouped: GroupedSheetLayout[],
  highlightSeq = -1,
): void {
  const vp = canvas.parentElement!;
  canvas.width  = vp.clientWidth;
  canvas.height = vp.clientHeight;

  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#080b0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!grouped.length) return;

  const PAD = 24;
  const gapY = 22;
  const sectionH = Math.max(140, Math.floor((canvas.height - PAD * 2 - gapY * (grouped.length - 1)) / grouped.length));

  grouped.forEach((g, idx) => {
    // Create a temporary offscreen canvas to reuse existing renderer logic.
    const off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = sectionH;
    renderSheetPreview(off, g.layout, highlightSeq);

    const y = PAD + idx * (sectionH + gapY);
    ctx.drawImage(off, 0, y);

    // Section label
    ctx.fillStyle = 'rgba(232,237,246,0.9)';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`THICKNESS: ${g.label}  |  Parts: ${g.layout.placed.filter(p => !p.overflow).length}/${g.layout.placed.length}`, 14, y + 10);
  });
}
