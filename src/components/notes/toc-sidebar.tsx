"use client";

import { useCallback, useEffect, useRef, useState, useLayoutEffect } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";

/** 标题数量超过该值才自动展开目录；标题少时一屏可见，目录默认收起 */
const AUTO_OPEN_THRESHOLD = 3;
/** 标题滚过滚动容器顶部该距离后切换高亮（略大于标题的 scroll-margin-top） */
const SPY_OFFSET = 48;

// 面板宽度拖拽（与 notes-shell 文档树同款交互）：localStorage 记忆，双击复位
const WIDTH_STORAGE_KEY = "notes-toc-width";
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 256; // 即原 w-64

/**
 * 工具栏的目录按钮与目录面板分处服务端组件树两侧，无法共享 state，
 * 走与 notes:tree-refresh 同款的事件模式：按钮发 toggle 请求切换，
 * 面板在展开态每次变化时广播 state 供按钮同步图标
 */
const TOC_TOGGLE_EVENT = "notes:toc-toggle";
const TOC_STATE_EVENT = "notes:toc-state";

interface HeadingRef {
  el: HTMLHeadingElement;
  level: number;
  text: string;
}

interface TocSidebarProps {
  /**
   * 内容滚动容器的 CSS 选择器。阅读视图是 page 里的滚动 div；
   * 编辑视图的滚动容器在 Vditor 内部（dynamic 加载后才出现）。
   */
  scrollSelector: string;
  /** 笔记标题：正文首个 H1 与之相同时不在目录中重复列出（标题已显示在工具栏） */
  title?: string;
}

// SSR 渲染客户端组件时 useLayoutEffect 会告警，服务端退化为 useEffect
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// IR 编辑器把 markdown 标记符（标题的 #、加粗的 ** 等）渲染为标题内的
// .vditor-ir__marker span，取标题文本时须剔除，否则目录条目带出 "# " 前缀
function headingText(el: HTMLHeadingElement): string {
  if (!el.querySelector(".vditor-ir__marker")) {
    return (el.textContent ?? "").trim();
  }
  const clone = el.cloneNode(true) as HTMLHeadingElement;
  clone.querySelectorAll(".vditor-ir__marker").forEach((marker) => marker.remove());
  return (clone.textContent ?? "").trim();
}

// 从滚动容器解析标题列表；正文首个 H1 与笔记标题相同时不列出（标题已显示在工具栏）
function collectHeadings(scroll: HTMLElement, title?: string): HeadingRef[] {
  const next: HeadingRef[] = [];
  scroll.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6").forEach((el) => {
    if (!el.isConnected) {
      return;
    }
    const text = headingText(el);
    if (text) {
      next.push({ el, level: Number(el.tagName.slice(1)), text });
    }
  });
  if (title && next.length > 0 && next[0].level === 1 && next[0].text === title.trim()) {
    next.shift();
  }
  return next;
}

