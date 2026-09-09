import {
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
const root = process.cwd();
const stage = resolve(root, ".pages-build");
// Only this disposable, explicitly named build directory may be replaced.
if (stage !== join(root, ".pages-build"))
  throw Error("Unexpected build directory");
if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "app"), { recursive: true });
mkdirSync(join(stage, "lib/shared"), { recursive: true });
for (const file of [
  "app/page.tsx",
  "app/layout.tsx",
  "app/globals.css",
  "lib/client.ts",
  "lib/shared/types.ts",
  "package.json",
])
  cpSync(join(root, file), join(stage, file));
cpSync(join(root, "public"), join(stage, "public"), { recursive: true });
const basePath = process.env.PAGES_BASE_PATH || "/shiyu-film";
if (!/^\/[a-zA-Z0-9_-]+$/.test(basePath))
  throw Error("Invalid Pages base path");
writeFileSync(
  join(stage, "next.config.mjs"),
  `export default ${JSON.stringify({ output: "export", basePath, trailingSlash: true, images: { unoptimized: true }, devIndicators: false, turbopack: { root }, env: { NEXT_PUBLIC_STATIC_SITE: "1", NEXT_PUBLIC_BASE_PATH: basePath } })};\n`,
);
const ts = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
ts.include = ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"];
ts.exclude = ["node_modules"];
writeFileSync(join(stage, "tsconfig.json"), JSON.stringify(ts, null, 2));
const result = spawnSync(
  process.execPath,
  [join(root, "node_modules/next/dist/bin/next"), "build", stage],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_STATIC_SITE: "1",
      NEXT_PUBLIC_BASE_PATH: basePath,
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
if (result.status !== 0) process.exit(result.status || 1);
const output = join(stage, "out");
if (!existsSync(join(output, "index.html")))
  throw Error("Static build did not produce index.html");
if (existsSync(join(output, "api")))
  throw Error("Backend API must not be present in Pages output");
writeFileSync(join(output, ".nojekyll"), "");
console.log("GitHub Pages artifact ready: .pages-build/out");
