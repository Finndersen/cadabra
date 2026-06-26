#!/usr/bin/env node
/* ============================================================================
   verify.mjs — Cadabra verification gates, loaded over file:// (NO server).
   Confirms the runtime works straight from disk:
     1. renders WITHOUT console errors
     2. window.__app hook present (with the required methods)
     3. a config save (getState) → load round-trips
     4. captures a screenshot

   Usage:
     node verify.mjs                                  # generic stub template
     node verify.mjs examples/crystal/model.js        # inject example into temp project
     node verify.mjs examples/phone_case/model.js
     node verify.mjs path/to/any/index.html           # verify a full project directly
     node verify.mjs --out shot.png [target]
   ============================================================================ */
import { chromium } from "playwright";
import { resolve, dirname, join, extname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { scaffold } from "./scaffold_project.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let targetArg = null, outArg = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") outArg = args[++i];
  else if (!targetArg) targetArg = args[i];
}

// When given a model.js, scaffold a temp project and overlay it.
let tempDir = null;
let htmlPath;
if (targetArg && extname(targetArg) === ".js") {
  tempDir = mkdtempSync(join(tmpdir(), "cadabra-verify-"));
  scaffold({ dir: tempDir, name: "verify-temp", fab: "printed" });
  const src = resolve(targetArg);
  // copyFileSync from node:fs
  const { copyFileSync } = await import("node:fs");
  copyFileSync(src, join(tempDir, "model.js"));
  htmlPath = join(tempDir, "index.html");
  console.log("Scaffolded temp project for: " + basename(src));
} else {
  htmlPath = resolve(targetArg || join(__dirname, "..", "templates", "runtime", "index.html"));
}

const url = pathToFileURL(htmlPath).href;
const outPath = resolve(outArg || join(__dirname, "..", "verify_shot.png"));

const REQUIRED_HOOK_METHODS = ["setParams", "getState", "loadConfig", "setVisible", "setStyle", "render", "screenshot"];

function ok(label)           { console.log("  PASS  " + label); }
function bad(label, detail)  { console.log("  FAIL  " + label + (detail ? " — " + detail : "")); failures++; }
let failures = 0;

const browser = await chromium.launch();
const consoleErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  console.log("Verifying " + htmlPath + "\n  (" + url + ")\n");
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.__app && window.__app.ready === true, { timeout: 30000 });
  // Wait for the FIRST build to land (kernel parts solve async; WASM can take several seconds).
  await page.waitForFunction(() => window.__app && window.__app.solveCount > 0 && !window.__app.solving, { timeout: 60000 });

  // gate 1: no console errors
  if (consoleErrors.length === 0) ok("renders without console errors");
  else bad("renders without console errors", consoleErrors.join(" | "));

  // gate 2: hook present + methods
  const missing = await page.evaluate((req) => {
    if (!window.__app) return ["__app missing entirely"];
    return req.filter((m) => typeof window.__app[m] !== "function");
  }, REQUIRED_HOOK_METHODS);
  if (missing.length === 0) ok("window.__app hook present with all required methods");
  else bad("window.__app hook", "missing: " + missing.join(", "));

  // gate 3: config round-trip
  const roundTrip = await page.evaluate(() => {
    const before = window.__app.getState();
    const firstPart = Object.keys(before.state)[0];
    const firstKey = Object.keys(before.state[firstPart])[0];
    const original = before.state[firstPart][firstKey];
    window.__app.setParams(firstPart, { [firstKey]: original + (typeof original === "number" ? 7 : 0) });
    const mutated = window.__app.getState().state[firstPart][firstKey];
    const cfg = { _app: "cadabra", _v: 1, state: before.state, view: before.view, printMat: before.printMat, explode: before.explode };
    window.__app.loadConfig(cfg);
    const restored = window.__app.getState().state[firstPart][firstKey];
    return { firstPart, firstKey, original, mutated, restored };
  });
  if (roundTrip.restored === roundTrip.original && roundTrip.mutated !== roundTrip.original)
    ok(`config save/load round-trips (${roundTrip.firstPart}.${roundTrip.firstKey}: ${roundTrip.original} → ${roundTrip.mutated} → ${roundTrip.restored})`);
  else bad("config save/load round-trip", JSON.stringify(roundTrip));

  // gate 4: screenshot
  const dataUrl = await page.evaluate(() => window.__app.screenshot());
  if (dataUrl && dataUrl.startsWith("data:image/png")) {
    writeFileSync(outPath, Buffer.from(dataUrl.split(",")[1], "base64"));
    ok("screenshot captured → " + outPath);
  } else bad("screenshot");

} catch (e) {
  bad("harness", e.message);
} finally {
  await browser.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}

console.log("\n" + (failures === 0 ? "ALL GATES PASSED" : failures + " GATE(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
