
# Project Schedule  
Web-Based Box Maker Application  
Author: Ferhat Göksel  

---

## Development Timeline

- 2026-03-01: Project Setup & Architecture Design  
- 2026-03-08: Geometry Engine Implementation  
- 2026-03-15: Finger Joint & Divider Algorithms  
- 2026-03-22: 3D Rendering Integration (Three.js)  
- 2026-03-29: SVG Generation Engine  
- 2026-04-05: SVG Optimization & Layout Algorithm  
- 2026-04-12: JSON Import/Export System  
- 2026-04-19: UI Refinement & Parameter Validation  
- 2026-04-26: Testing & Edge Case Handling  
- 2026-05-03: Performance Optimization  
- 2026-05-10: Final Integration & Stability Review  
- 2026-05-17: Documentation & Thesis Finalization  

---

## Phase Descriptions

### 1. Project Setup & Architecture Design
- Initialize Vite + TypeScript project
- Define folder structure (geometry, rendering, svg, ui, models, utils)
- Define core TypeScript interfaces
- Setup Git repository and branching strategy

### 2. Geometry Engine Implementation
- Parametric panel generation
- Dimension-based calculations
- Material thickness compensation
- Coordinate-based geometry structures

### 3. Finger Joint & Divider Algorithms
- Alternating finger joint logic
- Symmetry and fitting calculations
- Divider slot depth computation
- Internal compartment logic

### 4. 3D Rendering Integration
- Scene, camera, lighting setup
- Convert 2D geometry to 3D meshes
- Extrusion based on material thickness
- Real-time update functionality

### 5. SVG Generation Engine
- Convert geometry to SVG path commands
- Preserve millimeter precision
- Enable SVG file download

### 6. SVG Optimization & Layout Algorithm
- Panel arrangement on sheet
- Overlap prevention
- Remove redundant vector points
- Consolidate duplicated elements
- Reduce file size efficiently

### 7. JSON Import/Export System
- Serialize full configuration
- Restore system state from JSON
- Validate imported data

### 8. UI Refinement & Parameter Validation
- Improve usability
- Add input validation
- Prevent invalid dimensions

### 9. Testing & Edge Case Handling
- Test extreme dimensions
- Divider limits
- Sheet size boundaries
- Rendering stability

### 10. Performance Optimization
- Prevent memory leaks
- Optimize rendering updates
- Improve layout efficiency

### 11. Final Integration & Stability Review
- Code refactoring
- Remove debug logic
- Add documentation comments

### 12. Documentation & Thesis Finalization
- Architecture diagrams
- Algorithm explanations
- Final screenshots
- Repository cleanup
