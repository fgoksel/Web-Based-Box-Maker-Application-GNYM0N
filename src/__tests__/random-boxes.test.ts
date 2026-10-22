import { describe, expect, it, vi } from 'vitest';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { applyJointToPanel } from '../geometry/JointEngine';
import { outlineBounds, signedArea } from '../geometry/outline';
import { packPanels } from '../svg/BinPacker';
import { generateSVG } from '../svg/SvgEngine';
import { defaultSheetConfig, exportProject, importProject } from '../utils/ProjectIO';
import type { BoxParams, Panel, Point2D } from '../models/types';
import { assemble, countMismatches } from './helpers/assembly';
import { mulberry32, randomValidParams } from './helpers/randomBoxes';

vi.setConfig({ testTimeout: 120_000 });

/**
 * Property tests: instead of a handful of hand-picked boxes, hundreds of random ones go through the
 * whole pipeline. The generator is seeded, so a failure names a box that can be reproduced.
 */

const BOXES = randomValidParams(300, 11);

function build(params: BoxParams): Panel[] {
  const geo = buildBoxGeometry(params);
  geo.panels.forEach(p => applyJointToPanel(p, params.joint));
  return geo.panels;
}

/** True when two segments share any point, endpoints included. */
function segmentsTouch(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const cross = (o: Point2D, p: Point2D, q: Point2D) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const onSegment = (p: Point2D, q: Point2D, r: Point2D) =>
    Math.min(p.x, r.x) - 1e-9 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-9 &&
    Math.min(p.y, r.y) - 1e-9 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-9;
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))) return true;
  if (Math.abs(d1) <= 1e-9 && onSegment(a, c, b)) return true;
  if (Math.abs(d2) <= 1e-9 && onSegment(a, d, b)) return true;
  if (Math.abs(d3) <= 1e-9 && onSegment(c, a, d)) return true;
  if (Math.abs(d4) <= 1e-9 && onSegment(c, b, d)) return true;
  return false;
}

function isSimplePolygon(pts: Point2D[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsTouch(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

describe('random boxes: geometry', () => {
  it('builds every box with sound panels', () => {
    BOXES.forEach((params, n) => {
      const panels = build(params);
      const where = `box ${n}`;
      expect(panels.length, where).toBeGreaterThanOrEqual(5);
      expect(panels.map(p => p.sequenceNumber), where).toEqual(panels.map((_, i) => i + 1));
      expect(new Set(panels.map(p => p.name)).size, where).toBe(panels.length);

      for (const p of panels) {
        const w = `${where} ${p.name}`;
        expect(p.thickness, w).toBeGreaterThan(0);
        for (const v of [p.position3D.x, p.position3D.y, p.position3D.z, p.rotation3D.x, p.rotation3D.y, p.rotation3D.z]) {
          expect(Number.isFinite(v), w).toBe(true);
        }

        expect(p.outline.length, w).toBeGreaterThanOrEqual(4);
        for (const pt of p.outline) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y), w).toBe(true);

        const b = outlineBounds(p.outline);
        expect(b.minX, w).toBeCloseTo(0, 9);
        expect(b.minY, w).toBeCloseTo(0, 9);
        expect(p.panelWidth, w).toBeCloseTo(b.maxX, 9);
        expect(p.panelHeight, w).toBeCloseTo(b.maxY, 9);

        // Tabs stick out of the body and slots cut into it (a single finger can slot a whole edge),
        // so the body is not always inside the outline's box, but its centre always is.
        const body = p.body!;
        expect(body.width, w).toBeGreaterThan(0);
        expect(body.height, w).toBeGreaterThan(0);
        expect(body.x + body.width / 2, w).toBeGreaterThan(0);
        expect(body.x + body.width / 2, w).toBeLessThan(p.panelWidth);
        expect(body.y + body.height / 2, w).toBeGreaterThan(0);
        expect(body.y + body.height / 2, w).toBeLessThan(p.panelHeight);

        expect(Math.abs(signedArea(p.outline)), w).toBeGreaterThan(0);
        // Every edge is straight along an axis, because joints and slots are all rectangular.
        p.outline.forEach((pt, i) => {
          const q = p.outline[(i + 1) % p.outline.length];
          expect(Math.abs(pt.x - q.x) < 1e-9 || Math.abs(pt.y - q.y) < 1e-9, `${w} edge ${i}`).toBe(true);
        });
        expect(isSimplePolygon(p.outline), `${w} crosses itself`).toBe(true);
      }
    });
  });

  it('puts an engraved label on exactly one panel when there is one, and none otherwise', () => {
    BOXES.forEach((params, n) => {
      const labelled = build(params).filter(p => p.engrave);
      const expected = params.label.enabled && params.label.text.trim() !== '' ? 1 : 0;
      expect(labelled, `box ${n}`).toHaveLength(expected);
    });
  });

  it('adds up the material area', () => {
    for (const params of BOXES.slice(0, 50)) {
      const geo = buildBoxGeometry(params);
      expect(geo.totalMaterialArea).toBeCloseTo(geo.panels.reduce((s, p) => s + p.panelWidth * p.panelHeight, 0), 6);
    }
  });
});

describe('random boxes: SVG', () => {
  /** Checks that every tag is closed in the right order. */
  function wellFormed(svg: string): boolean {
    const body = svg.replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    const stack: string[] = [];
    for (const m of body.matchAll(/<(\/?)([A-Za-z][\w-]*)[^>]*?(\/?)>/g)) {
      const [, closing, name, selfClosing] = m;
      if (selfClosing) continue;
      if (closing) {
        if (stack.pop() !== name) return false;
      } else {
        stack.push(name);
      }
    }
    return stack.length === 0;
  }

  it('writes a clean file for random boxes on any packing method', () => {
    const rand = mulberry32(5);
    BOXES.slice(0, 80).forEach((params, n) => {
      const algorithm = (['guillotine', 'maxrects', 'skyline'] as const)[Math.floor(rand() * 3)];
      const layout = packPanels(build(params), { ...defaultSheetConfig(), size: 'A1', algorithm });
      const svg = generateSVG(layout, params);
      const where = `box ${n} ${algorithm}`;

      expect(svg.startsWith('<?xml'), where).toBe(true);
      expect(svg.trimEnd().endsWith('</svg>'), where).toBe(true);
      expect(/NaN|undefined|Infinity|null/.test(svg), `${where}: bad number or text`).toBe(false);
      expect(wellFormed(svg), `${where}: tags`).toBe(true);

      const paths = [...svg.matchAll(/<path [^>]*\bd="([^"]*)"/g)].map(m => m[1]);
      expect(paths.length, where).toBeGreaterThan(0);
      for (const d of paths) {
        expect(/^[MHVLZ\d.,\s-]+$/.test(d), `${where}: path data`).toBe(true);
        expect(d.startsWith('M'), where).toBe(true);
      }

      // Text in the file is escaped, whatever the label said.
      for (const m of svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)) {
        expect(/&(?!amp;|lt;|gt;|quot;)/.test(m[1]), `${where}: text "${m[1]}"`).toBe(false);
      }
    });
  });
});

