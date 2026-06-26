#!/usr/bin/env node
/* ============================================================================
   screenshot.mjs — Cadabra on-demand screenshot driver.

   Loads a project's index.html over file:// (NO server — the runtime is
   classic-script + globals + CDN libs, so it works straight from the
   filesystem), optionally applies per-part params and a preset camera view,
   waits for the model to build, then calls window.__app.screenshot() and writes
   the PNG.

   Screenshots are OCCASIONAL in the Cadabra workflow — the agent usually
   understands the design from the model.js code itself. Use this only to resolve
   a specific visual question or when the user wants the agent to view a view.

   Usage:
     node screenshot.mjs --html <path/to/index.html> --out shot.png
        [--set '<partId>:{"H":1400}' ...]   apply window.__app.setParams
        [--view iso|front|back|left|right|top|bottom]
        [--config path.json]                 load a saved config first
        [--width 1280] [--height 900]
        [--wait 1200]                        extra settle ms after build
   Examples:
     node screenshot.mjs --html ../examples/crystal/index.html --out crystal.png
     node screenshot.mjs --html ./index.html --out tall.png \
        --set 'crystal:{"H":1500,"n":8}' --view front
   ============================================================================ */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";

function parseArgs(argv) {
  const a = { sets: [], width: 1280, height: 900, view: null, config: null, wait: 700, out: "shot.png" };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === "--html") a.html = next();
    else if (k === "--out") a.out = next();
    else if (k === "--set") a.sets.push(next());
    else if (k === "--view") a.view = next();
    else if (k === "--config") a.config = next();
    else if (k === "--width") a.width = parseInt(next(), 10);
    else if (k === "--height") a.height = parseInt(next(), 10);
    else if (k === "--wait") a.wait = parseInt(next(), 10);
    else if (k === "--help" || k === "-h") a.help = true;
  }
  return a;
}

const HELP = `cadabra screenshot — render a project index.html to PNG (file://, no server)
  --html <file>      path to index.html (required)
  --out <file>       output PNG (default shot.png)
  --set '<id>:{...}' setParams JSON for a part (repeatable)
  --view <preset>    iso|front|back|left|right|top|bottom
  --config <file>    load a saved config JSON before rendering
  --width/--height   viewport size (default 1280x900)
  --wait <ms>        extra settle time after build (default 700)`;

export async function capture(opts) {
  const url = pathToFileURL(resolve(opts.html)).href;
  const browser = await chromium.launch();
  const consoleErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

    await page.goto(url, { waitUntil: "load" });
    // The runtime installs its hook after the CDN three.js module loads (async).
    await page.waitForFunction(() => window.__app && window.__app.ready === true, { timeout: 30000 });
    // Wait for the first build to land (kernel parts solve async in a worker).
    await page.waitForFunction(() => window.__app && window.__app.solveCount > 0 && !window.__app.solving, { timeout: 60000 });

    if (opts.config) {
      const cfg = JSON.parse(readFileSync(resolve(opts.config), "utf8"));
      await page.evaluate((c) => window.__app.loadConfig(c), cfg);
    }
    for (const s of opts.sets) {
      const i = s.indexOf(":");
      const partId = s.slice(0, i);
      const obj = JSON.parse(s.slice(i + 1));
      await page.evaluate(([id, o]) => window.__app.setParams(id, o), [partId, obj]);
    }
    if (opts.view) await page.evaluate((v) => window.__app.setView && window.__app.setView(v), opts.view);

    // setParams/loadConfig trigger an async rebuild for kernel parts — let it settle.
    await page.waitForFunction(() => window.__app && !window.__app.solving, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(opts.wait);   // let the build + camera animation settle
    const dataUrl = await page.evaluate(() => window.__app.screenshot());
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const outPath = resolve(opts.out);
    writeFileSync(outPath, Buffer.from(b64, "base64"));
    return { outPath, consoleErrors, hookOk: true };
  } finally {
    await browser.close();
  }
}

// CLI entry
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv);
  if (a.help || !a.html) { console.log(HELP); process.exit(a.help ? 0 : 1); }
  capture(a)
    .then((r) => {
      console.log("wrote " + r.outPath);
      if (r.consoleErrors.length) {
        console.error("console errors:\n  " + r.consoleErrors.join("\n  "));
        process.exit(2);
      }
    })
    .catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
}
