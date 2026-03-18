export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Rect2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MaterialConfig {
  frameThickness: number;
  baseThickness: number;
  dividerThickness: number;
  kerf: number;
}

export type TabStyle = 'finger' | 'box' | 'dovetail' | 'none';

export interface JointConfig {
  style: TabStyle;
  minTabCount: number;
  tabWidthOverride: number;
}

export interface DividerConfig {
  enabled: boolean;
  columns: number;
  rows: number;
  heightOverride: number;
}

export interface LidConfig {
  enabled: boolean;
  height: number;
  tolerance: number;
}

export interface CompartmentSpec {
  width: number;
  depth: number;
  height: number;
  label?: string;
}

export interface InsetConfig {
  enabled: boolean;
  compartments: CompartmentSpec[];
}

export type LabelFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface LabelConfig {
  enabled: boolean;
  text: string;
  face: LabelFace;
  fontSize: number;
}

export interface BoxParams {
  width: number;
  depth: number;
  height: number;
  material: MaterialConfig;
  joint: JointConfig;
  divider: DividerConfig;
  lid: LidConfig;
  inset: InsetConfig;
  label: LabelConfig;
}

export type PanelGroup = 'tray' | 'lid' | 'divider' | 'inset';

export interface Panel {
  sequenceNumber: number;
  name: string;
  panelWidth: number;
  panelHeight: number;
  thickness: number;
  group: PanelGroup;
  outline: Point2D[];
  colorHex: number;
  position3D: Vec3;
  rotation3D: Vec3;
}

export interface BoxGeometry {
  params: BoxParams;
  panels: Panel[];
  internalWidth: number;
  internalDepth: number;
  internalHeight: number;
  totalMaterialArea: number;
}

export type StandardSheetSize = 'A4' | 'A3' | 'A2' | 'A1' | 'custom';

export interface SheetConfig {
  size: StandardSheetSize;
  width: number;
  height: number;
  gap: number;
}

export interface PlacedPanel {
  panel: Panel;
  x: number;
  y: number;
  rotated: boolean;
  overflow: boolean;
}

export interface SheetLayout {
  config: SheetConfig;
  placed: PlacedPanel[];
  efficiency: number;
  sheetsRequired: number;
}

export interface BoxMakerProject {
  meta: {
    app: 'Web-Based Box Maker';
    version: string;
    author: string;
    created: string;
    modified: string;
  };
  params: BoxParams;
  sheet: SheetConfig;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
