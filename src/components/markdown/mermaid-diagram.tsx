"use client";

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { useSettings } from "@/components/settings-context";

interface MermaidDiagramProps {
  chart: string;
}

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const diagramId = useId().replace(/:/g, "");
  const { resolvedTheme } = useSettings();
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isZoomed, setIsZoomed] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");

  const mermaidTheme = resolvedTheme === "dark" ? "dark" : "neutral";
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "loose",
          theme: mermaidTheme,
          themeVariables: {
            fontFamily: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
            fontSize: "15px",
            primaryColor: isDark ? "#1f2937" : "#f8fafc",
            primaryTextColor: isDark ? "#e5e7eb" : "#111827",
            primaryBorderColor: isDark ? "#4b5563" : "#cbd5e1",
            lineColor: isDark ? "#9ca3af" : "#64748b",
            secondaryColor: isDark ? "#111827" : "#eff6ff",
            tertiaryColor: isDark ? "#0f172a" : "#ffffff",
            background: "transparent",
            mainBkg: isDark ? "#1f2937" : "#f8fafc",
            secondBkg: isDark ? "#111827" : "#eff6ff",
            tertiaryBkg: isDark ? "#0b1220" : "#ffffff",
            clusterBkg: isDark ? "#111827" : "#f8fafc",
            clusterBorder: isDark ? "#4b5563" : "#cbd5e1",
            edgeLabelBackground: isDark ? "#111827" : "#ffffff",
          },
        });

        const { svg: renderedSvg } = await mermaid.render(`mermaid-${diagramId}`, chart);

        if (!cancelled) {
          setSvg(renderedSvg);
          setError("");
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg("");
          setError(renderError instanceof Error ? renderError.message : "Mermaid render failed");
        }
      }
    }

    renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [chart, diagramId, isDark, mermaidTheme]);

  useEffect(() => {
    if (copyStatus === "idle") {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopyStatus("idle");
    }, 1800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [copyStatus]);

  const handleCopySource = async () => {
    try {
      await navigator.clipboard.writeText(chart);
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }
  };

  const handleDownloadSvg = () => {
    const file = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const objectUrl = URL.createObjectURL(file);
    const link = document.createElement("a");

    link.href = objectUrl;
    link.download = `mermaid-diagram-${diagramId}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  };

  if (error) {
    return (
      <div className="mermaid-diagram my-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <div className="font-medium">Mermaid 渲染失败</div>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded border border-red-200 bg-white/80 p-3 text-xs text-red-700">
          {error}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="mermaid-diagram my-6 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
        正在渲染 Mermaid 图表...
      </div>
    );
  }

  const diagramClassName = `mermaid-diagram rounded-lg border p-4 md:p-5 ${
    isDark
      ? "border-slate-700 bg-slate-950/40 text-slate-100"
      : "border-slate-200 bg-slate-50/80 text-slate-900"
  }`;

  return (
    <>
      <button
        type="button"
        className={`${diagramClassName} my-6 block w-full overflow-x-auto cursor-zoom-in text-left transition-colors hover:border-[var(--accent-600)]`}
        onClick={() => setIsZoomed(true)}
        aria-label="放大查看 Mermaid 图表"
      >
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      </button>

      {isZoomed && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 md:p-6"
          onClick={() => setIsZoomed(false)}
        >
          <div className="absolute left-4 top-4 flex max-w-[calc(100vw-5rem)] flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleDownloadSvg();
              }}
              className="rounded-full bg-white/10 px-3 py-2 text-sm text-white transition-colors hover:bg-white/20"
            >
              导出 SVG
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void handleCopySource();
              }}
              className="rounded-full bg-white/10 px-3 py-2 text-sm text-white transition-colors hover:bg-white/20"
            >
              复制源码
            </button>
            {copyStatus !== "idle" && (
              <span className="rounded-full bg-white/10 px-3 py-2 text-sm text-white">
                {copyStatus === "success" ? "源码已复制" : "复制失败"}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsZoomed(false);
            }}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            aria-label="关闭 Mermaid 放大预览"
          >
            <X className="h-6 w-6" />
          </button>

          <div
            className={`${diagramClassName} mermaid-diagram-overlay max-h-[92vh] w-full max-w-7xl overflow-auto cursor-zoom-out`}
            onClick={(event) => event.stopPropagation()}
          >
            <div dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        </div>
      )}
    </>
  );
}
