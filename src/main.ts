import { buildBoxGeometry } from './geometry/GeometryEngine';
import { applyJointToPanel } from './geometry/JointEngine';
import { layoutCompartments, parseSizeList } from './geometry/compartments';
import { BoxRenderer } from './rendering/BoxRenderer';
import type { BoxParams, BoxGeometry, Panel, SheetConfig, SheetLayout } from './models/types';
import {
  defaultBoxParams,
  defaultSheetConfig,
  exportProject,
  importProject,
  downloadJSON,
} from './utils/ProjectIO';
import {
  packPanels,
  packPanelsByThickness,
  renderGroupedSheetPreview,
  renderSheetPreview,
  SHEET_SIZES,
  type GroupedSheetLayout,
} from './svg/BinPacker';
import { downloadSVG, generateGroupedSVG, generateSVG } from './svg/SvgEngine';

type ViewMode = '3d' | 'flat';

/** Safe typed lookup for required DOM elements. */
function el<T extends HTMLElement>(id: string): T {
  const out = document.getElementById(id);
  if (!out) throw new Error(`Missing element #${id}`);
  return out as T;
}

function num(id: string): number {
  const v = (el<HTMLInputElement>(id).value ?? '').trim();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function setText(id: string, text: string): void {
  el<HTMLElement>(id).textContent = text;
}

function setValidMessage(msg: string, kind: 'error' | 'ok' | 'info' = 'info'): void {
  const box = el<HTMLElement>('validMsg');
  box.textContent = msg;
  box.setAttribute('data-kind', kind);
}

function toast(message: string, kind: 'ok' | 'err' | 'info' = 'info', timeoutMs = 2200): void {
  const host = el<HTMLDivElement>('toast');
  const item = document.createElement('div');
  item.className = `toast-item ${kind}`;
  item.textContent = message;
  host.appendChild(item);
  setTimeout(() => item.remove(), timeoutMs);
}

function setActionEnabled(id: string, enabled: boolean): void {
  el<HTMLButtonElement>(id).disabled = !enabled;
}

function toggleOn(offEl: HTMLElement, on: boolean): void {
  offEl.classList.toggle('on', on);
}

function markFieldValid(id: string, valid: boolean): void {
  el<HTMLElement>(id).classList.toggle('invalid-field', !valid);
}

interface UIValidationResult {
  valid: boolean;
  params: BoxParams | null;
  errors: string[];
}

let currentParams: BoxParams | null = null;
let currentGeometry: BoxGeometry | null = null;
let currentSheet: SheetConfig | null = null;
let currentLayout: SheetLayout | null = null;
let currentGroupedLayouts: GroupedSheetLayout[] | null = null;
let currentThicknessView = '__all__';

let highlightSeq: number | null = null;
let viewMode: ViewMode = '3d';

let boxRenderer: BoxRenderer | null = null;

type StatusTone = 'ready' | 'processing' | 'error';

function setStatusTone(tone: StatusTone): void {
  el<HTMLElement>('stDot').setAttribute('data-state', tone);
}

function setEmptyStateVisible(visible: boolean): void {
  el<HTMLElement>('viewportEmptyState').style.display = visible ? 'flex' : 'none';
}

/**
 * Unified user feedback helper used by workflow actions.
 * - status bar is always updated
 * - validation area is updated when `validKind` is provided
 * - optional toast for short-lived confirmation
 */
function notifyUser(opts: {
  status: string;
  dims?: string;
  validKind?: 'error' | 'ok' | 'info';
  toastKind?: 'ok' | 'err' | 'info';
  toastMessage?: string;
  tone?: StatusTone;
}): void {
  showStatus(opts.status, opts.dims);
  if (opts.validKind) setValidMessage(opts.status, opts.validKind);
  if (opts.toastKind && opts.toastMessage) toast(opts.toastMessage, opts.toastKind);
  if (opts.tone) setStatusTone(opts.tone);
}

function readBoxParamsFromUI(): BoxParams {
  const params = defaultBoxParams();

  params.width = num('bW');
  params.depth = num('bD');
  params.height = num('bH');

  params.material.frameThickness = num('tF');
  params.material.baseThickness = num('tB');
  params.material.dividerThickness = num('tD');
  params.material.kerf = Number(el<HTMLInputElement>('kerf').value);

  params.joint.style = (el<HTMLSelectElement>('tabStyle').value as BoxParams['joint']['style']);
  params.joint.minTabCount = num('tabN');
  params.joint.tabWidthOverride = Number(el<HTMLInputElement>('tabW').value);

  const lidEnabled = el<HTMLElement>('togLid').classList.contains('on');
  params.lid.enabled = lidEnabled;
  params.lid.height = num('lidH');
  params.lid.tolerance = Number(el<HTMLInputElement>('lidTol').value);

  const divEnabled = el<HTMLElement>('togDiv').classList.contains('on');
  params.divider.enabled = divEnabled;
  params.divider.columns = num('dCols');
  params.divider.rows = num('dRows');
  params.divider.heightOverride = num('dH');
  params.divider.columnWidths = parseSizeList(el<HTMLInputElement>('dColW').value);
  params.divider.rowDepths = parseSizeList(el<HTMLInputElement>('dRowD').value);

  params.label.enabled = false;
  params.label.text = '';
  params.label.face = 'front';
  params.label.fontSize = 8;

  return params;
}

function validateParams(params: BoxParams): UIValidationResult {
  const errors: string[] = [];

  const positiveFields: Array<[number, string, string]> = [
    [params.width, 'Width', 'bW'],
    [params.depth, 'Depth', 'bD'],
    [params.height, 'Height', 'bH'],
    [params.material.frameThickness, 'Frame thickness', 'tF'],
    [params.material.baseThickness, 'Base thickness', 'tB'],
    [params.material.dividerThickness, 'Divider thickness', 'tD'],
  ];

  for (const [val, name, id] of positiveFields) {
    const ok = Number.isFinite(val) && val > 0;
    markFieldValid(id, ok);
    if (!ok) errors.push(`${name} must be greater than 0`);
  }

  const kerfOk = Number.isFinite(params.material.kerf) && params.material.kerf >= 0;
  markFieldValid('kerf', kerfOk);
  if (!kerfOk) errors.push('Kerf must be 0 or greater');

  const tabOk = Number.isInteger(params.joint.minTabCount) && params.joint.minTabCount >= 1;
  markFieldValid('tabN', tabOk);
  if (!tabOk) errors.push('Min tab count must be an integer >= 1');

  const fingerOk = Number.isFinite(params.joint.tabWidthOverride) && params.joint.tabWidthOverride >= 0;
  markFieldValid('tabW', fingerOk);
  if (!fingerOk) errors.push('Finger width must be 0 (automatic) or greater');

  const colsOk = Number.isInteger(params.divider.columns) && params.divider.columns >= 1;
  const rowsOk = Number.isInteger(params.divider.rows) && params.divider.rows >= 1;
  markFieldValid('dCols', colsOk);
  markFieldValid('dRows', rowsOk);
  if (!colsOk) errors.push('Divider columns must be an integer >= 1');
  if (!rowsOk) errors.push('Divider rows must be an integer >= 1');

  const dHOk = Number.isFinite(params.divider.heightOverride) && params.divider.heightOverride >= 0;
  markFieldValid('dH', dHOk);
  if (!dHOk) errors.push('Divider height override must be >= 0');

  const lidHOk = Number.isFinite(params.lid.height) && params.lid.height > 0;
  const lidTolOk = Number.isFinite(params.lid.tolerance) && params.lid.tolerance >= 0;
  markFieldValid('lidH', lidHOk);
  markFieldValid('lidTol', lidTolOk);
  if (!lidHOk) errors.push('Lid height must be greater than 0');
  if (!lidTolOk) errors.push('Lid tolerance must be >= 0');

  const iW = params.width - 2 * params.material.frameThickness;
  const iD = params.depth - 2 * params.material.frameThickness;
  const iH = params.height - params.material.baseThickness;
  if (iW <= 0) errors.push('Width is too small for current frame thickness');
  if (iD <= 0) errors.push('Depth is too small for current frame thickness');
  if (iH <= 0) errors.push('Height is too small for current base thickness');

  if (params.lid.enabled) {
    if (params.lid.height <= params.material.baseThickness) {
      errors.push('Lid height must be greater than base thickness');
    }
  }

  if (params.divider.enabled && iW > 0 && iD > 0) {
    const tD = params.material.dividerThickness;
    const cols = params.divider.columns;
    const rows = params.divider.rows;
    const dH = params.divider.heightOverride > 0 ? params.divider.heightOverride : iH;

    if (dH <= 0 || dH > iH) {
      errors.push('Divider height must be > 0 and <= internal height');
    }
    const colLayout = layoutCompartments(iW, tD, cols, params.divider.columnWidths, 'width');
    const rowLayout = layoutCompartments(iD, tD, rows, params.divider.rowDepths, 'depth');
    markFieldValid('dColW', !params.divider.columnWidths.length || !colLayout.error);
    markFieldValid('dRowD', !params.divider.rowDepths.length || !rowLayout.error);
    if (colLayout.error) errors.push(`Columns: ${colLayout.error}`);
    if (rowLayout.error) errors.push(`Rows: ${rowLayout.error}`);
  }

  return { valid: errors.length === 0, params: errors.length ? null : params, errors };
}

/** Shows the compartment sizes that the current divider settings give. */
function updateDividerInfo(params: BoxParams): void {
  const info = el<HTMLElement>('divInfo');
  const { frameThickness: tF, baseThickness: tB, dividerThickness: tD } = params.material;
  const iW = params.width - 2 * tF;
  const iD = params.depth - 2 * tF;
  const d = params.divider;

  el<HTMLInputElement>('dCols').disabled = d.columnWidths.length > 0;
  el<HTMLInputElement>('dRows').disabled = d.rowDepths.length > 0;

  if (!d.enabled || iW <= 0 || iD <= 0 || params.height - tB <= 0) {
    info.textContent = '';
    return;
  }
  const cols = layoutCompartments(iW, tD, d.columns, d.columnWidths, 'width');
  const rows = layoutCompartments(iD, tD, d.rows, d.rowDepths, 'depth');
  const fmt = (xs: number[]) => xs.map(x => (Number.isFinite(x) ? x.toFixed(1) : '?')).join(' | ');
  info.textContent = `Compartments (mm)\nwidths: ${fmt(cols.sizes)}\ndepths: ${fmt(rows.sizes)}`;
}

/** Sets the box width and depth so the typed compartment sizes fit exactly. */
function fitBoxToCompartments(): void {
  const params = readBoxParamsFromUI();
  const { frameThickness: tF, dividerThickness: tD } = params.material;
  const widths = params.divider.columnWidths;
  const depths = params.divider.rowDepths;
  if (!widths.length && !depths.length) {
    toast('Enter column widths or row depths first', 'info');
    return;
  }
  const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0) + tD * (xs.length - 1);
  if (widths.length && widths.every(Number.isFinite)) {
    el<HTMLInputElement>('bW').value = String(Math.round((total(widths) + 2 * tF) * 1000) / 1000);
  }
  if (depths.length && depths.every(Number.isFinite)) {
    el<HTMLInputElement>('bD').value = String(Math.round((total(depths) + 2 * tF) * 1000) / 1000);
  }
  refreshValidation();
  scheduleLiveUpdate('model');
}

