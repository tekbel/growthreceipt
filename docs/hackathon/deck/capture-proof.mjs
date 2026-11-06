// Makes one PayPal sandbox purchase in a fresh judge demo (free, no real money), then captures
// Results and Technical proof for the deck. Run from the repo root:
// node docs/hackathon/deck/capture-proof.mjs
import { chromium } from "@playwright/test";

const BASE = "https://growthreceipt.addisstack.com";
const out = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
	colorScheme: "light",
	reducedMotion: "reduce",
});
const page = await context.newPage();
await page.goto(BASE);
await page.getByRole("button", { name: "Try the judge demo" }).first().click();
await page.getByRole("button", { name: "Close tour" }).click({ timeout: 30_000 });
// Customer checkout holds the seeded Day 3 post's buy link, the same path the e2e purchase uses.
await page.getByRole("button", { name: "Customer checkout", exact: true }).first().click();
await page.waitForURL(/\/checkout$/);

const opened = page.waitForEvent("popup");
await page.getByRole("button", { name: "Open as customer" }).click();
const checkout = await opened;
await checkout.locator(".paypal-button-slot.ready").waitFor({ timeout: 30_000 });
await checkout.screenshot({ path: `${out}checkout.png` });
const email = (await checkout.locator(".test-buyer dd").nth(0).innerText()).trim();
const password = (await checkout.locator(".test-buyer dd").nth(1).innerText()).trim();

let paypal = null;
for (let attempt = 0; attempt < 3 && !paypal; attempt += 1) {
	const popup = context.waitForEvent("page", { timeout: 15_000 }).catch(() => null);
	await checkout.locator('paypal-button[aria-label="Pay with PayPal"]').click();
	paypal = await popup;
	if (!paypal) {
		await checkout.reload({ waitUntil: "domcontentloaded" });
		await checkout.locator(".paypal-button-slot.ready").waitFor({ timeout: 30_000 });
	}
}
if (!paypal) throw new Error("PayPal did not open.");
await paypal.locator("#email").fill(email);
await paypal.locator("#btnNext").click();
await paypal.locator("#password").waitFor({ state: "visible", timeout: 20_000 });
await paypal.locator("#password").fill(password);
await paypal.locator("#btnLogin").click();
await paypal.locator('[data-id="payment-submit-btn"]').click({ timeout: 45_000 });
await checkout.locator(".checkout-success").waitFor({ timeout: 60_000 });
await checkout.screenshot({ path: `${out}paid.png` });

await page.bringToFront();
await page.getByRole("button", { name: "Results", exact: true }).first().click();
await page.reload();
await page.getByText("Technical proof", { exact: true }).waitFor({ timeout: 45_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}results-paid.png`, fullPage: true });
await page.getByText("Technical proof", { exact: true }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}proof.png`, fullPage: true });
await browser.close();
