"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Eye, History } from "lucide-react";
import { EditableTitle } from "./editable-title";
import { NoteIconButton } from "./note-icon-button";
import { NoteProtectionButton } from "./note-protection-button";
import { TocSidebar } from "./toc-sidebar";
import { refreshTree } from "./sidebar";
import { VersionDialog } from "./version-dialog";

// MDXEditor 不支持 SSR，必须客户端加载
const RichEditor = dynamic(() => import("./rich-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
      编辑器加载中...
    </div>
  ),
});

interface NoteEditorPageProps {
  noteId: string;
  title: string;
  icon: string;
  initialContent: string;
  /** 有效保护状态（自身或祖先开启） */
  protectedEffective: boolean;
  /** 由上级文档保护（不能单独关闭） */
  protectedInherited: boolean;
}

/** 卸载/关页时兜底冲刷未保存内容的原样 PUT（keepalive 尽力送达） */
function flushSave(noteId: string, content: string) {
  void fetch("/api/notes/file", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: noteId, content }),
    keepalive: true,
  }).catch(() => undefined);
}

type SaveStatus = "saved" | "saving" | "error";

/** 编辑模式整页组件：自动保存（防抖 800ms + 卸载/关页兜底），无需手动点保存 */
export function NoteEditorPage({
  noteId,
  title,
  icon,
  initialContent,
  protectedEffective,
  protectedInherited,
}: NoteEditorPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [versionsOpen, setVersionsOpen] = useState(false);
  const draftRef = useRef(initialContent);
  const savedRef = useRef(initialContent);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingPromiseRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    draftRef.current = initialContent;
    savedRef.current = initialContent;
    setStatus("saved");
  }, [initialContent, noteId]);

  // 已有保存在途时复用同一个 Promise（版本弹窗点「备份当前内容」前也会调它冲刷草稿），
  // 这样既能等在途保存完成，也不会并发写同一文件
  const saveNow = useCallback((): Promise<boolean> => {
    if (savingPromiseRef.current) {
      return savingPromiseRef.current;
    }
    if (draftRef.current === savedRef.current) {
      return Promise.resolve(true);
    }
    const doSave = async (): Promise<boolean> => {
      const content = draftRef.current;
      setStatus("saving");
      try {
        const response = await fetch("/api/notes/file", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: noteId, content }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          window.alert((data as { error?: string }).error ?? "自动保存失败");
          setStatus("error");
          return false;
        }
        savedRef.current = content;
        setStatus("saved");
        refreshTree(); // H1 兜底标题可能随内容变化
        return true;
      } catch {
        setStatus("error");
        return false;
      }
    };
    savingPromiseRef.current = doSave().finally(() => {
      savingPromiseRef.current = null;
    });
    return savingPromiseRef.current;
  }, [noteId]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => void saveNow(), 800);
  }, [saveNow]);

  // 卸载（切换标签页/路由）时冲刷未保存的草稿
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (draftRef.current !== savedRef.current) {
        flushSave(noteId, draftRef.current);
      }
    };
  }, [noteId]);

  // 关闭页面前兜底
  useEffect(() => {
    const handler = () => {
      if (draftRef.current !== savedRef.current) {
        flushSave(noteId, draftRef.current);
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [noteId]);

  async function handleBackToView() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    const ok = await saveNow();
    if (!ok && !window.confirm("自动保存失败，仍要返回阅读视图？")) {
      return;
    }
    router.push(pathname);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--border-default)] px-4">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <NoteIconButton noteId={noteId} icon={icon} />
          <EditableTitle
            noteId={noteId}
            title={title}
            className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--text-heading)]"
          />
          {status === "error" && (
            <span className="shrink-0 text-[11px] text-red-500" title="改动仍在编辑器里，下次自动保存时重试">
              保存失败，重试中…
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setVersionsOpen(true)}
            className="docs-button"
            title="查看历史版本，备份当前内容"
          >
            <History className="h-3.5 w-3.5" />
            <span className="hidden md:inline">版本</span>
          </button>
          <button type="button" onClick={() => void handleBackToView()} className="docs-button" title="返回阅读视图">
            <Eye className="h-3.5 w-3.5" />
            <span className="hidden md:inline">退出编辑</span>
          </button>
          <NoteProtectionButton
            noteId={noteId}
            protectedEffective={protectedEffective}
            protectedInherited={protectedInherited}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div id="note-editor-scroll" className="min-h-0 min-w-0 flex-1">
          <RichEditor
            key={noteId}
            noteId={noteId}
            initialContent={initialContent}
            onChange={(markdown) => {
              draftRef.current = markdown;
              scheduleSave();
            }}
            onSave={() => void saveNow()}
          />
        </div>
        <TocSidebar
          title={title}
          scrollSelector="#note-editor-scroll .mdxeditor-root-contenteditable, #note-editor-scroll .mdxeditor-source-editor"
        />
      </div>

      {versionsOpen && (
        <VersionDialog
          noteId={noteId}
          noteTitle={title}
          onClose={() => setVersionsOpen(false)}
          onFlushDraft={saveNow}
        />
      )}
    </div>
  );
}