function validateSheetUI(): string[] {
  const errors: string[] = [];

  const gapOk = Number.isFinite(Number(el<HTMLInputElement>('shGap').value)) && Number(el<HTMLInputElement>('shGap').value) >= 0;
  markFieldValid('shGap', gapOk);
  if (!gapOk) errors.push('Sheet gap must be 0 or greater');

  const custom = el<HTMLSelectElement>('shSz').value === 'custom';
  for (const [id, name] of [['shW', 'Sheet width'], ['shH', 'Sheet height']] as const) {
    const v = Number(el<HTMLInputElement>(id).value);
    const ok = !custom || (Number.isFinite(v) && v > 0);
    markFieldValid(id, ok);
    if (!ok) errors.push(`${name} must be greater than 0`);
  }
  return errors;
}

/** Re-checks the inputs while typing: shows problems straight away and clears them once fixed. */
function refreshValidation(): UIValidationResult {
  const result = validateUI(false);
  const box = el<HTMLElement>('validMsg');
  if (!result.valid) setValidMessage(result.errors.join('\n'), 'error');
  else if (box.getAttribute('data-kind') === 'error') setValidMessage('Inputs look valid', 'ok');
  return result;
}

function validateUI(showMessage = true): UIValidationResult {
  const params = readBoxParamsFromUI();
  const boxResult = validateParams(params);
  updateDividerInfo(params);
  const sheetErrors = validateSheetUI();
  const errors = [...boxResult.errors, ...sheetErrors];
  const result: UIValidationResult = {
    valid: errors.length === 0,
    params: errors.length === 0 ? boxResult.params : null,
    errors,
  };

  if (showMessage) {
    if (result.valid) setValidMessage('Inputs look valid', 'ok');
    else setValidMessage(result.errors.join('\n'), 'error');
  }

  setActionEnabled('btnGenerate', result.valid);
  setActionEnabled('btnPack', result.valid && !!currentGeometry);
  setActionEnabled('btnSVG', result.valid && (!!currentLayout || !!currentGroupedLayouts));
  setActionEnabled('btnExport', result.valid);

  return result;
}

