import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    middlewareClientMaxBodySize: 150 * 1024 * 1024,
    serverActions: {
      bodySizeLimit: "150mb",
    },
  },
};

export default nextConfig;
