import { layoutCompartments } from '../geometry/compartments';
import { labelProblem } from '../geometry/label';
import { DEFAULT_CUTTING } from '../svg/cutting';
import { DEFAULT_SEARCH } from '../svg/layoutSearch';
import type {
  BoxMakerProject,
  BoxParams,
  CuttingConfig,
  LayoutSearchConfig,
  SheetConfig,
  ValidationResult,
} from '../models/types';

const APP_VERSION = '1.0.0';

export function defaultBoxParams(): BoxParams {
  return {
    width:  120,
    depth:  90,
    height: 55,
    material: {
      frameThickness:   3,
      baseThickness:    3,
      dividerThickness: 3,
      kerf:             0.1,
      fitClearance:     0,
    },
    joint: {
      style:            'finger',
      minTabCount:       3,
      tabWidthOverride:  0,
    },
    divider: {
      enabled:        false,
      columns:        2,
      rows:           2,
      columnWidths:   [],
      rowDepths:      [],
      heightOverride: 0,
    },
    lid: {
      enabled:   false,
      height:    12,
      tolerance: 0.2,
    },
    label: {
      enabled:  false,
      text:     '',
      face:     'front',
      fontSize: 8,
    },
  };
}

export function defaultSheetConfig(): SheetConfig {
  return {
    size:   'A3',
    width:  420,
    height: 297,
    gap:    2,
    algorithm: 'maxrects',
    cutting: { ...DEFAULT_CUTTING },
    search: { ...DEFAULT_SEARCH },
  };
}

export function exportProject(
  params: BoxParams,
  sheet: SheetConfig,
): string {
  const project: BoxMakerProject = {
    meta: {
      app:      'Web-Based Box Maker',
      version:  APP_VERSION,
      author:   'Ferhat Göksel',
      created:  new Date().toISOString(),
      modified: new Date().toISOString(),
    },
    params,
    sheet,
  };
  return JSON.stringify(project, null, 2);
}

type Obj = Record<string, unknown>;

const MAX_JSON_CHARS = 1_000_000;
const TAB_STYLES = ['finger', 'none'] as const;
const LABEL_FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
const SHEET_SIZES = ['A4', 'A3', 'A2', 'A1', 'custom'] as const;
const PACKING_ALGORITHMS = ['guillotine', 'maxrects', 'skyline'] as const;

function isObject(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'string') return `"${v.length > 20 ? v.slice(0, 20) + '...' : v}"`;
  if (typeof v === 'object') return 'an object';
  return String(v);
}

/** Reads and range-checks one field at a time, collecting every problem instead of stopping at the first. */
class Reader {
  errors: string[] = [];
  warnings: string[] = [];

  number(
    src: Obj,
    key: string,
    path: string,
    fallback: number,
    opts: { min?: number; max?: number; above?: number; integer?: boolean },
  ): number {
    const where = `${path}.${key}`;
    const v = src[key];
    if (v === undefined) {
      this.errors.push(`${where} is missing`);
      return fallback;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.errors.push(`${where} must be a number (got ${describe(v)})`);
      return fallback;
    }
    if (opts.integer && !Number.isInteger(v)) {
      this.errors.push(`${where} must be a whole number (got ${v})`);
      return fallback;
    }
    if (opts.above !== undefined && !(v > opts.above)) {
      this.errors.push(`${where} must be greater than ${opts.above} (got ${v})`);
      return fallback;
    }
    if (opts.min !== undefined && v < opts.min) {
      this.errors.push(`${where} must be at least ${opts.min} (got ${v})`);
      return fallback;
    }
    if (opts.max !== undefined && v > opts.max) {
      this.errors.push(`${where} must be at most ${opts.max} (got ${v})`);
      return fallback;
    }
    return v;
  }

  /** An optional list of positive sizes. A missing list means "not used" and is not an error. */
  sizeList(src: Obj, key: string, path: string): number[] {
    const where = `${path}.${key}`;
    const v = src[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      this.errors.push(`${where} must be a list of numbers (got ${describe(v)})`);
      return [];
    }
    if (v.length > 50) {
      this.errors.push(`${where} has too many entries (maximum 50)`);
      return [];
    }
    const out: number[] = [];
    v.forEach((item, n) => {
      if (typeof item !== 'number' || !Number.isFinite(item)) {
        this.errors.push(`${where}[${n}] must be a number (got ${describe(item)})`);
      } else if (!(item > 0) || item > 10000) {
        this.errors.push(`${where}[${n}] must be greater than 0 and at most 10000 (got ${item})`);
      } else {
        out.push(item);
      }
    });
    return out;
  }

