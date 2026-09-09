import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
const dataDir = resolve(".data-test-" + Date.now());
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    ...(process.env.CI ? {} : { channel: "msedge" as const }),
  },
  webServer: {
    command: "node scripts/dev.mjs --port 3100",
    url: "http://127.0.0.1:3100/api/capabilities",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      SHIYU_MODE: "demo",
      SHIYU_DATA_DIR: dataDir,
      NEXT_DIST_DIR: ".next-test",
      APP_ORIGIN: "http://127.0.0.1:3100",
      DEMO_STEP_MS: "900",
    },
  },
  reporter: "list",
});
