// Captures real screens from the live judge demo for the deck. Free: no purchase, no agent run.
// Run from the repo root: node docs/hackathon/deck/capture.mjs
import { chromium } from "@playwright/test";

const BASE = "https://growthreceipt.addisstack.com";
const out = new URL("./shots/", import.meta.url).pathname;
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 2,
	colorScheme: "light",
	reducedMotion: "reduce",
});

await page.goto(BASE);
await page.getByRole("button", { name: "See the full revenue loop" }).first().click();
const loop = page.getByRole("dialog");
await loop.getByRole("button", { name: /^Next post/ }).click();
await page.waitForTimeout(500);
await loop.locator(".loop-stages").screenshot({ path: `${out}loop.png` });
await page.keyboard.press("Escape");

await page.getByRole("button", { name: "Try the judge demo" }).first().click();
await page.getByRole("button", { name: "Close tour" }).click({ timeout: 30_000 });
for (const [name, file] of [
	["Results", "results"],
	["Next experiment", "experiment"],
	["Content", "content"],
]) {
	await page.getByRole("button", { name, exact: true }).first().click();
	await page.waitForTimeout(1500);
	await page.screenshot({ path: `${out}${file}.png`, fullPage: true });
}
await browser.close();
