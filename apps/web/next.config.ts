import type { NextConfig } from "next";
const config: NextConfig = {
  agentRules: false,
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