function readSheetFromUI(): SheetConfig {
  const config = defaultSheetConfig();
  config.gap = num('shGap');

  const size = el<HTMLSelectElement>('shSz').value;
  config.size = size as SheetConfig['size'];

  if (config.size === 'custom') {
    config.width = Number(el<HTMLInputElement>('shW').value);
    config.height = Number(el<HTMLInputElement>('shH').value);
  } else if (SHEET_SIZES[size]) {
    const [w, h] = SHEET_SIZES[size];
    config.width = w;
    config.height = h;
  }

  return config;
}

function setView(mode: ViewMode): void {
  viewMode = mode;
  const c3d = el<HTMLCanvasElement>('c3d');
  const cFlat = el<HTMLCanvasElement>('cFlat');
  const v3dBtn = el<HTMLButtonElement>('v3dBtn');
  const vFlatBtn = el<HTMLButtonElement>('vFlatBtn');

  if (mode === '3d') {
    c3d.style.display = 'block';
    cFlat.style.display = 'none';
    v3dBtn.classList.add('active');
    vFlatBtn.classList.remove('active');
    if (boxRenderer) boxRenderer.paused = false;
  } else {
    c3d.style.display = 'none';
    cFlat.style.display = 'block';
    v3dBtn.classList.remove('active');
    vFlatBtn.classList.add('active');
    if (boxRenderer) boxRenderer.paused = true;

    renderCurrentFlatPreview();
  }
}

