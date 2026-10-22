import { describe, expect, it } from 'vitest';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { defaultBoxParams, defaultSheetConfig, exportProject, importProject } from '../utils/ProjectIO';

function validFile(): Record<string, any> {
  return JSON.parse(exportProject(defaultBoxParams(), defaultSheetConfig()));
}

function importObject(obj: unknown) {
  return importProject(JSON.stringify(obj));
}

function errorsOf(obj: unknown): string[] {
  const res = importObject(obj);
  expect(res.success).toBe(false);
  expect(res.project).toBeNull();
  return res.validation.errors;
}

describe('importProject: valid files', () => {
  it('round-trips an exported project exactly', () => {
    const params = defaultBoxParams();
    params.width = 150;
    params.lid.enabled = true;
    params.divider.enabled = true;
    params.divider.columns = 3;
    params.joint.style = 'none';
    const sheet = { ...defaultSheetConfig(), size: 'A2' as const, gap: 4 };

    const res = importProject(exportProject(params, sheet));
    expect(res.success).toBe(true);
    expect(res.project?.params).toEqual(params);
    expect(res.project?.sheet).toEqual(sheet);
    expect(res.validation.errors).toEqual([]);
    expect(res.validation.warnings).toEqual([]);
  });

  it('produces parameters the geometry engine can build', () => {
    const res = importProject(exportProject(defaultBoxParams(), defaultSheetConfig()));
    expect(() => buildBoxGeometry(res.project!.params)).not.toThrow();
  });

  it('accepts inset compartments with and without a label', () => {
    const file = validFile();
    file.params.inset = {
      enabled: true,
      compartments: [{ width: 20, depth: 30, height: 15, label: 'coins' }, { width: 10, depth: 10, height: 10 }],
    };
    const res = importObject(file);
    expect(res.success).toBe(true);
    expect(res.project?.params.inset.compartments).toHaveLength(2);
    expect(res.project?.params.inset.compartments[0].label).toBe('coins');
  });

  it('uses the default sheet, with a note, when the sheet is missing', () => {
    const file = validFile();
    delete file.sheet;
    const res = importObject(file);
    expect(res.success).toBe(true);
    expect(res.project?.sheet).toEqual(defaultSheetConfig());
    expect(res.validation.warnings.join(' ')).toContain('sheet is missing');
  });

  it('uses defaults, with a note, for an optional section that is missing', () => {
    const file = validFile();
    delete file.params.label;
    delete file.params.inset;
    const res = importObject(file);
    expect(res.success).toBe(true);
    expect(res.project?.params.label).toEqual(defaultBoxParams().label);
    expect(res.validation.warnings.some(w => w.includes('params.label'))).toBe(true);
    expect(res.validation.warnings.some(w => w.includes('params.inset'))).toBe(true);
  });
});

describe('importProject: unreadable input', () => {
  it('rejects empty text', () => {
    expect(importProject('').validation.errors[0]).toMatch(/empty/i);
    expect(importProject('   \n ').success).toBe(false);
  });

  it('rejects broken JSON', () => {
    const res = importProject('{"params": {');
    expect(res.success).toBe(false);
    expect(res.validation.errors[0]).toMatch(/parse error/i);
  });

  it('rejects input that is not an object', () => {
    for (const text of ['[]', '42', '"hello"', 'null', 'true']) {
      const res = importProject(text);
      expect(res.success, text).toBe(false);
    }
  });

  it('rejects a missing or wrongly typed params', () => {
    expect(errorsOf({})[0]).toBe('params is missing');
    expect(errorsOf({ params: 5 })[0]).toMatch(/params must be an object/);
    expect(errorsOf({ params: [] })[0]).toMatch(/params must be an object/);
  });

  it('rejects absurdly large input', () => {
    const res = importProject('{"params":{},"pad":"' + 'x'.repeat(1_100_000) + '"}');
    expect(res.success).toBe(false);
    expect(res.validation.errors[0]).toMatch(/too large/);
  });
});

