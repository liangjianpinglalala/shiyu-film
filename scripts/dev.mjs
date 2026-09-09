import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.SHIYU_MODE ||= "demo";
process.env.APP_ORIGIN ||= "http://127.0.0.1:3000";
const compiled = spawnSync(
  process.execPath,
  [resolve("node_modules/typescript/bin/tsc"), "-p", "tsconfig.server.json"],
  { stdio: "inherit" },
);
if (compiled.status !== 0) process.exit(1);
const children = [
  spawn(
    process.execPath,
    [
      resolve("node_modules/next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: process.env },
  ),
  spawn(process.execPath, [".server/worker/index.js"], {
    stdio: "inherit",
    env: process.env,
  }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === "win32" && child.pid)
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    else child.kill();
  }
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children)
  child.on("exit", (code) => {
    if (!stopping) {
      process.exitCode = code || 0;
      stop();
    }
  });