function getVisibleGroupedLayouts(): GroupedSheetLayout[] {
  if (!currentGroupedLayouts) return [];
  if (currentThicknessView === '__all__') return currentGroupedLayouts;
  return currentGroupedLayouts.filter(g => g.key === currentThicknessView);
}

function renderCurrentFlatPreview(): void {
  if (viewMode !== 'flat') return;
  const flat = el<HTMLCanvasElement>('cFlat');
  if (currentGroupedLayouts) {
    renderGroupedSheetPreview(flat, getVisibleGroupedLayouts(), highlightSeq ?? -1);
  } else if (currentLayout) {
    renderSheetPreview(flat, currentLayout, highlightSeq ?? -1);
  }
}

function refreshThicknessSelector(): void {
  const wrap = el<HTMLElement>('thicknessSelWrap');
  const sel = el<HTMLSelectElement>('thicknessSel');
  const stats = el<HTMLElement>('thicknessStats');

  if (!currentGroupedLayouts || currentGroupedLayouts.length <= 1) {
    wrap.style.display = 'none';
    sel.innerHTML = '';
    stats.textContent = '';
    currentThicknessView = '__all__';
    return;
  }

  wrap.style.display = 'block';
  const totalParts = currentGroupedLayouts.reduce(
    (sum, g) => sum + g.layout.placed.filter(p => !p.overflow).length,
    0,
  );
  const avgEff = currentGroupedLayouts.reduce((sum, g) => sum + g.layout.efficiency, 0) / currentGroupedLayouts.length;

  const opts = [
    `<option value="__all__">All thicknesses</option>`,
    ...currentGroupedLayouts.map((g) => {
      const count = g.layout.placed.filter(p => !p.overflow).length;
      const eff = (g.layout.efficiency * 100).toFixed(1);
      return `<option value="${g.key}">${g.label} — ${count} parts | ${eff}%</option>`;
    }),
  ];
  sel.innerHTML = opts.join('');
  sel.value = currentThicknessView;
  if (currentThicknessView === '__all__') {
    stats.textContent = `All groups: ${currentGroupedLayouts.length} | ${totalParts} parts | Avg efficiency ${(
      avgEff * 100
    ).toFixed(1)}%`;
  } else {
    const g = currentGroupedLayouts.find(x => x.key === currentThicknessView);
    if (!g) {
      stats.textContent = '';
      return;
    }
    const count = g.layout.placed.filter(p => !p.overflow).length;
    stats.textContent = `${g.label}: ${count} parts | ${(g.layout.efficiency * 100).toFixed(1)}%`;
  }
}

function updateSummary(geometry: BoxGeometry, layout: SheetLayout | null): void {
  setText('sExt', `${currentParams?.width ?? '-'} × ${currentParams?.depth ?? '-'} × ${currentParams?.height ?? '-'}`);
  setText('sInt', `${geometry.internalWidth.toFixed(1)} × ${geometry.internalDepth.toFixed(1)} × ${geometry.internalHeight.toFixed(1)}`);
  setText('sParts', String(geometry.panels.length));
  setText('sArea', `${geometry.totalMaterialArea.toFixed(1)} mm²`);
  setText('sEff', layout ? `${(layout.efficiency * 100).toFixed(1)}%` : '—');
}

