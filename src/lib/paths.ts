import path from "node:path";

/** 所有笔记与上传文件都存放于项目根目录的 docs/ 下 */
export const DOCS_ROOT = path.join(process.cwd(), "docs");

/**
 * 把 URL 风格的相对路径（posix, 可能带中文与扩展名）安全解析为 docs 内的绝对路径。
 * 空字符串表示 docs 根目录。拒绝绝对路径、盘符与 `..` 穿越，保证最终路径仍在 docs 内。
 */
export function resolveDocsPath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized === "") {
    return DOCS_ROOT;
  }
  if (normalized.includes("\0")) {
    return null;
  }

  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return DOCS_ROOT;
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  const absolute = path.resolve(DOCS_ROOT, ...segments);
  const rootWithSep = DOCS_ROOT.endsWith(path.sep) ? DOCS_ROOT : DOCS_ROOT + path.sep;
  if (absolute !== DOCS_ROOT && !absolute.startsWith(rootWithSep)) {
    return null;
  }

  return absolute;
}

/** docs 内绝对路径 → 相对 docs 根的 posix 路径（用于 URL 与树节点） */
export function toRelativeDocsPath(absolutePath: string): string {
  return path.relative(DOCS_ROOT, absolutePath).split(path.sep).join("/");
}

/** 清理文件/文件夹名里的非法字符（Windows 保留字符与控制符） */
export function sanitizeName(name: string): string | null {
  const cleaned = name
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return null;
  }
  return cleaned;
}

export function isMarkdownFile(name: string): boolean {
  return /\.mdx?$/i.test(name);
}

/** 供下载的 Content-Type 兜底表（覆盖常见笔记附件类型） */
const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".xml": "application/xml",
  ".csv": "text/csv",
  ".yml": "text/yaml",
  ".yaml": "text/yaml",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".md": "text/markdown; charset=utf-8",
  ".mdx": "text/markdown; charset=utf-8",
};

export function guessMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}
