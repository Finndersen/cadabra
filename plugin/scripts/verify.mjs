#!/usr/bin/env node
/* ============================================================================
   verify.mjs — Cadabra verification + screenshot driver, loaded over file://
   (NO server — classic-script + globals + CDN libs, so it works straight off
   disk, same as opening index.html by hand).

   Always runs the pass/fail gates:
     1. renders without console errors
     2. window.__app hook present (with the required methods)
     3. the last build completed without error (window.__app.lastError)
     4. screenshot() returns a valid PNG
   ...then prints each part's metrics rows (informational — no pass/fail).

   Screenshot capture, param overrides, camera views, and config loading are
   additive — opt in with flags. The gates run the same way either way, so
   this one script covers both "does it still work" and "let me look at it."

   Usage:
     node verify.mjs <path/to/project/index.html>
     node verify.mjs <path/to/index.html> --out shot.png --view iso
     node verify.mjs <path/to/index.html> --set 'crystal:{"H":1500,"n":8}'
     node verify.mjs <path/to/index.html> --config saved.json --dump state.json
     node verify.mjs <path/to/index.html> --json      # full report() to stdout
     node verify.mjs <path/to/index.html> --verbose    # stream console live
     node verify.mjs <path/to/index.html> --no-fail --out shot.png
        # capture a screenshot of a known-broken state without a nonzero exit

   Flags:
     --out <file>        save the screenshot PNG here (omit = gate-only, no save)
     --set '<id>:{...}'  apply window.__app.setParams(id, obj) — repeatable,
                         one per part
     --view <preset>     iso | front | back | left | right | top | bottom
     --config <file>     load a saved config JSON before rendering
     --part <id>         hide all other parts; camera re-fits to this part only
     --width <n>          viewport width (default 1280)
     --height <n>         viewport height (default 900)
     --wait <ms>          extra settle ms after build before capturing (default 700)
     --dump <file>        write getState() + report() JSON to this file
     --json                print the full window.__app.report() to stdout
                           instead of the per-part metrics summary
     --verbose             stream every console/pageerror message live as the
                           page loads. Use this when a gate fails with a bare
                           timeout instead of a clear error — e.g. a kernel
                           build error (OCC fillet/boolean failure) logs as
                           console.error inside the worker and otherwise only
                           surfaces after the gate's timeout, not before it.
     --no-fail             always exit 0 — still runs every gate and prints
                           results, just don't fail the process. Use this to
                           screenshot a known-broken state to look at it.
   ============================================================================ */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { writeFileSync, readFileSync } from "node:fs";

function parseArgs(argv) {
  const a = {
    sets: [], width: 1280, height: 900, view: null, config: null, wait: 700,
    out: null, dump: null, part: null, json: false, verbose: false, noFail: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === "--out") a.out = next();
    else if (k === "--set") a.sets.push(next());
    else if (k === "--view") a.view = next();
    else if (k === "--config") a.config = next();
    else if (k === "--width") a.width = parseInt(next(), 10);
    else if (k === "--height") a.height = parseInt(next(), 10);
    else if (k === "--wait") a.wait = parseInt(next(), 10);
    else if (k === "--dump") a.dump = next();
    else if (k === "--part") a.part = next();
    else if (k === "--json") a.json = true;
    else if (k === "--verbose") a.verbose = true;
    else if (k === "--no-fail") a.noFail = true;
    else if (k === "--help" || k === "-h") a.help = true;
    else if (!a.html) a.html = k;
  }
  return a;
}

const HELP = `cadabra verify — gate a project index.html and optionally capture a PNG (file://, no server)

  node verify.mjs <path/to/project/index.html> [options]

  --out <file>         save the screenshot PNG here (omit = gate-only, no save)
  --set '<id>:{...}'   apply window.__app.setParams(id, obj) — repeatable
  --view <preset>      iso | front | back | left | right | top | bottom
  --config <file>      load a saved config JSON before rendering
  --part <id>          hide all other parts; camera re-fits to this part only
  --width <n>          viewport width (default 1280)
  --height <n>         viewport height (default 900)
  --wait <ms>          extra settle ms after build (default 700)
  --dump <file>        write getState() + report() JSON to this file
  --json               print the full report() to stdout
  --verbose            stream every console/pageerror message live
  --no-fail            always exit 0 (still runs & prints every gate)`;

