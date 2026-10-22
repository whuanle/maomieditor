"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileArchive, Trash2, TriangleAlert, X } from "lucide-react";
import { refreshTree } from "@/components/notes/notes-context";
import type { VaultBackupItem } from "@/lib/backup";
import { FormButton, FormMessage, SettingsGroup, SettingsRow } from "./settings-ui";

// 客户端只引用类型（import type 编译期擦除，不会把 node:fs 带进浏览器包）
type BackupItem = VaultBackupItem;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatTs(ts: number): string {
  const date = new Date(ts);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 备份设置：打包 docs 生成 zip（上限 5 份），支持下载/删除/上传全量恢复 */
export function BackupSection() {
  const router = useRouter();
  const [backups, setBackups] = useState<BackupItem[] | null>(null);
  const [max, setMax] = useState(5);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/backup", { cache: "no-store" });
      if (response.ok) {
        const data = (await response.json()) as { backups: BackupItem[]; max: number };
        setBackups(data.backups);
        setMax(data.max);
      }
    } catch {
      // 拉取失败保留上次结果
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const count = backups?.length ?? 0;
  const full = count >= max;

  async function create() {
    if (creating || full) {
      return;
    }
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create" }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "备份失败");
        return;
      }
      setSuccess("备份已创建");
      await refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setCreating(false);
    }
  }

  async function remove(name: string) {
    if (!window.confirm(`确定删除备份 ${name}？删除后不可恢复。`)) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", name }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "删除失败");
        return;
      }
      await refresh();
    } catch {
      setError("网络错误，请重试");
    }
  }

  function download(name: string) {
    const anchor = document.createElement("a");
    anchor.href = `/api/backup/download?name=${encodeURIComponent(name)}`;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function pickFile() {
    setRestoreSuccess(null);
    fileInputRef.current?.click();
  }

  /** 恢复提交：返回错误文案，成功返回 null（弹窗自行关闭并刷新工作台） */
  async function submitRestore(): Promise<string | null> {
    if (!pendingFile) {
      return "未选择文件";
    }
    const form = new FormData();
    form.append("file", pendingFile);
    try {
      const response = await fetch("/api/backup/restore", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { error?: string; noteFiles?: number };
      if (!response.ok) {
        return data.error ?? "恢复失败";
      }
      setRestoreSuccess(`恢复完成（${data.noteFiles ?? 0} 个笔记文件），当前内容已被备份内容覆盖`);
      await refresh();
      refreshTree(); // 侧边栏/标签栏的树
      router.refresh(); // 底层打开中的笔记页
      return null;
    } catch {
      return "网络错误，请重试";
    }
  }

  return (
    <div className="flex h-full max-w-3xl flex-col py-8 pl-8 pr-2">
      <div className="border-b border-[var(--border-default)] pr-8 pb-4">
        <h1 className="text-[17px] font-semibold text-[var(--text-heading)]">备份</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">
          把 docs 全部内容打包为 zip 压缩包，支持下载到本地与上传恢复。
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-8 pb-10">
        <SettingsGroup title="备份文件">
          <SettingsRow
            label="立即备份"
            description={`打包当前全部笔记、附件与回收站（上限 ${max} 份，满了需先删除旧备份）`}
          >
            <div className="flex items-center gap-3">
              <span className={`text-[13px] ${full ? "text-red-600 dark:text-red-400" : "text-[var(--text-tertiary)]"}`}>
                {backups === null ? "…" : `${count}/${max}`}
              </span>
              <FormButton
                onClick={() => void create()}
                disabled={creating || full || backups === null}
                title={full ? `已达 ${max} 份上限，请先删除旧备份` : undefined}
              >
                {creating ? "备份中…" : "立即备份"}
              </FormButton>
            </div>
          </SettingsRow>

          {backups === null ? (
            <p className="py-6 text-center text-[13px] text-[var(--text-tertiary)]">正在加载备份列表…</p>
          ) : (
            <div className="pt-3">
              <div className="overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)]">
                {backups.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[13px] text-[var(--text-tertiary)]">
                    暂无备份，点击「立即备份」生成第一份
                  </p>
                ) : (
                  <ul className="divide-y divide-[var(--border-faint,var(--border-default))]">
                    {backups.map((item) => (
                      <li
                        key={item.name}
                        className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--bg-hover)]"
                      >
                        <FileArchive className="h-5 w-5 shrink-0 text-[var(--text-tertiary)]" />
                        <div className="min-w-0 flex-1">
                          <p className="text-[15px] font-medium text-[var(--text-primary)]">{formatTs(item.ts)}</p>
                          <p className="mt-0.5 truncate text-[13px] text-[var(--text-tertiary)]" title={item.name}>
                            {formatSize(item.size)} · {item.name}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            title="下载备份"
                            aria-label={`下载 ${item.name}`}
                            onClick={() => download(item.name)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            title="删除备份"
                            aria-label={`删除 ${item.name}`}
                            onClick={() => void remove(item.name)}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 dark:hover:text-red-400"
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
          )}

          {(error || success) && (
            <div className="flex justify-end py-2">
              <FormMessage error={error} success={success} />
            </div>
          )}
        </SettingsGroup>

        <SettingsGroup title="上传恢复">
          <p className="pr-1 pb-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
            上传此前下载的备份压缩包，将全量覆盖当前的笔记、附件与回收站；恢复完成后工作台自动刷新。
          </p>
          <SettingsRow label="从备份恢复" description="选择 zip 备份文件，确认后覆盖现有全部内容">
            <FormButton onClick={pickFile}>选择文件…</FormButton>
          </SettingsRow>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = ""; // 允许再次选择同一文件
              if (file) {
                setRestoreSuccess(null);
                setPendingFile(file);
              }
            }}
          />
          {restoreSuccess && (
            <div className="flex justify-end py-2">
              <FormMessage success={restoreSuccess} />
            </div>
          )}
        </SettingsGroup>
      </div>

      {pendingFile && (
        <RestoreDialog
          file={pendingFile}
          onClose={() => setPendingFile(null)}
          onSubmit={submitRestore}
        />
      )}
    </div>
  );
}

/**
 * 恢复确认弹窗：危险操作两步确认——
 * 第一步展示所选文件并提醒将覆盖全部内容，第二步红色警示终确认，之后才真正覆盖
 */
function RestoreDialog({
  file,
  onSubmit,
  onClose,
}: {
  file: File;
  onSubmit: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (busy) {
          return;
        }
        // 第二步 Esc 返回上一步，第一步才关闭
        if (step === 2) {
          setError(null);
          setStep(1);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, step, onClose]);

  async function submit() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await onSubmit();
      if (message) {
        setError(message);
        setStep(1); // 失败回到第一步，让用户能换文件或放弃
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="从备份恢复"
      onClick={() => {
        if (!busy) {
          onClose();
        }
      }}
    >
      <div className="dialog-panel w-full max-w-sm p-5" onClick={(event) => event.stopPropagation()}>
        {step === 1 ? (
          <>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-[var(--text-heading)]">从备份恢复</h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 truncate text-[13px] text-[var(--text-secondary)]" title={file.name}>
              {file.name}（{formatSize(file.size)}）
            </p>
            <div className="mt-3 flex gap-2.5 rounded-md border border-red-300 bg-red-50 px-3 py-2.5 dark:border-red-900 dark:bg-red-950">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <p className="text-[13px] leading-relaxed text-red-600 dark:text-red-400">
                恢复将删除并替换当前全部笔记、附件与回收站内容，此操作不可撤销。建议先「立即备份」一份当前状态。
              </p>
            </div>
            {error && (
              <div className="flex justify-end pt-2">
                <FormMessage error={error} />
              </div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <FormButton onClick={onClose} disabled={busy}>
                取消
              </FormButton>
              <FormButton danger onClick={() => setStep(2)} disabled={busy}>
                继续
              </FormButton>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-center pt-2">
              <TriangleAlert className="h-10 w-10 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="mt-3 text-center text-[15px] font-semibold text-[var(--text-heading)]">
              确认覆盖全部内容？
            </h2>
            <p className="mt-2 text-center text-[13px] leading-relaxed text-[var(--text-secondary)]">
              现有全部笔记、附件与回收站将被备份内容整体替换，
              <span className="font-medium text-red-600 dark:text-red-400">操作完成后无法撤销</span>
              。请谨慎操作。
            </p>
            {error && (
              <div className="flex justify-end pt-2">
                <FormMessage error={error} />
              </div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <FormButton onClick={() => setStep(1)} disabled={busy}>
                返回
              </FormButton>
              <FormButton danger onClick={() => void submit()} disabled={busy}>
                {busy ? "恢复中…" : "确定覆盖"}
              </FormButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
