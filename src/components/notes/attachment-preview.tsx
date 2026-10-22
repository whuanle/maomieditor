"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import {
  Download,
  ExternalLink,
  File,
  FileAudio,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Image as FileImage,
  Loader2,
  X,
} from "lucide-react";

/**
 * 附件在线预览：全局单例弹窗，通过 notes:preview-attachment 事件打开
 * （与 notes:tree-refresh 同款事件模式），侧边栏附件节点、正文附件链接共用。
 *
 * 预览全部走既有 /api/attachments/{id}（cookie 鉴权 + 笔记保护检查随路由生效）：
 * - 图片 / PDF / 音视频：浏览器原生能力，零依赖
 * - xlsx/xls/csv：动态 import SheetJS 懒加载解析，渲染只读表格
 * - 纯文本：Range 截取前 2MB 渲染
 * - 其余格式：提示下载
 */

export interface PreviewAttachment {
  id: string;
  name: string;
  size?: number;
  mime?: string;
}

const PREVIEW_EVENT = "notes:preview-attachment";

/** 打开附件预览弹窗 */
export function openAttachmentPreview(attachment: PreviewAttachment) {
  window.dispatchEvent(new CustomEvent<PreviewAttachment>(PREVIEW_EVENT, { detail: attachment }));
}

/** 从附件 URL（/api/attachments/{id} 或 /files/{分桶}/{id}.{ext}）提取附件 ID */
function attachmentIdFromUrl(url: string): string | null {
  const segment = url.split("?")[0].split("/").pop() ?? "";
  const match = segment.match(/^([0-9a-f]{12})(?:\.[a-z0-9]+)?$/i);
  return match ? match[1] : null;
}

/** 从正文里的附件链接 URL 打开预览；无法识别为附件 ID 时返回 false，调用方保留默认行为 */
export function openAttachmentPreviewFromUrl(url: string, name?: string): boolean {
  const id = attachmentIdFromUrl(url);
  if (!id) return false;
  openAttachmentPreview({ id, name: name?.trim() || id });
  return true;
}

type PreviewKind = "image" | "pdf" | "video" | "audio" | "sheet" | "text" | "other";

const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "m4v", "mkv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"]);
const SHEET_EXTS = new Set(["xlsx", "xls", "xlsm", "csv"]);
const TEXT_EXTS = new Set([
  "txt", "md", "mdx", "json", "log", "yml", "yaml", "xml", "html", "htm", "css", "js", "mjs",
  "ts", "tsx", "jsx", "py", "sh", "bat", "ps1", "ini", "conf", "toml", "sql", "env",
]);

function detectKind(name: string, mime?: string): PreviewKind {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  if (mime?.startsWith("image/")) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime?.startsWith("video/") || VIDEO_EXTS.has(ext)) return "video";
  if (mime?.startsWith("audio/") || AUDIO_EXTS.has(ext)) return "audio";
  if (
    mime === "application/vnd.ms-excel" ||
    mime === "text/csv" ||
    mime?.includes("spreadsheetml") ||
    SHEET_EXTS.has(ext)
  ) {
    return "sheet";
  }
  if (mime?.startsWith("text/") || mime === "application/json" || TEXT_EXTS.has(ext)) return "text";
  return "other";
}

function kindLabel(kind: PreviewKind): string {
  switch (kind) {
    case "image": return "图片";
    case "pdf": return "PDF";
    case "video": return "视频";
    case "audio": return "音频";
    case "sheet": return "表格";
    case "text": return "文本";
    default: return "文件";
  }
}

function kindIcon(kind: PreviewKind, className: string): ReactElement {
  switch (kind) {
    case "image": return <FileImage className={className} />;
    case "sheet": return <FileSpreadsheet className={className} />;
    case "video": return <FileVideo className={className} />;
    case "audio": return <FileAudio className={className} />;
    case "pdf":
    case "text": return <FileText className={className} />;
    default: return <File className={className} />;
  }
}

function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function httpError(status: number): string {
  if (status === 401) return "登录状态已失效，请重新登录";
  if (status === 403) return "没有权限访问该附件（所属笔记可能已锁定）";
  if (status === 404) return "附件不存在或已被删除";
  return `加载失败（HTTP ${status}）`;
}

