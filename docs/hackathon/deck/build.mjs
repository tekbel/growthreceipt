// Renders slides.html to growthreceipt-deck.pdf and one PNG per page in previews/.
// Fails when a slide overflows or an image did not load. Run from the repo root:
// node docs/hackathon/deck/build.mjs && python3 docs/hackathon/deck/check_deck.py
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const dir = new URL("./", import.meta.url).pathname;
mkdirSync(`${dir}previews`, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`file://${dir}slides.html`);
await page.evaluate(() => document.fonts.ready);

const problems = await page.evaluate(() => {
	const found = [];
	for (const img of document.images) {
		if (!img.complete || img.naturalWidth === 0) found.push(`image not loaded: ${img.src}`);
	}
	if (!document.fonts.check("32px Figtree")) found.push("Figtree did not load");
	document.querySelectorAll(".slide").forEach((slide, index) => {
		const box = slide.getBoundingClientRect();
		for (const el of slide.querySelectorAll("*")) {
			const r = el.getBoundingClientRect();
			if (r.width && (r.right > box.right + 0.5 || r.bottom > box.bottom + 0.5)) {
				found.push(`slide ${index + 1}: ${el.tagName.toLowerCase()}.${el.className} overflows`);
				break;
			}
		}
	});
	return found;
});
if (problems.length) {
	console.error(problems.join("\n"));
	process.exit(1);
}

const slides = await page.locator(".slide").all();
for (const [index, slide] of slides.entries()) {
	await slide.screenshot({ path: `${dir}previews/slide-${index + 1}.png` });
}
await page.pdf({ path: `${dir}growthreceipt-deck.pdf`, width: "1920px", height: "1080px", printBackground: true });
await browser.close();
console.log(`rendered ${slides.length} slides`);
