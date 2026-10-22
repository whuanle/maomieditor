"use client";

import { Children, isValidElement, useState, type ComponentPropsWithoutRef, useEffect, useRef } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import Prism from "prismjs";
import { stripFrontmatter } from "@/lib/markdown";
import { resolveAssetSrc, resolveNoteHref } from "@/lib/markdown-path";
import { openAttachmentPreviewFromUrl } from "@/components/notes/attachment-preview";
import { ZoomableImage } from "./zoomable-image";
import { MermaidDiagram } from "./mermaid-diagram";
import { CodeTabs } from "./doc-tabs";
import { remarkCodeTabs } from "@/lib/remark-code-tabs";

// 导入 PrismJS 语言支持
import "prismjs/components/prism-bash";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-css";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-nginx";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-shell-session";

interface DocContentClientProps {
  content: string;
  /** 笔记相对 docs 根的路径，用于解析相对资源与链接 */
  notePath: string;
  /** 资源服务前缀，默认 /api/attachments；分享页传 /api/public/share/{token}/attachments */
  assetBase?: string;
  /** app：笔记间链接可跳转；share：笔记链接渲染为纯文本 */
  mode?: "app" | "share";
}

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: {
    start?: {
      line?: number;
    };
    end?: {
      line?: number;
    };
  };
}

const GAP_PRESERVING_PARENT_TYPES = new Set(["root", "blockquote", "listItem"]);

/** 提取链接/节点的纯文本，用作附件预览的显示名 */
function childText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(childText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    if (props && "children" in props) return childText(props.children);
  }
  return "";
}

function createBreakNodes(count: number): MarkdownNode[] {
  if (count <= 0) {
    return [];
  }

  return Array.from({ length: count }, () => ({
    type: "html",
    value: "<br />",
  }));
}

function getExtraBlankLineCount(current: MarkdownNode, next: MarkdownNode): number {
  const endLine = current.position?.end?.line;
  const startLine = next.position?.start?.line;

  if (typeof endLine !== "number" || typeof startLine !== "number") {
    return 0;
  }

  return Math.max(0, startLine - endLine - 2);
}

function preserveBlankLines(node: MarkdownNode) {
  if (!Array.isArray(node.children) || node.children.length === 0) {
    return;
  }

  const originalChildren = [...node.children];

  for (const child of originalChildren) {
    preserveBlankLines(child);
  }

  if (node.type === "list") {
    for (let index = 0; index < originalChildren.length - 1; index += 1) {
      const currentChild = originalChildren[index];
      const nextChild = originalChildren[index + 1];
      const extraBlankLines = getExtraBlankLineCount(currentChild, nextChild);

      if (extraBlankLines > 0 && Array.isArray(currentChild.children)) {
        currentChild.children = [
          ...currentChild.children,
          ...createBreakNodes(1),
        ];
      }
    }

    return;
  }

  if (!GAP_PRESERVING_PARENT_TYPES.has(node.type)) {
    return;
  }

  const nextChildren: MarkdownNode[] = [];

  for (let index = 0; index < originalChildren.length; index += 1) {
    const currentChild = originalChildren[index];
    const nextChild = originalChildren[index + 1];

    nextChildren.push(currentChild);

    if (!nextChild) {
      continue;
    }

    const extraBlankLines = getExtraBlankLineCount(currentChild, nextChild);

    if (extraBlankLines > 0) {
      nextChildren.push(...createBreakNodes(1));
    }
  }

  node.children = nextChildren;
}

function remarkPreserveBlankLines() {
  return (tree: MarkdownNode) => {
    preserveBlankLines(tree);
  };
}

