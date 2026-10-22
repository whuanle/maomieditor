import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocContentClient } from "@/components/markdown/doc-content-client";
import { MdxContent } from "@/components/markdown/mdx-content";
import { NoteLockScreen } from "@/components/notes/note-lock-screen";
import { NoteToolbar } from "@/components/notes/note-toolbar";
import { NoteEditorPage } from "@/components/notes/note-editor-page";
import { TocSidebar } from "@/components/notes/toc-sidebar";
import { VersionPreviewToolbar } from "@/components/notes/version-preview-toolbar";
import { isNoteLocked } from "@/lib/note-guard";
import { getNote, isValidId, readNote } from "@/lib/store";
import { readVersion } from "@/lib/versions";

export const dynamic = "force-dynamic";

interface NotePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string; v?: string }>;
}

export async function generateMetadata({ params }: NotePageProps): Promise<Metadata> {
  const { id } = await params;
  const note = await getNote(id);
  return { title: note ? `${note.icon ? `${note.icon} ` : ""}${note.title}` : "笔记" };
}

export default async function NotePage({ params, searchParams }: NotePageProps) {
  const { id } = await params;
  const { edit, v } = await searchParams;

  if (!isValidId(id)) {
    notFound();
  }

  const note = await getNote(id);
  if (!note) {
    notFound();
  }

  // 保护门禁：受保护（自身或祖先开启）且无有效会话时只渲染锁定屏，正文不出网
  if (await isNoteLocked(id)) {
    return <NoteLockScreen noteId={note.id} title={note.title} icon={note.icon} />;
  }

  const content = await readNote(id);
  if (content === null) {
    notFound();
  }

  const title = note.title; // 标题在旁挂 yaml：sidecar.title > 用户 frontmatter title > 首个 # 标题
  const editing = edit === "1";

  // 编辑态：整页交给编辑器（客户端组件，content 为纯字符串可序列化）
  if (editing) {
    return (
      <NoteEditorPage
        noteId={note.id}
        title={title}
        icon={note.icon}
        initialContent={content}
        protectedEffective={note.protectedEffective}
        protectedInherited={note.protectedEffective && !note.protectedSelf}
      />
    );
  }

  // 历史版本预览（?v={毫秒时间戳}）：只读渲染备份文件内容；版本已删除则落回当前版本
  const versionTs = Number(v);
  if (Number.isFinite(versionTs) && versionTs > 0) {
    const versionContent = await readVersion(id, versionTs);
    if (versionContent !== null) {
      const versionView =
        note.format === "mdx" ? (
          <MdxContent content={versionContent} notePath={note.id} />
        ) : (
          <DocContentClient content={versionContent} notePath={note.id} />
        );
      return (
        <div className="flex h-full min-h-0 flex-col">
          <VersionPreviewToolbar noteId={note.id} title={title} icon={note.icon} ts={versionTs} />
          <div className="flex min-h-0 flex-1">
            <div id="note-reader-scroll" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <div className="px-6 py-8 md:px-10 md:py-10">{versionView}</div>
            </div>
            <TocSidebar title={title} scrollSelector="#note-reader-scroll" />
          </div>
        </div>
      );
    }
  }

  // 阅读态：内容留在服务端渲染区，工具栏单独作为客户端组件
  const view =
    note.format === "mdx" ? (
      <MdxContent content={content} notePath={note.id} />
    ) : (
      <DocContentClient content={content} notePath={note.id} />
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <NoteToolbar
        noteId={note.id}
        title={title}
        icon={note.icon}
        protectedEffective={note.protectedEffective}
        protectedInherited={note.protectedEffective && !note.protectedSelf}
      />
      <div className="flex min-h-0 flex-1">
        <div id="note-reader-scroll" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="px-6 py-8 md:px-10 md:py-10">{view}</div>
        </div>
        <TocSidebar
          title={title}
          scrollSelector="#note-reader-scroll"
        />
      </div>
    </div>
  );
}
