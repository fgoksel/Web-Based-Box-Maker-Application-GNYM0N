# Web-Based Box Maker — Usage Notes

## Build / run
From the project root (inner folder):

```bash
npm run dev
```

## Workflow
1. Set box dimensions and material thicknesses.
2. Choose joint style (finger/box/flat).
3. Optionally enable lid and/or dividers.
4. Click `Generate`.
   - This creates 3D geometry in the viewport.
5. Choose the sheet size and gap.
6. Click `Run Bin Packing`.
   - This creates the sheet layout preview.
7. Click:
   - `Export SVG` for laser cutting output
   - `Export JSON` to save the current project settings
8. Optional:
   - `Separate by Thickness` groups panels by their panel thickness and shows them in separate sheet sections.

## Thickness grouped view
When grouped mode is enabled:
- The sheet preview is split into multiple stacked sections (one per thickness).
- A dropdown allows selecting:
  - `All thicknesses`
  - or a single thickness group to inspect only that portion.

## What screenshots to include in the thesis
Recommended final screenshots:
- 3D view before packing (after `Generate`)
- Sheet layout normal mode (single packing)
- Sheet layout grouped-by-thickness mode with dropdown selection
- Export SVG output showing overflow comment absent/present
- Validation error state (invalid inputs)

Replace the placeholders with your actual images.

