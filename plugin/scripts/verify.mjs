#!/usr/bin/env node
/* ============================================================================
   verify.mjs — Cadabra verification gates, loaded over file:// (NO server).
   Confirms the runtime works straight from disk:
     1. renders WITHOUT console errors
     2. window.__app hook present (with the required methods)
     3. captures a screenshot (saved next to the target index.html)

   Usage:
     node verify.mjs <path/to/project/index.html>
     node verify.mjs --out shot.png path/to/index.html
   ============================================================================ */
import { chromium } from "playwright";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
let targetArg = null, outArg = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") outArg = args[++i];
  else if (!targetArg) targetArg = args[i];
}

if (!targetArg) {
  console.error("Usage: node verify.mjs <path/to/project/index.html> [--out shot.png]");
  process.exit(2);
}

const htmlPath = resolve(targetArg);
const url = pathToFileURL(htmlPath).href;
const outPath = resolve(outArg || join(dirname(htmlPath), "verify_shot.png"));

const REQUIRED_HOOK_METHODS = ["setParams", "getState", "loadConfig", "setVisible", "setStyle", "render", "screenshot"];

function ok(label)          { console.log("  PASS  " + label); }
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

  // gate 3: screenshot
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
