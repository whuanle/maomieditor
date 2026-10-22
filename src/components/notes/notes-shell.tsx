"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { SettingsOverlay } from "@/components/settings/settings-overlay";
import { AttachmentPreviewHost } from "./attachment-preview";
import { NoteSidebar } from "./sidebar";
import { NotesProvider } from "./notes-context";
import { ProtectionKeepAlive } from "./protection-keepalive";
import { TabBar } from "./tab-bar";
import { TrashPage } from "./trash-page";

const STORAGE_KEY = "notes-sidebar-width";
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256;

/** 工作台外壳：侧边栏 + 可拖拽调宽的分隔条 + 顶部标签栏 + 内容区 */
export function NotesShell({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const widthRef = useRef(width);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) {
      widthRef.current = saved;
      setWidth(saved);
    }
  }, []);

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // 窗口比保存的侧边栏宽度还窄时收缩侧边栏，给内容区至少留 200px
  const effectiveWidth =
    viewportWidth > 0 ? Math.min(width, Math.max(MIN_WIDTH, viewportWidth - 200)) : width;

  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setDragging(true);

    const move = (e: MouseEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      widthRef.current = next;
      setWidth(next);
    };
    const up = () => {
      window.localStorage.setItem(STORAGE_KEY, String(widthRef.current));
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDragging(false);
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, []);

  return (
    <NotesProvider>
      <ProtectionKeepAlive />
      <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)]">
        <NoteSidebar width={effectiveWidth} onOpenSettings={() => setSettingsOpen(true)} onOpenTrash={() => setTrashOpen(true)} />
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startResize}
          onDoubleClick={() => {
            widthRef.current = DEFAULT_WIDTH;
            setWidth(DEFAULT_WIDTH);
            window.localStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH));
          }}
          className={`relative z-10 -ml-px w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--accent-600)] ${
            dragging ? "bg-[var(--accent-600)]" : ""
          }`}
          title="拖动调整宽度（双击复位）"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TabBar />
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>

      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
      {trashOpen && <TrashPage onClose={() => setTrashOpen(false)} />}

      <AttachmentPreviewHost />
    </NotesProvider>
  );
}