  boolean(src: Obj, key: string, path: string, fallback: boolean): boolean {
    const v = src[key];
    if (typeof v === 'boolean') return v;
    this.errors.push(
      v === undefined ? `${path}.${key} is missing` : `${path}.${key} must be true or false (got ${describe(v)})`,
    );
    return fallback;
  }

  string(src: Obj, key: string, path: string, fallback: string, maxLength: number): string {
    const v = src[key];
    if (typeof v !== 'string') {
      this.errors.push(
        v === undefined ? `${path}.${key} is missing` : `${path}.${key} must be text (got ${describe(v)})`,
      );
      return fallback;
    }
    if (v.length > maxLength) {
      this.errors.push(`${path}.${key} is too long (maximum ${maxLength} characters)`);
      return fallback;
    }
    return v;
  }

  oneOf<T extends string>(src: Obj, key: string, path: string, allowed: readonly T[], fallback: T): T {
    const v = src[key];
    if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) return v as T;
    this.errors.push(
      v === undefined
        ? `${path}.${key} is missing`
        : `${path}.${key} must be one of ${allowed.join(', ')} (got ${describe(v)})`,
    );
    return fallback;
  }

  /** A nested section: a missing one falls back to the defaults with a note, a wrongly typed one is an error. */
  section(src: Obj, key: string, path: string): Obj | null {
    const v = src[key];
    if (v === undefined) {
      this.warnings.push(`${path}.${key} is missing, using default values`);
      return null;
    }
    if (!isObject(v)) {
      this.errors.push(`${path}.${key} must be an object (got ${describe(v)})`);
      return null;
    }
    return v;
  }

  unknownKeys(src: Obj, path: string, known: string[]): void {
    for (const k of Object.keys(src)) {
      if (!known.includes(k)) this.warnings.push(`${path}.${k} is not used and was ignored`);
    }
  }
}

/** Older files may say "box", which was only ever another name for finger joints. */
function readJointStyle(r: Reader, joint: Obj, path: string, fallback: BoxParams['joint']['style']): BoxParams['joint']['style'] {
  if (joint.style === 'box') {
    r.warnings.push(`${path}.style "box" is now called "finger"; using finger joints`);
    return 'finger';
  }
  return r.oneOf(joint, 'style', path, TAB_STYLES, fallback);
}

const DIM = { above: 0, max: 10000 };
const THICKNESS = { above: 0, max: 100 };

