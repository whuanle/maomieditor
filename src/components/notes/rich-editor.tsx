"use client";

/**
 * MDXEditor 富文本编辑器封装（客户端专用，父组件以 dynamic(ssr:false) 加载）。
 *
 * - 富文本模式为主，工具栏含「源码/差异」切换（diffSourcePlugin），
 *   复杂语法（内嵌 HTML、MDX export 等）可切源码模式保真编辑
 * - 图片插入/粘贴自动上传为当前笔记的附件（/api/upload），插入 /api/attachments URL
 * - Ctrl/Cmd+S 保存由外层容器捕获处理
 */

import { useCallback, useMemo, useRef, type KeyboardEvent } from "react";
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  frontmatterPlugin,
  tablePlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  toolbarPlugin,
  markdownShortcutPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  ListsToggle,
  BlockTypeSelect,
  CreateLink,
  InsertImage,
  InsertTable,
  InsertCodeBlock,
  CodeToggle,
  InsertThematicBreak,
  DiffSourceToggleWrapper,
  Separator,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { refreshTree } from "./sidebar";

/** 需在 codeBlockLanguages 里登记，CodeMirror 才接管该语言并保留 fence meta（如 tab="X"） */
const CODE_BLOCK_LANGUAGES: Record<string, string> = {
  bash: "Bash",
  shell: "Shell",
  sh: "Shell",
  powershell: "PowerShell",
  javascript: "JavaScript",
  js: "JavaScript",
  typescript: "TypeScript",
  ts: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  react: "React",
  css: "CSS",
  scss: "SCSS",
  html: "HTML",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  markdown: "Markdown",
  md: "Markdown",
  mdx: "MDX",
  python: "Python",
  java: "Java",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  go: "Go",
  rust: "Rust",
  sql: "SQL",
  docker: "Docker",
  dockerfile: "Dockerfile",
  nginx: "Nginx",
  text: "Plain Text",
  txt: "Plain Text",
};

interface RichEditorProps {
  /** 笔记 ID（用于附件归属上传目录与 key 复位） */
  noteId: string;
  initialContent: string;
  onChange: (markdown: string) => void;
  onSave: () => void;
}

export default function RichEditor({ noteId, initialContent, onChange, onSave }: RichEditorProps) {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const handleImageUpload = useCallback(
    async (image: File): Promise<string> => {
      const formData = new FormData();
      formData.set("noteId", noteId);
      formData.set("inline", "1"); // 粘贴/插入的图片属于正文，不在目录树中显示
      formData.append("file", image);

      const response = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "图片上传失败");
      }

      refreshTree();
      const saved = data.attachments[0] as { id: string; path: string };
      // 插入本地编辑器可解析的相对引用（../../files/{分桶}/{id}.{ext}），
      // Web 渲染管线会按附件 ID 还原成 /api/attachments/{id}
      return saved.path;
    },
    [noteId]
  );

  const plugins = useMemo(
    () => [
      toolbarPlugin({
        toolbarContents: () => (
          <DiffSourceToggleWrapper>
            <UndoRedo />
            <Separator />
            <BlockTypeSelect />
            <BoldItalicUnderlineToggles />
            <CodeToggle />
            <Separator />
            <ListsToggle />
            <Separator />
            <CreateLink />
            <InsertImage />
            <InsertTable />
            <InsertCodeBlock />
            <InsertThematicBreak />
          </DiffSourceToggleWrapper>
        ),
      }),
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      markdownShortcutPlugin(),
      tablePlugin(),
      frontmatterPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      imagePlugin({ imageUploadHandler: handleImageUpload, imageAutocompleteSuggestions: [] }),
      // codeBlockPlugin 注册 code 节点的导入/导出支持，codeMirrorPlugin 提供 CodeMirror 编辑面；
      // 缺少前者时导入会在第一个代码块处静默截断
      codeBlockPlugin(),
      codeMirrorPlugin({ codeBlockLanguages: CODE_BLOCK_LANGUAGES }),
      diffSourcePlugin({ viewMode: "rich-text" }),
    ],
    [handleImageUpload]
  );

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      event.stopPropagation();
      saveRef.current();
    }
  }, []);

  return (
    <div className="rich-editor-shell h-full min-h-0" onKeyDownCapture={handleKeyDown}>
      <MDXEditor
        className="mdxeditor-full-height"
        markdown={initialContent}
        onChange={onChange}
        plugins={plugins}
        contentEditableClassName="docs-prose rich-editor-content"
        placeholder="开始书写笔记…"
        spellCheck={false}
      />
    </div>
  );
}
