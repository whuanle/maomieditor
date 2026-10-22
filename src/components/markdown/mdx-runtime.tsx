"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Children, isValidElement } from "react";
import Link from "next/link";
import * as runtime from "react/jsx-runtime";
import { resolveAssetSrc, resolveNoteHref } from "@/lib/markdown-path";
import { ZoomableImage } from "./zoomable-image";
import { MermaidDiagram } from "./mermaid-diagram";
import { CodeTabs } from "./doc-tabs";

/**
 * MDX 浏览器端运行时（next-mdx-remote 同款架构）：
 * 服务端用 @mdx-js/mdx 编译成 function-body 字符串，浏览器里 new Function 求值。
 * 组件映射全部是本模块（"use client"）里的真实组件，可被 RSC 序列化。
 */

interface MdxRenderOptions {
  notePath: string;
  assetBase: string;
  mode: "app" | "share";
}

const MdxRenderContext = createContext<MdxRenderOptions>({
  notePath: "",
  assetBase: "/api/attachments",
  mode: "app",
});

function MdxDiv({ className, children, ...props }: ComponentPropsWithoutRef<"div">) {
  if (typeof className === "string" && className.includes("codetabs")) {
    return <CodeTabs>{children}</CodeTabs>;
  }
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}

function MdxPre({ children }: ComponentPropsWithoutRef<"pre">) {
  const firstChild = Children.count(children) > 0 ? Children.toArray(children)[0] : null;

  if (
    isValidElement<{ className?: string }>(firstChild) &&
    typeof firstChild.props.className === "string" &&
    firstChild.props.className.includes("language-mermaid")
  ) {
    return <>{children}</>;
  }

  return (
    <pre tabIndex={0} className="bg-[var(--code-bg)] border border-[var(--code-border)] rounded-md p-4 my-4 overflow-x-auto">
      {children}
    </pre>
  );
}

function MdxCode({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";

  if (language.toLowerCase() === "mermaid") {
    const chart = String(children).trim();
    return <MermaidDiagram chart={chart} />;
  }

  if (className) {
    return (
      <code className={language ? `language-${language}` : ""} {...props}>
        {children}
      </code>
    );
  }

  return (
    <code className="px-1.5 py-0.5 bg-[var(--code-bg)] text-[var(--accent-600)] rounded text-sm font-mono">
      {children}
    </code>
  );
}

function MdxImg({ src, alt, ...props }: ComponentPropsWithoutRef<"img">) {
  const { notePath, assetBase } = useContext(MdxRenderContext);
  const imageSrc = typeof src === "string" ? src : undefined;
  const resolved = imageSrc && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(imageSrc)
    ? resolveAssetSrc(imageSrc, assetBase, notePath)
    : imageSrc;

  return (
    <ZoomableImage
      src={resolved}
      alt={alt}
      className="block max-w-full mx-auto rounded-md my-6 cursor-zoom-in border border-[var(--border-default)]"
      {...props}
    />
  );
}

function MdxVideo({ className, children, src, ...props }: ComponentPropsWithoutRef<"video">) {
  const { notePath, assetBase } = useContext(MdxRenderContext);
  const resolved = typeof src === "string" && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src)
    ? resolveAssetSrc(src, assetBase, notePath)
    : src;

  return (
    <video
      className={className ?? "block max-w-full mx-auto rounded-md my-6 border border-[var(--border-default)]"}
      src={resolved}
      controls
      preload="metadata"
      {...props}
    >
      {children}
    </video>
  );
}

function MdxAnchor({ href, children, ...props }: ComponentPropsWithoutRef<"a">) {
  const { notePath, assetBase, mode } = useContext(MdxRenderContext);

  if (href) {
    const resolved = resolveNoteHref(href, assetBase, notePath);

    if (resolved?.kind === "note") {
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
      return (
        <a href={resolved.url} {...props}>
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
}

const MDX_COMPONENTS = {
  div: MdxDiv,
  pre: MdxPre,
  code: MdxCode,
  img: MdxImg,
  video: MdxVideo,
  a: MdxAnchor,
};

interface MdxRuntimeProps extends MdxRenderOptions {
  /** @mdx-js/mdx outputFormat: "function-body" 的编译产物 */
  code: string;
}

function evaluateFunctionBody(code: string): (props?: { components?: typeof MDX_COMPONENTS }) => ReactNode {
  // function-body 产物从 arguments[0] 解构 jsx runtime，并以 `return { default: MDXContent }` 收尾
  type MdxFactory = (jsxRuntime: typeof runtime) => {
    default: (props?: { components?: typeof MDX_COMPONENTS }) => ReactNode;
  };
  const factory = new Function(code) as unknown as MdxFactory;
  return factory(runtime).default;
}

export function MdxRuntime({ code, notePath, assetBase, mode }: MdxRuntimeProps) {
  const MDXContent = useMemo(() => evaluateFunctionBody(code), [code]);

  return (
    <MdxRenderContext.Provider value={{ notePath, assetBase, mode }}>
      <div className="docs-prose">
        <MdxInner Content={MDXContent} />
      </div>
    </MdxRenderContext.Provider>
  );
}

function MdxInner({ Content }: { Content: (props?: { components?: typeof MDX_COMPONENTS }) => ReactNode }) {
  // MDX 渲染完成后补 Prism 高亮
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    const PrismPromise = import("prismjs").then((Prism) => {
      if (!cancelled && ref.current) {
        Prism.default.highlightAllUnder(ref.current);
      }
    });
    return () => {
      cancelled = true;
    };
    void PrismPromise;
  }, [Content]);

  return (
    <div ref={ref}>
      <Content components={MDX_COMPONENTS} />
    </div>
  );
}
