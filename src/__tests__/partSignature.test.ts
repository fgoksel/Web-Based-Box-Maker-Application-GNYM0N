import { describe, expect, it, vi } from 'vitest';
import { defaultBoxParams } from '../utils/ProjectIO';
import { buildBoxGeometry } from '../geometry/GeometryEngine';
import { applyJointToPanel } from '../geometry/JointEngine';
import { canonicalContour, equivalentParts, groupParts, partSignature } from '../svg/partSignature';
import { randomValidParams } from './helpers/randomBoxes';
import type { BoxParams, Panel, Point2D } from '../models/types';

vi.setConfig({ testTimeout: 120_000 });

/** An L-shaped part: not the same turned or mirrored, so it tells the orientations apart. */
const L: Point2D[] = [
  { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 30 }, { x: 0, y: 30 },
];

function panel(outline: Point2D[], extra: Partial<Panel> = {}): Panel {
  const xs = outline.map(p => p.x);
  const ys = outline.map(p => p.y);
  return {
    sequenceNumber: 1,
    name: 'Part',
    panelWidth: Math.max(...xs) - Math.min(...xs),
    panelHeight: Math.max(...ys) - Math.min(...ys),
    thickness: 3,
    group: 'tray',
    outline,
    colorHex: 0,
    position3D: { x: 0, y: 0, z: 0 },
    rotation3D: { x: 0, y: 0, z: 0 },
    ...extra,
  };
}

function build(params: BoxParams): Panel[] {
  const geo = buildBoxGeometry(params);
  geo.panels.forEach(p => applyJointToPanel(p, params.joint));
  return geo.panels;
}

const names = (panels: Panel[]) => panels.map(p => p.name);

describe('canonicalContour', () => {
  it('is the same whichever vertex the outline starts from', () => {
    const base = canonicalContour(L);
    for (let k = 1; k < L.length; k++) {
      expect(canonicalContour([...L.slice(k), ...L.slice(0, k)])).toBe(base);
    }
  });

  it('is the same when the outline is walked the other way round', () => {
    expect(canonicalContour([...L].reverse())).toBe(canonicalContour(L));
  });

  it('does not depend on where the part lies', () => {
    expect(canonicalContour(L.map(p => ({ x: p.x + 123.4, y: p.y - 7.7 })))).toBe(canonicalContour(L));
  });

  it('ignores points on a straight line', () => {
    const withExtra = [L[0], { x: 20, y: 0 }, ...L.slice(1)];
    expect(canonicalContour(withExtra)).toBe(canonicalContour(L));
  });

  it('ignores rounding noise but not a real difference of 0.01 mm', () => {
    const noisy = L.map(p => ({ x: p.x + 1e-9, y: p.y - 1e-9 }));
    expect(canonicalContour(noisy)).toBe(canonicalContour(L));
    const moved = L.map((p, i) => (i === 4 ? { x: p.x + 0.01, y: p.y } : p));
    expect(canonicalContour(moved)).not.toBe(canonicalContour(L));
  });
});

describe('partSignature', () => {
  it('matches the same shape drawn from a different vertex', () => {
    const a = panel(L);
    const b = panel([...L.slice(3), ...L.slice(0, 3)]);
    expect(equivalentParts(a, b)).toBe(true);
  });

  it('keeps similar but different shapes apart', () => {
    const a = panel(L);
    const longer = panel(L.map((p, i) => (i === 1 || i === 2 ? { x: p.x + 0.5, y: p.y } : p)));
    expect(equivalentParts(a, longer)).toBe(false);
  });

  it('separates parts of different thickness', () => {
    expect(equivalentParts(panel(L), panel(L, { thickness: 4 }))).toBe(false);
    expect(equivalentParts(panel(L), panel(L, { thickness: 3 + 1e-9 }))).toBe(true);
  });

  it('allows a quarter turn by default but not when only the drawn orientation is allowed', () => {
    const rect = (w: number, h: number) => panel([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]);
    expect(equivalentParts(rect(60, 30), rect(30, 60))).toBe(true);
    expect(equivalentParts(rect(60, 30), rect(30, 60), { turns: [0] })).toBe(false);

    const turned = panel(L.map(p => ({ x: -p.y, y: p.x })));
    expect(equivalentParts(panel(L), turned)).toBe(true);
    expect(equivalentParts(panel(L), turned, { turns: [0] })).toBe(false);
  });

  it('treats a half turn as different unless it is allowed', () => {
    const half = panel(L.map(p => ({ x: -p.x, y: -p.y })));
    expect(equivalentParts(panel(L), half)).toBe(false);
    expect(equivalentParts(panel(L), half, { turns: [0, 1, 2, 3] })).toBe(true);
  });

  it('treats a mirror image as different unless mirroring is allowed', () => {
    const mirror = panel(L.map(p => ({ x: -p.x, y: p.y })));
    expect(equivalentParts(panel(L), mirror)).toBe(false);
    expect(equivalentParts(panel(L), mirror, { allowMirror: true })).toBe(true);
  });

  it('never mirrors an engraved part', () => {
    const engrave = { text: 'A', fontSize: 6, outward: 1 as const };
    const a = panel(L, { engrave });
    const mirror = panel(L.map(p => ({ x: -p.x, y: p.y })), { engrave });
    expect(equivalentParts(a, mirror, { allowMirror: true })).toBe(false);
  });

  it('separates engraved parts from plain ones and from each other', () => {
    const e = (text: string, fontSize = 6, outward: 1 | -1 = 1) => panel(L, { engrave: { text, fontSize, outward } });
    expect(equivalentParts(panel(L), e('A'))).toBe(false);
    expect(equivalentParts(e('A'), e('B'))).toBe(false);
    expect(equivalentParts(e('A'), e('A', 7))).toBe(false);
    expect(equivalentParts(e('A'), e('A', 6, -1))).toBe(false);
    expect(equivalentParts(e('A'), e('A'))).toBe(true);
  });

  it('reports the orientation that brings a part to the canonical one', () => {
    const turned = panel(L.map(p => ({ x: -p.y, y: p.x })));
    const a = partSignature(panel(L));
    const b = partSignature(turned);
    expect(a.key).toBe(b.key);
    expect(a.turns === b.turns).toBe(false);
  });

  it('is repeatable', () => {
    expect(partSignature(panel(L))).toEqual(partSignature(panel(L)));
  });

  it('needs at least one allowed orientation', () => {
    expect(() => partSignature(panel(L), { turns: [] })).toThrow();
  });
});

