#!/usr/bin/env node
// Launch audit: public and signed-in checks are read-only. Explicit Preview
// webhook mode mutates ONLY a dedicated Staging payment fixture. States must
// stay in .audit-results (ignored). Never save an estimate or submit a payment.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const moduleName = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(path.resolve(moduleName)).href : "playwright");
const axe = readFileSync(process.env.AXE_MODULE || require.resolve("axe-core/axe.min.js"), "utf8");
const app = process.env.APP_BASE_URL || "https://app.workcraftai.com";
const marketing = process.env.MARKETING_BASE_URL || "https://workcraftai.com";
for (const value of [app, marketing]) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Use HTTPS or localhost.");
}
const results = [];
const skipped = [];
const fixture = process.env.WORKCRAFT_E2E_CROSS_ACCOUNT_ESTIMATE_ID;
const owner = process.env.WORKCRAFT_E2E_ESTIMATE_OWNER || "pro";
if (!["free", "pro"].includes(owner)) throw new Error("Estimate owner must be free or pro.");
if (fixture && !/^[0-9a-f-]{36}$/i.test(fixture)) throw new Error("Invalid estimate fixture UUID.");
const guideSlugs = ["write-a-clear-contractor-estimate", "build-a-practical-price-book",
  "price-a-small-trade-job", "good-better-best-estimate-options",
  "from-approved-estimate-to-invoice", "follow-up-on-an-estimate",
  "job-photos-and-voice-notes", "clear-estimates-in-english-and-spanish"];
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
async function auditPage(context, url, width, locale, account = "public") {
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 900 });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    if (response?.status() !== 200) throw new Error(`HTTP ${response?.status()}`);
    const expectedPath = new URL(url).pathname.replace(/\/+$/, "");
    if (new URL(page.url()).pathname.replace(/\/+$/, "") !== expectedPath) {
      throw new Error("Unexpected redirect; requested page was not audited");
    }
    const actualLanguage = await page.locator("html").getAttribute("lang");
    if (!actualLanguage?.startsWith(locale)) {
      const toggle = page.getByRole("button", { name: locale === "es"
        ? /Switch to Spanish|Cambiar a español/ : /Switch to English|Cambiar a inglés/ }).filter({ visible: true });
      if (await toggle.count() === 1) await toggle.click();
    }
    await page.evaluate(axe);
    const a11y = await page.evaluate(() => window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    }));
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      smallTargets: [...document.querySelectorAll("a,button,input,select,textarea")]
        .filter((element) => {
          const r = element.getBoundingClientRect(); const s = getComputedStyle(element);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden"
            && r.top < innerHeight && r.bottom > 0 && (r.height < 48 || r.width < 48);
        }).map((element) => ({ tag: element.tagName, width: Math.round(element.getBoundingClientRect().width),
          height: Math.round(element.getBoundingClientRect().height) })),
    }));
    const entry = { account, path: new URL(url).pathname, host: new URL(url).host, width, locale,
      landedPath: new URL(page.url()).pathname, actualLanguage: await page.locator("html").getAttribute("lang"), ...layout,
      violations: a11y.violations.map(({ id, impact, nodes }) => ({ id, impact, count: nodes.length,
        checks: [...new Set(nodes.flatMap((node) => [...node.any, ...node.all, ...node.none].map((check) => check.id)))] })),
      incomplete: a11y.incomplete.map(({ id, nodes }) => ({ id, count: nodes.length })),
    };
    results.push(entry);
    console.log(`${entry.overflow || entry.violations.length || !entry.actualLanguage?.startsWith(locale) ? "FAIL" : "PASS"} ${account} ${entry.host}${entry.path} ${width}px ${locale}; axe=${entry.violations.length}; small visible targets=${entry.smallTargets.length}`);
  } catch (error) {
    results.push({ account, path: new URL(url).pathname, width, locale, error: error.message });
    console.log(`ERROR ${account} ${new URL(url).pathname} ${width}px ${locale}: ${error.message}`);
  } finally { await page.close(); }
}
try {
  for (const locale of ["en", "es"]) {
    const context = await browser.newContext({ locale });
    for (const width of [375, 768, 1280]) {
      for (const route of ["/", "/resources/", ...guideSlugs.map((slug) => `/resources/${slug}/`)]) {
        await auditPage(context, `${marketing}${route}`, width, locale);
      }
      for (const route of ["/login", "/signup", "/reset-password", "/forgot-password", "/support", "/privacy", "/terms"]) {
        await auditPage(context, `${app}${route}`, width, locale);
      }
    }
    await context.close();
  }
  // Optional: capture these states using a manual browser login, including
  // CAPTCHA/MFA. Do not bypass Auth protection with a service-role key.
  for (const account of ["free", "pro"]) {
    const state = process.env[`WORKCRAFT_${account.toUpperCase()}_STORAGE_STATE`];
    if (!state) { skipped.push(`signed-in ${account}: storage state not supplied`); console.log(`SKIP signed-in ${account}`); continue; }
    const context = await browser.newContext({ storageState: state });
    const entitlement = await context.request.get(`${app}/api/user/entitlements`);
    if (entitlement.status() !== 200) throw new Error(`${account} state is expired or invalid`);
    const access = await entitlement.json();
    if (access.has_pro !== (account === "pro")) throw new Error(`${account} entitlement mismatch`);
    const ai = await context.request.get(`${app}/api/generate-estimate`);
    if (ai.status() !== (account === "free" ? 403 : 200)) throw new Error(`${account} AI entitlement mismatch: ${ai.status()}`);
    if (fixture) {
      const response = await context.request.get(`${app}/api/estimates/${encodeURIComponent(fixture)}`);
      if (response.status() !== (account === owner ? 200 : 404)) throw new Error(`${account} estimate isolation mismatch`);
    }
    if (!fixture) skipped.push(`${account}: cross-account fixture not supplied`);
    for (const locale of ["en", "es"]) for (const width of [375, 768, 1280]) for (const route of ["/dashboard", "/customers", "/schedule", "/pricebook", "/reports", "/profile", "/estimate/new"]) {
      await auditPage(context, `${app}${route}`, width, locale, account);
    }
    await context.close();
  }
} finally { await browser.close(); }
mkdirSync(".audit-results", { recursive: true, mode: 0o700 });
writeFileSync(".audit-results/launch-readiness.json", JSON.stringify({ results, skipped }, null, 2), { mode: 0o600 });
console.log("Saved sanitized results to .audit-results/launch-readiness.json. Small targets are review flags, not automatic WCAG failures. Incomplete axe checks need human review.");
if (process.env.WORKCRAFT_FREE_ACCESS_TOKEN && process.env.WORKCRAFT_PRO_ACCESS_TOKEN) {
  await import("./launch-storage-isolation.mjs");
} else {
  skipped.push("Direct RLS and private Storage: manual-session access tokens not supplied");
}
if (process.env.WORKCRAFT_RUN_PREVIEW_WEBHOOKS === "1") {
  await import("./launch-preview-webhooks.mjs");
} else {
  skipped.push("Preview Stripe state-changing simulations not enabled");
}
writeFileSync(".audit-results/launch-readiness.json", JSON.stringify({ results, skipped }, null, 2), { mode: 0o600 });
console.log(`${results.length} page checks; ${skipped.length} skipped groups.`);
process.exitCode = results.some((r) => r.error || r.overflow || r.violations?.length || !r.actualLanguage?.startsWith(r.locale))
  || (process.env.WORKCRAFT_REQUIRE_FULL_AUDIT === "1" && skipped.length > 0) ? 1 : 0;