function PreBlock({ children }: { children?: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = preRef.current?.textContent ?? "";
    if (!text) {
      return;
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="codeblock-wrap relative group my-4">
      <pre ref={preRef} tabIndex={0} className="bg-[var(--code-bg)] border border-[var(--code-border)] rounded-md p-4 overflow-x-auto">
        {children}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 p-2 text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] rounded-md opacity-0 group-hover:opacity-100 transition-all duration-200 hover:text-[var(--text-primary)] border border-[var(--border-default)]"
        title="复制代码"
        aria-label="复制代码"
      >
        {copied ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    </div>
  );
}

export function DocContentClient({
  content,
  notePath,
  assetBase = "/api/attachments",
  mode = "app",
}: DocContentClientProps) {
  const articleRef = useRef<HTMLDivElement>(null);

  // 预处理 content
  let processedContent = content;

  // 1. 移除 frontmatter
  processedContent = stripFrontmatter(processedContent);

  // 2. 处理图片/视频路径
  // markdown 视频语法 ![alt](demo.mp4) 转为 <video> 播放器
  processedContent = processedContent.replace(
    /!\[([^\]]*)\]\(([^)]+\.(?:mp4|m4v|webm|mov|ogv))\)/gi,
    (_match, _alt, src) => {
      return `<video controls preload="metadata" src="${resolveAssetSrc(src, assetBase, notePath)}"></video>`;
    }
  );

  // 处理 markdown 图片路径 ![alt](src)
  processedContent = processedContent.replace(
    /!\[([^\]]*)\]\((?!http|\/)([^)]+)\)/g,
    (_match, alt, src) => {
      return `![${alt}](${resolveAssetSrc(src, assetBase, notePath)})`;
    }
  );

  // 处理 HTML img 标签的 src
  processedContent = processedContent.replace(
    /<img\s+([^\u003e]*)src=["'](?!http|\/)([^"']+)["']([^\u003e]*)\u003e/g,
    (_match, before, src, after) => {
      return `<img ${before}src="${resolveAssetSrc(src, assetBase, notePath)}"${after}>`;
    }
  );

  // 处理 HTML video / source 标签的 src
  processedContent = processedContent.replace(
    /(<video\b[^\u003e]*?\bsrc=["'])(?!http|\/)([^"']+)(["'])/gi,
    (_match, prefix, src, quote) => `${prefix}${resolveAssetSrc(src, assetBase, notePath)}${quote}`
  );

  processedContent = processedContent.replace(
    /(<source\b[^\u003e]*?\bsrc=["'])(?!http|\/)([^"']+)(["'])/gi,
    (_match, prefix, src, quote) => `${prefix}${resolveAssetSrc(src, assetBase, notePath)}${quote}`
  );

  // 高亮代码 - 延迟执行确保 ReactMarkdown 渲染完成
  useEffect(() => {
    const timer = setTimeout(() => {
      if (articleRef.current) {
        Prism.highlightAllUnder(articleRef.current);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [processedContent]);

  const markdownComponents = {
    // div 拦截：把 remark-code-tabs 产出的 <div class="codetabs"> 交给 CodeTabs 渲染
    div({ className, children, ...props }: ComponentPropsWithoutRef<"div">) {
      if (typeof className === "string" && className.includes("codetabs")) {
        return <CodeTabs>{children}</CodeTabs>;
      }
      return (
        <div className={className} {...props}>
          {children}
        </div>
      );
    },
    // 自定义 pre 标签（代码块容器，带复制按钮）
    pre({ children }: ComponentPropsWithoutRef<"pre">) {
      const firstChild = Children.count(children) > 0 ? Children.toArray(children)[0] : null;

      if (
        isValidElement<{ className?: string }>(firstChild) &&
        typeof firstChild.props.className === "string" &&
        firstChild.props.className.includes("language-mermaid")
      ) {
        return <>{children}</>;
      }

      return <PreBlock>{children}</PreBlock>;
    },
    // 自定义 table 标签：包一层横向滚动容器，超宽表格滚动查看而不挤压列或撑破正文
    table({ children, node: _node, ...props }: ComponentPropsWithoutRef<"table"> & { node?: unknown }) {
      return (
        <div className="table-wrap">
          <table {...props}>{children}</table>
        </div>
      );
    },
    // 自定义 code 标签
    code({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
      const match = /language-(\w+)/.exec(className || "");
      const language = match ? match[1] : "";

      if (language.toLowerCase() === "mermaid") {
        const chart = String(children).trim();
        return <MermaidDiagram chart={chart} />;
      }

      // 如果是代码块（有 className），只返回 code 标签，因为 pre 已经由上面的组件处理了
      if (className) {
        return (
          <code className={language ? `language-${language}` : ""} {...props}>
            {children}
          </code>
        );
      }

      // 行内代码
      return (
        <code className="px-1.5 py-0.5 bg-[var(--code-bg)] text-[var(--accent-600)] rounded text-sm font-mono">
          {children}
        </code>
      );
    },
    // 自定义图片
    img({ src, alt, ...props }: ComponentPropsWithoutRef<"img">) {
      const imageSrc = typeof src === "string" ? src : undefined;

      return (
        <ZoomableImage
          src={imageSrc}
          alt={alt}
          className="block max-w-full mx-auto rounded-md my-6 cursor-zoom-in border border-[var(--border-default)]"
          {...props}
        />
      );
    },
    // 自定义视频：统一宽度样式，默认可控制播放
    video({ className, children, node: _node, ...props }: ComponentPropsWithoutRef<"video"> & { node?: unknown }) {
      return (
        <video
          className={className ?? "block max-w-full mx-auto rounded-md my-6 border border-[var(--border-default)]"}
          {...props}
          controls
          preload="metadata"
        >
          {children}
        </video>
      );
    },
    a({ href, children, node: _node, ...props }: ComponentPropsWithoutRef<"a"> & { node?: unknown }) {
      if (href) {
        const resolved = resolveNoteHref(href, assetBase, notePath);

        if (resolved?.kind === "note") {
          // 分享页里笔记间链接不可跳转（未分享的笔记不暴露）
          if (mode === "share") {
            return <span className="text-[var(--text-secondary)]">{children}</span>;
          }
          return (
            <Link href={resolved.url} {...props}>
              {children}
            </Link>
          );
        }

        if (resolved?.kind === "asset") {
          // 分享页没有登录态，保持原下载链接；站内左键点击改为先预览（中键/修饰键保留默认行为）
          if (mode === "share") {
            return (
              <a href={resolved.url} {...props}>
                {children}
              </a>
            );
          }
          return (
            <a
              href={resolved.url}
              {...props}
              onClick={(event) => {
                if (
                  event.button === 0 &&
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey &&
                  openAttachmentPreviewFromUrl(resolved.url, childText(children))
                ) {
                  event.preventDefault();
                }
              }}
            >
              {children}
            </a>
          );
        }
      }

      if (href && href.startsWith("/")) {
        return (
          <Link href={href} {...props}>
            {children}
          </Link>
        );
      }

      return (
        <a href={href} {...props}>
          {children}
        </a>
      );
    },
  } as Components;

  return (
    <div ref={articleRef} className="docs-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks, remarkMath, remarkCodeTabs, remarkPreserveBlankLines]}
        rehypePlugins={[rehypeSlug, rehypeRaw, rehypeKatex]}
        components={markdownComponents}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}
