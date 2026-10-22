"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import { refreshTree } from "./notes-context";

interface NoteProtectionButtonProps {
  noteId: string;
  /** 有效保护状态（自身或祖先开启） */
  protectedEffective: boolean;
  /** 由上级文档保护：子文档不能单独关闭 */
  protectedInherited: boolean;
}

/**
 * 工具栏右侧的「保护」开关：开启后访问需输入保护密码（密码在 设置→密码 里管理），
 * 子文档随父文档自动受保护。父级开启时本开关只读，需到开启保护的父文档关闭。
 */
export function NoteProtectionButton({
  noteId,
  protectedEffective,
  protectedInherited,
}: NoteProtectionButtonProps) {
  const router = useRouter();
  // 乐观展示：成功后先翻本地，等服务端 props 刷新后自然对齐
  const [current, setCurrent] = useState(protectedEffective);
  const [busy, setBusy] = useState(false);

  const locked = protectedInherited || current;

  async function toggle() {
    if (busy || protectedInherited) {
      return;
    }
    const next = !current;
    setBusy(true);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-protection", id: noteId, protected: next }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        window.alert((data as { error?: string }).error ?? "操作失败");
        return;
      }
      setCurrent(next);
      refreshTree(); // 侧边栏的锁标记随子树变化
      router.refresh(); // 本页工具栏与门禁状态
    } catch {
      window.alert("网络错误");
    } finally {
      setBusy(false);
    }
  }

  const title = protectedInherited
    ? "由上级文档保护，子文档不能单独关闭；请到开启保护的上级文档关闭"
    : locked
      ? "文档已保护：访问需输入保护密码；点击关闭保护"
      : "开启保护：访问需输入保护密码，子文档一并保护";
  // docs-button 自带 color，锁定态用 !important 的 accent 色才能盖过它

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy || protectedInherited}
      title={title}
      aria-pressed={locked}
      className={`docs-button ${locked ? "text-[var(--accent-700)]!" : ""} ${
        protectedInherited ? "cursor-not-allowed opacity-70" : ""
      }`}
    >
      {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
      <span className="hidden md:inline">{locked ? "已保护" : "保护"}</span>
    </button>
  );
}
