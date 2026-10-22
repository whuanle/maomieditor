import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 静态资源走 /api/files 与 /api/public/share/...，交给 Route Handler 控制
  async headers() {
    return [
      {
        source: "/:path*.(png|jpg|jpeg|gif|webp|svg|avif|ico|bmp|woff|woff2)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
