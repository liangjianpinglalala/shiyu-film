import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/pages",
  workers: 1,
  use: {
    baseURL: process.env.PAGES_TEST_URL || "http://127.0.0.1:3200/shiyu-film/",
    ...(process.env.CI ? {} : { channel: "msedge" }),
  },
  webServer: process.env.PAGES_TEST_URL
    ? undefined
    : {
        command: "node scripts/serve-pages.mjs",
        url: "http://127.0.0.1:3200/shiyu-film/",
        reuseExistingServer: false,
      },
  reporter: "list",
});