function renderPartsList(panels: Panel[]): void {
  const wrap = el<HTMLDivElement>('partsList');
  wrap.innerHTML = '';

  if (!panels.length) {
    wrap.innerHTML = `<div class="empty-msg">Generate a box to see parts</div>`;
    return;
  }

  for (const p of panels) {
    const row = document.createElement('div');
    row.className = 'part-row';
    if (highlightSeq === p.sequenceNumber) row.classList.add('selected');
    row.tabIndex = 0;
    row.dataset.seq = String(p.sequenceNumber);

    const badge = document.createElement('div');
    badge.className = 'part-badge';
    badge.textContent = String(p.sequenceNumber);

    const main = document.createElement('div');
    main.className = 'part-main';

    const name = document.createElement('div');
    name.className = 'part-name';
    name.textContent = p.name;

    const meta = document.createElement('div');
    meta.className = 'part-meta';
    meta.innerHTML = `
      <span class="tag"><span class="dot ${p.group}"></span>${p.group.toUpperCase()}</span>
      <span class="tag">${p.panelWidth.toFixed(1)}×${p.panelHeight.toFixed(1)} mm</span>
      <span class="tag">t=${p.thickness.toFixed(2)} mm</span>
    `;

    main.appendChild(name);
    main.appendChild(meta);
    row.appendChild(badge);
    row.appendChild(main);

    const onPick = () => {
      highlightSeq = p.sequenceNumber;
      boxRenderer?.highlightPanel(p.sequenceNumber);
      renderPartsList(panels);
      renderCurrentFlatPreview();
    };
    row.addEventListener('click', onPick);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onPick();
      }
    });

    wrap.appendChild(row);
  }
}

/** Updates bottom status line text. */
function showStatus(text: string, dims?: string): void {
  setText('stText', text);
  if (dims) setText('stDims', dims);
}

function regenerate3D(): void {
  setStatusTone('processing');
  const validation = validateUI(true);
  if (!validation.valid || !validation.params) {
    setStatusTone('error');
    throw new Error('Please fix validation errors before generating');
  }
  const params = validation.params;
  currentParams = params;

  const geometry = buildBoxGeometry(params);
  geometry.panels.forEach(p => applyJointToPanel(p, params.joint));
  currentGeometry = geometry;

  if (!boxRenderer) throw new Error('BoxRenderer not initialized');
  boxRenderer.loadGeometry(geometry);
  setEmptyStateVisible(false);

  updateSummary(geometry, null);
  renderPartsList(geometry.panels);
  showStatus('Generated — click Run Bin Packing');
  setValidMessage('Geometry generated successfully', 'ok');

  currentSheet = readSheetFromUI();
  currentLayout = null;
  currentGroupedLayouts = null;
  currentThicknessView = '__all__';
  refreshThicknessSelector();
  setActionEnabled('btnPack', true);
  // Enable SVG export only after packing has produced a layout.
  setActionEnabled('btnSVG', false);
  setStatusTone('ready');
}

function separateByThicknessEnabled(): boolean {
  return el<HTMLElement>('togSepMat').classList.contains('on');
}

function runPacking(): void {
  setStatusTone('processing');
  const validation = validateUI(true);
  if (!validation.valid) {
    setStatusTone('error');
    return;
  }

  if (!currentGeometry || !currentParams) {
    setValidMessage('Generate geometry first', 'error');
    setStatusTone('error');
    return;
  }

  const sheet = readSheetFromUI();
  currentSheet = sheet;

  if (separateByThicknessEnabled()) {
    const grouped = packPanelsByThickness(currentGeometry.panels, sheet);
    currentGroupedLayouts = grouped;
    currentLayout = null;
    currentThicknessView = '__all__';
    refreshThicknessSelector();
    renderCurrentFlatPreview();
    notifyUser({ status: 'Packed (grouped by thickness) — SVG export is ready', dims: `Groups: ${grouped.length}` });
    // Use worst overflow state as message
    const anyOverflow = grouped.some(g => g.layout.placed.some(p => p.overflow));
    setValidMessage(anyOverflow ? 'Some panels overflow: increase sheet size or gap' : 'All panels fit on the sheet', anyOverflow ? 'info' : 'ok');
    setActionEnabled('btnSVG', true);
    setStatusTone(anyOverflow ? 'processing' : 'ready');
    return;
  }

  const layout = packPanels(currentGeometry.panels, sheet);
  currentLayout = layout;
  currentGroupedLayouts = null;
  currentThicknessView = '__all__';
  refreshThicknessSelector();

  renderCurrentFlatPreview();

  updateSummary(currentGeometry, layout);
  notifyUser({ status: 'Packed — SVG export is ready', dims: `Sheets: ${layout.sheetsRequired}` });
  if (layout.placed.some(p => p.overflow)) {
    setValidMessage('Some panels overflow: increase sheet size or gap', 'info');
    setStatusTone('processing');
  } else {
    setValidMessage('All panels fit on the sheet', 'ok');
    setStatusTone('ready');
  }
  setActionEnabled('btnSVG', true);
}

