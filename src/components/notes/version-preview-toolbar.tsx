"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { History, RotateCcw, X } from "lucide-react";
import { refreshTree } from "./sidebar";
import { TocToggleButton } from "./toc-sidebar";

interface VersionPreviewToolbarProps {
  noteId: string;
  title: string;
  icon: string;
  ts: number;
}

/** 历史版本预览态工具栏：内容只读不可编辑，可恢复该版本或返回当前版本 */
export function VersionPreviewToolbar({ noteId, title, icon, ts }: VersionPreviewToolbarProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const time = new Date(ts).toLocaleString("zh-CN");

  async function restore() {
    if (busy) {
      return;
    }
    if (!window.confirm(`恢复到 ${time} 的版本？当前内容会先自动备份。`)) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId, action: "restore", ts }),
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
        <History className="mr-1 h-4 w-4 shrink-0 text-[var(--accent-600)]" />
        <span className="truncate text-[15px] font-semibold text-[var(--text-heading)]">
          {icon ? `${icon} ` : ""}
          {title}
        </span>
        <span className="ml-2 shrink-0 rounded bg-[var(--accent-100)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent-600)]">
          历史版本 · {time} · 只读
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void restore()}
          className="docs-button"
          title="用该版本内容替换当前主文件（当前内容会先自动备份）"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          恢复此版本
        </button>
        <button
          type="button"
          onClick={() => router.push(`/notes/${noteId}`)}
          className="docs-button"
          title="回到当前版本"
        >
          <X className="h-3.5 w-3.5" />
          返回当前版本
        </button>
        <TocToggleButton />
      </div>
    </div>
  );
}
