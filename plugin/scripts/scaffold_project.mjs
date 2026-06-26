#!/usr/bin/env node
/* ============================================================================
   scaffold_project.mjs — deterministically stamp out a Cadabra project.

   Copies the canonical runtime (index.html, runtime.js, theme.css, kernel.js)
   and the GENERIC STUB model.js into the target dir, writes a PROJECT.md (the
   living design document), and creates config/ and exports/. Don't spend agent
   tokens on boilerplate — this is pure plumbing.

   The result opens straight from the filesystem: double-click index.html
   (file://). No server. Then edit model.js and click the Reload button.

   Usage:
     node scaffold_project.mjs --dir <target> [--name "My Thing"]
                                [--fab printed|cut-sheet|milled|carpentry]
                                [--force]
   --force overwrites runtime files in an existing dir (model.js and PROJECT.md
            are never clobbered unless empty/missing — they hold agent + design
            work and persist across sessions).
   ============================================================================ */
import { mkdirSync, copyFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = resolve(join(__dirname, "..", "templates", "runtime"));

const RUNTIME_FILES = ["index.html", "runtime.js", "theme.css", "kernel.js"];

export function scaffold(spec) {
  const dir = resolve(spec.dir);
  const name = spec.name || "Untitled project";
  const fab = spec.fab || "printed";
  const force = !!spec.force;

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "config"), { recursive: true });
  mkdirSync(join(dir, "exports"), { recursive: true });

  const written = [];
  // stable shell files — always refreshable with --force
  for (const f of RUNTIME_FILES) {
    const dest = join(dir, f);
    if (!existsSync(dest) || force) { copyFileSync(join(RUNTIME_DIR, f), dest); written.push(f); }
  }

  // model.js — the generic stub. Never clobber a non-empty existing one (agent-authored).
  const modelDest = join(dir, "model.js");
  if (!(existsSync(modelDest) && statSync(modelDest).size > 0)) {
    copyFileSync(join(RUNTIME_DIR, "model.js"), modelDest);
    written.push("model.js");
  }

  // PROJECT.md — the living design document. Never clobber (it carries context across sessions).
  const projDest = join(dir, "PROJECT.md");
  if (!existsSync(projDest)) {
    writeFileSync(projDest, projectMd(name, fab));
    written.push("PROJECT.md");
  }

  // config/default.json — empty named-preset container
  const cfgDest = join(dir, "config", "default.json");
  if (!existsSync(cfgDest) || force) {
    writeFileSync(cfgDest, JSON.stringify(
      { _app: "cadabra", _v: 1, _note: "named preset — fill via Save config", state: {}, view: {} }, null, 2));
    written.push("config/default.json");
  }

  return { dir, written };
}

function projectMd(name, fab) {
  return `# ${name}

> **Cadabra living project document.** This is the durable source of truth for
> the design — it must survive across many agent sessions, because conversation
> context does not carry over. Update it whenever requirements or decisions
> evolve. Read it first at the start of every session.

## 1. Intent & use case
_What is this object? Who uses it, how, and where? What does success look like?_

## 2. Reference material
_Links, images, existing objects/standards this must match or take cues from.
Note where reference files live (e.g. exports/refs/), and key takeaways._

## 3. Fabrication
- **Default process:** ${fab}
- _Per-part process (3D print FDM/resin · laser/CNC sheet · milling · carpentry):_
- _Material(s) — density (g/cm³), price ($/kg or sheet), min wall / kerf / clearance:_

## 4. Dimensions & hard constraints
_Size envelope · print-bed / sheet / stock limits · fit to an existing object
(record researched dimensions WITH sources) · weight · budget · cavities/electronics._
- _e.g. controller PCB 56 × 36 × 18 mm — source: …_

## 5. Aesthetic
_Faceted vs smooth · rounded vs sharp · finish · palette._

## 6. Geometry / engine decisions (model.js)
- **Tier per part** — Cadabra has TWO first-class engines; pick per part:
  - **analytic** — flat-panel / sheet-cut parts (laser/CNC acrylic, ply): exact
    planar faces, instant, zero-dependency, clean DXF/SVG nesting. Plain JS vertex
    math. Also fine for simple prisms where instant + dependency-free matters.
  - **kernel** (replicad / OpenCASCADE WASM) — anything needing curved B-rep
    features: fillets, chamfers, shells/hollows, booleans, lofts/sweeps, STEP
    export, or a watertight guarantee. Runs in a Blob-URL Web Worker from CDN libs
    + CDN wasm (no server, works from file://); lazy-loads only when used. See the
    \`phone_case\` example for a fillet + shell + boolean part.
  - _Decision for this project:_ …
- **Parts & dependencies:** _…_
- **Key parameters and their ranges:** _…_

## 7. Open questions / TODO
- _…_

## 8. Decision log (newest first)
_Date — decision — why. Keep this so a future session understands the "why"._
- ${new Date().toISOString().slice(0, 10)} — Project scaffolded.

---

## Working with this project
- **Open it:** double-click \`index.html\` (opens via \`file://\` — no server needed).
- **Iterate:** edit \`model.js\`, then click the **Reload** button in the app.
- **Tweak live:** drag the sliders; no agent involvement needed for dimensional changes.
- **Export:** per-part STL / DXF / SVG buttons; configs save/load as JSON.
- **Agent screenshot:** \`node <plugin>/scripts/screenshot.mjs --html ./index.html --out shot.png\`
  (occasional — the agent usually reasons from the model.js code itself).
- _Optional fallback if a browser ever blocks file://:_ \`npx serve .\` then open the URL.
`;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = { force: false };
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i];
    if (k === "--dir") a.dir = process.argv[++i];
    else if (k === "--name") a.name = process.argv[++i];
    else if (k === "--fab") a.fab = process.argv[++i];
    else if (k === "--force") a.force = true;
  }
  if (!a.dir) { console.error("--dir <target> is required"); process.exit(1); }
  const r = scaffold(a);
  console.log("scaffolded " + r.dir);
  console.log("wrote: " + (r.written.join(", ") || "(nothing new)"));
  console.log("open: double-click " + join(r.dir, "index.html") + "  (file:// — no server)");
}
