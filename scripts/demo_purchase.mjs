// Buys from one or more GrowthReceipt buy links with the PayPal sandbox buyer, the same way
// a customer would. Used to add sandbox purchases to a demo workspace.
//
//   node scripts/demo_purchase.mjs <buy link> [<buy link> ...] [--count N] [--headless]
//
// Each link is bought N times (default 1). Chrome opens visibly unless --headless is given,
// because PayPal opens its popup more reliably there. Every purchase runs in a fresh context, logs in to
// PayPal with the sandbox buyer and completes the payment. The script refuses to log in
// anywhere but www.sandbox.paypal.com, so it cannot move real money.
//
// The buyer defaults to the public judge sandbox account. DEMO_BUYER_EMAIL and
// DEMO_BUYER_PASSWORD override it. Needs Google Chrome installed.

import { chromium } from "playwright-core";

const SANDBOX_HOST = "www.sandbox.paypal.com";
const MAX_PURCHASES = 10; // Public orders are limited to 20 an hour per address.
const buyer = {
  email: process.env.DEMO_BUYER_EMAIL ?? "judge-buyer@personal.example.com",
  password: process.env.DEMO_BUYER_PASSWORD ?? "JudgeBuyer2026!",
};

function parseArgs(argv) {
  const links = [];
  let count = 1;
  let headless = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--count") count = Number(argv[++i]);
    else if (argv[i] === "--headless") headless = true;
    else links.push(argv[i]);
  }
  if (links.length === 0 || !Number.isInteger(count) || count < 1) {
    console.error("Usage: node scripts/demo_purchase.mjs <buy link> [...] [--count N] [--headless]");
    process.exit(2);
  }
  for (const link of links) {
    if (!/^https?:\/\/[^/]+\/buy\/[0-9a-f-]{36}$/i.test(link)) {
      console.error(`Not a buy link: ${link}`);
      process.exit(2);
    }
  }
  if (links.length * count > MAX_PURCHASES) {
    console.error(`At most ${MAX_PURCHASES} purchases per run.`);
    process.exit(2);
  }
  return { links, count, headless };
}

// PayPal usually opens its popup at once. Now and then it does not, so reload and try again.
// Each try opens a PayPal order, so a retry shows as one more checkout started.
async function openPayPal(context, page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const opened = context.waitForEvent("page", { timeout: 8_000 }).catch(() => null);
    await page.locator("paypal-button").click();
    const popup = await opened;
    if (popup) return popup;
    retries++;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".paypal-button-slot.ready", { timeout: 30_000 });
  }
  throw new Error("PayPal did not open after 3 tries.");
}

async function buyOnce(browser, link) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  try {
    const page = await context.newPage();
    await page.goto(link, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".paypal-button-slot.ready", { timeout: 30_000 });
    const offer = await page.locator("#checkout-title").innerText();

    const paypal = await openPayPal(context, page);
    // The popup opens blank, then navigates to PayPal.
    await paypal.waitForURL(/^https:\/\//, { timeout: 30_000 });
    const host = new URL(paypal.url()).host;
    if (host !== SANDBOX_HOST) throw new Error(`Refusing to log in on ${host}, not the sandbox.`);

    await paypal.locator("#email").fill(buyer.email);
    await paypal.locator("#btnNext").click();
    await paypal.locator("#password").waitFor({ state: "visible", timeout: 20_000 });
    await paypal.locator("#password").fill(buyer.password);
    await paypal.locator("#btnLogin").click();
    await paypal.locator('[data-id="payment-submit-btn"]').click({ timeout: 45_000 });

    const success = page.locator(".checkout-success");
    const failure = page.locator(".checkout-status.error");
    await Promise.race([
      success.waitFor({ timeout: 60_000 }),
      failure.waitFor({ timeout: 60_000 }).then(async () => {
        throw new Error(await failure.innerText());
      }),
    ]);
    const capture = await success.locator("dd").last().innerText();
    return { offer, capture };
  } finally {
    await context.close();
  }
}

const { links, count, headless } = parseArgs(process.argv.slice(2));
const browser = await chromium.launch({ channel: "chrome", headless });
let failed = 0;
let retries = 0;
try {
  for (const link of links) {
    for (let n = 1; n <= count; n++) {
      const label = `${link.split("/buy/")[1].slice(0, 8)} #${n}`;
      try {
        const { offer, capture } = await buyOnce(browser, link);
        console.log(`${label}  paid  ${offer}  capture ${capture}`);
      } catch (error) {
        failed++;
        console.error(`${label}  failed  ${error instanceof Error ? error.message : error}`);
      }
    }
  }
} finally {
  await browser.close();
}
if (retries) console.log(`${retries} retried checkout(s) also count under Checkouts started.`);
process.exit(failed ? 1 : 0);
