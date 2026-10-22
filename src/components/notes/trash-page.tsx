"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, RotateCcw, Search, Trash2, X } from "lucide-react";
import { refreshTree } from "./notes-context";

interface TrashItem {
  id: string;
  format: "md" | "mdx";
  title: string;
  deletedAt: string;
  parentId: string | null;
  parentTitle: string | null;
  childCount: number;
}

interface TrashPageProps {
  onClose: () => void;
}

/** 两段式点击确认按钮：第一次点击进入待确认态（红色实心），再次点击才执行；6 秒无操作自动取消 */
function DangerConfirmButton({
  armed,
  busy,
  label,
  confirmLabel,
  title,
  onArm,
  onRun,
}: {
  armed: boolean;
  busy: boolean;
  label: string;
  confirmLabel: string;
  title: string;
  onArm: () => void;
  onRun: () => void;
}) {
  if (armed) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onRun}
        title={`${title}（再点一次确认）`}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {busy ? "删除中…" : confirmLabel}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onArm}
      title={`${title}（点击后需再确认一次）`}
      className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950"
    >
      {label}
    </button>
  );
}

/**
 * 回收站独立页：整页覆盖工作台（同设置中心，不占标签栏）。
 * 支持标题/原位置搜索、勾选批量恢复/彻底删除、单条恢复/彻底删除/只读预览、清空回收站；
 * 破坏性操作一律两段式点击确认，不弹系统对话框。
 */
