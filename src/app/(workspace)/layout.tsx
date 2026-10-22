import type { ReactNode } from "react";
import { NotesShell } from "@/components/notes/notes-shell";

/** 工作台外壳：笔记区共享布局（树/标签状态跨页面保留；设置为整页覆盖层，不走路由） */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <NotesShell>{children}</NotesShell>;
}
