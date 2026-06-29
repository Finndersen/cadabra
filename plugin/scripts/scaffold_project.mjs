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
import { mkdirSync, copyFileSync, writeFileSync, existsSync, statSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(join(__dirname, ".."));
const RUNTIME_DIR = join(PLUGIN_ROOT, "templates", "runtime");
const INDEX_TEMPLATE = join(PLUGIN_ROOT, "templates", "index.html");

// Engine files go into project/runtime/; index.html goes to project root.
const RUNTIME_FILES = ["runtime.js", "theme.css", "kernel.js"];

export function scaffold(spec) {
  const dir = resolve(spec.dir);
  const name = spec.name || "Untitled project";
  const fab = spec.fab || "printed";
  const force = !!spec.force;

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "runtime"), { recursive: true });
  mkdirSync(join(dir, "config"), { recursive: true });
  mkdirSync(join(dir, "exports"), { recursive: true });

  const written = [];
  // engine files → project/runtime/ (always refreshable with --force)
  for (const f of RUNTIME_FILES) {
    const dest = join(dir, "runtime", f);
    if (!existsSync(dest) || force) { copyFileSync(join(RUNTIME_DIR, f), dest); written.push("runtime/" + f); }
  }
  // index.html → project root
  const indexDest = join(dir, "index.html");
  if (!existsSync(indexDest) || force) { copyFileSync(INDEX_TEMPLATE, indexDest); written.push("index.html"); }

  // model.js — the generic stub. Never clobber a non-empty existing one (agent-authored).
  const modelDest = join(dir, "model.js");
  if (!(existsSync(modelDest) && statSync(modelDest).size > 0)) {
    copyFileSync(join(PLUGIN_ROOT, "templates", "model.js"), modelDest);
    written.push("model.js");
  }

  // PROJECT.md — the living design document. Never clobber (it carries context across sessions).
  const projDest = join(dir, "PROJECT.md");
  if (!existsSync(projDest)) {
    writeFileSync(projDest, projectMd(name, fab));
    written.push("PROJECT.md");
  }

  // README.md — user-facing: how to open and use the app. Links to PROJECT.md.
  // Never clobber — the user may have customised it.
  const readmeDest = join(dir, "README.md");
  if (!existsSync(readmeDest)) {
    writeFileSync(readmeDest, readmeMd(name));
    written.push("README.md");
  }

  // CLAUDE.md — session guide for agents working in this project directory.
  // Never clobber — the agent may have customised it.
  const claudeDest = join(dir, "CLAUDE.md");
  if (!existsSync(claudeDest)) {
    const runtimeVersion = extractRuntimeVersion();
    writeFileSync(claudeDest, claudeMd(name, runtimeVersion, PLUGIN_ROOT));
    written.push("CLAUDE.md");
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

function extractRuntimeVersion() {
  try {
    const src = readFileSync(join(RUNTIME_DIR, "runtime.js"), "utf8");
    const m = src.match(/window\.CADABRA\s*=\s*\{[^}]*version:\s*"([^"]+)"/);
    return m ? m[1] : "unknown";
  } catch { return "unknown"; }
}

