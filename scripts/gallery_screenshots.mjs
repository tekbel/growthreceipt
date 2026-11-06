// Captures product screenshots of the judge demo at 1500x1000 (3:2).
//
//   node scripts/gallery_screenshots.mjs [--new] [--wait] [--base URL] [--out DIR]
//
// Chrome opens visibly with its own saved profile, so the same judge workspace comes back on
// every run. Make sandbox purchases in that workspace first, otherwise Results is empty.
//   --new   start a fresh judge workspace (drops the saved session first)
//   --wait  pause after opening the workspace so you can buy in that window, then open Results
//   --base  site to capture (default https://growthreceipt.addisstack.com)
//   --out   folder for the PNG files (default ~/Desktop/growthreceipt-screenshots)
// Needs Google Chrome installed.

import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const VIEWPORT = { width: 1500, height: 1000 };
const PROFILE = join(homedir(), ".cache", "growthreceipt-screenshot-profile");

function parseArgs(argv) {
  const options = {
    fresh: false,
    wait: false,
    base: "https://growthreceipt.addisstack.com",
    out: join(homedir(), "Desktop", "growthreceipt-screenshots"),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--new") options.fresh = true;
    else if (argv[i] === "--wait") options.wait = true;
    else if (argv[i] === "--base") options.base = argv[++i].replace(/\/$/, "");
    else if (argv[i] === "--out") options.out = argv[++i];
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return options;
}

async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800); // Lets entrance animations finish.
}

async function closeTour(page) {
  const close = page.getByRole("button", { name: "Close tour" });
  if (await close.isVisible().catch(() => false)) await close.click();
}

async function enterWorkspace(page, base) {
  await page.goto(`${base}/today`);
  const today = page.getByRole("button", { name: "Today", exact: true });
  if (await today.isVisible({ timeout: 8_000 }).catch(() => false)) return;
  await page.goto(base);
  await page.getByRole("button", { name: "Try the judge demo" }).first().click();
  await today.waitFor({ timeout: 30_000 });
}

async function shoot(page, out, name) {
  await closeTour(page);
  await settle(page);
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`saved ${file}`);
}

async function openWorkspacePage(page, button, path) {
  await page.getByRole("button", { name: button, exact: true }).first().click();
  await page.waitForURL(new RegExp(`/${path}$`), { timeout: 15_000 });
}

const options = parseArgs(process.argv.slice(2));
if (options.fresh) await rm(PROFILE, { recursive: true, force: true });
await mkdir(options.out, { recursive: true });

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: "chrome",
  headless: false,
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
});
const page = context.pages()[0] ?? (await context.newPage());

try {
  await page.goto(options.base);
  await shoot(page, options.out, "01-home");

  await enterWorkspace(page, options.base);
  if (options.wait) {
    // Works without a terminal: the script continues once Results is open in the window.
    console.log("Make the sandbox purchases in the Chrome window, then open Results.");
    await page.waitForURL(/\/results$/, { timeout: 0 });
  }

  const pages = [
    ["02-today", "Today", "today"],
    ["03-content", "Content", "content"],
    ["04-checkout", "Customer checkout", "checkout"],
    ["05-results", "Results", "results"],
    ["06-next-experiment", "Next experiment", "experiment"],
    ["07-dashboard", "Revenue dashboard", "dashboard"],
  ];
  for (const [name, button, path] of pages) {
    await openWorkspacePage(page, button, path);
    await shoot(page, options.out, name);
  }
} finally {
  await context.close();
}
