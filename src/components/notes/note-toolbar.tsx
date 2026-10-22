"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { History, Pencil, Share2 } from "lucide-react";
import { EditableTitle } from "./editable-title";
import { NoteIconButton } from "./note-icon-button";
import { NoteProtectionButton } from "./note-protection-button";
import { ShareDialog } from "./share-dialog";
import { TocToggleButton } from "./toc-sidebar";
import { VersionDialog } from "./version-dialog";

interface NoteToolbarProps {
  noteId: string;
  title: string;
  icon: string;
  /** 有效保护状态（自身或祖先开启） */
  protectedEffective: boolean;
  /** 由上级文档保护（不能单独关闭） */
  protectedInherited: boolean;
}

/** 阅读模式顶部工具栏（编辑态由编辑器自带工具条） */
export function NoteToolbar({
  noteId,
  title,
  icon,
  protectedEffective,
  protectedInherited,
}: NoteToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [shareOpen, setShareOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--border-default)] px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <NoteIconButton noteId={noteId} icon={icon} />
        <h1 className="min-w-0 flex-1">
          <EditableTitle noteId={noteId} title={title} className="text-[15px] font-semibold text-[var(--text-heading)]" />
        </h1>
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
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          disabled={protectedEffective}
          className="docs-button"
          title={protectedEffective ? "受保护的笔记不能创建分享链接" : "生成公开分享链接"}
        >
          <Share2 className="h-3.5 w-3.5" />
          <span className="hidden md:inline">分享</span>
        </button>
        <button
          type="button"
          onClick={() => router.push(`${pathname}?edit=1`)}
          className="docs-button"
          title="编辑这篇笔记"
        >
          <Pencil className="h-3.5 w-3.5" />
          <span className="hidden md:inline">编辑</span>
        </button>
        <NoteProtectionButton
          noteId={noteId}
          protectedEffective={protectedEffective}
          protectedInherited={protectedInherited}
        />
        <TocToggleButton />
      </div>

      {shareOpen && (
        <ShareDialog noteId={noteId} noteTitle={title} onClose={() => setShareOpen(false)} />
      )}
      {versionsOpen && (
        <VersionDialog noteId={noteId} noteTitle={title} onClose={() => setVersionsOpen(false)} />
      )}
    </div>
  );
}
