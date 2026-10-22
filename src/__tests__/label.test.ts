import { describe, expect, it } from 'vitest';
import { estimateTextWidth, labelFace, labelIssue, labelProblem, LABEL_PANEL } from '../geometry/label';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { applyJointToPanel } from '../geometry/JointEngine';
import { packPanels } from '../svg/BinPacker';
import { generateSVG } from '../svg/SvgEngine';
import { defaultBoxParams, defaultSheetConfig, exportProject, importProject } from '../utils/ProjectIO';
import type { BoxParams } from '../models/types';

function withLabel(text = 'TEA', face: BoxParams['label']['face'] = 'front', fontSize = 8): BoxParams {
  const params = defaultBoxParams();
  params.label = { enabled: true, text, face, fontSize };
  return params;
}

function buildSvg(params: BoxParams, sheet = defaultSheetConfig()): string {
  const geo = buildBoxGeometry(params);
  geo.panels.forEach(p => applyJointToPanel(p, params.joint));
  return generateSVG(packPanels(geo.panels, sheet), params);
}

describe('label faces', () => {
  it('sizes each face like the panel that carries it', () => {
    const params = defaultBoxParams(); // 120 x 90 x 55, 3 mm material
    expect(labelFace(params, 'front')).toEqual({ width: 114, height: 52 });
    expect(labelFace(params, 'back')).toEqual({ width: 114, height: 52 });
    expect(labelFace(params, 'left')).toEqual({ width: 90, height: 52 });
    expect(labelFace(params, 'right')).toEqual({ width: 90, height: 52 });
    expect(labelFace(params, 'bottom')).toEqual({ width: 120, height: 90 });
  });

  it('has a top face only when there is a lid', () => {
    const params = defaultBoxParams();
    expect(labelFace(params, 'top')).toBeNull();
    params.lid.enabled = true;
    const top = labelFace(params, 'top')!;
    expect(top.width).toBeCloseTo(120.4, 9);
    expect(top.height).toBeCloseTo(90.4, 9);
  });

  it('maps every face to a panel the engine really builds', () => {
    const params = defaultBoxParams();
    params.lid.enabled = true;
    const names = buildBoxGeometry(params).panels.map(p => p.name);
    for (const { panel } of Object.values(LABEL_PANEL)) expect(names).toContain(panel);
  });
});

describe('label checks', () => {
  it('accepts a label that fits, and ignores one that is switched off', () => {
    expect(labelProblem(withLabel('TEA'))).toBeNull();
    const off = withLabel('x'.repeat(500));
    off.label.enabled = false;
    expect(labelProblem(off)).toBeNull();
  });

  it('blames the right setting', () => {
    expect(labelIssue(withLabel('   '))?.field).toBe('text');
    expect(labelIssue(withLabel('TEA', 'front', 0))?.field).toBe('size');
    expect(labelIssue(withLabel('TEA', 'top'))?.field).toBe('face');
    expect(labelIssue(withLabel('A very long label that cannot fit', 'front', 8))?.field).toBe('text');
    expect(labelIssue(withLabel('A', 'front', 60))?.field).toBe('size');
  });

  it('measures the text conservatively', () => {
    expect(estimateTextWidth('TEA', 10)).toBeCloseTo(18, 9);
  });

  it('explains how far the text is too wide', () => {
    const msg = labelProblem(withLabel('x'.repeat(40), 'left', 8))!;
    expect(msg).toContain('too wide for the left face');
    expect(msg).toContain('90 mm');
  });
});

describe('label in the geometry', () => {
  it('puts the text on the chosen panel only', () => {
    const geo = buildBoxGeometry(withLabel('TEA', 'back', 6));
    const labelled = geo.panels.filter(p => p.engrave);
    expect(labelled.map(p => p.name)).toEqual(['Back Wall']);
    expect(labelled[0].engrave).toEqual({ text: 'TEA', fontSize: 6, outward: -1 });
  });

  it('puts nothing anywhere when the label is off or empty', () => {
    const off = withLabel();
    off.label.enabled = false;
    expect(buildBoxGeometry(off).panels.some(p => p.engrave)).toBe(false);
    expect(buildBoxGeometry(withLabel('  ')).panels.some(p => p.engrave)).toBe(false);
  });

  it('can label the lid', () => {
    const params = withLabel('TOP', 'top');
    params.lid.enabled = true;
    const panel = buildBoxGeometry(params).panels.find(p => p.engrave)!;
    expect(panel.name).toBe('Lid Bottom');
    expect(panel.engrave?.outward).toBe(1);
  });
});

