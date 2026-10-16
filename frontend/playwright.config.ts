import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: process.env.SCHOOLOS_TEST_URL ?? "http://localhost:3000",
    channel: process.env.SCHOOLOS_BROWSER_CHANNEL ?? "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 980 } },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium", defaultBrowserType: "chromium" },
    },
  ],
});
