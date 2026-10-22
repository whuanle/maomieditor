"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, RotateCcw, X } from "lucide-react";
import { refreshTree } from "./sidebar";
import { TocToggleButton } from "./toc-sidebar";

interface TrashPreviewToolbarProps {
  noteId: string;
  title: string;
  icon: string;
  deletedAt: string;
}

/** 回收站预览态工具栏：内容只读不可编辑，可恢复到原位置或关闭预览 */
export function TrashPreviewToolbar({ noteId, title, icon, deletedAt }: TrashPreviewToolbarProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const time = deletedAt ? new Date(deletedAt).toLocaleString("zh-CN") : "未知时间";

  async function restore() {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", id: noteId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        window.alert((data as { error?: string }).error ?? "恢复失败");
        return;
      }
      refreshTree();
      router.replace(`/notes/${noteId}`);
    } catch {
      window.alert("网络错误");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--border-default)] bg-[var(--accent-50)] px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Archive className="mr-1 h-4 w-4 shrink-0 text-[var(--accent-600)]" />
        <span className="truncate text-[15px] font-semibold text-[var(--text-heading)]">
          {icon ? `${icon} ` : ""}
          {title}
        </span>
        <span className="ml-2 shrink-0 rounded bg-[var(--accent-100)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-600)]">
          回收站 · 删除于 {time} · 只读
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void restore()}
          className="docs-button"
          title="笔记及其回收站内的子笔记回到原位置（父级已不存在则挂到根级）"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          恢复到原位置
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="docs-button"
          title="关闭预览，返回之前的页面"
        >
          <X className="h-3.5 w-3.5" />
          关闭预览
        </button>
        <TocToggleButton />
      </div>
    </div>
  );
}
