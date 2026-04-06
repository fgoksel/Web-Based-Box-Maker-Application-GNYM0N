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

export function importProject(jsonString: string): {
  success: boolean;
  project: BoxMakerProject | null;
  validation: ValidationResult;
} {
  const errors:   string[] = [];
  const warnings: string[] = [];

  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch (e) {
    return {
      success:    false,
      project:    null,
      validation: {
        valid:    false,
        errors:   [`JSON parse error: ${(e as Error).message}`],
        warnings: [],
      },
    };
  }

  if (typeof raw !== 'object' || raw === null) {
    return {
      success:    false,
      project:    null,
      validation: { valid: false, errors: ['Root must be a JSON object'], warnings: [] },
    };
  }

  const obj = raw as Record<string, unknown>;

  if (!obj.params) {
    errors.push('Missing params field');
  }

  if (errors.length > 0) {
    return {
      success:    false,
      project:    null,
      validation: { valid: false, errors, warnings },
    };
  }

  const project: BoxMakerProject = {
    meta: {
      app:      'Web-Based Box Maker',
      version:  APP_VERSION,
      author:   'Ferhat Göksel',
      created:  new Date().toISOString(),
      modified: new Date().toISOString(),
    },
    params: obj.params as BoxParams,
    sheet:  (obj.sheet as SheetConfig) ?? defaultSheetConfig(),
  };

  return {
    success:    true,
    project,
    validation: { valid: true, errors: [], warnings },
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