function doExportSVG(): void {
  if ((!currentLayout && !currentGroupedLayouts) || !currentParams) {
    setValidMessage('Run bin packing first', 'error');
    setStatusTone('error');
    return;
  }

  const svg = currentGroupedLayouts
    ? generateGroupedSVG(currentGroupedLayouts, currentParams)
    : generateSVG(currentLayout!, currentParams);
  downloadSVG(svg);
  const parts = currentGroupedLayouts
    ? currentGroupedLayouts.reduce((s, g) => s + g.layout.placed.length, 0)
    : currentLayout!.placed.length;
  notifyUser({
    status: 'SVG downloaded',
    dims: `Parts: ${parts}`,
    toastKind: 'ok',
    toastMessage: 'SVG exported',
    tone: 'ready',
  });
}

function doExportProjectJSON(): void {
  const validation = validateUI(true);
  if (!validation.valid) {
    setStatusTone('error');
    return;
  }

  if (!currentParams) {
    setValidMessage('Generate geometry first', 'error');
    setStatusTone('error');
    return;
  }
  const sheet = currentSheet ?? readSheetFromUI();
  currentSheet = sheet;
  const json = exportProject(currentParams, sheet);
  downloadJSON(json);
  notifyUser({
    status: 'Project JSON downloaded',
    toastKind: 'ok',
    toastMessage: 'Project JSON exported',
    tone: 'ready',
  });
}

function syncCustomSheet(): void {
  el<HTMLElement>('customSheetSub').classList.toggle('open', el<HTMLSelectElement>('shSz').value === 'custom');
}

let liveTimer: number | undefined;
let livePending: 'model' | 'sheet' | null = null;

/**
 * Rebuilds the model (or just the sheet layout) shortly after a value changes, so typing
 * "125" does not rebuild three times. Only runs once a box has been generated.
 */
function scheduleLiveUpdate(kind: 'model' | 'sheet'): void {
  if (!el<HTMLElement>('togLive').classList.contains('on') || !currentGeometry) return;
  livePending = livePending === 'model' ? 'model' : kind;
  window.clearTimeout(liveTimer);
  liveTimer = window.setTimeout(runLiveUpdate, 350);
}

function runLiveUpdate(): void {
  const kind = livePending;
  livePending = null;
  if (!kind || !currentGeometry) return;
  if (!validateUI(false).valid) return;

  const hadLayout = !!(currentLayout || currentGroupedLayouts);
  try {
    if (kind === 'model') {
      regenerate3D();
      if (hadLayout) runPacking();
    } else if (hadLayout) {
      runPacking();
    }
  } catch (e) {
    setValidMessage((e as Error).message, 'error');
  }
}

function applyProjectToUI(project: { params: BoxParams; sheet: SheetConfig }): void {
  const p = project.params;
  const sheet = project.sheet;

  el<HTMLInputElement>('bW').value = String(p.width);
  el<HTMLInputElement>('bD').value = String(p.depth);
  el<HTMLInputElement>('bH').value = String(p.height);

  el<HTMLInputElement>('tF').value = String(p.material.frameThickness);
  el<HTMLInputElement>('tB').value = String(p.material.baseThickness);
  el<HTMLInputElement>('tD').value = String(p.material.dividerThickness);
  el<HTMLInputElement>('kerf').value = String(p.material.kerf);

  el<HTMLSelectElement>('tabStyle').value = p.joint.style;
  el<HTMLInputElement>('tabN').value = String(p.joint.minTabCount);
  el<HTMLInputElement>('tabW').value = String(p.joint.tabWidthOverride);

  toggleOn(el<HTMLElement>('togLid'), p.lid.enabled);
  el<HTMLInputElement>('lidH').value = String(p.lid.height);
  el<HTMLInputElement>('lidTol').value = String(p.lid.tolerance);

  toggleOn(el<HTMLElement>('togDiv'), p.divider.enabled);
  el<HTMLInputElement>('dCols').value = String(p.divider.columns);
  el<HTMLInputElement>('dRows').value = String(p.divider.rows);
  el<HTMLInputElement>('dH').value = String(p.divider.heightOverride);
  el<HTMLInputElement>('dColW').value = p.divider.columnWidths.join(', ');
  el<HTMLInputElement>('dRowD').value = p.divider.rowDepths.join(', ');

  el<HTMLSelectElement>('shSz').value = sheet.size;
  el<HTMLInputElement>('shGap').value = String(sheet.gap);
  el<HTMLInputElement>('shW').value = String(sheet.width);
  el<HTMLInputElement>('shH').value = String(sheet.height);
  syncCustomSheet();

  el<HTMLElement>('lidSub').classList.toggle('open', p.lid.enabled);
  el<HTMLElement>('divSub').classList.toggle('open', p.divider.enabled);

  currentThicknessView = '__all__';
  refreshThicknessSelector();
}

