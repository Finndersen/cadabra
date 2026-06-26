#!/usr/bin/env node
/* ============================================================================
   verify.mjs — Cadabra verification gates against a project index.html, loaded
   over file:// (NO server). Confirms the runtime works straight from disk:
     1. renders WITHOUT console errors
     2. window.__app hook present (with the required methods)
     3. a config save (getState/exportConfig) → load round-trips
     4. captures a screenshot of the assembly

   Usage: node verify.mjs [path/to/index.html] [--out shot.png]
          (defaults to the generic stub template runtime)
   ============================================================================ */
import { chromium } from "playwright";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let htmlArg = null, outArg = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") outArg = args[++i];
  else if (!htmlArg) htmlArg = args[i];
}
const htmlPath = resolve(htmlArg || join(__dirname, "..", "templates", "runtime", "index.html"));
const url = pathToFileURL(htmlPath).href;
const outPath = resolve(outArg || join(__dirname, "..", "verify_shot.png"));

const REQUIRED_HOOK_METHODS = ["setParams", "getState", "loadConfig", "setVisible", "setStyle", "render", "screenshot"];

function ok(label) { console.log("  PASS  " + label); }
function bad(label, detail) { console.log("  FAIL  " + label + (detail ? " — " + detail : "")); failures++; }
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
  // Wait for the FIRST build to actually land (kernel parts solve asynchronously
  // in a Web Worker — booting replicad + WASM can take several seconds).
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

  // gate 3: config round-trip — snapshot state, mutate a param, reload original, compare
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
}

console.log("\n" + (failures === 0 ? "ALL GATES PASSED" : failures + " GATE(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
