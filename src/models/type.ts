/**
 * Web Based BoxMaker— Core TypeScript Interfaces & Models
 * Phase 1: Architecture Design
 * Author: Ferhat Göksel
 * Date: 2026-03-01
 */

// ─────────────────────────────────────────────
// Primitive geometry types
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// Material configuration
// ─────────────────────────────────────────────

export interface MaterialConfig {
  /** Thickness of the frame/wall panels (mm) */
  frameThickness: number;
  /** Thickness of the base/bottom panel (mm) */
  baseThickness: number;
  /** Thickness of internal divider panels (mm) */
  dividerThickness: number;
  /** Laser kerf width — half applied per cut edge (mm) */
  kerf: number;
}

// ─────────────────────────────────────────────
// Finger joint configuration
// ─────────────────────────────────────────────

export type TabStyle = 'finger' | 'box' | 'dovetail' | 'none';

export interface JointConfig {
  style: TabStyle;
  /** Minimum number of tabs per edge */
  minTabCount: number;
  /** Override tab width (0 = auto-compute from edge length) */
  tabWidthOverride: number;
}

// ─────────────────────────────────────────────
// Divider configuration
// ─────────────────────────────────────────────

export interface DividerConfig {
  enabled: boolean;
  columns: number;
  rows: number;
  /** 0 = full box height */
  heightOverride: number;
}

// ─────────────────────────────────────────────
// Lid configuration
// ─────────────────────────────────────────────

export interface LidConfig {
  enabled: boolean;
  /** Height of the lid tray (mm) */
  height: number;
  /** Fit tolerance — lid expands by this amount to nest over tray (mm) */
  tolerance: number;
}

// ─────────────────────────────────────────────
// Inset / compartment auto-layout
// ─────────────────────────────────────────────

export interface CompartmentSpec {
  /** Internal width of the compartment (mm) */
  width: number;
  /** Internal depth of the compartment (mm) */
  depth: number;
  /** Required height of the compartment (mm) */
  height: number;
  /** Optional label e.g. "Catan tile", "Card deck" */
  label?: string;
}

export interface InsetConfig {
  enabled: boolean;
  compartments: CompartmentSpec[];
}

// ─────────────────────────────────────────────
// Label engraving
// ─────────────────────────────────────────────

export type LabelFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface LabelConfig {
  enabled: boolean;
  text: string;
  face: LabelFace;
  fontSize: number;
}

// ─────────────────────────────────────────────
// Master box parameters — single source of truth
// ─────────────────────────────────────────────

export interface BoxParams {
  /** External box width (mm) */
  width: number;
  /** External box depth (mm) */
  depth: number;
  /** External box height (mm) */
  height: number;
  material: MaterialConfig;
  joint: JointConfig;
  divider: DividerConfig;
  lid: LidConfig;
  inset: InsetConfig;
  label: LabelConfig;
}

// ─────────────────────────────────────────────
// Geometry: a flat 2D panel ready for SVG / 3D
// ─────────────────────────────────────────────

export type PanelGroup = 'tray' | 'lid' | 'divider' | 'inset';

export interface Panel {
  /** Assembly sequence number (1-based, shown in 3D and SVG) */
  sequenceNumber: number;
  /** Human-readable name e.g. "Front Wall", "Col Divider 2" */
  name: string;
  /** Flat panel width (mm) */
  panelWidth: number;
  /** Flat panel height (mm) */
  panelHeight: number;
  /** Material thickness (mm) — used for 3D extrusion */
  thickness: number;
  /** Which assembly group this panel belongs to */
  group: PanelGroup;
  /**
   * 2D outline including finger-joint notches.
   * Ordered list of points (closed polygon).
   * Units: mm. Origin at panel bottom-left.
   */
  outline: Point2D[];
  /** Colour hint for visualisation (hex number) */
  colorHex: number;
  /** Centre position in 3D space (mm) */
  position3D: Vec3;
  /** Euler rotation angles (radians) */
  rotation3D: Vec3;
}

// ─────────────────────────────────────────────
// Derived box geometry (computed from BoxParams)
// ─────────────────────────────────────────────

export interface BoxGeometry {
  params: BoxParams;
  panels: Panel[];
  /** Internal usable width (mm) */
  internalWidth: number;
  /** Internal usable depth (mm) */
  internalDepth: number;
  /** Internal usable height (mm) */
  internalHeight: number;
  /** Total flat material area needed (mm²) */
  totalMaterialArea: number;
}

// ─────────────────────────────────────────────
// Sheet layout / bin packing
// ─────────────────────────────────────────────

export type StandardSheetSize = 'A4' | 'A3' | 'A2' | 'A1' | 'custom';

export interface SheetConfig {
  size: StandardSheetSize;
  width: number;
  height: number;
  /** Minimum gap between placed panels (mm) */
  gap: number;
}

export interface PlacedPanel {
  panel: Panel;
  /** X position of bottom-left on sheet (mm) */
  x: number;
  /** Y position of bottom-left on sheet (mm) */
  y: number;
  /** True if panel was rotated 90° to fit */
  rotated: boolean;
  /** True if panel did not fit on the sheet */
  overflow: boolean;
}

export interface SheetLayout {
  config: SheetConfig;
  placed: PlacedPanel[];
  /** Ratio of used area to sheet area (0–1) */
  efficiency: number;
  /** Estimated number of sheets needed */
  sheetsRequired: number;
}

// ─────────────────────────────────────────────
// JSON persistence schema
// ─────────────────────────────────────────────

export interface BoxMakerProject {
  meta: {
    app: 'BoxMaker Pro';
    version: string;
    author: string;
    created: string;
    modified: string;
  };
  params: BoxParams;
  sheet: SheetConfig;
}

// ─────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}