function showJsonMessage(lines: string[]): void {
  const box = el<HTMLElement>('jsonMsg');
  const shown = lines.slice(0, 8);
  if (lines.length > shown.length) shown.push(`...and ${lines.length - shown.length} more`);
  box.textContent = shown.map(l => `• ${l}`).join('\n');
  box.setAttribute('data-kind', lines.length ? 'error' : '');
}

function openJsonModal(initialValue: string, title: string): void {
  showJsonMessage([]);
  el<HTMLElement>('jsonModalTitle').textContent = title;
  el<HTMLTextAreaElement>('jsonArea').value = initialValue;
  el<HTMLElement>('jsonModal').style.display = 'flex';
}

function closeJsonModal(): void {
  el<HTMLElement>('jsonModal').style.display = 'none';
}

function initUI(): void {
  el<HTMLElement>('lidSub').classList.remove('open');
  el<HTMLElement>('divSub').classList.remove('open');

  const lidToggle = el<HTMLElement>('togLid');
  const divToggle = el<HTMLElement>('togDiv');
  const lidRow = el<HTMLElement>('togLidRow');
  const divRow = el<HTMLElement>('togDivRow');
  const sepToggle = el<HTMLElement>('togSepMat');
  const sepRow = el<HTMLElement>('togSepMatRow');
  const thicknessSel = el<HTMLSelectElement>('thicknessSel');

  lidRow.addEventListener('click', () => {
    const enabled = !lidToggle.classList.contains('on');
    toggleOn(lidToggle, enabled);
    el<HTMLElement>('lidSub').classList.toggle('open', enabled);
    refreshValidation();
    scheduleLiveUpdate('model');
  });
  divRow.addEventListener('click', () => {
    const enabled = !divToggle.classList.contains('on');
    toggleOn(divToggle, enabled);
    el<HTMLElement>('divSub').classList.toggle('open', enabled);
    refreshValidation();
    scheduleLiveUpdate('model');
  });

  sepRow.addEventListener('click', () => {
    const enabled = !sepToggle.classList.contains('on');
    toggleOn(sepToggle, enabled);
    toast(enabled ? 'Packing: grouped by thickness' : 'Packing: single sheet', 'info');
    if (!enabled) {
      currentThicknessView = '__all__';
      refreshThicknessSelector();
    }
  });

  thicknessSel.addEventListener('change', () => {
    currentThicknessView = thicknessSel.value;
    renderCurrentFlatPreview();
  });

  el<HTMLButtonElement>('v3dBtn').addEventListener('click', () => setView('3d'));
  el<HTMLButtonElement>('vFlatBtn').addEventListener('click', () => setView('flat'));

  el<HTMLButtonElement>('btnReset').addEventListener('click', () => boxRenderer?.resetCamera());
  el<HTMLButtonElement>('btnWire').addEventListener('click', () => {
    if (!boxRenderer) return;
    boxRenderer.wireframe = !boxRenderer.wireframe;
    el<HTMLButtonElement>('btnWire').classList.toggle('active', boxRenderer.wireframe);
  });
  el<HTMLButtonElement>('btnExplode').addEventListener('click', () => {
    if (!boxRenderer) return;
    boxRenderer.explode = !boxRenderer.explode;
    el<HTMLButtonElement>('btnExplode').classList.toggle('active', boxRenderer.explode);
  });

  el<HTMLButtonElement>('btnGenerate').addEventListener('click', () => {
    try {
      currentParams = readBoxParamsFromUI();
      regenerate3D();
      runPacking();
    } catch (e) {
      setValidMessage((e as Error).message, 'error');
      setStatusTone('error');
      setEmptyStateVisible(true);
    }
  });

  el<HTMLButtonElement>('btnPack').addEventListener('click', () => {
    try {
      runPacking();
    } catch (e) {
      setValidMessage((e as Error).message, 'error');
    }
  });

  el<HTMLButtonElement>('btnSVG').addEventListener('click', () => doExportSVG());
  el<HTMLButtonElement>('btnExport').addEventListener('click', () => doExportProjectJSON());

  const modelInputs = [
    'bW', 'bD', 'bH', 'tF', 'tB', 'tD', 'kerf',
    'tabStyle', 'tabN', 'tabW', 'lidH', 'lidTol', 'dCols', 'dRows', 'dH', 'dColW', 'dRowD',
  ];
  const sheetInputs = ['shSz', 'shGap', 'shW', 'shH'];
  for (const [ids, kind] of [[modelInputs, 'model'], [sheetInputs, 'sheet']] as const) {
    for (const id of ids) {
      const node = el<HTMLElement>(id);
      const onChange = () => {
        if (id === 'shSz') syncCustomSheet();
        refreshValidation();
        scheduleLiveUpdate(kind);
      };
      node.addEventListener('input', onChange);
      node.addEventListener('change', onChange);
    }
  }
  syncCustomSheet();

  el<HTMLElement>('togLiveRow').addEventListener('click', () => {
    const on = !el<HTMLElement>('togLive').classList.contains('on');
    toggleOn(el<HTMLElement>('togLive'), on);
    toast(on ? 'Automatic update on' : 'Automatic update off', 'info');
  });

  el<HTMLButtonElement>('btnFitBox').addEventListener('click', fitBoxToCompartments);

  el<HTMLButtonElement>('btnDefaults').addEventListener('click', () => {
    applyProjectToUI({ params: defaultBoxParams(), sheet: defaultSheetConfig() });
    refreshValidation();
    scheduleLiveUpdate('model');
    toast('Values reset to defaults', 'info');
  });

  el<HTMLButtonElement>('btnImport').addEventListener('click', () => {
    openJsonModal('', 'Import JSON');
  });

  el<HTMLButtonElement>('btnCloseModal').addEventListener('click', closeJsonModal);
  el<HTMLButtonElement>('btnCloseModal2').addEventListener('click', closeJsonModal);

  el<HTMLButtonElement>('btnApplyJSON').addEventListener('click', () => {
    const raw = el<HTMLTextAreaElement>('jsonArea').value;
    const res = importProject(raw);
    if (!res.success || !res.project) {
      showJsonMessage(res.validation.errors);
      return;
    }

    applyProjectToUI(res.project);
    currentParams = res.project.params;
    currentSheet = res.project.sheet;
    currentLayout = null;
    highlightSeq = null;

    try {
      regenerate3D();
      runPacking();
      validateUI(true);
    } catch (e) {
      showJsonMessage([(e as Error).message]);
      return;
    }
    closeJsonModal();
    const notes = res.validation.warnings.length;
    toast(
      notes ? `Project imported (${notes} note${notes === 1 ? '' : 's'}: ${res.validation.warnings[0]})` : 'Project imported',
      notes ? 'info' : 'ok',
      notes ? 4500 : 2200,
    );
  });

  el<HTMLButtonElement>('btnCopyJSON').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(el<HTMLTextAreaElement>('jsonArea').value);
      showStatus('Copied to clipboard');
      toast('Copied JSON to clipboard', 'ok');
    } catch {
      setValidMessage('Clipboard copy failed', 'error');
      toast('Clipboard copy failed', 'err');
      setStatusTone('error');
    }
  });

  // Close modal when clicking outside the modal box.
  el<HTMLElement>('jsonModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeJsonModal();
  });

  // Keyboard shortcut: Ctrl+Enter triggers Generate.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      el<HTMLButtonElement>('btnGenerate').click();
    }
  });
}

function initRenderer(): void {
  const c3d = el<HTMLCanvasElement>('c3d');
  boxRenderer = new BoxRenderer(c3d);
  boxRenderer.start();
}

function handleResize(): void {
  const c3d = el<HTMLCanvasElement>('c3d');
  const rect = c3d.getBoundingClientRect();
  if (boxRenderer && rect.width > 0 && rect.height > 0) {
    boxRenderer.resize(Math.floor(rect.width), Math.floor(rect.height));
  }

  if (viewMode === 'flat') {
    renderCurrentFlatPreview();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initRenderer();
  initUI();

  handleResize();
  window.addEventListener('resize', handleResize);

  showStatus('Ready — click Generate');
  setStatusTone('ready');
  setEmptyStateVisible(true);
  setActionEnabled('btnSVG', false);
  validateUI(false);
});
