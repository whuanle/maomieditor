"use client";

/**
 * Vditor 即时渲染（IR）编辑器封装（客户端专用，父组件以 dynamic(ssr:false) 加载）。
 *
 * - Typora 式体验：直接输入 markdown 语法（``` 围栏、| 表格、# 标题、**加粗**）即时渲染
 * - 工具栏「编辑模式」可切 IR / 所见即所得 / 分屏源码（SV 模式即纯源码编辑）
 * - 图片插入/粘贴/拖入自动上传为当前笔记的内嵌附件（/api/upload，inline=1，不在目录树显示），
 *   其余文件同样上传并挂到当前笔记下（目录树可见），正文插入 `[文件名](相对引用)` 链接；
 *   引用统一写 ../../files/{分桶}/{id}.{ext}，浏览器在 /notes/{id} 页面下解析到 /files 路由，
 *   阅读管线再按附件 ID 还原成 /api/attachments/{id}
 * - Ctrl/Cmd+S 保存由外层容器捕获处理
 */

import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import Vditor from "vditor";
import "vditor/dist/index.css";
import { refreshTree } from "./sidebar";

/**
 * lute（markdown 引擎 WASM）、mermaid、katex、代码高亮按需从这里加载。
 * 资源已在构建外复制到 public/vendor/vditor/dist（scripts/sync-vditor-assets.mjs），
 * 不依赖 unpkg 外网 CDN。
 */
const VDITOR_CDN = "/vendor/vditor";

interface RichEditorProps {
  /** 笔记 ID（用于附件归属上传目录与 key 复位） */
  noteId: string;
  initialContent: string;
  onChange: (markdown: string) => void;
  onSave: () => void;
}

function isDarkTheme() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export default function RichEditor({ noteId, initialContent, onChange, onSave }: RichEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vditorRef = useRef<Vditor | null>(null);
  const noteIdRef = useRef(noteId);
  noteIdRef.current = noteId;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const uploadFiles = useCallback(async (files: File[]) => {
    const vditor = vditorRef.current;
    if (!vditor) {
      return;
    }
    for (const file of files) {
      const isImage =
        file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(file.name);
      const formData = new FormData();
      formData.set("noteId", noteIdRef.current);
      // 图片属于正文内容，不在目录树中显示；其余文件挂为笔记附件（目录树可见）
      if (isImage) {
        formData.set("inline", "1");
      }
      formData.append("file", file);

      let data: { error?: string; attachments?: { id: string; name: string; path: string }[] };
      try {
        const response = await fetch("/api/upload", { method: "POST", body: formData });
        data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "文件上传失败");
        }
      } catch (error) {
        vditor.tip(error instanceof Error ? error.message : "文件上传失败");
        return;
      }

      refreshTree();
      const saved = data.attachments?.[0];
      if (saved) {
        // 图片内嵌显示，其余文件插入链接引用；路径为编辑器/阅读管线可解析的相对引用
        const label = file.name.replace(/[\\[\]]/g, "");
        const ref = isImage ? `![${label}](${saved.path})` : `[${label}](${saved.path})`;
        vditor.insertValue(`${ref}\n`);
      }
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || vditorRef.current) {
      return;
    }
    // 宿主元素在 effect 内创建：清理时直接 detach，未完成的异步初始化
    //（React StrictMode 开发模式会立即挂载→卸载→再挂载）无处渲染
    const host = document.createElement("div");
    host.className = "vditor-instance h-full min-h-0";
    container.appendChild(host);
    const dark = isDarkTheme();
    const vditor = new Vditor(host, {
      cdn: VDITOR_CDN,
      mode: "ir",
      value: initialContent,
      height: "100%",
      lang: "zh_CN",
      icon: "ant",
      placeholder: "开始书写笔记…",
      cache: { enable: false },
      theme: dark ? "dark" : "classic",
      toolbar: [
        "undo",
        "redo",
        "|",
        "headings",
        "bold",
        "italic",
        "strike",
        "inline-code",
        "|",
        "list",
        "ordered-list",
        "check",
        "quote",
        "line",
        "|",
        "code",
        "table",
        "link",
        "upload",
        "|",
        "edit-mode",
        "fullscreen",
      ],
      preview: {
        // 内容宽度由 .vditor-reset 上的 --content-max-width 控制，关掉 vditor 自身 768 上限
        maxWidth: 100000,
        theme: {
          current: dark ? "dark" : "light",
          path: `${VDITOR_CDN}/dist/css/content-theme`,
        },
        hljs: {
          enable: true,
          lineNumber: false,
          style: dark ? "github-dark" : "github",
        },
        math: { engine: "KaTeX" },
        markdown: {
          // 笔记正文含内嵌 HTML/MDX 片段，单用户本地应用无需 XSS 过滤，避免被清洗
          sanitize: false,
        },
      },
      input: (markdown) => onChangeRef.current(markdown),
      upload: {
        multiple: true,
        handler: (files) => {
          void uploadFiles(files);
          return null;
        },
      },
    });
    vditorRef.current = vditor;
    return () => {
      host.remove();
      try {
        vditor.destroy();
      } catch {
        // 异步初始化未完成时 this.vditor 尚未赋值，destroy 会抛错；宿主已移除，安全
      }
      vditorRef.current = null;
    };
    // 父组件以 key={noteId} 挂载，切换笔记必走重挂载，这里只需初始化一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题跟随 html.dark（外观设置切换时热更新，不重建编辑器、不丢光标/撤销栈）
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = root.classList.contains("dark");
      vditorRef.current?.setTheme(
        dark ? "dark" : "classic",
        dark ? "dark" : "light",
        dark ? "github-dark" : "github"
      );
    };
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      event.stopPropagation();
      saveRef.current();
    }
  }, []);

  return (
    <div className="rich-editor-shell h-full min-h-0" onKeyDownCapture={handleKeyDown}>
      <div ref={containerRef} className="h-full min-h-0" />
    </div>
  );
}
