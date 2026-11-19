import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Native / binary packages used by the server-side print engine.
  serverExternalPackages: ["@resvg/resvg-js"],
  // Fonts read from disk by the print engine must be bundled with the functions that use them.
  outputFileTracingIncludes: {
    "/api/**/*": ["./assets/fonts/**/*"],
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
  async rewrites() {
    return [
      { source: "/auth/login", destination: "/login" },
      { source: "/auth/signup", destination: "/signup" },
    ];
  },
};

export default nextConfig;
