# Crystal sculpture + base

> **Cadabra living project document.** This example exists to verify the generic
> runtime against a real, non-trivial multi-part assembly. It is also a worked
> example of how a PROJECT.md should read once a project is underway.

## 1. Intent & use case
A faceted, gem-like decorative sculpture (a "crystal") that sits in a pedestal
base on a shelf or desk. The crystal is the hero object; the base both displays
it and conceals a small recess (for wiring / a light, optional).

## 2. Reference material
- Cut-and-fold faceted lampshade / polyhedral crystal sculptures.
- Faceting comes in two families: a diamond lattice (offset girdle ring) and a
  triangular zig-zag girdle. Both are parameterised in `model.js`.

## 3. Fabrication
- **Crystal:** `cut-sheet` — laser-cut translucent acrylic panels, butt-jointed.
  - Material: cast acrylic / PMMA, ρ ≈ 1.18 g/cm³, ~$85 per m² per mm of thickness
    (incl. cutting). Default sheet 3 mm.
  - Panels are real 3 mm sheets extruded OUTWARD along each face normal (V-gaps at
    outer edges). The zero-thickness CORE drives DXF/SVG cut outlines + the base fit.
- **Base:** `printed` — FDM, PLA default (ρ 1.24, $22/kg). Splittable into print-bed
  segments. Hollow shell = crystal-hugging collar dropping into a flared skirt.

## 4. Dimensions & hard constraints
- Crystal total height 300–1800 mm (default 1000).
- Base socket clears the crystal's OUTER surface: clearance = `clear + panelThk`.
- Base collar seats the crystal at a recessed `seatZ`; interior cavity reported
  for a controller fit check (≥ 60 × 30 mm = "fits").
- Largest print segment reported against the bed.

## 5. Aesthetic
Translucent acrylic crystal (glassy, transmission material), matte PLA base.
Faceted/sharp, not rounded.

## 6. Geometry / engine decisions (model.js)
- **Both parts analytic** — flat acrylic panels need exact planar faces for clean
  per-panel DXF nesting; the base is prismatic shells (analytic volume via
  prismatoid integration). No kernel tier needed.
- **Parts:** \`crystal\` (independent) → \`base\` (dependsOn crystal; reads its
  \`bottom\`, \`section(h)\`, \`panelThk\`, and places the crystal at \`base.seatZ\`).
- **Key params:** crystal H / ratio / midW / botW / facet depth / faceting mode /
  sides / sheet thickness; base height / wall / collar height / ledge depth / flare
  / clearance / ledge / segments.

## 7. Open questions / TODO
- Engrave panel labels + match-marks on the cut files.
- Per-segment STL export for the base (split at seam lines for the bed).

## 8. Decision log (newest first)
- Ported verbatim from kernel_poc.html; converted model.js to a classic script
  (window.MODEL) so it runs over file:// with no server.

---

## Working with this project
- **Open it:** double-click `index.html` (opens via `file://` — no server needed).
- **Iterate:** edit `model.js`, then click the **Reload** button in the app.
- **Tweak live:** drag the sliders.
- **Export:** crystal → STL/DXF/SVG (DXF = one file per unique panel + cut list zip);
  base → STL.
