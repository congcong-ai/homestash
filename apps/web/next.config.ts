import type { NextConfig } from "next";
const config: NextConfig = {
  agentRules: false,
  distDir: process.env.HOMESTASH_NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: process.env.HOMESTASH_LAN_ADDRESS
    ? [process.env.HOMESTASH_LAN_ADDRESS]
    : undefined,
  experimental: { proxyClientMaxBodySize: "22mb" },
  transpilePackages: [
    "@homestash/domain",
    "@homestash/protocol",
    "@homestash/api-client",
    "@homestash/recipes",
  ],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.CORE_INTERNAL_URL ?? "http://127.0.0.1:3100"}/api/:path*`,
      },
    ];
  },
};
export default config;
