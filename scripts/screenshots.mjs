#!/usr/bin/env node
// Docs screenshot generator — reproduces site/src/assets/screenshots/*.png
// against the dev stack, so a UI refresh is one command instead of an ad-hoc
// Playwright session. Modeled on the sibling generators in edc-core/ctms-core.
//
// What it does, in order:
//   1. Brings up (or reuses) the compose stack from infra/compose.yaml.
//   2. Migrates and seeds the demo study (idempotent-ish: a reused stack keeps
//      its existing data; seeding a second time is tolerated and skipped).
//   3. Logs in one Playwright context per demo persona, resolves the demo
//      study and the specific sample/shipment/worksheet each shot needs from
//      the API, and captures each page at 1440x900, deviceScaleFactor 2.
//
// The *pages* show whatever is in the database, so for canonical screenshots
// start from a fresh stack:
//   podman compose -f infra/compose.yaml down -v
//
// Usage: node scripts/screenshots.mjs [--only name,name] [--out dir]
//        pnpm screenshots
//
// Requires Playwright's Chromium: `pnpm install` then
// `npx playwright install chromium`.

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The SPA and its /api proxy are the web dev server (vite forwards /api → API).
const WEB_URL = process.env.LIMS_WEB_URL ?? "http://localhost:5174";
const DEMO_PASSWORD = process.env.LIMS_DEMO_PASSWORD ?? "lims-demo-2026!";
const COMPOSE_TOOL = process.env.LIMS_COMPOSE_TOOL ?? "podman";
const VIEWPORT = { width: 1440, height: 900 };

const args = process.argv.slice(2);
function flagValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const only = flagValue("--only")
  ?.split(",")
  .map((s) => s.trim());
const outDir = path.resolve(root, flagValue("--out") ?? "site/src/assets/screenshots");

