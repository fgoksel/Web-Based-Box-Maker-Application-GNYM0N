import type { Panel, Point2D } from '../models/types';
import { cleanOutline, outlineBounds, signedArea } from '../geometry/outline';

/**
 * Parts that are the same piece of wood cut to the same shape (two walls of a box, two dividers) can be
 * recognised from their outlines alone. Names such as "Front Wall" say nothing about the shape, so the
 * signature is built from the geometry.
 *
 * Coordinates are compared in steps of SIGNATURE_UNIT mm: far finer than the 0.001 mm written to the SVG,
 * so two parts that differ in any way that reaches the cutter get different signatures, while
 * floating-point noise from the geometry code does not.
 */
export const SIGNATURE_UNIT = 0.0001;

/** Quarter turns the cutter sheet allows. Only 0 and 1 are used by the packers today. */
export type Turns = 0 | 1 | 2 | 3;

export interface SignatureOptions {
  /** Orientations on the sheet that count as the same part. Default: as drawn, and turned by 90 degrees. */
  turns?: Turns[];
  /** Also treat the mirror image as the same part (turning the board over). Never applies to engraved parts. */
  allowMirror?: boolean;
}

export interface PartSignature {
  /** Equal for equivalent parts, whichever way round they are drawn. */
  key: string;
  /** Quarter turns and mirroring that bring the part into the canonical orientation behind `key`. */
  turns: Turns;
  mirrored: boolean;
}

export interface PartGroup {
  key: string;
  /** Every physical part of this shape, in part-number order. The parts themselves are not merged. */
  members: Panel[];
}

const toUnits = (v: number): number => Math.round(v / SIGNATURE_UNIT);

function mirrorX(pts: Point2D[]): Point2D[] {
  return pts.map(p => ({ x: -p.x, y: p.y }));
}

function quarterTurn(pts: Point2D[]): Point2D[] {
  return pts.map(p => ({ x: -p.y, y: p.x }));
}

/**
 * The outline written in one fixed way: no collinear points, counter-clockwise, moved so its bounding
 * box starts at the origin, and beginning at its lowest-left vertex. The same shape gives the same
 * text whichever vertex it was drawn from, and whichever direction it was walked.
 */
export function canonicalContour(outline: Point2D[]): string {
  let pts = cleanOutline(outline);
  if (signedArea(pts) < 0) pts = [...pts].reverse();
  const b = outlineBounds(pts);
  const q = pts.map(p => ({ x: toUnits(p.x - b.minX), y: toUnits(p.y - b.minY) }));

  // A simple polygon never repeats a vertex, so the lowest-left one is a unique place to start.
  let start = 0;
  for (let i = 1; i < q.length; i++) {
    if (q[i].x < q[start].x || (q[i].x === q[start].x && q[i].y < q[start].y)) start = i;
  }
  return q.map((_, i) => q[(start + i) % q.length]).map(p => `${p.x},${p.y}`).join(';');
}

/** Everything that is cut or engraved into a part besides its outline. */
function surfaceKey(panel: Panel, outline: Point2D[]): string {
  if (!panel.engrave) return '';
  const b = outlineBounds(outline);
  const body = panel.body ?? { x: 0, y: 0, width: panel.panelWidth, height: panel.panelHeight };
  const { text, fontSize, outward } = panel.engrave;
  return `${JSON.stringify(text)}|${toUnits(fontSize)}|${outward}|${toUnits(body.x - b.minX)},${toUnits(body.y - b.minY)},${toUnits(body.width)},${toUnits(body.height)}`;
}

/**
 * Signature of a panel: its shape in the first orientation (in the allowed set) that gives the smallest
 * text, plus the material thickness and anything engraved on it. Two panels are interchangeable on the
 * sheet when their keys are equal.
 */
export function partSignature(panel: Panel, options: SignatureOptions = {}): PartSignature {
  const turnSet = options.turns ?? [0, 1];
  const mirrors = options.allowMirror && !panel.engrave ? [false, true] : [false];
  const thickness = toUnits(panel.thickness);

  let best: PartSignature | null = null;
  for (const mirrored of mirrors) {
    let pts = mirrored ? mirrorX(panel.outline) : panel.outline;
    for (let t = 0 as number; t < 4; t++) {
      if (turnSet.includes(t as Turns)) {
        const key = `${thickness}|${canonicalContour(pts)}|${surfaceKey(panel, pts)}`;
        if (!best || key < best.key) best = { key, turns: t as Turns, mirrored };
      }
      pts = quarterTurn(pts);
    }
  }
  if (!best) throw new Error('At least one orientation must be allowed.');
  return best;
}

export function equivalentParts(a: Panel, b: Panel, options: SignatureOptions = {}): boolean {
  return partSignature(a, options).key === partSignature(b, options).key;
}

/**
 * Sorts the panels into groups of equivalent parts. Every panel appears in exactly one group; the groups
 * are ordered by the lowest part number they hold and the members by part number, so the result does not
 * depend on the order the panels were passed in.
 */
export function groupParts(panels: Panel[], options: SignatureOptions = {}): PartGroup[] {
  const byKey = new Map<string, Panel[]>();
  for (const panel of panels) {
    const key = partSignature(panel, options).key;
    const members = byKey.get(key);
    if (members) members.push(panel);
    else byKey.set(key, [panel]);
  }
  const groups: PartGroup[] = [...byKey].map(([key, members]) => ({
    key,
    members: members.sort((a, b) => a.sequenceNumber - b.sequenceNumber),
  }));
  return groups.sort((a, b) => a.members[0].sequenceNumber - b.members[0].sequenceNumber);
}