function claudeMd(name, runtimeVersion, pluginRoot) {
  return `# ${name} — Cadabra project

This is a **Cadabra** parametric CAD project. The user opens \`index.html\` in a
browser (no server needed) and interacts with sliders; you interact with the
project by editing files and using the agent hook and scripts below.

- \`model.js\` — the parametric geometry. **The file you edit in the common case.**
- \`PROJECT.md\` — the living design document. Read it first every session.
- \`index.html\` — the app entry point (project-owned copy).
- \`runtime/\` — the Cadabra engine: \`runtime.js\`, \`kernel.js\`, \`theme.css\`
  (project-owned copies — see "Custom runtime changes" below).

## Every session: start here

1. Read \`PROJECT.md\` — design intent, constraints, decisions, open questions.
2. Read \`model.js\` — understand the current geometry and parameters.
3. Check the runtime version:
   \`\`\`
   node ${pluginRoot}/scripts/upgrade_runtime.mjs --dir . --check
   \`\`\`
   - **Exit 0:** runtime is current — proceed with your work.
   - **Exit 1:** a newer runtime is available. Read the changelog output printed
     by the script, summarise the changes to the user, and ask if they want to
     update. If yes, activate the **\`update-project\`** skill to apply it.

## Making changes

- **Geometry / parameters** — edit \`model.js\`, then tell the user to click
  **Reload** in the browser to apply.
- **Fabrication format** — update \`fab\`, \`exports\`, \`engine\` in \`model.js\`;
  note the decision in \`PROJECT.md\`.
- **Dimensional inspection** — use the agent hook in the browser console:
  \`window.__app.report()\` returns bbox, volume, cavity dims, and published values
  per part. \`window.__app.getState()\` returns current slider values.
- **Screenshots** — capture a render for visual review:
  \`\`\`
  node ${pluginRoot}/scripts/screenshot.mjs --html ./index.html --out shot.png [--view iso|front|top]
  \`\`\`
- **Verification** — confirm the app boots and the agent hook is intact:
  \`\`\`
  node ${pluginRoot}/scripts/verify.mjs ./index.html
  \`\`\`
- **Sandbox note:** \`screenshot.mjs\` and \`verify.mjs\` launch a headless browser
  via Playwright. If either fails with a permission or operation-not-permitted
  error, re-run it with the Claude sandbox disabled.

## Custom runtime changes

\`index.html\` and the files in \`runtime/\` are **project-owned copies** — you can
edit them directly if the user needs something the standard framework does not
support: a custom UI control, a new export format, a bespoke rendering mode, extra
sidebar content, etc. Treat them as ordinary code files. The only invariant: keep
\`window.__app\` (especially \`screenshot()\`) intact — it is the agent's eyes on
the live model. After any runtime edit, re-run \`verify.mjs\` to confirm.

<!-- cadabra-runtime-version: ${runtimeVersion} -->
`;
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
- _Export needs — file formats required (DXF per panel shape? SVG nesting? STL per segment? STEP?):_
- _Sheet / print-bed size constraints (largest panel that fits, bed dimensions):_

## 4. Dimensions & hard constraints
_Size envelope · print-bed / sheet / stock limits · fit to an existing object
(record researched dimensions WITH sources) · weight · budget · cavities/electronics._
- _e.g. controller PCB 56 × 36 × 18 mm — source: …_

## 5. Aesthetic
_Faceted vs smooth · rounded vs sharp · finish · palette._

## 6. Geometry / engine decisions (model.js)
- **Tier per part** — Cadabra has TWO first-class engines; pick per part:
  - **direct** — flat-panel / sheet-cut (laser/CNC acrylic, ply) and simple printed
    shapes (prisms, cylinders, boxes with recesses): exact planar faces, instant,
    zero-dependency, clean DXF/SVG nesting, STL via triangulation. Try this first
    for any printed part. (\`engine:'analytic'\` is a legacy alias.)
  - **kernel** (replicad / OpenCASCADE WASM) — curved B-rep features: fillets,
    chamfers, shells/hollows, booleans, lofts/sweeps, STEP export, watertight
    solids. Runs in a Blob-URL Web Worker from CDN (no server, works from
    file://); lazy-loads only when used. First-visit cost: 3–9s CDN load. See
    the \`phone_case\` example for a fillet + shell + boolean part.
  - _Decision for this project:_ …
- **Parts & dependencies:** _…_
- **Key parameters and their ranges:** _…_

## 7. Open questions / TODO
- _…_

## 8. Decision log (newest first)
_Date — decision — why. Keep this so a future session understands the "why"._
- ${new Date().toISOString().slice(0, 10)} — Project scaffolded.

---

_See [README.md](README.md) for how to open and use the app._
`;
}

function readmeMd(name) {
  return `# ${name}

A parametric CAD project built with [Cadabra](https://github.com/finndersen/cadabra).
Open the live 3D viewer by double-clicking **\`index.html\`** — no server needed.

## Use

- Drag the **sliders** in the sidebar to adjust dimensions in real time.
- After the agent edits \`model.js\`, click **Reload** in the app to apply changes.
- Switch to the **Export tab** to download STL / DXF / SVG / STEP files for fabrication.
- **Save config / Load config** to store and restore named design presets.
- _If a browser ever blocks \`file://\` access:_ run \`npx serve .\` and open the URL.

## Design specifications

See [PROJECT.md](PROJECT.md) for the full design intent, dimensions, fabrication
requirements, and decision log.
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