function readParams(r: Reader, src: Obj): BoxParams {
  const d = defaultBoxParams();
  const path = 'params';
  r.unknownKeys(src, path, ['width', 'depth', 'height', 'material', 'joint', 'divider', 'lid', 'label']);

  const params: BoxParams = {
    width: r.number(src, 'width', path, d.width, DIM),
    depth: r.number(src, 'depth', path, d.depth, DIM),
    height: r.number(src, 'height', path, d.height, DIM),
    material: { ...d.material },
    joint: { ...d.joint },
    divider: { ...d.divider },
    lid: { ...d.lid },
    label: { ...d.label },
  };

  const material = r.section(src, 'material', path);
  if (material) {
    const mp = `${path}.material`;
    r.unknownKeys(material, mp, ['frameThickness', 'baseThickness', 'dividerThickness', 'kerf', 'fitClearance']);
    params.material = {
      frameThickness: r.number(material, 'frameThickness', mp, d.material.frameThickness, THICKNESS),
      baseThickness: r.number(material, 'baseThickness', mp, d.material.baseThickness, THICKNESS),
      dividerThickness: r.number(material, 'dividerThickness', mp, d.material.dividerThickness, THICKNESS),
      kerf: r.number(material, 'kerf', mp, d.material.kerf, { min: 0, max: 5 }),
      // Added after the first file format, so files without it are fine.
      fitClearance:
        material.fitClearance === undefined
          ? d.material.fitClearance
          : r.number(material, 'fitClearance', mp, d.material.fitClearance, { min: 0, max: 1 }),
    };
  }

  const joint = r.section(src, 'joint', path);
  if (joint) {
    const jp = `${path}.joint`;
    r.unknownKeys(joint, jp, ['style', 'minTabCount', 'tabWidthOverride']);
    params.joint = {
      style: readJointStyle(r, joint, jp, d.joint.style),
      minTabCount: r.number(joint, 'minTabCount', jp, d.joint.minTabCount, { min: 1, max: 99, integer: true }),
      tabWidthOverride: r.number(joint, 'tabWidthOverride', jp, d.joint.tabWidthOverride, { min: 0, max: 1000 }),
    };
  }

  const divider = r.section(src, 'divider', path);
  if (divider) {
    const dp = `${path}.divider`;
    r.unknownKeys(divider, dp, ['enabled', 'columns', 'rows', 'columnWidths', 'rowDepths', 'heightOverride']);
    params.divider = {
      enabled: r.boolean(divider, 'enabled', dp, d.divider.enabled),
      columns: r.number(divider, 'columns', dp, d.divider.columns, { min: 1, max: 50, integer: true }),
      rows: r.number(divider, 'rows', dp, d.divider.rows, { min: 1, max: 50, integer: true }),
      columnWidths: r.sizeList(divider, 'columnWidths', dp),
      rowDepths: r.sizeList(divider, 'rowDepths', dp),
      heightOverride: r.number(divider, 'heightOverride', dp, d.divider.heightOverride, { min: 0, max: 10000 }),
    };
  }

  const lid = r.section(src, 'lid', path);
  if (lid) {
    const lp = `${path}.lid`;
    r.unknownKeys(lid, lp, ['enabled', 'height', 'tolerance']);
    params.lid = {
      enabled: r.boolean(lid, 'enabled', lp, d.lid.enabled),
      height: r.number(lid, 'height', lp, d.lid.height, DIM),
      tolerance: r.number(lid, 'tolerance', lp, d.lid.tolerance, { min: 0, max: 50 }),
    };
  }

  const label = r.section(src, 'label', path);
  if (label) {
    const lp = `${path}.label`;
    r.unknownKeys(label, lp, ['enabled', 'text', 'face', 'fontSize']);
    params.label = {
      enabled: r.boolean(label, 'enabled', lp, d.label.enabled),
      text: r.string(label, 'text', lp, d.label.text, 200),
      face: r.oneOf(label, 'face', lp, LABEL_FACES, d.label.face),
      fontSize: r.number(label, 'fontSize', lp, d.label.fontSize, { above: 0, max: 500 }),
    };
  }

  return params;
}

/** The cutting settings were added after the first file format, so a file without them gets the defaults. */
function readCutting(r: Reader, src: unknown): CuttingConfig {
  if (src === undefined) return { ...DEFAULT_CUTTING };
  if (!isObject(src)) {
    r.errors.push(`sheet.cutting must be an object (got ${describe(src)})`);
    return { ...DEFAULT_CUTTING };
  }
  r.unknownKeys(src, 'sheet.cutting', ['optimise', 'cutSpeed', 'travelSpeed']);
  return {
    optimise: r.boolean(src, 'optimise', 'sheet.cutting', DEFAULT_CUTTING.optimise),
    cutSpeed: r.number(src, 'cutSpeed', 'sheet.cutting', DEFAULT_CUTTING.cutSpeed, { above: 0, max: 5000 }),
    travelSpeed: r.number(src, 'travelSpeed', 'sheet.cutting', DEFAULT_CUTTING.travelSpeed, { above: 0, max: 5000 }),
  };
}

/** The layout search was added after the first file format, so a file without it packs once, as before. */
function readSearch(r: Reader, src: unknown): LayoutSearchConfig {
  if (src === undefined) return { ...DEFAULT_SEARCH };
  if (!isObject(src)) {
    r.errors.push(`sheet.search must be an object (got ${describe(src)})`);
    return { ...DEFAULT_SEARCH };
  }
  r.unknownKeys(src, 'sheet.search', ['enabled', 'candidates']);
  return {
    enabled: r.boolean(src, 'enabled', 'sheet.search', DEFAULT_SEARCH.enabled),
    candidates: r.number(src, 'candidates', 'sheet.search', DEFAULT_SEARCH.candidates, { min: 1, max: 5000, integer: true }),
  };
}