describe('label in the SVG', () => {
  it('adds a separate engrave group with the text', () => {
    const svg = buildSvg(withLabel('TEA'));
    expect(svg).toContain('<g id="engrave"');
    expect(svg).toMatch(/<text [^>]*font-size="8"[^>]*>TEA<\/text>/);
    expect(svg).toContain('dominant-baseline="central"');
  });

  it('has no engrave group without a label', () => {
    expect(buildSvg(defaultBoxParams())).not.toContain('id="engrave"');
  });

  it('escapes characters that would break the file', () => {
    const svg = buildSvg(withLabel('A&B <1> "x"'));
    expect(svg).toContain('A&amp;B &lt;1&gt; &quot;x&quot;');
    expect(svg).not.toContain('A&B');
  });

  it('removes control characters', () => {
    const svg = buildSvg(withLabel('A\u0001B'));
    expect(svg).toContain('>AB</text>');
  });

  // Placements are written by hand so the test does not depend on how the packer arranges things.
  function placeFront(rotated: boolean) {
    const params = withLabel('TEA', 'front');
    const geo = buildBoxGeometry(params);
    geo.panels.forEach(p => applyJointToPanel(p, params.joint));
    const panel = geo.panels.find(p => p.name === 'Front Wall')!;
    const config = { ...defaultSheetConfig(), size: 'custom' as const, width: 300, height: 300 };
    const placed = { panel, x: 40, y: 70, rotated, overflow: false };
    const svg = generateSVG({ config, placed: [placed], efficiency: 0, sheetsRequired: 1 }, params);
    const m = svg.match(/<text x="([\d.]+)" y="([\d.]+)"([^>]*)>TEA</)!;
    expect(m).not.toBeNull();
    return { panel, x: Number(m[1]), y: Number(m[2]), attrs: m[3] };
  }

  // The text is centred on the panel body (the part without the tabs), not on the bounding box.
  const bodyCentre = (panel: ReturnType<typeof placeFront>['panel']) => ({
    cx: panel.body!.x + panel.body!.width / 2,
    cy: panel.body!.y + panel.body!.height / 2,
  });

  it('centres the text on an unturned panel and does not turn it', () => {
    const { panel, x, y, attrs } = placeFront(false);
    const { cx, cy } = bodyCentre(panel);
    // Kerf compensation moves the whole path, and the text with it, by half the kerf.
    expect(x).toBeCloseTo(40 + cx + 0.05, 2);
    expect(y).toBeCloseTo(70 + cy + 0.05, 2);
    expect(attrs).not.toContain('transform');
  });

  it('centres the text on a turned panel and turns it with the panel', () => {
    const { panel, x, y, attrs } = placeFront(true);
    const { cx, cy } = bodyCentre(panel);
    // A quarter turn maps (x, y) to (height - y, x), the same as the outline.
    expect(x).toBeCloseTo(40 + (panel.panelHeight - cy) + 0.05, 2);
    expect(y).toBeCloseTo(70 + cx + 0.05, 2);
    expect(attrs).toContain('transform="rotate(90 ');
  });
});

describe('label in project files', () => {
  it('round-trips', () => {
    const params = withLabel('TEA', 'right', 7);
    const res = importProject(exportProject(params, defaultSheetConfig()));
    expect(res.success).toBe(true);
    expect(res.project?.params.label).toEqual(params.label);
  });

  it('rejects a label that cannot be used', () => {
    for (const params of [withLabel('   '), withLabel('TEA', 'top'), withLabel('x'.repeat(60), 'front')]) {
      const res = importProject(exportProject(params, defaultSheetConfig()));
      expect(res.success).toBe(false);
      expect(res.validation.errors.some(e => e.startsWith('params.label:'))).toBe(true);
    }
  });

  it('rejects an unknown face and a label that is too long to be sensible', () => {
    const file = JSON.parse(exportProject(withLabel(), defaultSheetConfig()));
    file.params.label.face = 'inside';
    expect(importProject(JSON.stringify(file)).validation.errors[0]).toContain('params.label.face must be one of');
    file.params.label.face = 'front';
    file.params.label.text = 'x'.repeat(201);
    expect(importProject(JSON.stringify(file)).validation.errors[0]).toContain('params.label.text is too long');
  });
});