const log = (msg) => console.log(`[screenshots] ${msg}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(cmd, cmdArgs, opts = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...(opts.env ?? {}) },
    ...opts,
  });
  if (result.error) throw result.error;
  return result.status ?? 0;
}

async function webReachable() {
  try {
    const res = await fetch(`${WEB_URL}/`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureStack() {
  if (await webReachable()) {
    log(`dev stack already up at ${WEB_URL}`);
    return;
  }
  log(`dev stack not reachable at ${WEB_URL} — starting it (${COMPOSE_TOOL} compose)`);
  run(COMPOSE_TOOL, ["compose", "-f", "infra/compose.yaml", "up", "-d", "--build"]);
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    if (await webReachable()) return;
    await sleep(3000);
  }
  throw new Error(`stack did not become reachable at ${WEB_URL} within 10 minutes`);
}

function migrateAndSeed() {
  log("migrating + seeding demo study");
  run("pnpm", ["--filter", "@lims-core/db", "db:migrate"]);
  // seed-demo throws if the demo study already exists; on a reused stack that
  // is the state we want, so tolerate a non-zero exit and carry on.
  const status = run("pnpm", ["--filter", "@lims-core/api", "db:seed-demo"]);
  if (status !== 0)
    log("seed-demo returned non-zero (demo data likely already present) — continuing");
}

// JSON GET wrapper sharing a Playwright context's session cookie.
function api(request) {
  return async (apiPath) => {
    const res = await request.fetch(`${WEB_URL}/api${apiPath}`);
    const body = await res.text();
    if (!res.ok()) throw new Error(`GET ${apiPath} → ${res.status()}: ${body.slice(0, 200)}`);
    return body ? JSON.parse(body) : null;
  };
}

// JSON POST wrapper (same session cookie) for the small amount of state setup.
function apiPost(request) {
  return async (apiPath, data) => {
    const res = await request.fetch(`${WEB_URL}/api${apiPath}`, {
      method: "POST",
      data: data ?? {},
    });
    const body = await res.text();
    if (!res.ok()) throw new Error(`POST ${apiPath} → ${res.status()}: ${body.slice(0, 200)}`);
    return body ? JSON.parse(body) : null;
  };
}

// Ensure a sample carries a verified, not-yet-signed order, so the e-signature
// dialog (05-esign) has something to open. Returns that sample's id, or null.
// Idempotent: reuses an existing verified order before creating one, and the
// entered value is deliberately mid-range so the QC verdict stays a pass.
async function ensureSignableOrder(get, postTech, postManager, samples) {
  const ordersFor = async (s) => {
    try {
      return await get(`/samples/${s.id}/orders`);
    } catch {
      return [];
    }
  };
  const unsigned = (o) => o.signatures.length === 0;

  for (const s of samples) {
    const orders = await ordersFor(s);
    if (orders.some((o) => o.status === "verified" && unsigned(o))) return s.id;
  }
  for (const s of samples) {
    const orders = await ordersFor(s);
    const resulted = orders.find((o) => o.status === "resulted" && unsigned(o));
    if (resulted) {
      try {
        await postManager(`/orders/${resulted.id}/verify`);
        return s.id;
      } catch {
        // four-eyes may reject if the manager entered it; try the next sample.
      }
    }
    const ordered = orders.find((o) => o.status === "ordered" && !o.calculated);
    if (ordered) {
      try {
        await postTech(`/orders/${ordered.id}/results`, {
          value: "2.4",
          ...(ordered.serviceUnit ? { unit: ordered.serviceUnit } : {}),
        });
        await postManager(`/orders/${ordered.id}/verify`);
        return s.id;
      } catch {
        // fall through to the next candidate.
      }
    }
  }
  return null;
}

async function shoot(page, name, locator) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(300);
  const file = path.join(outDir, `${name}.png`);
  try {
    if (locator) {
      await locator.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: true });
    }
    log(`captured ${path.relative(root, file)}`);
  } catch (err) {
    // fullPage can exceed Chromium's texture limit on very tall pages; fall
    // back to the viewport rather than failing the whole run.
    log(`${name}: capture fell back to viewport (${String(err).slice(0, 80)})`);
    await page.screenshot({ path: file });
  }
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  await ensureStack();
  migrateAndSeed();

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "playwright is not installed — run `pnpm install` and `npx playwright install chromium`",
    );
  }
  const browser = await chromium.launch();
  const newContext = () =>
    browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, baseURL: WEB_URL });

  const login = async (username, password) => {
    const context = await newContext();
    const res = await context.request.post(`${WEB_URL}/api/auth/login`, {
      data: { username, password },
    });
    if (!res.ok()) {
      await context.close();
      throw new Error(`login as ${username} failed: ${res.status()}`);
    }
    return context;
  };

  try {
    const tech = await login("tchen", DEMO_PASSWORD); // technician
    const manager = await login("mgarcia", DEMO_PASSWORD); // lab manager (verify/sign, QC review)

    // Resolve the demo study and the specific entities each shot needs.
    const get = api(tech.request);
    const studies = await get("/studies");
    const study = studies[0];
    if (!study) throw new Error("no studies visible — seeding may have failed");
    log(`demo study: ${study.name ?? study.id}`);

    const samples = await get(`/studies/${study.id}/samples`);
    // Biobank shots want the volume-tracked whole-blood specimen.
    const wholeBlood = samples.find((s) => s.sampleType === "whole_blood") ?? samples[0];
    // The results and e-sign shots want a sample carrying a verified order; set
    // one up if the seed doesn't already have one. `in_testing` samples are the
    // ones with active analytical work, so try them first.
    const testing = samples.filter((s) => s.status === "in_testing");
    const signableId = await ensureSignableOrder(
      get,
      apiPost(tech.request),
      apiPost(manager.request),
      [...testing, ...samples],
    );
    const resultSample = samples.find((s) => s.id === signableId) ?? testing[0] ?? wholeBlood;
    if (!signableId)
      log("no verified/unsigned order found or creatable — 05-esign will be skipped");

    const shipments = await get(`/studies/${study.id}/shipments`);
    const shipment = shipments.find((s) => s.status === "received") ?? shipments[0];

    const worksheets = await get(`/studies/${study.id}/worksheets`);
    const worksheet = worksheets.find((w) => w.status === "completed") ?? worksheets[0];

    // name → { ctx (persona context), path, locator?, prep? }
    const captures = [
      { name: "01-login", ctx: null, path: "/login" },
      { name: "02-samples-list", ctx: tech, path: "/samples" },
      {
        name: "03-accession",
        ctx: tech,
        path: "/samples",
        prep: async (page) => {
          // Open the single-specimen accession form.
          const btn = page.getByRole("button", { name: "+ Accession sample" });
          await btn.waitFor({ state: "visible", timeout: 8000 });
          await btn.click();
          await page.getByText("Accession a sample").waitFor({ timeout: 3000 });
        },
      },
      resultSample && {
        name: "04-sample-detail",
        ctx: manager,
        path: `/samples/${resultSample.id}`,
      },
      wholeBlood && {
        name: "04b-sample-biobank",
        ctx: tech,
        path: `/samples/${wholeBlood.id}`,
      },
      resultSample && {
        name: "05-esign",
        ctx: manager,
        path: `/samples/${resultSample.id}`,
        prep: async (page) => {
          // "Sign result…" only shows for a verified, not-yet-signed order, so
          // canonical capture needs a fresh seed (see the header note).
          const btn = page.getByRole("button", { name: /sign result/i }).first();
          await btn.waitFor({ state: "visible", timeout: 8000 });
          await btn.click();
          await page.getByText(/Sign result —/).waitFor({ timeout: 3000 });
        },
      },
      { name: "06-audit-trail", ctx: manager, path: "/audit" },
      { name: "07-shipments", ctx: tech, path: "/shipments" },
      shipment && { name: "07b-shipment-detail", ctx: tech, path: `/shipments/${shipment.id}` },
      { name: "08-kits", ctx: tech, path: "/kits" },
      { name: "09-storage", ctx: tech, path: "/storage" },
      { name: "10-inventory", ctx: tech, path: "/inventory" },
      worksheet && { name: "11-worksheet-detail", ctx: tech, path: `/worksheets/${worksheet.id}` },
      // The QC board auto-selects the first control with measurements, so the
      // Levey-Jennings chart renders without a click.
      { name: "12-qc-review", ctx: manager, path: "/qc-review" },
      { name: "13-reports", ctx: manager, path: "/reports" },
    ].filter(Boolean);

    for (const cap of captures) {
      if (only && !only.includes(cap.name)) continue;
      const context = cap.ctx ?? (await newContext());
      const page = await context.newPage();
      await page.goto(cap.path);
      // Let the SPA hydrate before a prep tries to click — Playwright's click is
      // actionable-ready but doesn't wait for React to attach event handlers.
      await page.waitForLoadState("networkidle").catch(() => {});
      if (cap.prep) await cap.prep(page).catch((e) => log(`${cap.name} prep skipped: ${e}`));
      await shoot(page, cap.name, cap.locator);
      await page.close();
      if (!cap.ctx) await context.close();
    }
  } finally {
    await browser.close();
  }
  log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
