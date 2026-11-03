import path from "node:path";
import type { NextConfig } from "next";

const projectRoot = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const nextConfig: NextConfig = {
  // Pin the Turbopack workspace root to this repository so nested checkouts
  // (e.g. under a user home directory) never pick up a parent package-lock.json.
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