export function TrashPage({ onClose }: TrashPageProps) {
  const router = useRouter();
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [armKey, setArmKey] = useState<string | null>(null);
  const armTimer = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (armTimer.current !== null) {
        window.clearTimeout(armTimer.current);
      }
    };
  }, []);

  /** 进入/退出待确认态；同一时间只有一个按钮处于待确认，6 秒自动取消 */
  const arm = useCallback((key: string | null) => {
    if (armTimer.current !== null) {
      window.clearTimeout(armTimer.current);
      armTimer.current = null;
    }
    setArmKey(key);
    if (key !== null) {
      armTimer.current = window.setTimeout(() => {
        armTimer.current = null;
        setArmKey(null);
      }, 6000);
    }
  }, []);

  const load = useCallback(async (): Promise<TrashItem[]> => {
    try {
      const response = await fetch("/api/trash", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { items?: TrashItem[]; error?: string };
      if (!response.ok) {
        setError(data.error ?? "加载失败");
        setItems([]);
        return [];
      }
      setError("");
      setItems(data.items ?? []);
      return data.items ?? [];
    } catch {
      setError("网络错误");
      setItems([]);
      return [];
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!items) {
      return [];
    }
    if (!keyword) {
      return items;
    }
    return items.filter(
      (item) => item.title.toLowerCase().includes(keyword) || (item.parentTitle ?? "").toLowerCase().includes(keyword)
    );
  }, [items, query]);

  async function post(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    try {
      const response = await fetch("/api/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      return response.ok ? { ok: true } : { ok: false, error: data.error ?? "操作失败" };
    } catch {
      return { ok: false, error: "网络错误" };
    }
  }

  /** 操作完成后的收尾：刷新侧栏角标/树，重载列表并把勾选收敛到仍存在的条目 */
  async function settle(ids: string[]) {
    refreshTree();
    const fresh = await load();
    const alive = new Set(fresh.map((item) => item.id));
    setSelected((prev) => new Set(ids.filter((id) => alive.has(id))));
  }

  async function runSingle(action: "restore" | "purge", id: string) {
    const key = `${action}:${id}`;
    if (busyKey === key) {
      return;
    }
    setBusyKey(key);
    arm(null);
    const result = await post({ action, id });
    setBusyKey(null);
    if (!result.ok) {
      setError(result.error ?? "操作失败");
      return;
    }
    await settle([id]);
  }

  /** 批量执行：逐条调用，父笔记连带子笔记时后到的条目会 404，跳过并计入失败数 */
  async function runBatch(action: "restore" | "purge") {
    if (selected.size === 0) {
      return;
    }
    const key = `batch:${action}`;
    setBusyKey(key);
    arm(null);
    let failed = 0;
    let lastError = "";
    for (const id of selected) {
      const result = await post({ action, id });
      if (!result.ok) {
        failed += 1;
        lastError = result.error ?? "操作失败";
      }
    }
    setBusyKey(null);
    if (failed > 0) {
      setError(`${failed} 项未能${action === "restore" ? "恢复" : "删除"}：${lastError}（父笔记连带子笔记时属正常）`);
    }
    await settle([...selected]);
  }

  async function runEmpty() {
    setBusyKey("empty");
    arm(null);
    const result = await post({ action: "empty" });
    setBusyKey(null);
    if (!result.ok) {
      setError(result.error ?? "操作失败");
      return;
    }
    await settle([]);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    arm(null);
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every((item) => selected.has(item.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const item of filtered) {
          next.delete(item.id);
        }
      } else {
        for (const item of filtered) {
          next.add(item.id);
        }
      }
      return next;
    });
    arm(null);
  }

  /** 点击条目 → 关闭回收站，标签页只读预览 */
  function preview(id: string) {
    onClose();
    router.push(`/notes/${id}?trash=1`);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="回收站"
      className="anim-fade-in fixed inset-0 z-50 flex flex-col bg-[var(--bg-primary)]"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-default)] px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-wide text-[var(--text-heading)]">
            回收站{items !== null ? `（${items.length}）` : ""}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">
            删除的笔记保留在本地，恢复时回到原位置（父级已不存在则挂到根级）。点击标题可只读预览，文件不会真正删除。
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          autoFocus
          aria-label="关闭回收站"
          title="关闭回收站（Esc）"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-default)] px-6 py-2.5">
        <div className="flex h-8 w-64 max-w-full items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation(); // 有搜索词时 Esc 只清空搜索，不关闭整个页面
                setQuery("");
                event.currentTarget.blur();
              }
            }}
            placeholder="搜索标题或原位置"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={selected.size === 0 || busyKey !== null}
            onClick={() => void runBatch("restore")}
            className="docs-button"
            title="勾选的笔记（含各自在回收站内的子笔记）恢复到原位置"
          >
            {busyKey === "batch:restore" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            恢复所选{selected.size > 0 ? `（${selected.size}）` : ""}
          </button>
          <DangerConfirmButton
            armed={armKey === "batch:purge"}
            busy={busyKey === "batch:purge" || busyKey !== null}
            label={`彻底删除所选${selected.size > 0 ? `（${selected.size}）` : ""}`}
            confirmLabel={`确认删除 ${selected.size} 项？`}
            title="彻底删除勾选的笔记及其子笔记（不可恢复）"
            onArm={() => arm("batch:purge")}
            onRun={() => void runBatch("purge")}
          />
          <DangerConfirmButton
            armed={armKey === "empty"}
            busy={busyKey === "empty" || busyKey !== null}
            label="清空回收站"
            confirmLabel="确认清空回收站？"
            title="彻底删除回收站里的全部笔记（不可恢复）"
            onArm={() => arm("empty")}
            onRun={() => void runEmpty()}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
        {items === null ? (
          <p className="py-10 text-center text-sm text-[var(--text-tertiary)]">加载中...</p>
        ) : error ? (
          <p className="mx-auto max-w-3xl rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="py-16 text-center text-sm text-[var(--text-tertiary)]">
            回收站是空的{query ? "（试试清空搜索词）" : ""}
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-[var(--text-tertiary)]">没有匹配「{query.trim()}」的笔记</p>
        ) : (
          <ul className="mx-auto max-w-4xl divide-y divide-[var(--border-default)]">
            {filtered.map((item) => {
              const restoreKey = `restore:${item.id}`;
              const purgeKey = `purge:${item.id}`;
              return (
                <li key={item.id} className="flex items-center gap-3 px-2 py-2.5 transition-colors hover:bg-[var(--bg-hover)]">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    aria-label={`选择 ${item.title}`}
                    className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent-600)]"
                  />
                  <button
                    type="button"
                    onClick={() => preview(item.id)}
                    className="group flex min-w-0 flex-1 items-center gap-2 text-left"
                    title="预览内容（只读）"
                  >
                    <Eye className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--accent-600)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-[var(--text-primary)] group-hover:underline group-hover:decoration-[var(--border-default)] group-hover:underline-offset-2">
                        {item.title}
                        {item.childCount > 0 && (
                          <span className="ml-1.5 text-xs font-normal text-[var(--text-tertiary)]">
                            （含 {item.childCount} 篇子笔记）
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[13px] text-[var(--text-tertiary)]">
                        原位置：{item.parentTitle ?? "根级"} · 删除于{" "}
                        {item.deletedAt ? new Date(item.deletedAt).toLocaleString("zh-CN") : "未知时间"}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={busyKey !== null}
                    onClick={() => void runSingle("restore", item.id)}
                    className="docs-button shrink-0"
                    title="恢复到原位置（父级已不存在则挂到根级）"
                  >
                    {busyKey === restoreKey ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    恢复
                  </button>
                  <DangerConfirmButton
                    armed={armKey === purgeKey}
                    busy={busyKey === purgeKey || busyKey !== null}
                    label="彻底删除"
                    confirmLabel={`确认删除「${item.title}」？`}
                    title={`彻底删除「${item.title}」及其子笔记（不可恢复）`}
                    onArm={() => arm(purgeKey)}
                    onRun={() => void runSingle("purge", item.id)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {items !== null && items.length > 0 && (
        <footer className="flex shrink-0 items-center gap-3 border-t border-[var(--border-default)] px-6 py-2 text-xs text-[var(--text-tertiary)]">
          <label className="flex cursor-pointer select-none items-center gap-1.5">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleAll}
              className="h-4 w-4 cursor-pointer accent-[var(--accent-600)]"
            />
            全选{query.trim() ? "（当前筛选结果）" : ""}
          </label>
          {selected.size > 0 && <span>已选 {selected.size} 项</span>}
          <Trash2 className="ml-auto h-3.5 w-3.5 opacity-60" aria-hidden />
        </footer>
      )}
    </div>
  );
}
