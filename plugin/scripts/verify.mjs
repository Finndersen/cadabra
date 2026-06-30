#!/usr/bin/env node
/* ============================================================================
   verify.mjs — Cadabra verification gates, loaded over file:// (NO server).
   Confirms the runtime works straight from disk:
     1. renders WITHOUT console errors
     2. window.__app hook present (with the required methods)
     3. confirms screenshot() returns a valid PNG (not saved to disk unless
        --screenshot-out is given — use screenshot.mjs to actually capture a view)
     4. prints each part's estimate rows (informational — no pass/fail)

   Usage:
     node verify.mjs <path/to/project/index.html>
     node verify.mjs --screenshot-out shot.png path/to/index.html   # also save the PNG
     node verify.mjs --json path/to/index.html   # dump full window.__app.report()
     node verify.mjs --verbose path/to/index.html
       Streams every console/pageerror message live as the page loads, instead
       of only surfacing console.error text after a gate times out. Use this
       when a gate fails with a bare "Timeout exceeded" — e.g. a kernel build
       error logs as a plain console.error inside the worker, which the
       ready/solve gates don't fail fast on; --verbose shows it immediately.
   ============================================================================ */
import { chromium } from "playwright";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
let targetArg = null, screenshotOutArg = null, jsonArg = false, verboseArg = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--screenshot-out") screenshotOutArg = args[++i];
  else if (args[i] === "--json") jsonArg = true;
  else if (args[i] === "--verbose") verboseArg = true;
  else if (!targetArg) targetArg = args[i];
}

if (!targetArg) {
  console.error("Usage: node verify.mjs <path/to/project/index.html> [--screenshot-out shot.png] [--json] [--verbose]");
  process.exit(2);
}

const htmlPath = resolve(targetArg);
const url = pathToFileURL(htmlPath).href;
const outPath = screenshotOutArg ? resolve(screenshotOutArg) : null;

const REQUIRED_HOOK_METHODS = ["setParams", "getState", "loadConfig", "setVisible", "setStyle", "render", "screenshot"];

function ok(label)          { console.log("  PASS  " + label); }
function bad(label, detail) { console.log("  FAIL  " + label + (detail ? " — " + detail : "")); failures++; }
let failures = 0;

const browser = await chromium.launch();
const consoleErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (m) => {
    if (verboseArg) console.log("  [console." + m.type() + "] " + m.text());
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => {
    if (verboseArg) console.log("  [pageerror] " + e.message);
    consoleErrors.push("pageerror: " + e.message);
  });

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
    if (outPath) { writeFileSync(outPath, Buffer.from(dataUrl.split(",")[1], "base64")); ok("screenshot valid → saved to " + outPath); }
    else ok("screenshot() returns a valid PNG");
  } else bad("screenshot");

  // gate 4 (informational): report data
  const report = await page.evaluate(() => window.__app.report());
  if (jsonArg) {
    console.log("\n" + JSON.stringify(report, null, 2));
  } else {
    console.log("");
    for (const id in report.parts) {
      const part = report.parts[id];
      console.log("  " + part.name + ":");
      for (const [label, val] of part.estimate.rows) console.log("    " + label + ": " + val);
    }
  }

} catch (e) {
  bad("harness", e.message);
} finally {
  await browser.close();
}

console.log("\n" + (failures === 0 ? "ALL GATES PASSED" : failures + " GATE(S) FAILED"));
process.exit(failures === 0 ? 0 : 1);
