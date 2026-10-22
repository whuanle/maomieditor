"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Eye, RotateCcw, Trash2, X } from "lucide-react";
import { refreshTree } from "./sidebar";

interface VersionItem {
  ts: number;
  size: number;
}

interface VersionDialogProps {
  noteId: string;
  noteTitle: string;
  onClose: () => void;
  /** 备份前把编辑中的草稿落盘，保证快照与所见内容一致（阅读视图没有草稿，不传）；返回是否保存成功 */
  onFlushDraft?: () => Promise<boolean>;
}

/** 历史版本：备份快照文件（{noteId}_delete_{时间}.md 与笔记同目录）的列表，支持备份 / 标签页预览 / 恢复 / 删除。恢复前当前内容会自动先备份。 */
export function VersionDialog({ noteId, noteTitle, onClose, onFlushDraft }: VersionDialogProps) {
  const router = useRouter();
  const [versions, setVersions] = useState<VersionItem[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/versions?noteId=${noteId}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "加载失败");
        setVersions([]);
        return;
      }
      setVersions(data.versions ?? []);
    } catch {
      setError("网络错误");
      setVersions([]);
    }
  }, [noteId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(payload: Record<string, unknown>, confirmMessage?: string): Promise<Record<string, unknown> | null> {
    if (busy) {
      return null;
    }
    if (confirmMessage && !window.confirm(confirmMessage)) {
      return null;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId, ...payload }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        window.alert((data as { error?: string }).error ?? "操作失败");
        return null;
      }
      await load();
      // 只有恢复会改动笔记内容（可能影响侧边栏的兜底标题和服务端渲染），备份/删除只动备份文件
      if (payload.action === "restore") {
        refreshTree();
        router.refresh();
      }
      return data as Record<string, unknown>;
    } catch {
      window.alert("网络错误");
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** 备份当前内容；编辑态下先把未保存草稿落盘，快照的才是用户看到的内容 */
  async function handleBackup() {
    if (busy) {
      return;
    }
    if (onFlushDraft) {
      const ok = await onFlushDraft();
      if (!ok && !window.confirm("当前草稿保存失败，仍要备份上一次已保存的内容？")) {
        return;
      }
    }
    const data = await post({ action: "backup" });
    if (data && data.skipped === true) {
      setNotice("内容与最近一次备份相同，未创建新文件");
      setTimeout(() => setNotice(""), 3000);
    }
  }

  /** 在标签页里以只读模式预览该版本 */
  function openPreview(ts: number) {
    onClose();
    router.push(`/notes/${noteId}?v=${ts}`);
  }

  return (
    <div className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="dialog-panel flex max-h-[80vh] w-full max-w-2xl flex-col p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-heading)]">「{noteTitle}」的历史版本</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleBackup()}
              className="docs-button"
              title="把当前内容备份为一个新版本"
            >
              <Archive className="h-3.5 w-3.5" />
              备份当前内容
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <p className="mb-3 text-xs text-[var(--text-tertiary)]">
          版本是笔记同目录下的快照文件（{noteId}_delete_时间.md），可随笔记一起用 git 管理。自动保存不产生版本，点「备份当前内容」手动创建快照；恢复前当前内容会先自动备份一份。
        </p>
        {notice && (
          <p className="mb-3 rounded-md bg-[var(--accent-50)] px-3 py-2 text-xs text-[var(--accent-600)]">{notice}</p>
        )}

        {versions === null ? (
          <p className="py-6 text-center text-sm text-[var(--text-tertiary)]">加载中...</p>
        ) : error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        ) : versions.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--text-tertiary)]">
            还没有备份过版本，点右上「备份当前内容」创建第一份快照
          </p>
        ) : (
          <ul className="-mr-2 max-h-96 flex-1 space-y-1 overflow-y-auto pr-2">
            {versions.map((version) => (
              <li key={version.ts} className="rounded-md px-2 py-2 hover:bg-[var(--bg-hover)]">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {new Date(version.ts).toLocaleString("zh-CN")}
                    </p>
                    <p className="text-[11px] text-[var(--text-tertiary)]">
                      {(version.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openPreview(version.ts)}
                    className="shrink-0 rounded-md p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                    title="在标签页预览该版本"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void post(
                        { action: "restore", ts: version.ts },
                        `恢复到 ${new Date(version.ts).toLocaleString("zh-CN")} 的版本？当前内容会先自动备份。`
                      )
                    }
                    className="shrink-0 rounded-md p-1.5 text-[var(--accent-600)] transition-colors hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                    title="恢复到此版本"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void post({ action: "delete", ts: version.ts })}
                    className="shrink-0 rounded-md p-1.5 text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950"
                    title="删除该版本"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
