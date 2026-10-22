import type {
  BoxMakerProject,
  BoxParams,
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
      heightOverride: 0,
    },
    lid: {
      enabled:   false,
      height:    12,
      tolerance: 0.2,
    },
    inset: {
      enabled:      false,
      compartments: [],
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
const TAB_STYLES = ['finger', 'box', 'dovetail', 'none'] as const;
const LABEL_FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
const SHEET_SIZES = ['A4', 'A3', 'A2', 'A1', 'custom'] as const;

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

const DIM = { above: 0, max: 10000 };
const THICKNESS = { above: 0, max: 100 };

function readParams(r: Reader, src: Obj): BoxParams {
  const d = defaultBoxParams();
  const path = 'params';
  r.unknownKeys(src, path, ['width', 'depth', 'height', 'material', 'joint', 'divider', 'lid', 'inset', 'label']);

  const params: BoxParams = {
    width: r.number(src, 'width', path, d.width, DIM),
    depth: r.number(src, 'depth', path, d.depth, DIM),
    height: r.number(src, 'height', path, d.height, DIM),
    material: { ...d.material },
    joint: { ...d.joint },
    divider: { ...d.divider },
    lid: { ...d.lid },
    inset: { enabled: d.inset.enabled, compartments: [] },
    label: { ...d.label },
  };

  const material = r.section(src, 'material', path);
  if (material) {
    const mp = `${path}.material`;
    r.unknownKeys(material, mp, ['frameThickness', 'baseThickness', 'dividerThickness', 'kerf']);
    params.material = {
      frameThickness: r.number(material, 'frameThickness', mp, d.material.frameThickness, THICKNESS),
      baseThickness: r.number(material, 'baseThickness', mp, d.material.baseThickness, THICKNESS),
      dividerThickness: r.number(material, 'dividerThickness', mp, d.material.dividerThickness, THICKNESS),
      kerf: r.number(material, 'kerf', mp, d.material.kerf, { min: 0, max: 5 }),
    };
  }

  const joint = r.section(src, 'joint', path);
  if (joint) {
    const jp = `${path}.joint`;
    r.unknownKeys(joint, jp, ['style', 'minTabCount', 'tabWidthOverride']);
    params.joint = {
      style: r.oneOf(joint, 'style', jp, TAB_STYLES, d.joint.style),
      minTabCount: r.number(joint, 'minTabCount', jp, d.joint.minTabCount, { min: 1, max: 99, integer: true }),
      tabWidthOverride: r.number(joint, 'tabWidthOverride', jp, d.joint.tabWidthOverride, { min: 0, max: 1000 }),
    };
  }

  const divider = r.section(src, 'divider', path);
  if (divider) {
    const dp = `${path}.divider`;
    r.unknownKeys(divider, dp, ['enabled', 'columns', 'rows', 'heightOverride']);
    params.divider = {
      enabled: r.boolean(divider, 'enabled', dp, d.divider.enabled),
      columns: r.number(divider, 'columns', dp, d.divider.columns, { min: 1, max: 50, integer: true }),
      rows: r.number(divider, 'rows', dp, d.divider.rows, { min: 1, max: 50, integer: true }),
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

  const inset = r.section(src, 'inset', path);
  if (inset) {
    const ip = `${path}.inset`;
    r.unknownKeys(inset, ip, ['enabled', 'compartments']);
    params.inset.enabled = r.boolean(inset, 'enabled', ip, d.inset.enabled);
    const list = inset.compartments;
    if (!Array.isArray(list)) {
      r.errors.push(
        list === undefined ? `${ip}.compartments is missing` : `${ip}.compartments must be a list (got ${describe(list)})`,
      );
    } else if (list.length > 100) {
      r.errors.push(`${ip}.compartments has too many entries (maximum 100)`);
    } else {
      list.forEach((item, n) => {
        const cp = `${ip}.compartments[${n}]`;
        if (!isObject(item)) {
          r.errors.push(`${cp} must be an object (got ${describe(item)})`);
          return;
        }
        r.unknownKeys(item, cp, ['width', 'depth', 'height', 'label']);
        const comp = {
          width: r.number(item, 'width', cp, 1, DIM),
          depth: r.number(item, 'depth', cp, 1, DIM),
          height: r.number(item, 'height', cp, 1, DIM),
        } as { width: number; depth: number; height: number; label?: string };
        if (item.label !== undefined) comp.label = r.string(item, 'label', cp, '', 100);
        params.inset.compartments.push(comp);
      });
    }
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
  r.unknownKeys(src, 'sheet', ['size', 'width', 'height', 'gap']);
  return {
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

  if (p.divider.enabled && iW > 0 && iD > 0 && iH > 0) {
    const dH = p.divider.heightOverride > 0 ? p.divider.heightOverride : iH;
    if (dH > iH) r.errors.push('params.divider.heightOverride is taller than the inside of the box');
    if (p.divider.columns > 1 && (iW - tD * (p.divider.columns - 1)) / p.divider.columns <= 0) {
      r.errors.push('params.divider.columns do not fit in the box width');
    }
    if (p.divider.rows > 1 && (iD - tD * (p.divider.rows - 1)) / p.divider.rows <= 0) {
      r.errors.push('params.divider.rows do not fit in the box depth');
    }
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