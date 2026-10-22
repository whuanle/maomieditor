"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertCircle,
  ChevronRight,
  Download,
  FileText,
  FileType2,
  Lock,
  LogOut,
  MoreVertical,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Settings,
  Share2,
  SmilePlus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { TreeNode } from "@/lib/store";
import { ThemeToggle } from "@/components/theme-toggle";
import { ShareDialog } from "./share-dialog";
import { TrashDialog } from "./trash-dialog";
import { refreshTree, TREE_REFRESH_EVENT, useNotes } from "./notes-context";

// 兼容既有引用：编辑器/对话框等从 sidebar 导入 refreshTree
export { refreshTree } from "./notes-context";

type DropZone = "into" | "before" | "after";

interface DragState {
  id: string;
}

interface DropState {
  id: string;
  zone: DropZone;
}

function isNote(node: TreeNode): boolean {
  return node.type === "md" || node.type === "mdx";
}

function noteIcon(node: TreeNode) {
  if (node.icon) {
    return (
      <span className="w-4 shrink-0 text-center text-[15px] leading-none" aria-hidden>
        {node.icon}
      </span>
    );
  }
  return node.type === "mdx" ? (
    <FileType2 className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
  ) : (
    <FileText className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
  );
}

/** 按关键词过滤树（标题或 id 命中），命中节点的祖先链保留 */
function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return nodes;
  }
  const walk = (list: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const node of list) {
      if (node.type === "file") {
        continue; // 搜索只针对笔记
      }
      const children = node.children ? walk(node.children) : [];
      if (node.title.toLowerCase().includes(q) || node.id.toLowerCase().includes(q) || children.length > 0) {
        out.push({ ...node, children });
      }
    }
    return out;
  };
  return walk(nodes);
}

/** 收集树里全部笔记 id（搜索态用来强制展开所有分支） */
function collectAllNoteIds(nodes: TreeNode[], out: Set<string>): Set<string> {
  for (const node of nodes) {
    if (node.type !== "file") {
      out.add(node.id);
    }
    if (node.children) {
      collectAllNoteIds(node.children, out);
    }
  }
  return out;
}

/** id → 父 id 映射（用于自动展开当前笔记的祖先链） */
function buildParentMap(nodes: TreeNode[], parent: string | null, map: Map<string, string | null>) {
  for (const node of nodes) {
    map.set(node.id, parent);
    if (node.children) {
      buildParentMap(node.children, node.id, map);
    }
  }
}

