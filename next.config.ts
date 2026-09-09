import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pg", "bullmq", "ioredis"],
};
export default config;
