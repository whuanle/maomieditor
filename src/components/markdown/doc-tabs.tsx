"use client";

import {
  Children,
  isValidElement,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

interface TabPanelData {
  label: string;
  content: ReactNode;
}

interface CodeTabsProps {
  children?: ReactNode;
}

/**
 * 代码块 Tab 切换组件。
 *
 * 由 src/lib/remark-code-tabs.ts 产出 `<div class="codetabs">` 结构，
 * 经 rehype-raw 解析后，react-markdown 的 `div` 组件在 className 含 "codetabs"
 * 时把内部 children 交给本组件渲染。
 *
 * 传入的 children 是若干 `<div class="codetab-item" data-label="C#" data-lang="csharp">`
 * 元素，每个内部包含一个 `<pre><code class="language-xxx">` 代码块。
 *
 * 渲染逻辑：
 * - 从每个 codetab-item 提取 data-label 作为 tab 标题，内部 pre 作为面板内容
 * - 默认选中第一个（或带 data-default 的）
 * - 所有面板常驻 DOM，靠 hidden 切换 —— Prism 首屏已高亮全部代码，切换不闪烁
 */
export function CodeTabs({ children }: CodeTabsProps) {
  const panels: TabPanelData[] = [];
  let defaultIndex = 0;

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      return;
    }
    const props = child.props as ComponentPropsWithoutRef<"div"> & {
      "data-label"?: string;
      "data-default"?: string;
    };
    // 只收集 codetab-item（跳过文本节点等）
    const className = typeof props.className === "string" ? props.className : "";
    if (!className.includes("codetab-item")) {
      return;
    }

    const label = props["data-label"] ?? "code";
    const isDefault = props["data-default"] === "true";

    if (isDefault && panels.length > 0 && defaultIndex === 0) {
      defaultIndex = panels.length;
    }
    panels.push({ label, content: props.children });
  });

  const [activeIndex, setActiveIndex] = useState<number>(
    defaultIndex < panels.length ? defaultIndex : 0
  );

  if (panels.length === 0) {
    return <div className="my-4">{children}</div>;
  }

  return (
    <div className="my-4">
      {/* Tab 头：横向滚动，防止 tab 过多换行 */}
      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto border-b border-[var(--border-default)]"
      >
        {panels.map((panel, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={`${panel.label}-${index}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveIndex(index)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "border-[var(--accent-600)] text-[var(--accent-600)]"
                  : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              {panel.label}
            </button>
          );
        })}
      </div>

      {/* 内容面板区：常驻 DOM，靠 hidden 切换 */}
      {panels.map((panel, index) => (
        <div
          key={`${panel.label}-${index}`}
          role="tabpanel"
          hidden={index !== activeIndex}
          className="mt-0"
        >
          {panel.content}
        </div>
      ))}
    </div>
  );
}
