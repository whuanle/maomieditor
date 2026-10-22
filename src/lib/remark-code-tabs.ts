import type { Code, Html, Root } from "mdast";

interface TabCodeBlock {
  label: string;
  value: string;
  lang: string;
  defaultTab: boolean;
}

interface CodeTabGroup {
  startIndex: number;
  endIndex: number; // 不包含
  tabs: TabCodeBlock[];
}

const TAB_META_RE = /\btab\s*=\s*"([^"]*)"/;
const DEFAULT_FLAG_RE = /\bdefault\b/i;

/**
 * 从代码块的 meta 字符串中解析 tab 标签。
 * 支持的 meta 写法：
 *   tab="C#"
 *   tab="C#" default
 *   tab="C#" default lang=...
 * 返回 null 表示该代码块不是 tab 代码块。
 */
function parseTabMeta(meta: string | null | undefined): { label: string; defaultTab: boolean } | null {
  if (!meta) {
    return null;
  }

  const labelMatch = meta.match(TAB_META_RE);
  if (!labelMatch) {
    return null;
  }

  const label = labelMatch[1].trim();
  if (!label) {
    return null;
  }

  return {
    label,
    defaultTab: DEFAULT_FLAG_RE.test(meta),
  };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * 把一组 tab 代码块渲染成一段完整的 HTML（作为 mdast 的 html 节点）。
 * 交给现有的 rehype-raw 解析为 hast，内部 <pre><code class="language-xxx"> 与
 * 普通代码块结构一致，Prism 可正常高亮。
 */
function buildCodeTabsHtml(tabs: TabCodeBlock[]): string {
  const itemsHtml = tabs
    .map((tab) => {
      const langClass = tab.lang ? ` class="language-${escapeHtml(tab.lang)}"` : "";
      const dataAttrs = `data-label="${escapeHtml(tab.label)}" data-lang="${escapeHtml(tab.lang)}"${tab.defaultTab ? " data-default=\"true\"" : ""}`;
      return `      <div class="codetab-item" ${dataAttrs}>
        <pre><code${langClass}>${escapeHtml(tab.value)}</code></pre>
      </div>`;
    })
    .join("\n");

  return `<div class="codetabs">\n${itemsHtml}\n    </div>`;
}

/**
 * remark 插件：把连续的、带 `tab="标签"` 标记的代码块分组成一个 Tabs 组，
 * 转换为 mdast 的 html 节点（内含完整的 <div class="codetabs"> 结构）。
 *
 * 用法（在笔记里）：
 *
 * ```csharp tab="C#"
 * var x = 1;
 * ```
 *
 * ```python tab="Python"
 * x = 1
 * ```
 *
 * 这两个相邻的代码块会被合并成一个可切换的 Tab 组。
 * 中间有空行没关系；只要中间没有非 tab 内容，就视为同一组。
 */
export function remarkCodeTabs() {
  return (tree: Root) => {
    const children = tree.children;
    const groups: CodeTabGroup[] = [];

    let i = 0;
    while (i < children.length) {
      const node = children[i];
      const meta = parseTabMeta(node.type === "code" ? (node as Code).meta : null);

      if (node.type === "code" && meta) {
        const startIndex = i;
        const tabs: TabCodeBlock[] = [];
        let seenDefault = false;

        while (i < children.length) {
          const current = children[i];
          if (current.type !== "code") {
            break;
          }
          const currentMeta = parseTabMeta((current as Code).meta);
          if (!currentMeta) {
            break;
          }
          const codeNode = current as Code;
          // 同一组里只允许一个 default；若已存在 default，忽略后续的 default 标记
          const isDefault = currentMeta.defaultTab && !seenDefault;
          if (isDefault) {
            seenDefault = true;
          }
          tabs.push({
            label: currentMeta.label,
            value: codeNode.value ?? "",
            lang: codeNode.lang ?? "",
            defaultTab: isDefault,
          });
          i += 1;
        }

        groups.push({ startIndex, endIndex: i, tabs });
        continue; // i 已经指向组后第一个非 tab 节点
      }

      i += 1;
    }

    if (groups.length === 0) {
      return;
    }

    // 从后往前替换，避免索引偏移
    for (let g = groups.length - 1; g >= 0; g -= 1) {
      const group = groups[g];
      const htmlNode: Html = {
        type: "html",
        value: buildCodeTabsHtml(group.tabs),
      };
      tree.children.splice(group.startIndex, group.endIndex - group.startIndex, htmlNode);
    }
  };
}