describe('random boxes: project files', () => {
  it('round-trips every box through JSON', () => {
    BOXES.forEach((params, n) => {
      const sheet = { ...defaultSheetConfig(), gap: (n % 5) + 1 };
      const res = importProject(exportProject(params, sheet));
      expect(res.validation.errors, `box ${n}`).toEqual([]);
      expect(res.project?.params, `box ${n}`).toEqual(params);
      expect(res.project?.sheet, `box ${n}`).toEqual(sheet);
      expect(res.validation.warnings, `box ${n}`).toEqual([]);
    });
  });

  /** Changes a random value somewhere in the file to something that is probably wrong. */
  function mutateValue(root: unknown, rand: () => number): unknown {
    const leaves: Array<{ parent: Record<string, unknown> | unknown[]; key: string | number }> = [];
    const walk = (node: unknown) => {
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          leaves.push({ parent: node as Record<string, unknown>, key: k });
          walk(v);
        }
      }
    };
    walk(root);
    const target = leaves[Math.floor(rand() * leaves.length)];
    const replacements: unknown[] = [null, 'text', '', -1, 0, 1e9, 0.5, true, false, [], {}, [1, 2], { a: 1 }];
    const pick = replacements[Math.floor(rand() * replacements.length)];
    if (rand() < 0.2) delete (target.parent as Record<string, unknown>)[target.key as string];
    else (target.parent as Record<string, unknown>)[target.key as string] = pick;
    return root;
  }

  it('never throws on mangled files, and anything it accepts can be built', () => {
    const rand = mulberry32(99);
    let accepted = 0;
    let rejected = 0;

    for (const params of BOXES.slice(0, 40)) {
      const text = exportProject(params, defaultSheetConfig());
      for (let round = 0; round < 40; round++) {
        let mutated: string;
        const kind = rand();
        if (kind < 0.15) mutated = text.slice(0, Math.floor(rand() * text.length));
        else if (kind < 0.3) {
          const at = Math.floor(rand() * text.length);
          mutated = text.slice(0, at) + String.fromCharCode(32 + Math.floor(rand() * 90)) + text.slice(at + 1);
        } else {
          mutated = JSON.stringify(mutateValue(JSON.parse(text), rand));
        }

        let res: ReturnType<typeof importProject> | undefined;
        expect(() => { res = importProject(mutated); }, mutated.slice(0, 80)).not.toThrow();

        if (res!.success) {
          accepted++;
          const accepted_params = res!.project!.params;
          // Whatever the validator lets through must be something the application can really build.
          expect(() => build(accepted_params), `accepted but cannot build: ${mutated.slice(0, 200)}`).not.toThrow();
          const panels = build(accepted_params);
          for (const p of panels) for (const pt of p.outline) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
          const sheet = res!.project!.sheet;
          expect(sheet.width > 0 && sheet.height > 0 && sheet.gap >= 0).toBe(true);
        } else {
          rejected++;
          expect(res!.validation.errors.length).toBeGreaterThan(0);
        }
      }
    }
    // The mutations really exercise both outcomes.
    expect(accepted).toBeGreaterThan(50);
    expect(rejected).toBeGreaterThan(300);
  });
});

describe('random boxes: assembly', () => {
  it('fills every sampled box exactly once: no overlap, no gap, no stray tab', () => {
    // A few boxes only, because the check samples the whole volume. The sample spacing is wider than in the
    // main assembly tests; the property holds at every sample point, so a wider spacing still catches errors.
    for (const [n, params] of BOXES.slice(0, 6).entries()) {
      const result = countMismatches(assemble(params), 2);
      expect(result, `box ${n}: ${JSON.stringify(params)}`).toEqual({ overlap: 0, gap: 0, stray: 0 });
    }
  });
});
