import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const PAYPAL_SANDBOX_HOST = "www.sandbox.paypal.com";

function watchForBrowserErrors(page: Page, errors: string[], label: string) {
	page.on("console", (message) => {
		if (message.type() === "error")
			errors.push(`${label} console: ${message.text()}`);
	});
	page.on("pageerror", (error) =>
		errors.push(`${label} page: ${error.message}`),
	);
}

// A judge's first visit opens the guided tour. Tests that are not about the tour close it.
async function enterJudgeDemo(page: Page, { keepTour = false } = {}) {
	await page.goto("/");
	await expect(page).toHaveTitle(/GrowthReceipt/);
	await expect(
		page.getByRole("heading", { name: "Know which marketing posts drive sales and what to post next, backed by verified PayPal purchases." }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Try the judge demo" })
		.first()
		.click();
	await expect(
		page.getByRole("button", { name: "Today", exact: true }),
	).toBeVisible({
		timeout: 30_000,
	});
	await expect(
		page.getByText("PayPal sandbox. No real money moves."),
	).toBeVisible();
	await expect(page.locator("nextjs-portal")).toHaveCount(0);
	const tour = page.getByRole("complementary", { name: /^Describe your product/ });
	await expect(tour).toBeVisible();
	if (!keepTour) {
		await page.getByRole("button", { name: "Close tour" }).click();
		await expect(tour).toHaveCount(0);
	}
}

async function openWorkspacePage(page: Page, name: string, path: string) {
	await page.getByRole("button", { name, exact: true }).first().click();
	await expect(page).toHaveURL(new RegExp(`/${path}$`));
}

async function openPayPal(context: BrowserContext, checkout: Page) {
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const opened = context
			.waitForEvent("page", { timeout: 15_000 })
			.catch(() => null);
		await checkout
			.locator('paypal-button[aria-label="Pay with PayPal"]')
			.click();
		const paypal = await opened;
		if (paypal) return paypal;
		await checkout.reload({ waitUntil: "domcontentloaded" });
		await checkout
			.locator(".paypal-button-slot.ready")
			.waitFor({ timeout: 30_000 });
	}
	throw new Error("PayPal did not open after three attempts.");
}

test("hosted judge demo exposes the complete seeded story", async ({
	page,
}) => {
	const errors: string[] = [];
	watchForBrowserErrors(page, errors, "workspace");

	await enterJudgeDemo(page);
	await expect(page.getByText(/Sample campaign prepared (just now|\d+ minutes? ago)/)).toBeVisible();

	await openWorkspacePage(page, "Content", "content");
	await expect(
		page.getByRole("heading", { name: "Content", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Launch week", exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Ship with fewer surprises", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Approved · 1" }),
	).toBeVisible();

	await openWorkspacePage(page, "Customer checkout", "checkout");
	await expect(
		page.getByRole("heading", { name: "Buy as your customer" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Open as customer" }),
	).toBeVisible();

	await openWorkspacePage(page, "Results", "results");
	await expect(
		page.getByRole("heading", { name: "Results", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Find next move" }),
	).toBeVisible();

	await openWorkspacePage(page, "Next experiment", "experiment");
	await expect(
		page.getByText("Complete a verified purchase first."),
	).toBeVisible();

	expect(errors).toEqual([]);
});

test("guided tour walks a first time judge through the loop", async ({
	page,
}) => {
	const errors: string[] = [];
	watchForBrowserErrors(page, errors, "workspace");

	await enterJudgeDemo(page, { keepTour: true });
	const tour = page.locator(".tour-card");
	const steps = [
		{ title: "Describe your product", path: "products", target: "product" },
		{ title: "Review the campaign", path: "content", target: "content" },
		{ title: "Test the purchase", path: "checkout", target: "purchase" },
		{ title: "Read verified results", path: "results", target: null },
		{ title: "Choose the next test", path: "experiment", target: "next" },
	];
	for (const [index, step] of steps.entries()) {
		if (index > 0) await tour.getByRole("button", { name: "Next" }).click();
		await expect(page).toHaveURL(new RegExp(`/${step.path}$`));
		await expect(tour.getByRole("heading", { name: step.title })).toBeVisible();
		await expect(tour.getByText(`Step ${index + 1} of 5`)).toBeVisible();
		// Results has no receipts before a purchase, so nothing is ringed there.
		if (step.target)
			await expect(page.locator(`[data-tour="${step.target}"]`)).toHaveAttribute(
				"data-tour-active",
				"",
			);
		else await expect(page.locator("[data-tour-active]")).toHaveCount(0);
	}
	await expect(tour.getByText("Unlocks after your first verified purchase.")).toBeVisible();

	await tour.getByRole("button", { name: "Back" }).click();
	await expect(page).toHaveURL(/\/results$/);
	await expect(tour.getByText("Your purchase shows up here once PayPal confirms it.")).toBeVisible();
	// An open tour carries on after a reload, on the same step.
	await page.reload();
	await expect(tour.getByRole("heading", { name: "Read verified results" })).toBeVisible({
		timeout: 30_000,
	});
	await expect(page).toHaveURL(/\/results$/);
	await tour.getByRole("button", { name: "Next" }).click();
	await tour.getByRole("button", { name: "Finish" }).click();
	await expect(tour).toHaveCount(0);
	await expect(page.locator("[data-tour-active]")).toHaveCount(0);

	// It opens on its own only once. The judge bar and the help panel bring it back.
	await page.reload();
	await expect(page.getByText("PayPal sandbox. No real money moves.")).toBeVisible({
		timeout: 30_000,
	});
	await expect(tour).toHaveCount(0);
	await page.getByRole("button", { name: "Take the tour" }).click();
	await expect(page).toHaveURL(/\/products$/);
	await expect(tour).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(tour).toHaveCount(0);

	expect(errors).toEqual([]);
});

test("home page explains the full revenue loop", async ({ page }) => {
	await page.goto("/");
	const trigger = page
		.getByRole("button", { name: "See the full revenue loop" })
		.first();
	await trigger.click();
	const loop = page.getByRole("dialog", {
		name: "From approved post to verified revenue",
	});
	await expect(loop).toBeVisible();
	await loop.getByRole("button", { name: "Pause" }).click();

	await loop.getByRole("button", { name: /^You decide/ }).click();
	await expect(loop.getByText("9 of 10")).toBeVisible();
	await expect(loop.getByRole("heading", { name: "You decide" })).toBeVisible();
	await loop.getByRole("button", { name: "Next step" }).click();
	await expect(loop.getByText("10 of 10")).toBeVisible();
	await expect(loop.getByRole("button", { name: "Next step" })).toBeDisabled();

	await page.keyboard.press("Escape");
	await expect(loop).toBeHidden();
	await expect(trigger).toBeFocused();
});

// Phones show GrowthReceipt's icon for the app, and the product's icon on its checkout page.
test("app and checkout pages carry their own home screen icons", async ({
	page,
	request,
}) => {
	async function appleIcon(target: Page) {
		const link = target.locator('link[rel="apple-touch-icon"]');
		await expect(link).not.toHaveCount(0);
		const href = await link.first().getAttribute("href");
		expect(href).toBeTruthy();
		const url = new URL(href ?? "", target.url()).href;
		const response = await request.get(url);
		expect(response.ok()).toBe(true);
		expect(response.headers()["content-type"]).toContain("image/png");
		return href ?? "";
	}

	await enterJudgeDemo(page);
	const appIcon = await appleIcon(page);
	await openWorkspacePage(page, "Customer checkout", "checkout");
	const checkoutOpened = page.waitForEvent("popup");
	await page.getByRole("button", { name: "Open as customer" }).click();
	const checkout = await checkoutOpened;
	await checkout.locator("#checkout-title").waitFor({ timeout: 30_000 });
	const productIcon = await appleIcon(checkout);
	expect(productIcon).toContain("/buy/");
	expect(productIcon).not.toBe(appIcon);
});

// c38c3b5: Ask AI closes with Done, and opening it without a change saves nothing.
// No prompt is sent, so no agent call is made.
test("Ask AI closes with Done and leaves the dashboard unedited", async ({
	page,
}) => {
	const errors: string[] = [];
	watchForBrowserErrors(page, errors, "revenue dashboard");

	await enterJudgeDemo(page);
	await openWorkspacePage(page, "Revenue dashboard", "dashboard");
	const dashboard = page.getByRole("region", { name: "Revenue dashboard" });
	const askAi = dashboard.getByRole("button", { name: "Ask AI" });
	await expect(askAi).toBeVisible({ timeout: 30_000 });
	await expect(
		dashboard.getByRole("button", { name: "Reset to default" }),
	).toHaveCount(0);

	await askAi.click();
	const done = dashboard.getByRole("button", { name: "Done", exact: true });
	await expect(done).toBeVisible();
	await expect(
		dashboard.getByRole("button", { name: "Save layout" }),
	).toHaveCount(0);
	await done.click();

	await expect(askAi).toBeVisible();
	await expect(
		dashboard.getByRole("button", { name: "Reset to default" }),
	).toHaveCount(0);

	// The AG Studio key is live, so a license banner in the console fails this test too.
	expect(errors).toEqual([]);
});

test("judge demo remains navigable on a phone", async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const errors: string[] = [];
	watchForBrowserErrors(page, errors, "mobile workspace");

	await enterJudgeDemo(page);
	await page.getByRole("button", { name: "Open navigation" }).click();
	await expect(
		page.getByRole("complementary", { name: "Main navigation" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Content", exact: true }).click();
	await expect(page).toHaveURL(/\/content$/);
	await expect(
		page.getByRole("heading", { name: "Content", exact: true }),
	).toBeVisible();

	expect(errors).toEqual([]);
});

test("@paypal purchase closes the verified revenue loop", async ({
	page,
	context,
}) => {
	test.skip(
		process.env.E2E_PAYPAL !== "1",
		"Set E2E_PAYPAL=1 for a real Sandbox purchase.",
	);
	// PayPal sandbox and the refund webhook can each take minutes.
	test.setTimeout(420_000);
	const errors: string[] = [];
	watchForBrowserErrors(page, errors, "workspace");

	// The tour stays open on the purchase step and must turn to done on its own.
	await enterJudgeDemo(page, { keepTour: true });
	const tour = page.locator(".tour-card");
	await tour.getByRole("button", { name: "Next" }).click();
	await tour.getByRole("button", { name: "Next" }).click();
	await expect(page).toHaveURL(/\/checkout$/);
	await expect(tour.getByText(/^Waiting for your purchase/)).toBeVisible();

	const checkoutOpened = page.waitForEvent("popup");
	await page.getByRole("button", { name: "Open as customer" }).click();
	const checkout = await checkoutOpened;
	watchForBrowserErrors(checkout, errors, "checkout");
	await checkout.locator("#checkout-title").waitFor({ timeout: 30_000 });
	await checkout
		.locator(".paypal-button-slot.ready")
		.waitFor({ timeout: 30_000 });

	const email = (
		await checkout.locator(".test-buyer dd").nth(0).innerText()
	).trim();
	const password = (
		await checkout.locator(".test-buyer dd").nth(1).innerText()
	).trim();
	expect(email).toContain("@");
	expect(password.length).toBeGreaterThan(7);

	const paypal = await openPayPal(context, checkout);
	watchForBrowserErrors(paypal, errors, "PayPal");
	await paypal.waitForURL(/^https:\/\//, { timeout: 30_000 });
	expect(new URL(paypal.url()).host).toBe(PAYPAL_SANDBOX_HOST);

	await paypal.locator("#email").fill(email);
	await paypal.locator("#btnNext").click();
	await paypal
		.locator("#password")
		.waitFor({ state: "visible", timeout: 20_000 });
	await paypal.locator("#password").fill(password);
	await paypal.locator("#btnLogin").click();
	await paypal
		.locator('[data-id="payment-submit-btn"]')
		.click({ timeout: 45_000 });

	const success = checkout.locator(".checkout-success");
	await expect(success).toBeVisible({ timeout: 60_000 });
	const captureId = (await success.locator("dd").last().innerText()).trim();
	expect(captureId.length).toBeGreaterThan(8);

	// The workspace refreshes revenue on focus and every 15 seconds. Once the purchase is
	// confirmed, the tour moves on to the results by itself.
	await page.bringToFront();
	await expect(tour.getByRole("heading", { name: "Read verified results" })).toBeVisible({
		timeout: 45_000,
	});
	await expect(page).toHaveURL(/\/results$/);

	// The checkout tab opens the workspace too, and the tour continues there on the results.
	await checkout.getByRole("link", { name: "See it on Today" }).click();
	const checkoutTour = checkout.locator(".tour-card");
	await expect(
		checkoutTour.getByRole("heading", { name: "Read verified results" }),
	).toBeVisible({ timeout: 30_000 });
	await expect(checkout).toHaveURL(/\/results$/);
	await checkoutTour.getByRole("button", { name: "Close tour" }).click();

	await checkout.getByText("Technical proof", { exact: true }).click();
	await expect(checkout.getByText(captureId, { exact: true })).toBeVisible();

	// Refund the purchase in the app. It stops counting and PayPal's webhook confirms it.
	await expect(checkout.getByText("1 customer", { exact: true })).toBeVisible();
	await checkout.getByRole("button", { name: "Refund", exact: true }).click();
	await expect(checkout.getByText(/to the buyer\?$/)).toBeVisible();
	await checkout.getByRole("button", { name: "Refund", exact: true }).click();
	await expect(checkout.getByText("Refunded", { exact: true })).toBeVisible({
		timeout: 60_000,
	});
	await expect(checkout.getByText("1 refunded", { exact: true })).toBeVisible();
	await expect(checkout.getByText("PayPal confirmation on its way")).toBeVisible();
	// The page checks again on its own until PayPal's signed refund webhook is stored.
	await expect(checkout.getByText("Webhook verified", { exact: true })).toBeVisible({
		timeout: 130_000,
	});
	// The refunded purchase keeps its proof, with PayPal's refund and the verified webhook.
	await checkout.getByText("Technical proof", { exact: true }).click();
	await expect(checkout.getByText("Refund completed by PayPal")).toBeVisible();
	await expect(checkout.getByText("PayPal confirmed the refund")).toBeVisible();

	if (process.env.E2E_AGENT === "1") {
		await checkout.getByRole("button", { name: "Find next move" }).click();
		await expect(checkout.getByText("Why this recommendation")).toBeVisible({
			timeout: 90_000,
		});
	}

	expect(
		errors.filter((error) => !error.startsWith("PayPal console:")),
	).toEqual([]);
});
