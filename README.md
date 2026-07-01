# Cadabra

**CAD + abracadabra.** A Claude Code plugin that conjures a **bespoke, interactive
CAD interface per project**. You describe a physical thing you want to make; the agent
interviews you, captures the design into a living `PROJECT.md`, and writes the geometry
as code — giving you a live 3D viewer with design-specific parameter sliders to tweak
dimensions and fabrication-aware export options (STL, DXF, SVG, STEP). It generalises
the [interview → build → self-review → iterate](https://pub.towardsai.net/i-taught-claude-to-design-3d-printable-parts-heres-how-675f644af78a)
workflow into a repeatable skill with a **two-tier geometry engine** (instant analytic
math + an in-browser OpenCASCADE kernel) supporting 3D print, laser/CNC cut, milling,
and carpentry — no server or build step required.

---

## Install

```shell
# Add this repo as a marketplace, then install the plugin:
/plugin marketplace add https://github.com/Finndersen/cadabra
/plugin install cadabra@cadabra
```

The marketplace (`.claude-plugin/marketplace.json`) points at `./plugin`, whose
manifest is `plugin/.claude-plugin/plugin.json`.

## Invoke

Just describe what you want to make:

> "Design a parametric phone stand I can 3D print."
> "Help me laser-cut an acrylic enclosure for this PCB."
> "I want to model a faceted crystal sculpture on a printed base."

The **`setup-new-project`** skill triggers and runs the workflow:

1. **Gather** — interviews you for use case, reference material, fabrication
   process, materials, dimensions, constraints, and aesthetic.
2. **Research** — looks up real-world dimensions (phone bodies, mounts, lumber,
   material densities) and records them with sources.
3. **PROJECT.md** — writes/updates the living design document, the source of
   truth that survives across sessions.
4. **Scaffold + author** — stamps out the project and writes `model.js`.
5. **Self-review + iterate** — you drag sliders for dimensional tweaks; the agent
   edits code for structural changes; occasional screenshots resolve visual
   questions.

---

## What it generates

A scaffolded project is a small, self-contained directory:

```
<project>/
  index.html       # the app shell — open in browser (file://, no server)
  model.js         # ← AGENT-AUTHORED: the parametric design (params + geometry)
  PROJECT.md       # the living design document (durable across sessions)
  runtime/
    runtime.js     # the engine (project-owned): viewer, UI, build pipeline, exports
    theme.css      # design tokens (dark CAD palette)
    kernel.js      # OpenCASCADE WASM kernel tier (lazy — loads only when needed)
  config/          # named design presets (JSON)
  exports/         # generated STL / DXF / SVG / STEP + reference renders
```

You (and the agent) edit **`model.js`** in the common case — it declares each
part's parameters and builds its geometry. The viewer, controls, estimates, and
exports come from the schema automatically. The runtime is project-owned: each
scaffold gets its own copy, so a project can diverge as far as it needs.

**No server by default.** The runtime loads three.js from a CDN via one inline ES
module, then runs `model.js`/`runtime.js` as classic scripts attaching globals —
which is what lets it work straight from `file://`. Even the heavy kernel tier
(replicad / OpenCASCADE WASM) loads from the CDN and runs in a Blob-URL Web Worker,
so a server is genuinely not required. (If a locked-down browser ever blocks
`file://`, `npx serve .` is a fallback — nothing depends on it.)

---

## Skills

The plugin ships three skills:

| Skill | Trigger | What it does |
|---|---|---|
| **`setup-new-project`** | "Design a X", "Model a bracket", "Help me laser-cut..." | Full new-project workflow: interview → PROJECT.md → scaffold → author model.js → self-review → iterate |
| **`update-project`** | Runtime version mismatch detected in a project session | Upgrades a project's runtime files; handles same-major (copy files) and major-version (read migration notes, update model.js, then copy) paths |
| **`review-design`** | "Review the design", "Is this printable?", "Check for problems" | Reviews a Cadabra project for fabrication issues, constraint violations, and export readiness |

## Two geometry tiers (both first-class)

| Tier | Engine | Use for | Output |
|---|---|---|---|
| **analytic** | plain JS vertex math | flat-panel / sheet-cut parts (laser/CNC), simple prisms — instant, offline, exact planar faces | clean per-panel DXF/SVG nesting |
| **kernel** | replicad (OpenCASCADE WASM) | fillets, chamfers, shells, booleans, lofts/sweeps, STEP, watertight guarantees | meshed B-rep + STEP/STL |

**Rule:** flat-panel sheet-cut part → `analytic`; anything needing curved B-rep
features / STEP / watertight → `kernel`.

The kernel tier is **fully supported and runs from `file://` with no server**: it
loads replicad's ESM + OpenCASCADE WASM from the CDN and runs the solve in a
**Blob-URL Web Worker** (a classic worker that uses dynamic `import()` — a module
worker can't instantiate from a Blob over `file://`, which is the one gotcha this
plumbing handles for you). It **lazy-loads only when a kernel part is present**, so
analytic-only projects pay nothing. Verified end-to-end by `examples/phone_case/`
(`node scripts/verify.mjs examples/phone_case/index.html`).

---

## Develop / verify (for plugin maintainers)

```shell
cd plugin
npm install                       # playwright
npx playwright install chromium   # once

# verify the generic stub template renders over file:// (no server):
node scripts/scaffold_project.mjs --dir /tmp/stub --name "Stub" --fab printed
node scripts/verify.mjs /tmp/stub/index.html

# verify the analytic crystal example (scaffold a temp project, overlay model.js):
node scripts/scaffold_project.mjs --dir /tmp/crystal --name "Crystal" --fab cut-sheet
cp examples/crystal/model.js /tmp/crystal/model.js
node scripts/verify.mjs /tmp/crystal/index.html

# verify the kernel phone-case example (boots replicad WASM in a worker over file://):
node scripts/scaffold_project.mjs --dir /tmp/phone --name "Phone" --fab printed
cp examples/phone_case/model.js /tmp/phone/model.js
node scripts/verify.mjs /tmp/phone/index.html

# scaffold + capture a screenshot (gates still run; --out saves the PNG):
node scripts/scaffold_project.mjs --dir /tmp/demo --name "Demo" --fab printed
node scripts/verify.mjs /tmp/demo/index.html --out shot.png --view iso
```

`verify.mjs` takes several more flags than shown above — see
[`skills/setup-new-project/reference.md`](plugin/skills/setup-new-project/reference.md#cli-scripts-reference)
for the full list.

Every generated `index.html` must render without console errors, keep the
`window.__app` hook, and round-trip a config save/load — `verify.mjs` checks all
three over `file://`.

## License

MIT.
