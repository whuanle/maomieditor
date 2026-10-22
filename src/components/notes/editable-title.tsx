"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { refreshTree } from "./notes-context";

interface EditableTitleProps {
  noteId: string;
  title: string;
  /** 展示态与输入态共用的字号/字重/颜色类 */
  className?: string;
}

/** 点击即编辑的笔记标题：回车/失焦保存，Esc 取消；清空则回退原标题 */
export function EditableTitle({ noteId, title, className = "" }: EditableTitleProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  // 乐观展示：保存成功先改本地，等服务端 props 刷新后自然对齐
  const [current, setCurrent] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  // 回车提交后输入框随即卸载，浏览器可能补发 blur，用标记防重复提交
  const closedRef = useRef(false);

  useEffect(() => {
    setCurrent(title);
  }, [title]);

  useEffect(() => {
    if (editing) {
      closedRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function submit() {
    if (closedRef.current) {
      return;
    }
    closedRef.current = true;
    setEditing(false);
    const cleaned = draft.trim();
    if (!cleaned || cleaned === current) {
      return;
    }
    void (async () => {
      try {
        const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", id: noteId, title: cleaned }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          window.alert((data as { error?: string }).error ?? "重命名失败");
          return;
        }
        setCurrent(cleaned);
        refreshTree(); // 侧边栏与标签栏的标题
        router.refresh(); // 本页服务端渲染的标题与浏览器标签标题
      } catch {
        window.alert("网络错误");
      }
    })();
  }

  function cancel() {
    closedRef.current = true;
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        title="点击修改标题"
        onClick={() => {
          setDraft(current);
          setEditing(true);
        }}
        className={`-mx-1 block min-w-0 max-w-full cursor-pointer truncate rounded-sm px-1 text-left hover:bg-[var(--bg-secondary)] ${className}`}
      >
        {current}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          submit();
        } else if (event.key === "Escape") {
          cancel();
        }
      }}
      onBlur={submit}
      spellCheck={false}
      className={`-mx-1 w-full min-w-0 rounded-sm border border-[var(--accent-600)] bg-transparent px-1 outline-none ${className}`}
    />
  );
}