function readSheet(r: Reader, src: unknown): SheetConfig {
  const d = defaultSheetConfig();
  if (src === undefined) {
    r.warnings.push('sheet is missing, using the default sheet (A3)');
    return d;
  }
  if (!isObject(src)) {
    r.errors.push(`sheet must be an object (got ${describe(src)})`);
    return d;
  }
  r.unknownKeys(src, 'sheet', ['size', 'width', 'height', 'gap', 'algorithm', 'cutting', 'search']);
  return {
    cutting: readCutting(r, src.cutting),
    search: readSearch(r, src.search),
    // Files saved before there was a choice were packed with guillotine, so they keep it.
    algorithm: src.algorithm === undefined ? 'guillotine' : r.oneOf(src, 'algorithm', 'sheet', PACKING_ALGORITHMS, d.algorithm ?? 'maxrects'),
    size: r.oneOf(src, 'size', 'sheet', SHEET_SIZES, d.size),
    width: r.number(src, 'width', 'sheet', d.width, { above: 0, max: 100000 }),
    height: r.number(src, 'height', 'sheet', d.height, { above: 0, max: 100000 }),
    gap: r.number(src, 'gap', 'sheet', d.gap, { min: 0, max: 100 }),
  };
}

/** Checks that the values describe a box that can actually be built (walls leave room, dividers fit). */
function checkBuildable(r: Reader, p: BoxParams): void {
  const { frameThickness: tF, baseThickness: tB, dividerThickness: tD } = p.material;
  const iW = p.width - 2 * tF;
  const iD = p.depth - 2 * tF;
  const iH = p.height - tB;
  if (iW <= 0) r.errors.push('params: width is too small for the frame thickness');
  if (iD <= 0) r.errors.push('params: depth is too small for the frame thickness');
  if (iH <= 0) r.errors.push('params: height is too small for the base thickness');

  if (p.lid.enabled && p.lid.height <= tB) {
    r.errors.push('params.lid.height must be greater than the base thickness');
  }

  const label = labelProblem(p);
  if (label && iW > 0 && iD > 0 && iH > 0) r.errors.push(`params.label: ${label}`);

  if (p.divider.enabled && iW > 0 && iD > 0 && iH > 0) {
    const dH = p.divider.heightOverride > 0 ? p.divider.heightOverride : iH;
    if (dH > iH) r.errors.push('params.divider.heightOverride is taller than the inside of the box');
    const cols = layoutCompartments(iW, tD, p.divider.columns, p.divider.columnWidths, 'width');
    if (cols.error) r.errors.push(`params.divider: ${cols.error}`);
    const rows = layoutCompartments(iD, tD, p.divider.rows, p.divider.rowDepths, 'depth');
    if (rows.error) r.errors.push(`params.divider: ${rows.error}`);
  }
}

export function importProject(jsonString: string): {
  success: boolean;
  project: BoxMakerProject | null;
  validation: ValidationResult;
} {
  const fail = (errors: string[], warnings: string[] = []) => ({
    success: false,
    project: null,
    validation: { valid: false, errors, warnings },
  });

  if (typeof jsonString !== 'string' || jsonString.trim() === '') {
    return fail(['The JSON is empty']);
  }
  if (jsonString.length > MAX_JSON_CHARS) {
    return fail(['The JSON is too large to be a box design']);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (e) {
    return fail([`JSON parse error: ${(e as Error).message}`]);
  }

  if (!isObject(raw)) {
    return fail(['The root of the file must be a JSON object']);
  }
  if (!isObject(raw.params)) {
    return fail([raw.params === undefined ? 'params is missing' : `params must be an object (got ${describe(raw.params)})`]);
  }

  const r = new Reader();
  r.unknownKeys(raw, 'file', ['meta', 'params', 'sheet']);
  const params = readParams(r, raw.params);
  const sheet = readSheet(r, raw.sheet);
  if (r.errors.length === 0) checkBuildable(r, params);

  if (r.errors.length > 0) return fail(r.errors, r.warnings);

  // Only the checked values are copied over; nothing else from the file is kept.
  const now = new Date().toISOString();
  const project: BoxMakerProject = {
    meta: {
      app: 'Web-Based Box Maker',
      version: APP_VERSION,
      author: 'Ferhat Göksel',
      created: now,
      modified: now,
    },
    params,
    sheet,
  };

  return {
    success: true,
    project,
    validation: { valid: true, errors: [], warnings: r.warnings },
  };
}

export function downloadJSON(content: string, filename = 'web-box-maker-project.json'): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}