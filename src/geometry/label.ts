import type { BoxParams, LabelFace } from '../models/types';

/** Which panel carries a label on each face, and which side of that panel is the outside (local z). */
export const LABEL_PANEL: Record<LabelFace, { panel: string; outward: 1 | -1 }> = {
  front: { panel: 'Front Wall', outward: 1 },
  back: { panel: 'Back Wall', outward: -1 },
  left: { panel: 'Left Wall', outward: -1 },
  right: { panel: 'Right Wall', outward: 1 },
  bottom: { panel: 'Bottom', outward: -1 },
  top: { panel: 'Lid Bottom', outward: 1 },
};

/** Size of the panel a label sits on. The text runs along `width`. Null when the face does not exist. */
export function labelFace(params: BoxParams, face: LabelFace): { width: number; height: number } | null {
  const { width: W, depth: D, height: H, material, lid } = params;
  const iW = W - 2 * material.frameThickness;
  const iH = H - material.baseThickness;
  switch (face) {
    case 'front':
    case 'back':
      return { width: iW, height: iH };
    case 'left':
    case 'right':
      return { width: D, height: iH };
    case 'bottom':
      return { width: W, height: D };
    case 'top':
      return lid.enabled ? { width: W + 2 * lid.tolerance, height: D + 2 * lid.tolerance } : null;
  }
}

/** Rough width of a line of text. Deliberately generous so the text surely fits. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.6;
}

export interface LabelIssue {
  /** Which setting to blame, so the interface can highlight it. */
  field: 'text' | 'size' | 'face';
  message: string;
}

/** Why the label cannot be used, or null when it is fine (or switched off). */
export function labelIssue(params: BoxParams): LabelIssue | null {
  const label = params.label;
  if (!label.enabled) return null;
  if (label.text.trim() === '') return { field: 'text', message: 'Label text is empty' };
  if (!(label.fontSize > 0)) return { field: 'size', message: 'Label size must be greater than 0' };

  const face = labelFace(params, label.face);
  if (!face) return { field: 'face', message: 'A label on the top needs the lid (switch the lid on)' };

  const width = estimateTextWidth(label.text, label.fontSize);
  if (width > face.width * 0.9) {
    return {
      field: 'text',
      message: `Label is too wide for the ${label.face} face (about ${width.toFixed(0)} mm of text on ${face.width.toFixed(0)} mm)`,
    };
  }
  if (label.fontSize > face.height * 0.9) {
    return { field: 'size', message: `Label text is too tall for the ${label.face} face (${face.height.toFixed(0)} mm high)` };
  }
  return null;
}

/** The same as `labelIssue`, as plain text. */
export function labelProblem(params: BoxParams): string | null {
  return labelIssue(params)?.message ?? null;
}
