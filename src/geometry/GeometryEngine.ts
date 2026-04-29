import type {
  BoxParams,
  BoxGeometry,
  Panel,
  Point2D,
  Vec3,
  PanelGroup,
} from '../models/types';

const PANEL_COLORS: Record<PanelGroup, number[]> = {
  tray:    [0xf0a500, 0xe09000, 0xd08000, 0xffb520, 0xffc840],
  lid:     [0x00c8ff, 0x00aadd, 0x0090cc, 0x20d0ff, 0x40e0ff],
  divider: [0x39ff6e, 0x20ee55, 0x10dd44, 0x50ff80, 0x60ff90],
  inset:   [0xff6b9d, 0xff4488, 0xff2277, 0xff8ab0, 0xffaac0],
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

  panels.push(makePanel(
    'Bottom',
    W, D, tB, 'tray',
    { x: 0, y: bottomY, z: 0 },
    { x: -Math.PI / 2, y: 0, z: 0 },
    0,
  ));

  panels.push(makePanel(
    'Front Wall',
    iW, iH, tF, 'tray',
    { x: 0, y: cavityCenterY, z: halfD - tF / 2 },
    { x: 0, y: 0, z: 0 },
    1,
  ));

  panels.push(makePanel(
    'Back Wall',
    iW, iH, tF, 'tray',
    { x: 0, y: cavityCenterY, z: -(halfD - tF / 2) },
    { x: 0, y: 0, z: 0 },
    2,
  ));

  panels.push(makePanel(
    'Left Wall',
    D, iH, tF, 'tray',
    { x: -(halfW - tF / 2), y: cavityCenterY, z: 0 },
    { x: 0, y: Math.PI / 2, z: 0 },
    3,
  ));

  panels.push(makePanel(
    'Right Wall',
    D, iH, tF, 'tray',
    { x: halfW - tF / 2, y: cavityCenterY, z: 0 },
    { x: 0, y: Math.PI / 2, z: 0 },
    4,
  ));

  if (params.lid.enabled) {
    const { height: lH, tolerance: lTol } = params.lid;
    const lW = W + lTol * 2;
    const lD = D + lTol * 2;
    // Tray top is at y = H. Place lid above with a small clearance.
    const lidBaseY = H + lH / 2 + 2;

    panels.push(makePanel('Lid Bottom', lW, lD, tB, 'lid',
      { x: 0, y: lidBaseY - lH / 2 + tB / 2, z: 0 }, { x: -Math.PI / 2, y: 0, z: 0 }, 0));

    panels.push(makePanel('Lid Front Wall', lW - 2 * tF, lH - tB, tF, 'lid',
      { x: 0, y: lidBaseY, z: lD / 2 - tF / 2 }, { x: 0, y: 0, z: 0 }, 1));

    panels.push(makePanel('Lid Back Wall', lW - 2 * tF, lH - tB, tF, 'lid',
      { x: 0, y: lidBaseY, z: -(lD / 2 - tF / 2) }, { x: 0, y: 0, z: 0 }, 2));

    panels.push(makePanel('Lid Left Wall', lD, lH - tB, tF, 'lid',
      { x: -(lW / 2 - tF / 2), y: lidBaseY, z: 0 }, { x: 0, y: Math.PI / 2, z: 0 }, 3));

    panels.push(makePanel('Lid Right Wall', lD, lH - tB, tF, 'lid',
      { x: lW / 2 - tF / 2, y: lidBaseY, z: 0 }, { x: 0, y: Math.PI / 2, z: 0 }, 4));
  }

  if (params.divider.enabled) {
    const { columns: cols, rows, heightOverride } = params.divider;
    const dH = heightOverride > 0 ? heightOverride : iH;
    // Dividers should sit on the tray bottom (internal floor), not float.
    // Internal floor plane: y = tB
    // Divider center y: floor + dH/2
    const dividerCenterY = tB + dH / 2;

    if (cols > 1) {
      const colSlotW = (iW - tD * (cols - 1)) / cols;
      for (let c = 1; c < cols; c++) {
        const xPos = -iW / 2 + c * (colSlotW + tD) - tD / 2;
        panels.push(makePanel(
          `Col Divider ${c}`,
          iD, dH, tD, 'divider',
          { x: xPos, y: dividerCenterY, z: 0 },
          { x: 0, y: Math.PI / 2, z: 0 },
          c - 1,
        ));
      }
    }

    if (rows > 1) {
      const rowSlotD = (iD - tD * (rows - 1)) / rows;
      for (let r = 1; r < rows; r++) {
        const zPos = -iD / 2 + r * (rowSlotD + tD) - tD / 2;
        panels.push(makePanel(
          `Row Divider ${r}`,
          iW, dH, tD, 'divider',
          { x: 0, y: dividerCenterY, z: zPos },
          { x: 0, y: 0, z: 0 },
          (rows - 1) + r - 1,
        ));
      }
    }
  }

  if (params.inset.enabled) {
    params.inset.compartments.forEach((comp, ci) => {
      panels.push(makePanel(
        `Inset ${ci + 1} H-div`,
        comp.width, comp.height, tD, 'inset',
        { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, ci * 2,
      ));
      panels.push(makePanel(
        `Inset ${ci + 1} V-div`,
        comp.depth, comp.height, tD, 'inset',
        { x: 0, y: 0, z: 0 }, { x: 0, y: Math.PI / 2, z: 0 }, ci * 2 + 1,
      ));
    });
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