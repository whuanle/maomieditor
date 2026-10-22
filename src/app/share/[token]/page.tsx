import matter from "gray-matter";
import { DocContentClient } from "@/components/markdown/doc-content-client";
import { MdxContent } from "@/components/markdown/mdx-content";
import { findShareByToken } from "@/lib/share";
import { getNote, readNote } from "@/lib/store";

export const dynamic = "force-dynamic";

interface SharePageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: SharePageProps) {
  const { token } = await params;
  const entry = await findShareByToken(token);
  return { title: entry ? entry.noteTitle : "分享" };
}

export default async function SharePage({ params }: SharePageProps) {
  const { token } = await params;
  const entry = await findShareByToken(token);
  if (!entry) {
    return <ShareErrorState message="分享不存在或已被撤销" />;
  }

  const note = await getNote(entry.noteId);
  if (!note) {
    return <ShareErrorState message="分享的笔记已失效" />;
  }

  // 笔记在创建分享后开启了保护：公开链接不再展示内容（附件公开路由同样拦截）
  if (note.protectedEffective) {
    return <ShareErrorState message="该笔记已开启保护，分享链接已停用" />;
  }

  let content: string | null;
  try {
    content = await readNote(note.id);
  } catch {
    content = null;
  }
  if (content === null) {
    return <ShareErrorState message="分享的笔记已被删除" />;
  }

  const { data } = matter(content);
  const title =
    typeof data.title === "string" && data.title.trim() ? data.title.trim() : entry.noteTitle;

  const assetBase = `/api/public/share/${token}/attachments`;

  const view =
    note.format === "mdx" ? (
      <MdxContent content={content} notePath={note.id} assetBase={assetBase} mode="share" />
    ) : (
      <DocContentClient content={content} notePath={note.id} assetBase={assetBase} mode="share" />
    );

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <header className="sticky top-0 z-10 border-b border-[var(--border-default)] bg-[var(--bg-primary)]/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-3xl items-center justify-between px-6">
          <h1 className="truncate text-sm font-semibold text-[var(--text-heading)]">{title}</h1>
          <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
            🐱 来自猫咪笔记 · 只读分享
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">{view}</main>

      <footer className="pb-8 text-center text-xs text-[var(--text-muted)]">
        Powered by maomiedtor
      </footer>
    </div>
  );
}

function ShareErrorState({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-secondary)] px-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-8 text-center shadow-[var(--shadow-md)]">
        <p className="mb-2 text-3xl">🔒</p>
        <p className="text-sm font-medium text-[var(--text-primary)]">{message}</p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">请联系分享者获取新的链接</p>
      </div>
    </main>
  );
}
