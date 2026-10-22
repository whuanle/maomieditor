# syntax=docker/dockerfile:1

# ---------- 依赖安装：bun（与本地 bun.lock 一致） ----------
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---------- 构建：Node 跑 next build，产出 .next/standalone ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 生成 Vditor 本地静态资源：public/vendor 在 git/dockerignore 中被排除，
# 必须在镜像内从 node_modules/vditor 同步，否则线上编辑器加载 cdn 资源 404
RUN node scripts/sync-vditor-assets.mjs
RUN node node_modules/next/dist/bin/next build

# ---------- 运行：最小镜像 + git（docs 内 git 版本管理需要） ----------
FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache git

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

# 非 root 运行（uid/gid 1001；挂载 bind 目录时宿主侧需 chown 1001）
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# standalone 产物：server.js + 追踪到的最小 node_modules
COPY --from=builder /app/.next/standalone ./
# 静态资源与 public 不在 standalone 内，需单独放回
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 运行时可写目录：笔记与上传（docs/）、状态与备份（.data/）
RUN mkdir -p docs .data && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT:-3000}/login" || exit 1

CMD ["node", "server.js"]
