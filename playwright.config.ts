import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3001";

export default defineConfig({
	testDir: "./tests/e2e",
	timeout: 120_000,
	expect: { timeout: 15_000 },
	fullyParallel: false,
	workers: 1,
	reporter: "list",
	outputDir: "/tmp/growthreceipt-playwright",
	use: {
		baseURL,
		channel: "chrome",
		viewport: { width: 1440, height: 900 },
		screenshot: "only-on-failure",
		trace: "retain-on-failure",
	},
});
