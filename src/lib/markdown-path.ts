import path from "node:path";

/**
 * 笔记内容里相对资源/链接的解析规则：
 * - 图片、视频、附件 → `{assetBase}/{笔记所在目录}/{相对路径}`（由 files API 提供，支持 ?download=1）
 * - .md/.mdx 链接 → `/notes/{解析后的笔记路径}`（笔记 URL 保留扩展名）
 */

const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;

/**
 * 本地兼容的附件相对引用：md 位于 docs/notes/{shard}/，blob 位于 docs/files/{shard}/，
 * 所以 `../../files/{2hex}/{12hex}.{ext}` 在本地编辑器里直接可解析；
 * Web 渲染时按附件 ID 还原成 /api/attachments/{id}（分享页为其公开变体）。
 */
const BLOB_REL_RE = /^(?:\.\.\/)+files\/[0-9a-f]{2}\/([0-9a-f]{12})(?:\.[a-z0-9]+)?$/i;

function matchBlobRef(src: string): string | null {
  const trimmed = src.trim();
  const match = trimmed.match(BLOB_REL_RE);
  return match ? match[1] : null;
}

function toPosix(value: string): string {
  return value.replace(/\\/g, "/");
}

/** 笔记相对路径（含扩展名）→ 笔记所在目录的 posix 相对路径，"" 表示 docs 根 */
export function noteDirOf(notePath: string): string {
  const posix = toPosix(notePath);
  const dir = path.posix.dirname(posix);
  return dir === "." || dir === "/" ? "" : dir;
}

/** 相对资源 src → 附件 API 的 URL；外链/根路径/锚点原样返回 */
export function resolveAssetSrc(src: string, assetBase: string, notePath: string): string {
  const trimmed = src.trim();
  if (EXTERNAL_RE.test(trimmed)) {
    return trimmed;
  }
  const blobId = matchBlobRef(trimmed);
  if (blobId) {
    return `${assetBase}/${blobId}`;
  }
  const dir = noteDirOf(notePath);
  const resolved = path.posix.normalize(path.posix.join(dir, toPosix(trimmed)));
  return `${assetBase}/${encodeAssetPath(resolved)}`;
}

/**
 * .md/.mdx 相对链接 → /notes 路由；非笔记链接（附件）→ 附件 API 下载地址。
 * 返回 null 表示不是需要重写的相对链接。
 */
export function resolveNoteHref(
  href: string,
  assetBase: string,
  notePath: string
): { kind: "note"; url: string } | { kind: "asset"; url: string } | null {
  const trimmed = href.trim();
  if (EXTERNAL_RE.test(trimmed)) {
    return null;
  }

  const blobId = matchBlobRef(trimmed);
  if (blobId) {
    return { kind: "asset", url: `${assetBase}/${blobId}?download=1` };
  }

  const match = toPosix(trimmed).match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  const relativePath = match?.[1] ?? trimmed;
  const hash = match?.[3] ?? "";
  const dir = noteDirOf(notePath);

  if (/\.mdx?$/i.test(relativePath)) {
    const resolved = path.posix.normalize(path.posix.join(dir, relativePath));
    return { kind: "note", url: `/notes/${encodeAssetPath(resolved)}${hash}` };
  }

  if (!relativePath) {
    return null;
  }

  const resolvedAsset = path.posix.normalize(path.posix.join(dir, toPosix(relativePath)));
  return { kind: "asset", url: `${assetBase}/${encodeAssetPath(resolvedAsset)}?download=1` };
}

export function encodeAssetPath(assetPath: string): string {
  return assetPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}
