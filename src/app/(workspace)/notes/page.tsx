export const dynamic = "force-dynamic";

/** 工作台首页：无标签/未选文档时的空态（不再自动跳第一篇，交由标签页控制） */
export default function NotesIndexPage() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className="mb-2 text-4xl">📝</p>
        <p className="text-sm font-medium text-[var(--text-primary)]">未打开文档</p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          在左侧点击一篇笔记，或右键新建；已打开的文档会以标签页形式保留在顶部
        </p>
      </div>
    </div>
  );
}
