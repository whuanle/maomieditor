"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { TreeNode } from "@/lib/store";

// 客户端组件不能从 @/lib/store 导入运行时值（会把 node:fs 拉进浏览器 bundle），本地复制校验规则
const ID_RE = /^[0-9a-f]{12}$/;

/** 其他组件（保存/删除/上传后）通过该事件请求刷新树 */
export const TREE_REFRESH_EVENT = "notes:tree-refresh";

export function refreshTree() {
  window.dispatchEvent(new CustomEvent(TREE_REFRESH_EVENT));
}

export interface TabInfo {
  id: string;
}

interface NotesContextValue {
  tree: TreeNode[] | null;
  loadTree: () => Promise<void>;
  tabs: TabInfo[];
  tabsReady: boolean;
  openTab: (id: string) => void;
  /** 关闭标签，返回应激活的相邻标签（优先左侧） */
  closeTab: (id: string) => TabInfo | null;
  /** 关闭某标签左侧/右侧/其它标签，返回剩余标签（调用方据此决定是否需要切换激活页） */
  closeTabs: (id: string, mode: "left" | "right" | "others") => TabInfo[];
  /** 关闭全部标签 */
  closeAllTabs: () => void;
}

const NotesContext = createContext<NotesContextValue | null>(null);

export function useNotes(): NotesContextValue {
  const value = useContext(NotesContext);
  if (!value) {
    throw new Error("useNotes 必须在 NotesProvider 内使用");
  }
  return value;
}

const TABS_STORAGE_KEY = "notes-tabs";

function collectNoteIds(nodes: TreeNode[], out: Set<string>) {
  for (const node of nodes) {
    if (node.type !== "file") {
      out.add(node.id);
    }
    if (node.children) {
      collectNoteIds(node.children, out);
    }
  }
}

/** 工作台共享状态：文档树 + 打开的标签页（localStorage 记忆） */
export function NotesProvider({ children }: { children: ReactNode }) {
  const [tree, setTree] = useState<TreeNode[] | null>(null);
  const [tabs, setTabs] = useState<TabInfo[]>([]); // 首帧后再恢复，避免 SSR/CSR 不一致
  const [tabsReady, setTabsReady] = useState(false); // localStorage 恢复完成前不响应导航开标签

  const loadTree = useCallback(async () => {
    try {
      const response = await fetch("/api/notes/tree", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { tree: TreeNode[] };
      setTree(data.tree);
    } catch {
      // 网络异常时保留旧树
    }
  }, []);

  useEffect(() => {
    void loadTree();
    const handler = () => void loadTree();
    window.addEventListener(TREE_REFRESH_EVENT, handler);
    return () => window.removeEventListener(TREE_REFRESH_EVENT, handler);
  }, [loadTree]);

  // 恢复上次的标签页（在子组件的 openTab effect 之前完成，避免被覆盖）
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(TABS_STORAGE_KEY) ?? "[]");
      if (Array.isArray(saved)) {
        setTabs(
          saved
            .filter((tab): tab is { id: string } => typeof tab?.id === "string" && ID_RE.test(tab.id))
            .map((tab) => ({ id: tab.id }))
        );
      }
    } catch {
      // 损坏的存储忽略
    }
    setTabsReady(true);
  }, []);

  // 标签页变化即持久化
  useEffect(() => {
    if (tabsReady) {
      window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
    }
  }, [tabs, tabsReady]);

  // 树就绪后剔除已不存在的标签（笔记被删/回收站）
  useEffect(() => {
    if (!tree) {
      return;
    }
    const alive = new Set<string>();
    collectNoteIds(tree, alive);
    setTabs((prev) => (prev.some((tab) => !alive.has(tab.id)) ? prev.filter((tab) => alive.has(tab.id)) : prev));
  }, [tree]);

  const openTab = useCallback((id: string) => {
    setTabs((prev) => (prev.some((tab) => tab.id === id) ? prev : [...prev, { id }]));
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      let neighbor: TabInfo | null = null;
      setTabs((prev) => {
        const index = prev.findIndex((tab) => tab.id === id);
        if (index < 0) {
          return prev;
        }
        neighbor = prev[index - 1] ?? prev[index + 1] ?? null;
        return prev.filter((tab) => tab.id !== id);
      });
      return neighbor;
    },
    []
  );

  const closeAllTabs = useCallback(() => {
    setTabs([]);
  }, []);

  const closeTabs = useCallback((id: string, mode: "left" | "right" | "others"): TabInfo[] => {
    let remaining: TabInfo[] = [];
    setTabs((prev) => {
      const index = prev.findIndex((tab) => tab.id === id);
      if (index < 0) {
        remaining = prev;
        return prev;
      }
      remaining =
        mode === "left"
          ? prev.slice(index)
          : mode === "right"
            ? prev.slice(0, index + 1)
            : [prev[index]];
      return remaining;
    });
    return remaining;
  }, []);

  return (
    <NotesContext.Provider
      value={{ tree, loadTree, tabs, tabsReady, openTab, closeTab, closeTabs, closeAllTabs }}
    >
      {children}
    </NotesContext.Provider>
  );
}
