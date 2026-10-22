"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, FileType2, ListX, X } from "lucide-react";
import type { TreeNode } from "@/lib/store";
import { useNotes } from "./notes-context";

function buildTitleMap(nodes: TreeNode[], map: Map<string, { title: string; type: string; icon?: string }>) {
  for (const node of nodes) {
    if (node.type !== "file") {
      map.set(node.id, { title: node.title, type: node.type, icon: node.icon });
    }
    if (node.children) {
      buildTitleMap(node.children, map);
    }
  }
}

function tabUrl(id: string, edit: boolean): string {
  return `/notes/${id}${edit ? "?edit=1" : ""}`;
}

interface TabMenuState {
  x: number;
  y: number;
  /** 右键的标签 id；标签被关掉后菜单不再渲染 */
  id: string;
}

function TabContextMenu({
  menu,
  disabled,
  onDismiss,
  onCloseTab,
  onCloseLeft,
  onCloseRight,
  onCloseOthers,
  onCloseAll,
}: {
  menu: TabMenuState;
  disabled: { left: boolean; right: boolean; others: boolean };
  /** 仅收起菜单（点击菜单外 / Esc / 窗口尺寸变化） */
  onDismiss: () => void;
  onCloseTab: () => void;
  onCloseLeft: () => void;
  onCloseRight: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        onDismiss();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };
    const onMove = () => onDismiss();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
    };
  }, [onDismiss]);

  function renderMenuItem(label: string, title: string, action: () => void, isDisabled = false) {
    return (
      <button
        type="button"
        disabled={isDisabled}
        onClick={action}
        title={title}
        className="block w-full px-3 py-1.5 text-left text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:pointer-events-none disabled:opacity-40"
      >
        {label}
      </button>
    );
  }

  // portal 到 body：标签栏容器有 overflow-x-auto，菜单在里面会被裁剪
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[60] min-w-44 overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] py-1 shadow-lg"
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {renderMenuItem("关闭", "关闭该标签", onCloseTab)}
      {renderMenuItem("关闭左侧标签", "关闭该标签左边的全部标签", onCloseLeft, disabled.left)}
      {renderMenuItem("关闭右侧标签", "关闭该标签右边的全部标签", onCloseRight, disabled.right)}
      {renderMenuItem("关闭其它标签", "除该标签外全部关闭", onCloseOthers, disabled.others)}
      {renderMenuItem("关闭所有标签", "关闭全部标签", onCloseAll)}
    </div>,
    document.body
  );
}

/** 顶部文档标签栏：浏览器风格浮动标签——圆角卡片彼此留隙，活动标签白底浮起；标签随数量自动压缩等宽，不再无限横向滚动 */
export function TabBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { tree, tabs, tabsReady, openTab, setTabEdit, closeTab, closeTabs, closeAllTabs } = useNotes();
  const [menu, setMenu] = useState<TabMenuState | null>(null);

  const activeId = useMemo(() => {
    if (!pathname.startsWith("/notes/")) {
      return "";
    }
    const id = pathname.slice("/notes/".length);
    return /^[0-9a-f]{12}$/.test(id) ? id : "";
  }, [pathname]);

  const editing = searchParams.get("edit") === "1";

  // 恢复完成后再响应导航：任何进入笔记页的导航都确保标签存在，并同步编辑态标记
  useEffect(() => {
    if (activeId && tabsReady) {
      openTab(activeId);
      setTabEdit(activeId, editing);
    }
  }, [activeId, editing, tabsReady, openTab, setTabEdit]);

  const titleMap = useMemo(() => {
    const map = new Map<string, { title: string; type: string; icon?: string }>();
    if (tree) {
      buildTitleMap(tree, map);
    }
    return map;
  }, [tree]);

  function handleClose(id: string) {
    const neighbor = closeTab(id);
    if (id === activeId) {
      router.push(neighbor ? tabUrl(neighbor.id, neighbor.edit) : "/notes");
    }
  }

  function handleCloseAll() {
    closeAllTabs();
    router.push("/notes");
  }

  function openMenu(event: React.MouseEvent, id: string) {
    event.preventDefault();
    // 靠近视口边缘时收回来一点，避免菜单溢出屏幕
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 200),
      id,
    });
  }

  const menuTabIndex = menu ? tabs.findIndex((tab) => tab.id === menu.id) : -1;

  /** 关闭左/右/其它后：当前激活标签若被关掉，切到右键的目标标签（三种模式下它都存活） */
  function closeWithMode(mode: "left" | "right" | "others") {
    if (!menu) {
      return;
    }
    const target = tabs.find((tab) => tab.id === menu.id);
    if (!target) {
      setMenu(null);
      return;
    }
    const remaining = closeTabs(target.id, mode);
    setMenu(null);
    if (!remaining.some((tab) => tab.id === activeId)) {
      router.push(tabUrl(target.id, target.edit));
    }
  }

  return (
    <div className="flex h-11 shrink-0 items-stretch gap-1 px-1.5 py-1">
      {tabs.length === 0 ? (
        <span className="flex items-center px-3 text-[13px] text-[var(--text-tertiary)]">
          未打开文档——在左侧点击一篇笔记开始
        </span>
      ) : (
        <div className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            const info = titleMap.get(tab.id);
            return (
              <div
                key={tab.id}
                className={`anim-slide-in group/tab relative flex min-w-[4.5rem] max-w-52 flex-1 cursor-pointer items-center gap-1.5 overflow-hidden rounded-lg pl-3 pr-1.5 text-[13px] transition-colors ${
                  active
                    ? "bg-[var(--tab-active-bg)] font-medium text-[var(--text-primary)]"
                    : "bg-[var(--tab-inactive-bg)] text-[var(--text-secondary)] hover:bg-[var(--tab-active-bg)] hover:text-[var(--text-primary)]"
                }`}
                onClick={() => router.push(tabUrl(tab.id, tab.edit))}
                onContextMenu={(event) => openMenu(event, tab.id)}
                title={info?.title ?? tab.id}
              >
                {info?.icon ? (
                  <span className="shrink-0 text-[14px] leading-none" aria-hidden>
                    {info.icon}
                  </span>
                ) : info?.type === "mdx" ? (
                  <FileType2 className="h-4 w-4 shrink-0 text-[var(--accent-400)]" />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
                )}
                {tab.edit && (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-[#3fb950]" title="编辑中（未保存改动会自动保存）" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {info?.title ?? "…"}
                </span>
                <button
                  type="button"
                  aria-label="关闭标签"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ${
                    active ? "opacity-80" : "opacity-0 group-hover/tab:opacity-80"
                  }`}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleClose(tab.id);
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {tabs.length > 0 && (
        <button
          type="button"
          aria-label="关闭全部标签"
          title="关闭全部标签"
          className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center self-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          onClick={handleCloseAll}
        >
          <ListX className="h-4 w-4" />
        </button>
      )}
      {menu && menuTabIndex >= 0 && (
        <TabContextMenu
          menu={menu}
          disabled={{
            left: menuTabIndex === 0,
            right: menuTabIndex === tabs.length - 1,
            others: tabs.length === 1,
          }}
          onDismiss={() => setMenu(null)}
          onCloseTab={() => {
            setMenu(null);
            handleClose(menu.id);
          }}
          onCloseLeft={() => closeWithMode("left")}
          onCloseRight={() => closeWithMode("right")}
          onCloseOthers={() => closeWithMode("others")}
          onCloseAll={() => {
            setMenu(null);
            handleCloseAll();
          }}
        />
      )}
    </div>
  );
}
