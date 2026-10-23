import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 构建产物输出为 .next/standalone（Docker 镜像只携带最小 node_modules + server.js）；
  // 本地 next dev / next start 行为不变
  output: "standalone",
  poweredByHeader: false,
  // 有 proxy 时 Next 16 会把请求体缓冲进内存供 proxy/路由重复读取，默认上限 10MB，
  // 超出部分被静默截断，导致大附件上传时 multipart 解析失败（upstream: vercel/next.js#85810）；
  // 附件上限 200MB，这里放宽到 256MB
  experimental: {
    proxyClientMaxBodySize: "256mb",
  },
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
