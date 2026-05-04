import { buildBoxGeometry } from './geometry/GeometryEngine';
import { applyJointToPanel } from './geometry/JointEngine';
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
  params.joint.tabWidthOverride = 0;

  const lidEnabled = el<HTMLElement>('togLid').classList.contains('on');
  params.lid.enabled = lidEnabled;
  params.lid.height = num('lidH');
  params.lid.tolerance = Number(el<HTMLInputElement>('lidTol').value);

  const divEnabled = el<HTMLElement>('togDiv').classList.contains('on');
  params.divider.enabled = divEnabled;
  params.divider.columns = num('dCols');
  params.divider.rows = num('dRows');
  params.divider.heightOverride = num('dH');

  params.inset.enabled = false;
  params.inset.compartments = [];

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
    if (cols > 1) {
      const colSlotW = (iW - tD * (cols - 1)) / cols;
      if (colSlotW <= 0) errors.push('Divider columns do not fit current width/thickness');
    }
    if (rows > 1) {
      const rowSlotD = (iD - tD * (rows - 1)) / rows;
      if (rowSlotD <= 0) errors.push('Divider rows do not fit current depth/thickness');
    }
  }

  return { valid: errors.length === 0, params: errors.length ? null : params, errors };
}

function validateUI(showMessage = true): UIValidationResult {
  const params = readBoxParamsFromUI();
  const result = validateParams(params);

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

  if (config.size !== 'custom' && SHEET_SIZES[size]) {
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
  geometry.panels.forEach(p => applyJointToPanel(p, params.joint, params.material.kerf));
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

  toggleOn(el<HTMLElement>('togLid'), p.lid.enabled);
  el<HTMLInputElement>('lidH').value = String(p.lid.height);
  el<HTMLInputElement>('lidTol').value = String(p.lid.tolerance);

  toggleOn(el<HTMLElement>('togDiv'), p.divider.enabled);
  el<HTMLInputElement>('dCols').value = String(p.divider.columns);
  el<HTMLInputElement>('dRows').value = String(p.divider.rows);
  el<HTMLInputElement>('dH').value = String(p.divider.heightOverride);

  el<HTMLSelectElement>('shSz').value = sheet.size;
  el<HTMLInputElement>('shGap').value = String(sheet.gap);

  el<HTMLElement>('lidSub').classList.toggle('open', p.lid.enabled);
  el<HTMLElement>('divSub').classList.toggle('open', p.divider.enabled);

  currentThicknessView = '__all__';
  refreshThicknessSelector();
}

function openJsonModal(initialValue: string, title: string): void {
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
    validateUI(false);
  });
  divRow.addEventListener('click', () => {
    const enabled = !divToggle.classList.contains('on');
    toggleOn(divToggle, enabled);
    el<HTMLElement>('divSub').classList.toggle('open', enabled);
    validateUI(false);
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

  const watchedInputs = [
    'bW', 'bD', 'bH', 'tF', 'tB', 'tD', 'kerf',
    'tabStyle', 'tabN', 'lidH', 'lidTol', 'dCols', 'dRows', 'dH', 'shSz', 'shGap',
  ];
  for (const id of watchedInputs) {
    const node = el<HTMLElement>(id);
    node.addEventListener('input', () => validateUI(false));
    node.addEventListener('change', () => validateUI(false));
  }

  el<HTMLButtonElement>('btnImport').addEventListener('click', () => {
    openJsonModal('', 'Import JSON');
  });

  el<HTMLButtonElement>('btnCloseModal').addEventListener('click', closeJsonModal);
  el<HTMLButtonElement>('btnCloseModal2').addEventListener('click', closeJsonModal);

  el<HTMLButtonElement>('btnApplyJSON').addEventListener('click', () => {
    const raw = el<HTMLTextAreaElement>('jsonArea').value;
    const res = importProject(raw);
    if (!res.success || !res.project) {
      setValidMessage(res.validation.errors.join('\n'), 'error');
      return;
    }

    applyProjectToUI(res.project);
    currentParams = res.project.params;
    currentSheet = res.project.sheet;
    currentLayout = null;
    highlightSeq = null;

    regenerate3D();
    runPacking();
    validateUI(true);
    closeJsonModal();
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
