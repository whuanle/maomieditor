"use client";

import { useEffect, useState } from "react";
import { Copy, Link2, Trash2, X } from "lucide-react";

interface ShareEntry {
  token: string;
  noteId: string;
  noteTitle: string;
  createdAt: string;
  expiresAt: string | null;
}

interface ShareDialogProps {
  noteId: string;
  noteTitle: string;
  onClose: () => void;
}

export function ShareDialog({ noteId, noteTitle, onClose }: ShareDialogProps) {
  const [share, setShare] = useState<ShareEntry | null>(null);
  const [allShares, setAllShares] = useState<ShareEntry[]>([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        // 先创建/复用本笔记的分享，再拉全量列表
        const createResponse = await fetch("/api/shares", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: noteId }),
        });
        const createData = await createResponse.json();
        if (!createResponse.ok) {
          if (!cancelled) {
            setError(createData.error ?? "创建分享失败");
            setLoading(false);
          }
          return;
        }

        const listResponse = await fetch("/api/shares", { cache: "no-store" });
        const listData = await listResponse.json();
        if (!cancelled) {
          setShare(createData.share);
          setAllShares(listResponse.ok ? (listData.shares ?? []) : []);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("网络错误");
          setLoading(false);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  async function revoke(token: string) {
    if (!window.confirm("撤销该分享链接？已发出的链接将立即失效。")) {
      return;
    }
    const response = await fetch(`/api/shares?token=${encodeURIComponent(token)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      return;
    }
    setAllShares((prev) => prev.filter((item) => item.token !== token));
    if (share?.token === token) {
      setShare(null);
    }
  }

  async function copyLink(token: string) {
    const url = `${window.location.origin}/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("复制分享链接：", url);
    }
  }

  const shareUrl = share ? `${typeof window === "undefined" ? "" : window.location.origin}/share/${share.token}` : "";

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="dialog-panel w-full max-w-lg p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-heading)]">分享「{noteTitle}」</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading && <p className="py-6 text-center text-sm text-[var(--text-tertiary)]">生成中...</p>}

        {error && !loading && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        {!loading && !error && share && (
          <div className="mb-5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <Link2 className="h-3.5 w-3.5" />
              任何拿到此链接的人都能阅读这篇笔记（无需登录）
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(event) => event.target.select()}
                className="min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)]"
              />
              <button
                type="button"
                onClick={() => void copyLink(share.token)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent-600)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? "已复制" : "复制链接"}
              </button>
            </div>
          </div>
        )}

        {!loading && allShares.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">全部分享链接</p>
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {allShares.map((item) => (
                <li
                  key={item.token}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-[var(--text-primary)]">
                      {item.noteTitle}
                    </p>
                    <p className="truncate text-[11px] text-[var(--text-tertiary)]">
                      {item.noteId} · {new Date(item.createdAt).toLocaleString("zh-CN")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyLink(item.token)}
                    className="shrink-0 rounded-md p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                    title="复制链接"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void revoke(item.token)}
                    className="shrink-0 rounded-md p-1.5 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950"
                    title="撤销分享"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
