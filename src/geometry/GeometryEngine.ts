import type {
  BoxParams,
  BoxGeometry,
  Panel,
  Point2D,
  Vec3,
  PanelGroup,
  JointEdge,
  JointPlan,
  Notch,
} from '../models/types';
import { layoutCompartments } from './compartments';
import { LABEL_PANEL } from './label';

const PANEL_COLORS: Record<PanelGroup, number[]> = {
  tray:    [0xf0a500, 0xe09000, 0xd08000, 0xffb520, 0xffc840],
  lid:     [0x00c8ff, 0x00aadd, 0x0090cc, 0x20d0ff, 0x40e0ff],
  divider: [0x39ff6e, 0x20ee55, 0x10dd44, 0x50ff80, 0x60ff90],
};

function colorFor(group: PanelGroup, index: number): number {
  return PANEL_COLORS[group][index % PANEL_COLORS[group].length];
}

export function rectangleOutline(w: number, h: number): Point2D[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

export function computeInternalDimensions(params: BoxParams) {
  const { width: W, depth: D, height: H, material } = params;
  const { frameThickness: tF, baseThickness: tB } = material;
  return {
    iW: W - 2 * tF,
    iD: D - 2 * tF,
    iH: H - tB,
  };
}

const FLAT: JointEdge = { kind: 'flat', depth: 0, start: 0, length: 0, basis: 0 };

function jointEdge(kind: 'tab' | 'slot', depth: number, start: number, length: number, basis: number): JointEdge {
  return { kind, depth, start, length, basis };
}

function notchEdge(notches: Notch[]): JointEdge {
  return { kind: 'notches', depth: 0, start: 0, length: 0, basis: 0, notches };
}

/**
 * Joint plans for a tray (the box itself, or the lid built the same way).
 * Walls stand on the base plate: their bottom tabs drop into notches in the plate,
 * and the front/back walls push tabs through the ends of the left/right walls.
 */
function trayJointPlans(
  baseW: number,
  baseD: number,
  innerH: number,
  tF: number,
  tB: number,
) {
  const iW = baseW - 2 * tF;
  const floorBasis = Math.max(tF, tB);
  return {
    base: {
      bottom: jointEdge('slot', tF, tF, iW, floorBasis),
      top: jointEdge('slot', tF, tF, iW, floorBasis),
      left: jointEdge('slot', tF, 0, baseD, floorBasis),
      right: jointEdge('slot', tF, 0, baseD, floorBasis),
    } as JointPlan,
    frontBack: {
      bottom: jointEdge('tab', tB, 0, iW, floorBasis),
      right: jointEdge('tab', tF, 0, innerH, tF),
      top: FLAT,
      left: jointEdge('tab', tF, 0, innerH, tF),
    } as JointPlan,
    leftRight: {
      bottom: jointEdge('tab', tB, 0, baseD, floorBasis),
      right: jointEdge('slot', tF, 0, innerH, tF),
      top: FLAT,
      left: jointEdge('slot', tF, 0, innerH, tF),
    } as JointPlan,
  };
}

let _seqCounter = 0;

function makePanel(
  name: string,
  panelWidth: number,
  panelHeight: number,
  thickness: number,
  group: PanelGroup,
  position3D: Vec3,
  rotation3D: Vec3,
  colorIndex: number,
  jointPlan?: JointPlan,
): Panel {
  _seqCounter++;
  return {
    sequenceNumber: _seqCounter,
    name,
    panelWidth,
    panelHeight,
    thickness,
    group,
    outline: rectangleOutline(panelWidth, panelHeight),
    jointPlan,
    colorHex: colorFor(group, colorIndex),
    position3D,
    rotation3D,
  };
}

export function buildBoxGeometry(params: BoxParams): BoxGeometry {
  _seqCounter = 0;
  const panels: Panel[] = [];

  const { width: W, depth: D, height: H, material } = params;
  const { frameThickness: tF, baseThickness: tB, dividerThickness: tD } = material;
  const { iW, iD, iH } = computeInternalDimensions(params);

  const halfW = W / 2;
  const halfD = D / 2;
  // In 3D, we align everything to a "grounded" coordinate system:
  // - external bottom plane: y = 0 (sits on the grid)
  // - bottom panel (thickness tB) sits inside, centered at y = tB/2
  // - internal cavity spans height iH and is centered at y = tB + iH/2
  const bottomY = tB / 2;
  const cavityCenterY = tB + iH / 2;
  const plans = trayJointPlans(W, D, iH, tF, tB);

  panels.push(makePanel(
    'Bottom',
    W, D, tB, 'tray',
    { x: 0, y: bottomY, z: 0 },
    { x: -Math.PI / 2, y: 0, z: 0 },
    0,
    plans.base,
  ));

  panels.push(makePanel(
    'Front Wall',
    iW, iH, tF, 'tray',
    { x: 0, y: cavityCenterY, z: halfD - tF / 2 },
    { x: 0, y: 0, z: 0 },
    1,
    plans.frontBack,
  ));

  panels.push(makePanel(
    'Back Wall',
    iW, iH, tF, 'tray',
    { x: 0, y: cavityCenterY, z: -(halfD - tF / 2) },
    { x: 0, y: 0, z: 0 },
    2,
    plans.frontBack,
  ));

  panels.push(makePanel(
    'Left Wall',
    D, iH, tF, 'tray',
    { x: -(halfW - tF / 2), y: cavityCenterY, z: 0 },
    { x: 0, y: Math.PI / 2, z: 0 },
    3,
    plans.leftRight,
  ));

  panels.push(makePanel(
    'Right Wall',
    D, iH, tF, 'tray',
    { x: halfW - tF / 2, y: cavityCenterY, z: 0 },
    { x: 0, y: Math.PI / 2, z: 0 },
    4,
    plans.leftRight,
  ));

  if (params.lid.enabled) {
    const { height: lH, tolerance: lTol } = params.lid;
    const lW = W + lTol * 2;
    const lD = D + lTol * 2;
    // Tray top is at y = H. Place lid above with a small clearance.
    const lidBaseY = H + lH / 2 + 2;
    const lidPlans = trayJointPlans(lW, lD, lH - tB, tF, tB);
    // Lid walls stand on the lid base plate, which occupies the lowest tB of the lid.
    const lidWallY = lidBaseY + tB / 2;

    panels.push(makePanel('Lid Bottom', lW, lD, tB, 'lid',
      { x: 0, y: lidBaseY - lH / 2 + tB / 2, z: 0 }, { x: -Math.PI / 2, y: 0, z: 0 }, 0, lidPlans.base));

    panels.push(makePanel('Lid Front Wall', lW - 2 * tF, lH - tB, tF, 'lid',
      { x: 0, y: lidWallY, z: lD / 2 - tF / 2 }, { x: 0, y: 0, z: 0 }, 1, lidPlans.frontBack));

    panels.push(makePanel('Lid Back Wall', lW - 2 * tF, lH - tB, tF, 'lid',
      { x: 0, y: lidWallY, z: -(lD / 2 - tF / 2) }, { x: 0, y: 0, z: 0 }, 2, lidPlans.frontBack));

    panels.push(makePanel('Lid Left Wall', lD, lH - tB, tF, 'lid',
      { x: -(lW / 2 - tF / 2), y: lidWallY, z: 0 }, { x: 0, y: Math.PI / 2, z: 0 }, 3, lidPlans.leftRight));

    panels.push(makePanel('Lid Right Wall', lD, lH - tB, tF, 'lid',
      { x: lW / 2 - tF / 2, y: lidWallY, z: 0 }, { x: 0, y: Math.PI / 2, z: 0 }, 4, lidPlans.leftRight));
  }

  if (params.divider.enabled) {
    const { columns: cols, rows, heightOverride } = params.divider;
    const dH = heightOverride > 0 ? heightOverride : iH;
    // Dividers should sit on the tray bottom (internal floor), not float.
    // Internal floor plane: y = tB
    // Divider center y: floor + dH/2
    const dividerCenterY = tB + dH / 2;

    // Centre lines of every divider (world x for column dividers, world z for row dividers).
    const colLayout = layoutCompartments(iW, tD, cols, params.divider.columnWidths, 'width');
    const rowLayout = layoutCompartments(iD, tD, rows, params.divider.rowDepths, 'depth');
    if (colLayout.error) throw new Error(colLayout.error);
    if (rowLayout.error) throw new Error(rowLayout.error);
    const colX = colLayout.dividerCenters.map(c => -iW / 2 + c);
    const rowZ = rowLayout.dividerCenters.map(c => -iD / 2 + c);

    // Cross-halving: where a column and a row divider cross, the column divider is
    // slotted from the top and the row divider from the bottom, each half the height,
    // so the two slide together.
    const crossDepth = dH / 2;

    // Column divider panel: local x runs from the front (+z) to the back, so x = iD/2 - z.
    const colPlan: JointPlan = {
      bottom: FLAT,
      right: FLAT,
      left: FLAT,
      top: notchEdge(rowZ.map(z => ({ at: iD / 2 - z, width: tD, depth: crossDepth }))),
    };
    // Row divider panel: local x runs along world x, so x = world x + iW/2.
    const rowPlan: JointPlan = {
      top: FLAT,
      right: FLAT,
      left: FLAT,
      bottom: notchEdge(colX.map(x => ({ at: x + iW / 2, width: tD, depth: crossDepth }))),
    };

    colX.forEach((xPos, i) => {
      panels.push(makePanel(
        `Col Divider ${i + 1}`,
        iD, dH, tD, 'divider',
        { x: xPos, y: dividerCenterY, z: 0 },
        { x: 0, y: Math.PI / 2, z: 0 },
        i,
        colPlan,
      ));
    });

    rowZ.forEach((zPos, i) => {
      panels.push(makePanel(
        `Row Divider ${i + 1}`,
        iW, dH, tD, 'divider',
        { x: 0, y: dividerCenterY, z: zPos },
        { x: 0, y: 0, z: 0 },
        colX.length + i,
        rowPlan,
      ));
    });
  }

  const { label } = params;
  if (label.enabled && label.text.trim() !== '') {
    const target = LABEL_PANEL[label.face];
    const panel = panels.find(p => p.name === target.panel);
    if (panel) panel.engrave = { text: label.text.trim(), fontSize: label.fontSize, outward: target.outward };
  }

  const totalMaterialArea = panels.reduce(
    (sum, p) => sum + p.panelWidth * p.panelHeight,
    0,
  );

  return {
    params,
    panels,
    internalWidth:  iW,
    internalDepth:  iD,
    internalHeight: iH,
    totalMaterialArea,
  };
}