describe('groupParts on real boxes', () => {
  it('pairs the opposite walls of the default box and keeps the bottom alone', () => {
    const groups = groupParts(build(defaultBoxParams()));
    expect(groups.map(g => names(g.members))).toEqual([
      ['Bottom'],
      ['Front Wall', 'Back Wall'],
      ['Left Wall', 'Right Wall'],
    ]);
  });

  it('also pairs the lid walls, and keeps them apart from the tray walls', () => {
    const params = defaultBoxParams();
    params.lid.enabled = true;
    const groups = groupParts(build(params)).map(g => names(g.members));
    expect(groups).toContainEqual(['Front Wall', 'Back Wall']);
    expect(groups).toContainEqual(['Lid Front Wall', 'Lid Back Wall']);
    expect(groups).toContainEqual(['Lid Left Wall', 'Lid Right Wall']);
  });

  it('groups equal dividers', () => {
    const params = defaultBoxParams();
    params.divider.enabled = true;
    params.divider.columns = 3;
    params.divider.rows = 3;
    const groups = groupParts(build(params)).map(g => names(g.members));
    expect(groups).toContainEqual(['Col Divider 1', 'Col Divider 2']);
    expect(groups).toContainEqual(['Row Divider 1', 'Row Divider 2']);
  });

  it('never merges parts: every panel is in exactly one group, with its own number and metadata', () => {
    const params = defaultBoxParams();
    params.lid.enabled = true;
    params.divider.enabled = true;
    const panels = build(params);
    const groups = groupParts(panels);
    const members = groups.flatMap(g => g.members);
    expect(members).toHaveLength(panels.length);
    expect(new Set(members)).toEqual(new Set(panels));
    expect(new Set(members.map(m => m.sequenceNumber)).size).toBe(panels.length);
  });

  it('does not depend on the order the panels are passed in', () => {
    const params = defaultBoxParams();
    params.divider.enabled = true;
    params.divider.columns = 3;
    params.divider.rows = 2;
    const panels = build(params);
    const forward = groupParts(panels).map(g => names(g.members));
    const backward = groupParts([...panels].reverse()).map(g => names(g.members));
    expect(backward).toEqual(forward);
  });

  it('separates a labelled panel from its identical neighbour', () => {
    const params = defaultBoxParams();
    params.label.enabled = true;
    params.label.text = 'Tools';
    params.label.face = 'front';
    const groups = groupParts(build(params)).map(g => names(g.members));
    expect(groups).toContainEqual(['Front Wall']);
    expect(groups).toContainEqual(['Back Wall']);
  });

  it('puts only parts of identical outline area and thickness together, on random boxes', () => {
    for (const params of randomValidParams(30, 11)) {
      const groups = groupParts(build(params));
      for (const g of groups) {
        const first = g.members[0];
        for (const m of g.members) {
          expect(m.thickness).toBe(first.thickness);
          expect(m.outline.length).toBe(first.outline.length);
          const dims = (p: Panel) => [p.panelWidth, p.panelHeight].sort((x, y) => x - y);
          expect(dims(m)[0]).toBeCloseTo(dims(first)[0], 6);
          expect(dims(m)[1]).toBeCloseTo(dims(first)[1], 6);
        }
      }
    }
  });
});
