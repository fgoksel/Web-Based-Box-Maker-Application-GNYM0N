import { describe, expect, it } from 'vitest';
import { defaultBoxParams, defaultSheetConfig } from '../utils/ProjectIO';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { packPanels } from '../svg/BinPacker';
import { generateSVG } from '../svg/SvgEngine';

describe('SvgEngine', () => {
  it('generates a valid svg document with at least one path', () => {
    const params = defaultBoxParams();
    const geo = buildBoxGeometry(params);
    const sheet = defaultSheetConfig();
    const layout = packPanels(geo.panels, sheet);
    const svg = generateSVG(layout, params);

    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg.includes('<svg')).toBe(true);
    expect(svg.includes('<path')).toBe(true);
  });

  it('includes an overflow comment when parts overflow', () => {
    const params = defaultBoxParams();
    const geo = buildBoxGeometry(params);
    const sheet = defaultSheetConfig();
    sheet.size = 'custom';
    sheet.width = 60;
    sheet.height = 60;
    sheet.gap = 1;

    const layout = packPanels(geo.panels, sheet);
    const svg = generateSVG(layout, params);
    expect(svg.includes('OVERFLOW')).toBe(true);
  });
});