const REQUIRED_HOOK_METHODS = ["setParams", "getState", "loadConfig", "setVisible", "setStyle", "render", "screenshot"];

function printGate(g) {
  console.log("  " + (g.pass ? "PASS" : "FAIL") + "  " + g.label + (!g.pass && g.detail ? " — " + g.detail : ""));
}

export async function run(opts) {
  const url = pathToFileURL(resolve(opts.html)).href;
  const browser = await chromium.launch();
  const consoleErrors = [];
  const gates = [];
  let state = null, report = null, outPath = null;
  try {
    const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height } });
    page.on("console", (m) => {
      if (opts.verbose) console.log("  [console." + m.type() + "] " + m.text());
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => {
      if (opts.verbose) console.log("  [pageerror] " + e.message);
      consoleErrors.push("pageerror: " + e.message);
    });

    console.log("Verifying " + opts.html + "\n  (" + url + ")\n");
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__app && window.__app.ready === true, { timeout: 30000 });
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

    if (opts.part) {
      const allParts = await page.evaluate(() => window.__app.parts());
      for (const p of allParts) {
        if (p.id !== opts.part) await page.evaluate((id) => window.__app.setVisible(id, false), p.id);
      }
    }
    await page.waitForTimeout(opts.wait);   // let the build + camera animation settle

    // gate 1: no console errors
    gates.push({ label: "renders without console errors", pass: consoleErrors.length === 0, detail: consoleErrors.join(" | ") });

    // gate 2: hook present + methods
    const missing = await page.evaluate((req) => {
      if (!window.__app) return ["__app missing entirely"];
      return req.filter((m) => typeof window.__app[m] !== "function");
    }, REQUIRED_HOOK_METHODS);
    gates.push({ label: "window.__app hook present with all required methods", pass: missing.length === 0, detail: "missing: " + missing.join(", ") });

    // gate 3: last build completed without error. A rebuild that throws (e.g. after
    // --set/--config above) leaves the scene showing whatever rendered on the last
    // successful build — screenshot() below would otherwise still return a "valid"
    // PNG that doesn't reflect the params just applied. lastError catches that.
    const lastError = await page.evaluate(() => window.__app && window.__app.lastError);
    gates.push({ label: "last build completed without error", pass: !lastError, detail: lastError });

    // gate 4: screenshot
    const dataUrl = await page.evaluate(() => window.__app.screenshot());
    const shotOk = !!(dataUrl && dataUrl.startsWith("data:image/png"));
    if (shotOk && opts.out) {
      outPath = resolve(opts.out);
      writeFileSync(outPath, Buffer.from(dataUrl.split(",")[1], "base64"));
    }
    gates.push({ label: shotOk && outPath ? "screenshot valid → saved to " + outPath : "screenshot() returns a valid PNG", pass: shotOk });

    report = await page.evaluate(() => window.__app.report());
    if (opts.dump) {
      state = await page.evaluate(() => window.__app.getState());
      writeFileSync(resolve(opts.dump), JSON.stringify({ state, report }, null, 2));
    }
  } catch (e) {
    gates.push({ label: "harness", pass: false, detail: e.message });
  } finally {
    await browser.close();
  }

  for (const g of gates) printGate(g);

  if (opts.json) {
    console.log("\n" + JSON.stringify(report, null, 2));
  } else if (report) {
    console.log("");
    for (const id in report.parts) {
      const part = report.parts[id];
      console.log("  " + part.name + ":");
      for (const [label, val] of part.estimate.rows) console.log("    " + label + ": " + val);
    }
  }

  const failures = gates.filter((g) => !g.pass).length;
  console.log("\n" + (failures === 0 ? "ALL GATES PASSED" : failures + " GATE(S) FAILED"));
  return { failures, outPath, consoleErrors, report, state };
}

// CLI entry
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv);
  if (a.help || !a.html) { console.log(HELP); process.exit(a.help ? 0 : 1); }
  run(a)
    .then((r) => {
      if (a.dump) console.log("wrote " + resolve(a.dump));
      process.exit((a.noFail || r.failures === 0) ? 0 : 1);
    })
    .catch((e) => { console.error("FAILED:", e.message); process.exit(a.noFail ? 0 : 1); });
}
