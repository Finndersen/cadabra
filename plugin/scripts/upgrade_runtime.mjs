#!/usr/bin/env node
/* ============================================================================
   upgrade_runtime.mjs — update a Cadabra project's runtime files to the
   canonical version bundled with this plugin.

   Usage:
     node upgrade_runtime.mjs --dir <project-dir> [--check]

   --check  Report current vs canonical version and whether an upgrade is safe.
            Prints migration notes for major-version gaps. Does NOT write files.
            Exit 0 = up-to-date. Exit 1 = upgrade available. Exit 2 = error.

   (no flag) Perform the upgrade if safe (same major version). For major-version
             gaps: print the migration notes from RUNTIME_CHANGELOG.md and exit
             non-zero without touching any files — the agent must apply model.js
             migrations first, then re-run.

   Safe upgrades: patch and minor (same major) — copy the 4 runtime files
   (index.html, runtime.js, theme.css, kernel.js). Never touches model.js or
   PROJECT.md.

   Major upgrades: the agent reads the printed migration notes, applies any
   required model.js changes, then re-runs with --force-major to complete.
   ============================================================================ */
import { readFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(join(__dirname, ".."));
const RUNTIME_DIR = join(PLUGIN_ROOT, "templates", "runtime");
const INDEX_TEMPLATE = join(PLUGIN_ROOT, "templates", "index.html");
const CHANGELOG_PATH = join(PLUGIN_ROOT, "RUNTIME_CHANGELOG.md");
// Engine files live in project/runtime/; index.html is at project root.
const RUNTIME_FILES = ["runtime.js", "theme.css", "kernel.js"];

function extractVersion(content) {
  const m = content.match(/window\.CADABRA\s*=\s*\{[^}]*version:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function majorOf(v) { return parseInt(v.split(".")[0], 10); }
function minorOf(v) { return parseInt(v.split(".")[1], 10); }
function patchOf(v) { return parseInt(v.split(".")[2], 10); }

function compareVersions(a, b) {
  for (const fn of [majorOf, minorOf, patchOf]) {
    const d = fn(a) - fn(b); if (d !== 0) return d;
  }
  return 0;
}

function canonicalVersion() {
  const src = readFileSync(join(RUNTIME_DIR, "runtime.js"), "utf8");
  const v = extractVersion(src);
  if (!v) throw new Error("Could not extract version from plugin runtime.js");
  return v;
}

function projectVersion(dir) {
  const path = join(dir, "runtime", "runtime.js");
  if (!existsSync(path)) return null;
  return extractVersion(readFileSync(path, "utf8"));
}

// Extract changelog sections for versions strictly newer than `fromVersion`.
// Returns the raw markdown text of those sections.
function changelogSections(fromVersion) {
  if (!existsSync(CHANGELOG_PATH)) return null;
  const lines = readFileSync(CHANGELOG_PATH, "utf8").split("\n");
  const sections = [];
  let current = null, inBody = false;

  for (const line of lines) {
    const m = line.match(/^## (\d+\.\d+\.\d+)/);
    if (m) {
      if (current && inBody) sections.push(current);
      const v = m[1];
      inBody = compareVersions(v, fromVersion) > 0;
      current = inBody ? [line] : null;
    } else if (inBody && current) {
      current.push(line);
    }
  }
  if (current && inBody) sections.push(current);

  return sections.length ? sections.map(s => s.join("\n")).join("\n\n") : null;
}

function copyRuntimeFiles(projectDir) {
  const copied = [];
  mkdirSync(join(projectDir, "runtime"), { recursive: true });
  for (const f of RUNTIME_FILES) {
    copyFileSync(join(RUNTIME_DIR, f), join(projectDir, "runtime", f));
    copied.push("runtime/" + f);
  }
  copyFileSync(INDEX_TEMPLATE, join(projectDir, "index.html"));
  copied.push("index.html");
  return copied;
}

// --- CLI ---
const args = { check: false, forceMajor: false };
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === "--dir") args.dir = process.argv[++i];
  else if (k === "--check") args.check = true;
  else if (k === "--force-major") args.forceMajor = true;
}

if (!args.dir) {
  console.error("Usage: upgrade_runtime.mjs --dir <project-dir> [--check]");
  process.exit(2);
}

const projectDir = resolve(args.dir);
if (!existsSync(projectDir)) {
  console.error(`Project directory not found: ${projectDir}`);
  process.exit(2);
}

let canonical, project;
try { canonical = canonicalVersion(); }
catch (e) { console.error("Error reading canonical version: " + e.message); process.exit(2); }

project = projectVersion(projectDir);

console.log(`Plugin runtime : ${canonical}`);
console.log(`Project runtime: ${project ?? "(not found — will copy)"}`);

if (project && compareVersions(project, canonical) === 0) {
  console.log("Already up to date.");
  process.exit(0);
}

const sameMajor = project == null || majorOf(project) === majorOf(canonical);
const notes = project ? changelogSections(project) : null;

if (!sameMajor && !args.forceMajor) {
  console.log(`\nMAJOR version gap (${project} → ${canonical}). Auto-upgrade blocked.`);
  console.log("Apply the model.js migrations below, then re-run with --force-major.\n");
  if (notes) {
    console.log("─".repeat(72));
    console.log(notes);
    console.log("─".repeat(72));
  } else {
    console.log("(No changelog entries found for this range — check RUNTIME_CHANGELOG.md manually.)");
  }
  process.exit(1);
}

if (args.check) {
  if (sameMajor) {
    console.log(`\nSafe to upgrade (same major). Run without --check to apply.`);
  } else {
    console.log(`\nMajor upgrade (${project} → ${canonical}). See migration notes above.`);
  }
  if (notes) { console.log("\nChangelog for this upgrade:\n"); console.log(notes); }
  process.exit(project && compareVersions(project, canonical) < 0 ? 1 : 0);
}

// Apply the upgrade
const copied = copyRuntimeFiles(projectDir);
console.log(`\nUpgraded ${project ?? "?"} → ${canonical}`);
console.log("Copied: " + copied.join(", "));
if (notes) {
  console.log("\nChangelog for this upgrade:");
  console.log(notes);
}
console.log("\nDone. model.js and PROJECT.md were not touched.");
