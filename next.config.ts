import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      swr: "./lib/swr",
    },
  },
};

export default nextConfig;