describe('importProject: field checks', () => {
  it('names the exact field when a number has the wrong type', () => {
    const file = validFile();
    file.params.width = '120';
    const errors = errorsOf(file);
    expect(errors).toContain('params.width must be a number (got "120")');
  });

  it('rejects null, which is what NaN and Infinity become in JSON', () => {
    const file = validFile();
    file.params.depth = null;
    expect(errorsOf(file)).toContain('params.depth must be a number (got null)');
  });

  it('rejects zero, negative and oversized dimensions', () => {
    for (const [value, fragment] of [[0, 'greater than 0'], [-5, 'greater than 0'], [20000, 'at most 10000']] as const) {
      const file = validFile();
      file.params.height = value;
      expect(errorsOf(file).join(' ')).toContain(fragment);
    }
  });

  it('rejects a negative kerf and a zero thickness', () => {
    const file = validFile();
    file.params.material.kerf = -0.1;
    file.params.material.frameThickness = 0;
    const errors = errorsOf(file);
    expect(errors.some(e => e.startsWith('params.material.kerf'))).toBe(true);
    expect(errors.some(e => e.startsWith('params.material.frameThickness'))).toBe(true);
  });

  it('rejects an unknown joint style', () => {
    const file = validFile();
    file.params.joint.style = 'zigzag';
    expect(errorsOf(file)[0]).toContain('params.joint.style must be one of finger, box, dovetail, none');
  });

  it('rejects fractional counts', () => {
    const file = validFile();
    file.params.divider.columns = 2.5;
    file.params.joint.minTabCount = 0;
    const errors = errorsOf(file);
    expect(errors.some(e => e.includes('params.divider.columns must be a whole number'))).toBe(true);
    expect(errors.some(e => e.includes('params.joint.minTabCount must be at least 1'))).toBe(true);
  });

  it('rejects a non-boolean flag', () => {
    const file = validFile();
    file.params.lid.enabled = 'yes';
    expect(errorsOf(file)).toContain('params.lid.enabled must be true or false (got "yes")');
  });

  it('rejects a missing field inside a section', () => {
    const file = validFile();
    delete file.params.material.kerf;
    expect(errorsOf(file)).toContain('params.material.kerf is missing');
  });

  it('rejects a section of the wrong type', () => {
    const file = validFile();
    file.params.divider = [1, 2];
    expect(errorsOf(file)).toContain('params.divider must be an object (got an array)');
  });

  it('checks every inset compartment', () => {
    const file = validFile();
    file.params.inset = { enabled: true, compartments: [{ width: 10, depth: -1, height: 5 }, 'x', { width: 1, depth: 1 }] };
    const errors = errorsOf(file);
    expect(errors.some(e => e.startsWith('params.inset.compartments[0].depth'))).toBe(true);
    expect(errors.some(e => e.startsWith('params.inset.compartments[1] must be an object'))).toBe(true);
    expect(errors.some(e => e.startsWith('params.inset.compartments[2].height is missing'))).toBe(true);
  });

  it('rejects an invalid sheet', () => {
    const file = validFile();
    file.sheet = { size: 'B7', width: -1, height: 297, gap: 2 };
    const errors = errorsOf(file);
    expect(errors.some(e => e.startsWith('sheet.size must be one of'))).toBe(true);
    expect(errors.some(e => e.startsWith('sheet.width'))).toBe(true);
  });

  it('reports every problem at once, not just the first', () => {
    const file = validFile();
    file.params.width = -1;
    file.params.depth = 'x';
    file.params.joint.style = 'nope';
    file.sheet.gap = -3;
    expect(errorsOf(file).length).toBeGreaterThanOrEqual(4);
  });
});

describe('importProject: boxes that cannot be built', () => {
  it('rejects walls that leave no room inside', () => {
    const file = validFile();
    file.params.width = 5;
    expect(errorsOf(file)).toContain('params: width is too small for the frame thickness');
  });

  it('rejects a base thicker than the box is tall', () => {
    const file = validFile();
    file.params.height = 3;
    expect(errorsOf(file)).toContain('params: height is too small for the base thickness');
  });

  it('rejects a lid no taller than the base', () => {
    const file = validFile();
    file.params.lid.enabled = true;
    file.params.lid.height = 3;
    expect(errorsOf(file).join(' ')).toContain('params.lid.height must be greater than the base thickness');
  });

  it('rejects dividers that do not fit or are too tall', () => {
    const file = validFile();
    file.params.divider = { enabled: true, columns: 50, rows: 1, heightOverride: 0 };
    expect(errorsOf(file).join(' ')).toContain('params.divider.columns do not fit');

    const tall = validFile();
    tall.params.divider = { enabled: true, columns: 2, rows: 2, heightOverride: 500 };
    expect(errorsOf(tall).join(' ')).toContain('taller than the inside');
  });

  it('does not check dividers that are switched off', () => {
    const file = validFile();
    file.params.divider = { enabled: false, columns: 50, rows: 1, heightOverride: 0 };
    expect(importObject(file).success).toBe(true);
  });
});

describe('importProject: hostile input', () => {
  it('keeps only known fields and notes the rest', () => {
    const file = validFile();
    file.params.extra = 'ignored';
    file.params.material.surprise = 1;
    file.unexpected = true;
    const res = importObject(file);
    expect(res.success).toBe(true);
    expect(res.validation.warnings.join(' ')).toContain('params.extra');
    expect(res.validation.warnings.join(' ')).toContain('params.material.surprise');
    expect(JSON.stringify(res.project)).not.toContain('ignored');
    expect((res.project!.params as any).extra).toBeUndefined();
  });

  it('does not let a __proto__ key change anything', () => {
    const text = '{"__proto__":{"polluted":true},"params":' + JSON.stringify(validFile().params) + '}';
    const res = importProject(text);
    expect(res.success).toBe(true);
    expect(({} as any).polluted).toBeUndefined();
    expect((res.project as any).polluted).toBeUndefined();
  });

  it('does not return the parsed objects themselves', () => {
    const file = validFile();
    const res = importObject(file);
    expect(res.project?.params).not.toBe(file.params);
  });
});
