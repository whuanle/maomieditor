/**
 * 同步 Vditor 本地静态资源到 public/vendor/vditor/dist。
 *
 * Vditor 的 markdown 引擎（lute WASM）、mermaid、katex、代码高亮均按需从
 * options.cdn 加载（默认 unpkg 外网）。本地笔记应用离线可用，资源走 public：
 *   rich-editor.tsx 里 cdn = "/vendor/vditor"，加载路径为 /vendor/vditor/dist/...
 *
 * 只复制本项目用到的子集（阅读视图不渲染 echarts/mindmap/graphviz 等）。
 * 依赖升级后重跑：bun scripts/sync-vditor-assets.mjs
 */

import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "vditor", "dist");
const target = join(root, "public", "vendor", "vditor", "dist");

if (!existsSync(source)) {
  console.error("未找到 node_modules/vditor/dist，请先安装依赖：bun install");
  process.exit(1);
}

/** js 子目录：lute 必需；mermaid/katex/highlight.js 对应笔记里的图表、公式、代码块；i18n/icons 编辑器界面 */
const JS_DIRS = ["lute", "highlight.js", "mermaid", "katex", "i18n", "icons"];
/** css：content-theme 为 IR/预览内容主题；images：emoji 等静态图 */
const TOP_DIRS = ["css", "images"];

await rm(target, { recursive: true, force: true });
await mkdir(join(target, "js"), { recursive: true });

for (const dir of JS_DIRS) {
  await cp(join(source, "js", dir), join(target, "js", dir), { recursive: true });
}
for (const dir of TOP_DIRS) {
  await cp(join(source, dir), join(target, dir), { recursive: true });
}

console.log(`Vditor 资源已同步到 ${target}`);
