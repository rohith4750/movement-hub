import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@movement-hub/database"],
  // Keep Prisma and heavy Node-only SDKs out of the server bundle; load them from node_modules.
  serverExternalPackages: ["@prisma/client", "bcryptjs", "razorpay", "@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@movement-hub/database": path.resolve(__dirname, "../../packages/database/src/index.ts"),
    };
    return config;
  },
};

export default nextConfig;
