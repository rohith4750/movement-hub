import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@movement-hub/api", "@movement-hub/database"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    config.resolve.alias = {
      ...config.resolve.alias,
      "@movement-hub/database": path.resolve(__dirname, "../../packages/database/src/index.ts"),
      "@movement-hub/api": path.resolve(__dirname, "../api/src/app.ts"),
    };
    return config;
  },
};

export default nextConfig;
