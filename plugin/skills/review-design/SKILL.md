---
name: review-design
description: >-
  Review a Cadabra project's current design for fabrication issues, constraint
  violations, and best practices before export. Use when the user asks to review
  the design, check for problems, validate before printing or cutting, assess
  whether the model is ready to export, or asks "is this printable / cuttable".
---

# Cadabra — design review

Assess the current model against fabrication constraints and best practices.
The review uses the **currently configured parameter values** (loaded from
localStorage, so it reflects what the user last had set in the browser).

`${CLAUDE_PLUGIN_ROOT}` is the Cadabra plugin root.

## Step 1 — Gather context

Read `PROJECT.md` — note: fab type(s) per part, material(s), print bed / sheet
size limits, target dimensions, budget, any explicit constraints already recorded.

Read `model.js` — understand part geometry, how parameters drive dimensions,
`dependsOn` relationships, and what values are published in the `build()` return.

## Step 2 — Capture state and geometry data

The review script runs in a headless browser with no access to the user's
browser localStorage, so it cannot see their current slider values automatically.
**Ask the user to export their current config first:**

> "To review your current settings, please click **Save config…** in the app
> and tell me where the file was saved."

Then run with `--config <path>` so the headless browser loads those exact values:

> **Sandbox:** `verify.mjs` launches a headless browser via Playwright. If it
> fails with a permission or operation-not-permitted error, re-run it with
> the Claude sandbox disabled.

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs \
  ./index.html \
  --config <path/to/saved-config.json> \
  --out /tmp/cadabra_shot.png \
  --dump /tmp/cadabra_review.json \
  --view iso
```

Then `Read /tmp/cadabra_shot.png` to view the image. This also runs `verify.mjs`'s
usual pass/fail gates against the user's actual config, including the
`lastError` check — a config that no longer builds cleanly under the current
model.js is itself a finding worth reporting.

If the user has not configured anything (or wants to review defaults), omit
`--config` and the script will use the model's default parameter values.
`verify.mjs` also takes `--set`, `--part`, `--width`/`--height`, and
`--wait` — see
`${CLAUDE_PLUGIN_ROOT}/skills/setup-new-project/reference.md#cli-scripts-reference`
for the full flag list.

Read `review_data.json`. It contains:

- **`state.state`** — current param value per part (what the user has configured),
  including per-part material selection at `state.state[partId].material` if
  that part declares a `materials:[]` picker
- **`report.parts[id]`** — per part:
  - `bbox.size` — `[W, D, H]` in mm
  - `published` — values the model explicitly exports: `vol` (mm³), `panelThk`,
    `maxEdge`, `cavityW`, `cavityH`, `footprint`, `fits`, etc.
  - `estimate` — `{ rows, cost }`: `rows` are the part's metrics (computed
    quantities, not just cost); `cost` is the optional per-part fabrication
    cost, present only if the part defines `cost()`
  - `engine` (`direct` or `kernel`), `fab`
- **`report.assembly`** — overall height, footprint, BOM total, part count

Also view `review.png` to visually inspect the model.

## Step 3 — Apply the checklist

Work through every relevant section below. For each check: note Pass, Warn, or
Fail. Skip sections that don't apply to this project's fab type(s).

---

### A. 3D printing — FDM (fab: `printed`, material: pla / petg / abs)

Material densities for weight calculation:
- PLA: 1.24 g/cm³ · PETG: 1.27 g/cm³ · ABS: 1.04 g/cm³

| Check | How to assess |
|---|---|
| **Wall thickness ≥ 1.2 mm** (3 perimeters at 0.4 mm nozzle) | Read model.js: find shell/wall thickness params or geometry offsets. Check published `panelThk` if present. |
| **No unsupported overhangs > 45°** | Read model.js geometry: identify faces or edges that extend horizontally. Flag chamfers/undercuts steeper than 45°. |
| **Bridge spans ≤ 50 mm** (without supports) | Look for horizontal spans between supports in model.js. |
| **Thin features ≥ 1.5 mm** (pins, clips, snap-fits) | Check any narrow protrusion geometry in model.js. |
| **Screw/bolt holes: nominal + 0.2 mm clearance** | Look for hole diameter params; verify they're not exact nominal. |
| **Part fits print bed** | Compare `bbox.size[0]` and `bbox.size[1]` against bed limits from PROJECT.md. |
| **Hollow parts have drain holes ≥ 2 mm** | Check if any enclosed volumes exist and whether drainage is modelled. |
| **Weight estimate reasonable** | `vol` (mm³) × density / 1000 = grams. Cross-check with the part's metrics/cost data. |

---

### B. 3D printing — resin (fab: `printed`, material: `resin`)

| Check | How to assess |
|---|---|
| **Wall thickness ≥ 0.5 mm** | Same as FDM but lower bound. |
| **Large flat faces (> ~30 × 30 mm) risk suction / delamination** | Identify large planar areas in model.js; suggest drain holes or ribs if present. |
| **Fine features may be fragile** | Flag any feature < 1 mm in a stress-bearing role. |
| **Part fits build volume** | Compare `bbox.size` against resin printer build volume from PROJECT.md. |

---

### C. Laser / CNC cut-sheet (fab: `cut-sheet`)

| Check | How to assess |
|---|---|
| **Slot widths > kerf** (laser ~0.2 mm, CNC = bit diameter) | Check slot/tab dimension params in model.js vs kerf note in PROJECT.md. |
| **Minimum feature width ≥ 2× material thickness** | Check narrow bridges or tabs. |
| **Inside corner radius ≥ ½ bit diameter** (CNC only) | Flag any inside corners; resin/laser can cut to a point, CNC cannot. |
| **Panel fits sheet size** | Compare `published.maxEdge` or `bbox.size` against sheet limits from PROJECT.md. |
| **Tab/slot clearance** | Check fit tolerance in model.js — typically 0.1–0.15 mm press-fit, 0.2 mm loose. |

---

### D. Assembly and inter-part fit

| Check | How to assess |
|---|---|
| **Mating clearance present** | For parts with `dependsOn`, check that cavity dims (`cavityW`, `cavityH`) are larger than the mating part's `bbox.size` by the appropriate clearance (FDM: 0.2–0.3 mm each side; resin: 0.05–0.1 mm). |
| **`fits` value is true** | If model publishes `fits`, verify it is `true` at current params. |
| **Stacking/placement Z values are non-overlapping** | Check `report.parts[id].placementZ` — parts should not intersect. |
| **Assembly height matches intent** | Compare `report.assembly.height` against target from PROJECT.md. |

---

### E. Parameters and export readiness

| Check | How to assess |
|---|---|
| **No params at their min/max that could produce degenerate geometry** | Read `state.state` and compare each value to the `params` entry in model.js. Flag values at or near limits. |
| **All parts have the correct `exports` array** | Read model.js — every part's `exports` should list the formats needed for its fab type (e.g. `['stl']` for printed, `['dxf','svg']` for cut-sheet, `['step']` for milled). |
| **Cost/BOM within budget** | Read `report.assembly.bom` and compare to budget in PROJECT.md. |

---

## Step 4 — Report findings

Structure the report as three groups:

**✓ Good** — checks that passed. Keep these brief.

**⚠ Warning** — potential issues that may not matter depending on context, or
things the agent cannot verify without running the part (e.g. exact overhang
angles). State what to watch for and under what conditions it becomes a problem.

**✗ Issue** — definite problems. For each: what it is, why it matters for
fabrication, and the concrete fix (param to change, geometry to add, etc.).

End with a one-line summary: "Ready to export" or "X issue(s) to resolve before export."
