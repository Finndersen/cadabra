/* ============================================================================
   driver.mjs — OPTIONAL warm Playwright driver (for an MCP server, if you build
   one). NOT part of the core Cadabra flow.

   Per the refinements: the default workflow needs NO server and only OCCASIONAL
   screenshots, so the simple CLI scripts (scripts/screenshot.mjs, verify.mjs)
   are the primary tools. This driver only earns its keep if you want a warm
   browser process for frequent renders (e.g. keeping a kernel WASM solve warm).

   Like the CLI scripts it loads the project's index.html over file:// — the
   runtime is classic-script + globals + CDN libs, so no static server is needed.
   One geometry source, three consumers: this driver, the CLI screenshot script,
   and the live viewer all load the SAME index.html / model.js.
   ============================================================================ */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";

export class ProjectDriver {
  constructor(projectDir, { width = 1280, height = 900 } = {}) {
    this.projectDir = resolve(projectDir);
    this.width = width; this.height = height;
    this.browser = null; this.page = null; this.consoleErrors = [];
  }

  async ensure() {
    if (this.page) return;
    const htmlPath = join(this.projectDir, "index.html");
    if (!existsSync(htmlPath)) throw new Error("no index.html in " + this.projectDir);
    this.browser = await chromium.launch();
    this.page = await this.browser.newPage({ viewport: { width: this.width, height: this.height } });
    this.page.on("console", (m) => { if (m.type() === "error") this.consoleErrors.push(m.text()); });
    this.page.on("pageerror", (e) => this.consoleErrors.push("pageerror: " + e.message));
    await this.page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await this.page.waitForFunction(() => window.__app && window.__app.ready === true, { timeout: 45000 });
  }

  async applyParams(sets) {
    for (const [partId, obj] of Object.entries(sets || {})) {
      await this.page.evaluate(([id, o]) => window.__app.setParams(id, o), [partId, obj]);
    }
  }

  async render({ params, view, wait = 500 } = {}) {
    await this.ensure();
    if (params) await this.applyParams(params);
    if (view) await this.page.evaluate((v) => window.__app.setView && window.__app.setView(v), view);
    await this.page.waitForTimeout(wait);
    const dataUrl = await this.page.evaluate(() => window.__app.screenshot());
    return Buffer.from(dataUrl.split(",")[1], "base64");
  }

  async renderToFile(opts, outPath) {
    const png = await this.render(opts);
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(resolve(outPath), png);
    return resolve(outPath);
  }

  /* Compute a structured geometry report from the live model — measurements you
     can't eyeball. Runs in-page against the analytic faces (and any published
     fields like vol/footprint/cavity/fits/seg the model exposes). */
  async geometryReport({ params } = {}) {
    await this.ensure();
    if (params) await this.applyParams(params);
    await this.page.waitForTimeout(200);
    return await this.page.evaluate(() => {
      const app = window.__app;
      const st = app.getState();
      // re-derive last build outputs by reading the rendered groups isn't exposed;
      // instead recompute via the model contract is internal — so we measure what the
      // runtime publishes through a small bridge if present, else fall back to bbox.
      const report = { parts: {}, assembly: {} };
      // bounding boxes from the three.js scene groups (world units = mm)
      const measure = window.__cadabraMeasure ? window.__cadabraMeasure() : null;
      if (measure) return measure;
      return { state: st, note: "model.js does not expose __cadabraMeasure; bbox unavailable", report };
    });
  }

  listConfigs() {
    const dir = join(this.projectDir, "config");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith(".json"));
  }
  loadConfigFile(name) {
    const p = join(this.projectDir, "config", name.endsWith(".json") ? name : name + ".json");
    return JSON.parse(readFileSync(p, "utf8"));
  }
  async saveConfig(name) {
    await this.ensure();
    const st = await this.page.evaluate(() => window.__app.getState());
    const cfg = { _app: "cadabra", _v: 1, state: st.state, view: { vis: st.view.vis, styles: st.view.styles }, printMat: st.printMat, explode: st.explode };
    const dir = join(this.projectDir, "config");
    mkdirSync(dir, { recursive: true });
    const p = join(dir, (name.endsWith(".json") ? name : name + ".json"));
    writeFileSync(p, JSON.stringify(cfg, null, 2));
    return p;
  }
  async loadConfig(cfgObj) {
    await this.ensure();
    await this.page.evaluate((c) => window.__app.loadConfig(c), cfgObj);
    return true;
  }

  async close() {
    if (this.browser) await this.browser.close();
    this.browser = this.page = null;
  }
}
