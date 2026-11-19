import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/auth/login",
        destination: "/login",
      },
      {
        source: "/auth/signup",
        destination: "/signup",
      },
    ];
  },
};

export default nextConfig;
