import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 构建产物输出为 .next/standalone（Docker 镜像只携带最小 node_modules + server.js）；
  // 本地 next dev / next start 行为不变
  output: "standalone",
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