/** 工作区常驻的预览弹窗宿主，挂载一份即可（NotesShell） */
export function AttachmentPreviewHost() {
  const [attachment, setAttachment] = useState<PreviewAttachment | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<PreviewAttachment>).detail;
      if (detail && typeof detail.id === "string" && detail.id) {
        setAttachment({ id: detail.id, name: detail.name || detail.id, size: detail.size, mime: detail.mime });
      }
    };
    window.addEventListener(PREVIEW_EVENT, handler);
    return () => window.removeEventListener(PREVIEW_EVENT, handler);
  }, []);

  if (!attachment) return null;
  return <AttachmentPreviewDialog key={attachment.id} attachment={attachment} onClose={() => setAttachment(null)} />;
}

function AttachmentPreviewDialog({ attachment, onClose }: { attachment: PreviewAttachment; onClose: () => void }) {
  // mime 未知且扩展名也认不出时，Range 取 1 字节探测 Content-Type（顺带从 Content-Range 拿总大小）
  const needsProbe = !attachment.mime && detectKind(attachment.name) === "other";
  const [probe, setProbe] = useState<{ mime?: string; size?: number } | null>(null);

  const kind = detectKind(attachment.name, attachment.mime ?? probe?.mime);
  const size = attachment.size ?? probe?.size;
  const url = `/api/attachments/${attachment.id}`;
  const downloadUrl = `${url}?download=1`;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!needsProbe) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
        const contentType = res.headers.get("content-type")?.split(";")[0];
        const total = res.headers.get("content-range")?.split("/")[1];
        if (cancelled) return;
        setProbe({
          mime: contentType || undefined,
          size: total && Number.isFinite(Number(total)) ? Number(total) : undefined,
        });
      } catch {
        if (!cancelled) setProbe({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsProbe, url]);

  return (
    <div className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4 md:p-10" onClick={onClose}>
      <section
        role="dialog"
        aria-label={`预览 ${attachment.name}`}
        className="dialog-panel flex h-full w-full max-w-6xl flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border-default)] px-4 py-3">
          {kindIcon(kind, "h-5 w-5 shrink-0 text-[var(--text-tertiary)]")}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-[var(--text-heading)]" title={attachment.name}>
                {attachment.name}
              </h2>
              <span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
                {kindLabel(kind)}
              </span>
            </div>
            {size ? <p className="text-xs text-[var(--text-tertiary)]">{formatSize(size)}</p> : null}
          </div>
          <a href={downloadUrl} download className="docs-button shrink-0">
            <Download className="h-4 w-4" />
            下载
          </a>
          <button type="button" className="docs-button shrink-0" onClick={() => window.open(url, "_blank")}>
            <ExternalLink className="h-4 w-4" />
            新窗口
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          {needsProbe && !probe ? (
            <CenterMessage>
              <Spinner />
            </CenterMessage>
          ) : (
            <>
              {kind === "image" && <ImagePreview url={url} name={attachment.name} downloadUrl={downloadUrl} />}
              {kind === "pdf" && <iframe src={url} title={attachment.name} className="h-full w-full flex-1 bg-white" />}
              {kind === "video" && (
                <div className="flex flex-1 items-center justify-center p-4">
                  <video controls preload="metadata" src={url} className="max-h-full max-w-full" />
                </div>
              )}
              {kind === "audio" && (
                <div className="flex flex-1 items-center justify-center p-4">
                  <audio controls preload="metadata" src={url} className="w-full max-w-md" />
                </div>
              )}
              {kind === "sheet" && <SheetPreview url={url} />}
              {kind === "text" && <TextPreview url={url} />}
              {kind === "other" && <UnsupportedPreview downloadUrl={downloadUrl} />}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function CenterMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[var(--text-secondary)]">
      {children}
    </div>
  );
}

function Spinner() {
  return <Loader2 className="h-6 w-6 animate-spin text-[var(--text-tertiary)]" />;
}

function ImagePreview({ url, name, downloadUrl }: { url: string; name: string; downloadUrl: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <UnsupportedPreview downloadUrl={downloadUrl} hint="该图片格式浏览器无法解码" />;
  }
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto bg-[var(--bg-secondary)] p-4">
      <img src={url} alt={name} className="max-h-full max-w-full object-contain" onError={() => setFailed(true)} />
    </div>
  );
}

const MAX_ROWS = 2000;
const MAX_COLS = 100;
const TEXT_LIMIT = 2 * 1024 * 1024;

interface SheetData {
  name: string;
  rows: string[][];
  cols: number;
  totalRows: number;
  totalCols: number;
}

function SheetPreview({ url }: { url: string }) {
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // SheetJS 仅在实际预览表格时才会被下载（独立懒加载 chunk）
        const [res, XLSX] = await Promise.all([fetch(url), import("xlsx")]);
        if (!res.ok) throw new Error(httpError(res.status));
        const workbook = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array" });
        const parsed = workbook.SheetNames.map((sheetName): SheetData => {
          const all = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
            header: 1,
            raw: false,
            defval: "",
          });
          let totalCols = 0;
          for (const row of all) {
            if (row.length > totalCols) totalCols = row.length;
          }
          return {
            name: sheetName,
            rows: all.slice(0, MAX_ROWS).map((row) =>
              row.slice(0, MAX_COLS).map((cell) => (cell === null || cell === undefined ? "" : String(cell))),
            ),
            cols: Math.min(MAX_COLS, totalCols),
            totalRows: all.length,
            totalCols,
          };
        });
        if (!cancelled) setSheets(parsed);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "无法解析该表格文件");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <CenterMessage>
        <p>{error}</p>
      </CenterMessage>
    );
  }
  if (!sheets) {
    return (
      <CenterMessage>
        <Spinner />
      </CenterMessage>
    );
  }
  if (sheets.length === 0) {
    return (
      <CenterMessage>
        <p>该表格没有工作表</p>
      </CenterMessage>
    );
  }

  const sheet = sheets[Math.min(active, sheets.length - 1)];
  const truncated = sheet.totalRows > MAX_ROWS || sheet.totalCols > MAX_COLS;
  return (
    <>
      {sheets.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-default)] px-2 pt-2">
          {sheets.map((item, index) => (
            <button
              key={item.name}
              type="button"
              onClick={() => setActive(index)}
              className={`whitespace-nowrap rounded-t-md px-3 py-1.5 text-xs transition-colors ${
                index === active
                  ? "bg-[var(--bg-hover)] font-medium text-[var(--text-heading)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {sheet.rows.length === 0 || sheet.cols === 0 ? (
          <CenterMessage>
            <p>空工作表</p>
          </CenterMessage>
        ) : (
          <table className="preview-table">
            <thead>
              <tr>
                <th className="row-num" />
                {Array.from({ length: sheet.cols }, (_, c) => (
                  <th key={c}>{colLabel(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r}>
                  <td className="row-num">{r + 1}</td>
                  {Array.from({ length: sheet.cols }, (_, c) => (
                    <td key={c} title={row[c] ?? ""}>
                      {row[c] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {truncated && (
        <p className="shrink-0 border-t border-[var(--border-default)] px-4 py-2 text-xs text-[var(--text-tertiary)]">
          仅显示前 {MAX_ROWS} 行 / {MAX_COLS} 列（共 {sheet.totalRows} 行、{sheet.totalCols} 列），完整内容请下载查看
        </p>
      )}
    </>
  );
}

/** 0→A、25→Z、26→AA 的 Excel 列号 */
function colLabel(index: number): string {
  let label = "";
  let n = index;
  while (n >= 0) {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // 大文件只取前 2MB，避免整段塞进 DOM
        const res = await fetch(url, { headers: { Range: `bytes=0-${TEXT_LIMIT - 1}` } });
        if (!res.ok && res.status !== 206) throw new Error(httpError(res.status));
        const content = await res.text();
        if (cancelled) return;
        setTruncated(res.status === 206);
        setText(content);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "无法加载该文件");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <CenterMessage>
        <p>{error}</p>
      </CenterMessage>
    );
  }
  if (text === null) {
    return (
      <CenterMessage>
        <Spinner />
      </CenterMessage>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <pre className="preview-text">{text}</pre>
      {truncated && (
        <p className="mt-3 text-xs text-[var(--text-tertiary)]">文件较大，仅加载前 2MB 内容，完整内容请下载查看</p>
      )}
    </div>
  );
}

function UnsupportedPreview({ downloadUrl, hint }: { downloadUrl: string; hint?: string }) {
  return (
    <CenterMessage>
      <File className="h-8 w-8 text-[var(--text-tertiary)]" />
      <p>{hint ?? "该格式暂不支持在线预览，可下载后查看"}</p>
      <a href={downloadUrl} download className="docs-button border border-[var(--border-default)]">
        <Download className="h-4 w-4" />
        下载文件
      </a>
    </CenterMessage>
  );
}
