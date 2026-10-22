import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import { stripFrontmatter } from "@/lib/markdown";
import { remarkCodeTabs } from "@/lib/remark-code-tabs";
import { MdxRuntime } from "./mdx-runtime";

interface MdxContentProps {
  content: string;
  notePath: string;
  assetBase?: string;
  mode?: "app" | "share";
}

/**
 * 服务端：编译 MDX 为 function-body 字符串，交给浏览器端 MdxRuntime 求值渲染
 * （闭包/动态组件无法进入 RSC Flight 序列化树，因此不能用 evaluate 直渲染）。
 */
export async function MdxContent({ content, notePath, assetBase = "/api/attachments", mode = "app" }: MdxContentProps) {
  const source = stripFrontmatter(content);

  const compiled = await compile(source, {
    outputFormat: "function-body",
    development: false,
    remarkPlugins: [remarkGfm, remarkBreaks, remarkMath, remarkCodeTabs],
    rehypePlugins: [
      // MDX 里存在 jsx/esm 节点，rehype-raw 必须放行它们（见 @mdx-js/mdx 文档）
      [rehypeRaw, { passThrough: ["mdxFlowExpression", "mdxJsxFlowElement", "mdxJsxTextElement", "mdxTextExpression", "mdxjsEsm"] }],
      rehypeSlug,
      rehypeKatex,
    ],
  });

  return (
    <MdxRuntime
      code={String(compiled.value)}
      notePath={notePath}
      assetBase={assetBase}
      mode={mode}
    />
  );
}
