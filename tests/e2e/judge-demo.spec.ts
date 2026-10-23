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

async function enterJudgeDemo(page: Page) {
	await page.goto("/");
	await expect(page).toHaveTitle(/GrowthReceipt/);
	await expect(
		page.getByRole("heading", { name: "Know which posts generate revenue." }),
	).toBeVisible();
	await page.getByRole("button", { name: "Try the judge demo" }).click();
	await expect(
		page.getByRole("button", { name: "Today", exact: true }),
	).toBeVisible({
		timeout: 30_000,
	});
	await expect(
		page.getByText("PayPal sandbox. No real money moves."),
	).toBeVisible();
	await expect(page.locator("nextjs-portal")).toHaveCount(0);
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

	await enterJudgeDemo(page);
	await openWorkspacePage(page, "Customer checkout", "checkout");

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

	await checkout.getByRole("link", { name: "See it on Today" }).click();
	await expect(checkout).toHaveURL(/\/today$/);
	await expect(checkout.getByText(captureId, { exact: true })).toBeVisible({
		timeout: 30_000,
	});
	await expect(checkout.getByText(/captured through PayPal/)).toBeVisible();

	await openWorkspacePage(checkout, "Results", "results");
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
	await expect(checkout.getByText("Webhook on its way")).toBeVisible();
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
