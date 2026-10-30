import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  typescript: {
    // Do not fail the production build on type errors.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