/** rootId 的全部后代笔记 id（不含自身）；找不到 rootId 返回 null */
function collectDescendantIds(nodes: TreeNode[], rootId: string): Set<string> | null {
  for (const node of nodes) {
    if (node.id === rootId) {
      const result = new Set<string>();
      const walk = (list: TreeNode[] | undefined) => {
        for (const child of list ?? []) {
          if (isNote(child)) {
            result.add(child.id);
          }
          walk(child.children);
        }
      };
      walk(node.children);
      return result;
    }
    if (node.children) {
      const found = collectDescendantIds(node.children, rootId);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function countNotes(nodes: TreeNode[] | undefined): number {
  let count = 0;
  for (const node of nodes ?? []) {
    if (isNote(node)) {
      count += 1;
    }
    count += countNotes(node.children);
  }
  return count;
}

interface SidebarProps {
  className?: string;
  /** 由外壳传入的可拖宽度（px） */
  width?: number;
  /** 打开设置独立页（整页覆盖层） */
  onOpenSettings?: () => void;
}

export function NoteSidebar({ className, width, onOpenSettings }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { tree, loadTree } = useNotes();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode | null } | null>(null);
  const [shareTarget, setShareTarget] = useState<TreeNode | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashCount, setTrashCount] = useState<number | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadNoteIdRef = useRef<string>("");

  const activeId = useMemo(() => {
    if (!pathname.startsWith("/notes/")) {
      return "";
    }
    return pathname.slice("/notes/".length);
  }, [pathname]);

  const parentMap = useMemo(() => {
    const map = new Map<string, string | null>();
    buildParentMap(tree ?? [], null, map);
    return map;
  }, [tree]);

  const loadTrashCount = useCallback(async () => {
    try {
      const response = await fetch("/api/trash", { cache: "no-store" });
      if (response.ok) {
        const data = (await response.json()) as { items?: unknown[] };
        setTrashCount(data.items?.length ?? 0);
      }
    } catch {
      // 回收站数量拉取失败不阻塞树展示
    }
  }, []);

  useEffect(() => {
    void loadTrashCount();
    const handler = () => void loadTrashCount();
    window.addEventListener(TREE_REFRESH_EVENT, handler);
    return () => window.removeEventListener(TREE_REFRESH_EVENT, handler);
  }, [loadTrashCount]);

  // 当前笔记的祖先自动展开
  useEffect(() => {
    if (!activeId) {
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      let cursor = parentMap.get(activeId) ?? null;
      while (cursor) {
        next.add(cursor);
        cursor = parentMap.get(cursor) ?? null;
      }
      return next;
    });
  }, [activeId, parentMap]);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function postAction(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: (data as { error?: string }).error ?? "操作失败" };
    }
    return { ok: true, ...(data as object) };
  }

  async function createNote(parentId: string | null) {
    const title = window.prompt("输入新笔记标题：", "无标题笔记");
    if (!title) {
      return;
    }

    const result = await postAction({ action: "create", parentId, title, format: "md" });
    const data = result as { ok: boolean; error?: string; node?: TreeNode };
    if (!data.ok) {
      window.alert(data.error ?? "创建失败");
      return;
    }

    if (parentId) {
      setExpanded((prev) => new Set(prev).add(parentId));
    }
    refreshTree();
    if (data.node) {
      router.push(`/notes/${data.node.id}`);
    }
  }

  async function renameNote(node: TreeNode) {
    const title = window.prompt("重命名标题：", node.title);
    if (!title || title === node.title) {
      return;
    }
    const result = await postAction({ action: "rename", id: node.id, title });
    if (!result.ok) {
      window.alert(result.error ?? "重命名失败");
      return;
    }
    refreshTree();
  }

  async function setIcon(node: TreeNode) {
    const icon = window.prompt("输入 emoji 图标（留空移除）：", node.icon ?? "");
    if (icon === null) {
      return;
    }
    const result = await postAction({ action: "set-icon", id: node.id, icon });
    if (!result.ok) {
      window.alert(result.error ?? "设置图标失败");
      return;
    }
    refreshTree();
  }

  async function deleteNote(node: TreeNode) {
    const descendants = collectDescendantIds(tree ?? [], node.id) ?? new Set<string>();
    const message =
      descendants.size > 0
        ? `把「${node.title}」及其 ${descendants.size} 篇子笔记移入回收站？可随时恢复。`
        : `把「${node.title}」移入回收站？可随时恢复。`;
    if (!window.confirm(message)) {
      return;
    }

    const response = await fetch(`/api/notes?id=${node.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      window.alert((data as { error?: string }).error ?? "删除失败");
      return;
    }

    refreshTree();
    if (activeId === node.id || descendants.has(activeId)) {
      router.push("/notes");
    }
  }

  async function deleteAttachment(node: TreeNode) {
    if (!window.confirm(`删除附件「${node.title}」？`)) {
      return;
    }
    const parentId = node.parentId ?? "";
    const result = await postAction({ action: "delete-attachment", noteId: parentId, attachmentId: node.id });
    if (!result.ok) {
      window.alert(result.error ?? "删除失败");
      return;
    }
    refreshTree();
  }

  function startUpload(noteId: string) {
    uploadNoteIdRef.current = noteId;
    uploadInputRef.current?.click();
  }

  /** 上传文件到指定笔记：md/mdx 建为子笔记，其余挂为附件 */
  async function uploadFiles(noteId: string, files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    if (list.length === 0) {
      return;
    }
    const formData = new FormData();
    formData.set("noteId", noteId);
    for (const file of list) {
      formData.append("file", file);
    }
    const response = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      window.alert((data as { error?: string }).error ?? "上传失败");
      return;
    }
    refreshTree();
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }
    await uploadFiles(uploadNoteIdRef.current, files);
  }

  // ----- 拖拽：中段 = 挂为子笔记，上/下边缘 = 同级排序 -----

  const canDropOn = useCallback(
    (targetId: string): boolean => {
      if (!drag || drag.id === targetId) {
        return false;
      }
      const descendants = collectDescendantIds(tree ?? [], drag.id);
      return descendants === null || !descendants.has(targetId);
    },
    [drag, tree]
  );

  function handleRowDragOver(event: React.DragEvent, node: TreeNode) {
    if (!isNote(node)) {
      return;
    }
    // 本地文件拖入：高亮整行（上传到此笔记）
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDrop((prev) => (prev?.id === node.id && prev.zone === "into" ? prev : { id: node.id, zone: "into" }));
      return;
    }
    if (!drag || !canDropOn(node.id)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    const zone: DropZone = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "into";
    setDrop((prev) => (prev?.id === node.id && prev.zone === zone ? prev : { id: node.id, zone }));
  }

  async function handleRowDrop(event: React.DragEvent, node: TreeNode) {
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setDrop(null);
      await uploadFiles(node.id, files);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const zone = drop?.id === node.id ? drop.zone : "into";
    setDrop(null);
    setDrag(null);
    if (!drag) {
      return;
    }
    const payload =
      zone === "into"
        ? { action: "move", id: drag.id, parentId: node.id }
        : { action: "reorder", id: drag.id, targetId: node.id, position: zone };
    const result = await postAction(payload);
    if (!result.ok) {
      window.alert(result.error ?? "移动失败");
      return;
    }
    if (zone === "into") {
      setExpanded((prev) => new Set(prev).add(node.id));
    }
    refreshTree();
  }

  async function handleRootDrop(event: React.DragEvent) {
    event.preventDefault();
    setDrop(null);
    setDrag(null);
    if (!drag) {
      return;
    }
    const result = await postAction({ action: "move", id: drag.id, parentId: null });
    if (!result.ok) {
      window.alert(result.error ?? "移动失败");
      return;
    }
    refreshTree();
  }

  function handleContextMenu(event: React.MouseEvent, node: TreeNode | null) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, node });
  }

  const menuNode = menu?.node ?? null;

  const searching = query.trim().length > 0;
  const visibleTree = useMemo(() => filterTree(tree ?? [], query), [tree, query]);
  // 搜索态强制展开所有分支，让命中结果直接可见
  const expandedForRender = useMemo(
    () => (searching && tree ? collectAllNoteIds(tree, new Set()) : expanded),
    [searching, tree, expanded]
  );

  return (
    <aside
      className={`app-panel-bg flex shrink-0 flex-col border-r border-[var(--border-default)] ${className ?? ""}`}
      style={{ width: `${width ?? 256}px` }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-3 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="猫咪笔记" className="h-6 w-6 shrink-0" />
        <span className="text-base font-semibold tracking-wide text-[var(--text-heading)]">猫咪笔记</span>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--border-default)] px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              event.currentTarget.blur();
            }
          }}
          placeholder="搜索笔记"
          className="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="清空搜索"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => void createNote(null)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          title="新建笔记"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <nav
        className="flex-1 overflow-y-auto px-1 py-2 text-[15px]"
        onContextMenu={(event) => handleContextMenu(event, null)}
        onDragOver={(event) => {
          // 本地文件拖到空白处：md/mdx 可导入根级
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          const files = event.dataTransfer?.files;
          if (!files || files.length === 0) {
            return;
          }
          event.preventDefault();
          const allMarkdown = Array.from(files).every((file) => /\.(md|mdx)$/i.test(file.name));
          if (!allMarkdown) {
            window.alert("根级只能导入 .md / .mdx 文档；图片等其他文件请拖到具体笔记上");
            return;
          }
          void uploadFiles("root", files);
        }}
      >
        {tree === null ? (
          <p className="px-2 py-4 text-[13px] text-[var(--text-tertiary)]">加载中...</p>
        ) : tree.length === 0 ? (
          <p className="px-2 py-4 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
            还没有笔记。
            <br />
            点击上方 + 开始；笔记下还可以继续挂子笔记。
          </p>
        ) : searching && visibleTree.length === 0 ? (
          <p className="px-2 py-4 text-[13px] text-[var(--text-tertiary)]">
            没有匹配「{query.trim()}」的笔记
          </p>
        ) : (
          <ul className="anim-tree-in space-y-px">
            {visibleTree.map((node) => (
              <TreeItem
                key={node.id}
                node={node}
                depth={0}
                expanded={expandedForRender}
                activeId={activeId}
                drag={drag}
                drop={drop}
                canDropOn={canDropOn}
                onToggle={toggleExpand}
                onContextMenu={handleContextMenu}
                onDragStateChange={setDrag}
                onRowDragOver={handleRowDragOver}
                onRowDrop={handleRowDrop}
                onDragLeaveRow={() => setDrop((prev) => (prev ? null : prev))}
              />
            ))}
          </ul>
        )}

        {drag && (
          <div
            className="anim-fade-in mt-2 rounded-md border border-dashed border-[var(--accent-400,var(--border-default))] bg-[var(--accent-50)] px-2 py-2 text-center text-[13px] text-[var(--accent-700,var(--text-tertiary))]"
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => void handleRootDrop(event)}
          >
            拖到这里移到根级
          </div>
        )}
      </nav>

      <div className="flex items-center justify-center gap-2 border-t border-[var(--border-default)] px-2 py-1.5">
        <button
          type="button"
          onClick={() => setTrashOpen(true)}
          className="relative flex h-9 w-9 items-center justify-center rounded-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          title="回收站"
          aria-label="回收站"
        >
          <Trash2 className="h-5 w-5" />
          {trashCount !== null && trashCount > 0 && (
            <span
              key={trashCount}
              className="anim-badge-pop absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent-600)] px-1 text-[10px] font-semibold leading-none text-white"
            >
              {trashCount > 99 ? "99+" : trashCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="设置"
          title="设置"
          className="flex h-9 w-9 items-center justify-center rounded-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <Settings className="h-5 w-5" />
        </button>
        <ThemeToggle />
        <button
          type="button"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            router.replace("/login");
            router.refresh();
          }}
          className="flex h-9 w-9 items-center justify-center rounded-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          title="退出登录"
          aria-label="退出登录"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleUpload(event.target.files);
          event.target.value = "";
        }}
      />

      {menu && (
        <div
          className="context-menu fixed z-50 min-w-44 py-1 text-sm"
          style={{
            left: Math.min(menu.x, window.innerWidth - 190),
            top: Math.min(menu.y, window.innerHeight - 260),
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {menuNode && isNote(menuNode) ? (
            <>
              <MenuItem icon={<Plus className="h-3.5 w-3.5" />} label="新建子笔记" onClick={() => void createNote(menuNode.id)} />
              <MenuItem icon={<Upload className="h-3.5 w-3.5" />} label="上传文件到此笔记" onClick={() => startUpload(menuNode.id)} />
              <div className="my-1 border-t border-[var(--border-default)]" />
              <MenuItem icon={<Share2 className="h-3.5 w-3.5" />} label="分享…" onClick={() => setShareTarget(menuNode)} />
              <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="重命名标题" onClick={() => void renameNote(menuNode)} />
              <MenuItem icon={<SmilePlus className="h-3.5 w-3.5" />} label="设置图标" onClick={() => void setIcon(menuNode)} />
              <MenuItem icon={<Trash2 className="h-3.5 w-3.5" />} label="删除" danger onClick={() => void deleteNote(menuNode)} />
            </>
          ) : menuNode ? (
            <>
              <MenuItem
                icon={<Download className="h-3.5 w-3.5" />}
                label="下载"
                onClick={() => window.open(`/api/attachments/${menuNode.id}?download=1`, "_blank")}
              />
              <MenuItem icon={<Trash2 className="h-3.5 w-3.5" />} label="删除附件" danger onClick={() => void deleteAttachment(menuNode)} />
            </>
          ) : (
            <MenuItem icon={<Plus className="h-3.5 w-3.5" />} label="新建笔记" onClick={() => void createNote(null)} />
          )}
        </div>
      )}

      {shareTarget && (
        <ShareDialog noteId={shareTarget.id} noteTitle={shareTarget.title} onClose={() => setShareTarget(null)} />
      )}

      {trashOpen && <TrashDialog onClose={() => setTrashOpen(false)} />}
    </aside>
  );
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  activeId: string;
  drag: DragState | null;
  drop: DropState | null;
  canDropOn: (targetId: string) => boolean;
  onToggle: (id: string) => void;
  onContextMenu: (event: React.MouseEvent, node: TreeNode | null) => void;
  onDragStateChange: (state: DragState | null) => void;
  onRowDragOver: (event: React.DragEvent, node: TreeNode) => void;
  onRowDrop: (event: React.DragEvent, node: TreeNode) => void;
  onDragLeaveRow: () => void;
}

function TreeItem({
  node,
  depth,
  expanded,
  activeId,
  drag,
  drop,
  canDropOn,
  onToggle,
  onContextMenu,
  onDragStateChange,
  onRowDragOver,
  onRowDrop,
  onDragLeaveRow,
}: TreeItemProps) {
  const isAttachment = node.type === "file";
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = expanded.has(node.id);
  const isActive = activeId === node.id;
  // 内部拖拽时校验目标合法性；本地文件悬停（drag 为空）直接高亮
  const isDropTarget = drop?.id === node.id && (!drag || canDropOn(node.id));

  const rowBase = `group relative flex h-8 w-full items-center gap-1.5 rounded-sm pr-1 text-left transition-colors ${
    isDropTarget && drop!.zone === "into"
      ? "bg-[var(--accent-100)] ring-1 ring-inset ring-[var(--accent-400,var(--accent-600))]"
      : isActive
        ? "bg-[var(--accent-100)] text-[var(--text-primary)] font-medium"
        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
  }`;

  const indicator =
    isDropTarget && drop!.zone !== "into" ? (
      <span
        className={`pointer-events-none absolute inset-x-1 ${drop!.zone === "before" ? "-top-0.5" : "-bottom-0.5"} h-0.5 rounded bg-[var(--accent-600)]`}
      />
    ) : null;

  const content = (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      {isAttachment ? (
        <Paperclip className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
      ) : (
        noteIcon(node)
      )}
      <span className="truncate">{node.title}</span>
      {!isAttachment && node.protected && (
        <span title="受保护文档：打开需输入保护密码" className="shrink-0">
          <Lock className="h-3 w-3 text-[var(--accent-700)]" />
        </span>
      )}
      {node.orphan && (
        <span title="父笔记引用失效，已显示在根级">
          <AlertCircle className="h-3 w-3 shrink-0 text-amber-500" />
        </span>
      )}
      {isAttachment && (
        <MoreVertical className="h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-40" />
      )}
    </span>
  );

  return (
    <li>
      <div
        className={rowBase}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
        draggable={!isAttachment}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", node.id);
          onDragStateChange({ id: node.id });
        }}
        onDragEnd={() => onDragStateChange(null)}
        onDragOver={(event) => onRowDragOver(event, node)}
        onDragLeave={onDragLeaveRow}
        onDrop={(event) => void onRowDrop(event, node)}
        onContextMenu={(event) => onContextMenu(event, node)}
        title={isAttachment ? `${node.title}（附件）` : node.title}
      >
        {indicator}
        {!isAttachment && hasChildren ? (
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(node.id);
            }}
            title={isOpen ? "收起" : "展开"}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="h-7 w-7 shrink-0" />
        )}

        {isAttachment ? (
          <a
            href={`/api/attachments/${node.id}?download=1`}
            className="flex min-w-0 flex-1 items-center"
            download
          >
            {content}
          </a>
        ) : (
          <Link href={`/notes/${node.id}`} className="flex min-w-0 flex-1 items-center">
            {content}
          </Link>
        )}
      </div>

      {!isAttachment && isOpen && hasChildren && (
        <ul className="anim-tree-in space-y-px">
          {node.children!.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              activeId={activeId}
              drag={drag}
              drop={drop}
              canDropOn={canDropOn}
              onToggle={onToggle}
              onContextMenu={onContextMenu}
              onDragStateChange={onDragStateChange}
              onRowDragOver={onRowDragOver}
              onRowDrop={onRowDrop}
              onDragLeaveRow={onDragLeaveRow}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

function MenuItem({ icon, label, onClick, danger }: MenuItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-base text-left transition-colors hover:bg-[var(--bg-hover)] ${
        danger ? "text-red-600 dark:text-red-400" : "text-[var(--text-primary)]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