export function TocSidebar({ scrollSelector, title }: TocSidebarProps) {
  // 默认收起；标题数量超过阈值时自动展开（首帧预扫描 + collect 里持续跟进）
  const [open, setOpen] = useState(false);
  const [headings, setHeadings] = useState<HeadingRef[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  // 用户手动展开/收起后，本次停留期间不再自动变更
  const userToggledRef = useRef(false);

  // 面板宽度：首帧按默认渲染，挂载后恢复上次拖拽的记忆值
  const asideRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem(WIDTH_STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH) {
      widthRef.current = saved;
      setWidth(saved);
    }
  }, []);

  // 面板贴视口右缘，向左拖把手加宽：宽度 = 面板右缘 - 指针横坐标
  const startResize = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const right = asideRef.current?.getBoundingClientRect().right ?? window.innerWidth;
    setDragging(true);
    const move = (e: MouseEvent) => {
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, right - e.clientX));
      widthRef.current = next;
      setWidth(next);
    };
    const up = () => {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(widthRef.current));
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDragging(false);
    };
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, []);

  // 首帧前先数一遍标题决定初始展开态，避免先渲染一帧再切换造成闪动。
  // 滚动容器可能尚未挂载（编辑器异步加载），此时保持收起，检出标题后由 collect 自动展开
  useIsomorphicLayoutEffect(() => {
    if (userToggledRef.current) {
      return;
    }
    const scroll = document.querySelector<HTMLElement>(scrollSelector);
    if (scroll) {
      setOpen(collectHeadings(scroll, title).length > AUTO_OPEN_THRESHOLD);
    }
  }, [scrollSelector, title]);

  const toggle = useCallback((next: boolean) => {
    userToggledRef.current = true;
    setOpen(next);
  }, []);

  // 工具栏目录按钮的切换请求（等价于原右缘把手，算用户手动操作，之后不再自动变更）
  useEffect(() => {
    const onToggle = () => {
      userToggledRef.current = true;
      setOpen((prev) => !prev);
    };
    window.addEventListener(TOC_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(TOC_TOGGLE_EVENT, onToggle);
  }, []);

  // 展开态每次变化（含挂载时的自动展开）都广播，工具栏按钮据此换图标
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(TOC_STATE_EVENT, { detail: { open } }));
  }, [open]);

  // 扫描标题 + 滚动高亮。滚动容器可能延迟挂载或被替换，统一在 body 的
  // MutationObserver 里重新解析（防抖 + 内容比对，避免编辑器打字时反复重渲染）
  useEffect(() => {
    let scroll: HTMLElement | null = null;
    let collectTimer: ReturnType<typeof setTimeout> | undefined;
    let headingEls: HeadingRef[] = [];

    // 直接同步计算，不经 requestAnimationFrame：后台/节流的渲染进程会冻结 rAF，
    // 平滑滚动结束后事件照发但排入 rAF 的高亮更新可能永不执行
    const spy = () => {
      if (headingEls.length === 0) {
        setActiveIdx(-1);
        return;
      }
      // 标题 top 是视口绝对坐标，必须减去滚动容器顶缘（上方还有标签栏/工具栏）
      const base = scroll ? scroll.getBoundingClientRect().top : 0;
      let active = 0;
      for (let i = 0; i < headingEls.length; i++) {
        const { el } = headingEls[i];
        if (!el.isConnected) {
          continue;
        }
        if (el.getBoundingClientRect().top - base <= SPY_OFFSET) {
          active = i;
        } else {
          break;
        }
      }
      // 滚到底部时兜底高亮最后一项（末节短于视口时最后一项永远越不过阈值）
      if (scroll && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 4) {
        active = headingEls.length - 1;
      }
      setActiveIdx(active);
    };

    const onScroll = () => spy();

    const collect = () => {
      const nextScroll = document.querySelector<HTMLElement>(scrollSelector);
      if (nextScroll !== scroll) {
        scroll?.removeEventListener("scroll", onScroll);
        scroll = nextScroll;
        scroll?.addEventListener("scroll", onScroll, { passive: true });
      }
      if (!scroll) {
        headingEls = [];
        setHeadings([]);
        setActiveIdx(-1);
        return;
      }
      const next = collectHeadings(scroll, title);
      const unchanged =
        next.length === headingEls.length &&
        next.every((h, i) => h.el === headingEls[i].el && h.text === headingEls[i].text);
      if (unchanged) {
        spy();
        return;
      }
      headingEls = next;
      setHeadings(next);
      // 标题数量跨过阈值时自动展开/收起（编辑中新增第 4 个标题也会自动弹出目录）
      if (!userToggledRef.current) {
        setOpen(next.length > AUTO_OPEN_THRESHOLD);
      }
      spy();
    };

    const scheduleCollect = () => {
      clearTimeout(collectTimer);
      collectTimer = setTimeout(collect, 120);
    };

    collect();
    const observer = new MutationObserver(scheduleCollect);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      clearTimeout(collectTimer);
      scroll?.removeEventListener("scroll", onScroll);
    };
  }, [scrollSelector, title]);

  // 高亮项变化时让目录列表跟着滚，保持当前项可见
  useEffect(() => {
    if (activeIdx < 0) {
      return;
    }
    listRef.current
      ?.querySelector(`[data-toc-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  // 收起时不渲染任何东西：开关在工具栏的目录按钮（TocToggleButton）里
  if (!open) {
    return null;
  }

  return (
    <aside
      ref={asideRef}
      style={{ width }}
      className="app-panel-bg anim-fade-in relative hidden shrink-0 flex-col border-l border-[var(--border-default)] lg:flex"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={startResize}
        onDoubleClick={() => {
          widthRef.current = DEFAULT_WIDTH;
          setWidth(DEFAULT_WIDTH);
          window.localStorage.setItem(WIDTH_STORAGE_KEY, String(DEFAULT_WIDTH));
        }}
        className={`absolute inset-y-0 -left-0.5 z-10 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--accent-600)] ${
          dragging ? "bg-[var(--accent-600)]" : ""
        }`}
        title="拖动调整宽度（双击复位）"
      />
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border-default)] px-3">
        <span className="text-[15px] font-semibold text-[var(--text-secondary)]">目录</span>
        <button
          type="button"
          onClick={() => toggle(false)}
          className="rounded p-1.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          title="收起目录"
          aria-label="收起目录"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {headings.length === 0 ? (
          <p className="px-2 py-1 text-[13px] leading-6 text-[var(--text-tertiary)]">
            未发现标题，用 # / ## 创建后可在此快速跳转
          </p>
        ) : (
          headings.map((heading, index) => (
            <button
              key={`${heading.level}-${index}-${heading.text}`}
              data-toc-idx={index}
              type="button"
              onClick={() => heading.el.scrollIntoView({ behavior: "smooth", block: "start" })}
              title={heading.text}
              className={`mb-px block w-full truncate rounded py-[6px] pr-2 text-left text-[15px] leading-5 transition-colors ${
                index === activeIdx
                  ? "bg-[var(--accent-50)] font-medium text-[var(--accent-600)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              }`}
              style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }}
            >
              {heading.text}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

/**
 * 工具栏里的目录开关，放在操作按钮组的最后（带一条分组分隔线）。
 * 目录面板只在 lg 及以上显示，按钮同步隐藏；docs-button 的 display 写在
 * globals.css（无层叠层，优先级高于 Tailwind 工具类），需 ! 后缀才能响应式改显隐
 */
export function TocToggleButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onState = (event: Event) => {
      setOpen((event as CustomEvent<{ open: boolean }>).detail.open);
    };
    window.addEventListener(TOC_STATE_EVENT, onState);
    return () => window.removeEventListener(TOC_STATE_EVENT, onState);
  }, []);

  return (
    <>
      <span aria-hidden="true" className="mx-1 hidden h-4 w-px bg-[var(--border-default)] lg:block" />
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(TOC_TOGGLE_EVENT))}
        aria-pressed={open}
        title={open ? "收起目录" : "展开目录（标题超过 3 个时自动展开）"}
        className="docs-button hidden! lg:inline-flex!"
      >
        {open ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
        <span className="hidden md:inline">目录</span>
      </button>
    </>
  );
}
