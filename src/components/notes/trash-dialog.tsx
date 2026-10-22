"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { refreshTree } from "./sidebar";

interface TrashItem {
  id: string;
  format: "md" | "mdx";
  title: string;
  deletedAt: string;
  parentId: string | null;
  parentTitle: string | null;
  childCount: number;
}

interface TrashDialogProps {
  onClose: () => void;
}

/** 回收站：恢复到原位置（父级已不存在则挂到根级）/ 彻底删除 / 清空 */
export function TrashDialog({ onClose }: TrashDialogProps) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/trash", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "加载失败");
        setItems([]);
        return;
      }
      setItems(data.items ?? []);
    } catch {
      setError("网络错误");
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(payload: Record<string, unknown>, confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) {
      return;
    }
    const response = await fetch("/api/trash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert((data as { error?: string }).error ?? "操作失败");
      return;
    }
    refreshTree();
    await load();
  }

  return (
    <div className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="dialog-panel flex max-h-[80vh] w-full max-w-lg flex-col p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-heading)]">回收站</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-xs text-[var(--text-tertiary)]">
          删除的笔记会保留原位置信息，恢复时自动回到原处（父级已不存在则挂到根级）。
        </p>

        {items === null ? (
          <p className="py-6 text-center text-sm text-[var(--text-tertiary)]">加载中...</p>
        ) : error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">回收站是空的</p>
        ) : (
          <ul className="-mr-2 max-h-96 flex-1 space-y-1 overflow-y-auto pr-2">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-[var(--bg-hover)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {item.title}
                    {item.childCount > 0 && (
                      <span className="ml-1 text-[11px] font-normal text-[var(--text-tertiary)]">
                        （含 {item.childCount} 篇子笔记）
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-[var(--text-tertiary)]">
                    原位置：{item.parentTitle ?? "根级"} · 删除于{" "}
                    {item.deletedAt ? new Date(item.deletedAt).toLocaleString("zh-CN") : "未知时间"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void post({ action: "restore", id: item.id })}
                  className="shrink-0 rounded-md p-1.5 text-[var(--accent-600)] transition-colors hover:bg-[var(--bg-secondary)]"
                  title="恢复到原位置"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void post(
                      { action: "purge", id: item.id },
                      `彻底删除「${item.title}」及其子笔记？此操作不可恢复。`
                    )
                  }
                  className="shrink-0 rounded-md p-1.5 text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950"
                  title="彻底删除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {items !== null && items.length > 0 && (
          <div className="mt-4 flex justify-end border-t border-[var(--border-default)] pt-3">
            <button
              type="button"
              onClick={() => void post({ action: "empty" }, "清空回收站？其中的笔记将被彻底删除，不可恢复。")}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            >
              清空回收站
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
