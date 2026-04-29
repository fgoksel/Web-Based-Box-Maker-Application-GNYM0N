# Web-Based Box Maker — Architecture

## Goal
Generate parametrized laser-cut box panels from user inputs (dimensions, material thickness, join style), preview the result in **3D**, pack the 2D panel outlines on a **laser sheet**, and export an **SVG** plus a **JSON project**.

## Modules (and responsibilities)

### UI / App Controller
- `index.html`: UI layout + element IDs.
- `src/main.ts`: event handling + validation + orchestration.
- `src/ui/style.css`: UI theming + focus/invalid styling.

### Geometry (Box creation)
- `src/geometry/GeometryEngine.ts`
  - Computes internal dimensions based on material thickness.
  - Creates a list of `Panel` objects: bottom, walls, optional lid, optional dividers, optional insets.
  - Provides **3D placement** (centered on a grounded coordinate system) and sets the panel rotations so pieces assemble correctly.

### Joints (laser outline modification)
- `src/geometry/JointEngine.ts`
  - Computes finger-tab layout (`computeTabSpec`).
  - Generates joint outlines (`buildFingerJointOutline`) and applies them to `Panel.outline` (`applyJointToPanel`).

### 3D Rendering
- `src/rendering/BoxRenderer.ts`
  - Converts each panel outline into a `THREE.Shape`.
  - Extrudes by panel thickness and positions/rotates using `panel.position3D` and `panel.rotation3D`.
  - Supports toggles: wireframe and explode.
  - Highlights a selected panel by sequence number.

### Sheet Layout (2D packing)
- `src/svg/BinPacker.ts`
  - Packs rectangles using a free-rectangle (guillotine split) approach.
  - Prevents overlaps by only placing within free rectangles.
  - Supports **grouped packing** by panel thickness (`packPanelsByThickness`) and a multi-section preview.

### SVG Export (laser cutting output)
- `src/svg/SvgEngine.ts`
  - Converts `SheetLayout.placed[]` panel outlines into SVG `<path>` elements.
  - Removes redundant points (`removeCollinear`).
  - Consolidates paths by color group (`consolidatePaths`).
  - Exports a single SVG for either:
    - normal packing (`generateSVG`)
    - grouped thickness packing (`generateGroupedSVG`)

### JSON Project I/O
- `src/utils/ProjectIO.ts`
  - Serializes the full configuration (box params + sheet params).
  - Imports with basic validation.
  - Downloads JSON as a file.

## Data flow

```mermaid
flowchart TD
  A[index.html UI inputs] --> B[src/main.ts Controller]
  B -->|build| C[GeometryEngine: buildBoxGeometry]
  C --> D[JointEngine: applyJointToPanel]
  D --> E[BoxRenderer: loadGeometry (3D preview)]
  D --> F[BinPacker: packPanels or packPanelsByThickness]
  F --> G[Sheet preview: renderSheetPreview / renderGroupedSheetPreview]
  F --> H[SVG export: SvgEngine generateSVG / generateGroupedSVG]
  B --> I[ProjectIO export/import JSON]
```

## Important design notes
- Panels are the central data type: every system (3D rendering, packing, SVG) consumes `Panel` instances.
- Panel outlines are stored as ordered 2D points (`Panel.outline`), and updates from `JointEngine` directly affect packing/SVG.
- The grouped-by-thickness mode creates multiple `SheetLayout` sections and exports/visualizes them together.

