"use client";

import { Check, RotateCcw } from "lucide-react";
import {
  CONTENT_WIDTH_OPTIONS,
  LINE_HEIGHT_OPTIONS,
  MONO_FONT_OPTIONS,
  PROSE_FONT_OPTIONS,
  UI_FONT_OPTIONS,
  ZOOM_OPTIONS,
  type AppearanceSettings,
} from "@/lib/appearance";
import { useSettings } from "@/components/settings-context";
import { THEME_PRESETS, type ThemeMode, type ThemePreset } from "@/lib/settings-shared";
import { Segmented, SettingsGroup, SettingsRow, Toggle } from "./settings-ui";

/** 外观设置：主题 / 字体 / 正文排版 / 内容宽度 / 界面缩放与动效（参考 Trilium），改动即时生效并落盘到服务端 */
export function AppearanceSection() {
  const { settings, setTheme, setThemePreset, updateAppearance, resetAppearance, resolvedTheme, resolvedPreset } =
    useSettings();
  const appearance = settings.appearance;

  function update(patch: Partial<AppearanceSettings>) {
    updateAppearance(patch);
  }

  return (
    <div className="flex h-full max-w-3xl flex-col py-8 pl-8 pr-2">
      <div className="flex items-center justify-between border-b border-[var(--border-default)] pr-8 pb-4">
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold text-[var(--text-heading)]">外观</h1>
          <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">定制界面与文档渲染：主题配色、字体、排版、内容宽度与动效。</p>
        </div>
        <button
          type="button"
          onClick={resetAppearance}
          className="docs-button flex shrink-0 items-center gap-1.5"
          title="恢复全部外观设置为默认值（含配色模式与主题）"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          恢复默认
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-8 pb-10">
        <SettingsGroup title="主题">
          <SettingsRow label="配色模式" description="深浅色跟随系统或手动固定">
            <Segmented
              options={[
                { key: "system", label: "跟随系统" },
                { key: "light", label: "浅色" },
                { key: "dark", label: "深色" },
              ]}
              value={settings.theme}
              onChange={(key) => setTheme(key as ThemeMode)}
            />
          </SettingsRow>
          <div className="py-4">
            <p className="text-[13px] leading-relaxed text-[var(--text-tertiary)]">
              内置主题包含背景与强调色整套配色。跟随系统时，昼 / 夜会分别套用你在浅色、深色下选中的主题。
            </p>
            <div className="mt-3 space-y-4">
              {(["light", "dark"] as const).map((family) => (
                <div key={family}>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-medium text-[var(--text-secondary)]">
                      {family === "light" ? "浅色主题" : "深色主题"}
                    </h3>
                    {resolvedTheme === family && (
                      <span className="rounded-full bg-[var(--accent-100)] px-1.5 py-px text-[11px] text-[var(--accent-700)]">
                        当前
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-4 gap-2.5">
                    {THEME_PRESETS.filter((preset) => preset.family === family).map((preset) => (
                      <ThemePresetCard
                        key={preset.key}
                        preset={preset}
                        active={resolvedPreset === preset.key}
                        onSelect={setThemePreset}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SettingsGroup>

        <SettingsGroup title="字体">
          <SettingsRow label="界面字体" description="侧边栏、标签栏与菜单等界面元素">
            <FontSelect
              options={UI_FONT_OPTIONS}
              value={appearance.uiFont}
              onChange={(key) => update({ uiFont: key })}
            />
          </SettingsRow>
          <SettingsRow label="正文字体" description="笔记阅读与编辑区的文字">
            <FontSelect
              options={PROSE_FONT_OPTIONS}
              value={appearance.proseFont}
              onChange={(key) => update({ proseFont: key })}
            />
          </SettingsRow>
          <SettingsRow label="等宽字体" description="代码块与行内代码">
            <FontSelect
              options={MONO_FONT_OPTIONS}
              value={appearance.monoFont}
              onChange={(key) => update({ monoFont: key })}
            />
          </SettingsRow>
          <SettingsRow label="正文字号" description="标题与代码字号会按比例联动">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={14}
                max={22}
                step={1}
                value={appearance.proseFontSize}
                onChange={(event) => update({ proseFontSize: Number(event.target.value) })}
                className="w-44 accent-[var(--accent-600)]"
                aria-label="正文字号"
              />
              <span className="w-14 shrink-0 text-right text-[15px] tabular-nums text-[var(--text-secondary)]">
                {appearance.proseFontSize} px
              </span>
            </div>
          </SettingsRow>
          <SettingsRow label="正文行高" description="段落在竖直方向上的疏密">
            <Segmented
              options={LINE_HEIGHT_OPTIONS.map((option) => ({ key: option.key, label: option.label }))}
              value={appearance.proseLineHeight}
              onChange={(key) => update({ proseLineHeight: key as AppearanceSettings["proseLineHeight"] })}
            />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="内容宽度">
          <p className="pr-1 pb-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
            限制正文最大宽度可以提高宽屏阅读的可读性；也可以保持内容居中对齐。
          </p>
          <SettingsRow label="内容最大宽度" description="正文阅读与编辑区域的上限">
            <Segmented
              options={CONTENT_WIDTH_OPTIONS.map((option) => ({ key: option.key, label: option.label }))}
              value={appearance.contentWidth}
              onChange={(key) => update({ contentWidth: key as AppearanceSettings["contentWidth"] })}
            />
          </SettingsRow>
          <SettingsRow label="内容居中" description="关闭时正文左对齐铺满可用宽度">
            <Toggle checked={appearance.centerContent} onChange={(value) => update({ centerContent: value })} />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="界面与性能">
          <SettingsRow label="界面缩放" description="整体放大或缩小界面（含正文）">
            <Segmented
              options={ZOOM_OPTIONS.map((option) => ({ key: String(option.value), label: option.label }))}
              value={String(appearance.uiZoom)}
              onChange={(key) => update({ uiZoom: Number(key) })}
            />
          </SettingsRow>
          <SettingsRow label="过渡和动画" description="关闭可减少视觉干扰与渲染开销">
            <Toggle checked={appearance.animations} onChange={(value) => update({ animations: value })} />
          </SettingsRow>
          <SettingsRow label="阴影" description="弹窗与菜单的投影效果">
            <Toggle checked={appearance.shadows} onChange={(value) => update({ shadows: value })} />
          </SettingsRow>
          <SettingsRow label="毛玻璃背景效果" description="弹窗、菜单与面板的背景模糊；关闭后使用实底，更省性能">
            <Toggle checked={appearance.glassEffects} onChange={(value) => update({ glassEffects: value })} />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="预览" spaced={false}>
          <ProsePreview />
        </SettingsGroup>
      </div>
    </div>
  );
}

/* ===== 主题预设卡片：迷你界面预览 + 选中高亮（参考 WorkBuddy 主题网格） ===== */

function ThemePresetCard({
  preset,
  active,
  onSelect,
}: {
  preset: ThemePreset;
  active: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(preset.key)}
      aria-pressed={active}
      title={`${preset.label}${active ? "（当前主题）" : ""}`}
      className={`flex flex-col gap-1.5 rounded-lg border p-2 transition-colors ${
        active
          ? "border-[var(--accent-500)] ring-1 ring-[var(--accent-500)]"
          : "border-[var(--border-default)] hover:border-[var(--border-strong)]"
      }`}
    >
      <div
        className="flex h-[60px] overflow-hidden rounded-[5px] border"
        style={{ borderColor: preset.colors.border, background: preset.colors.bgPrimary }}
      >
        <div
          className="w-[30%] border-r"
          style={{ background: preset.colors.bgSidebar, borderColor: preset.colors.border }}
        />
        <div className="flex flex-1 flex-col gap-[5px] p-2">
          <div className="h-[6px] w-2/3 rounded-full" style={{ background: preset.colors.accent }} />
          <div className="h-[5px] w-full rounded-full" style={{ background: preset.colors.text, opacity: 0.45 }} />
          <div className="h-[5px] w-4/5 rounded-full" style={{ background: preset.colors.text, opacity: 0.3 }} />
        </div>
      </div>
      <span className="flex items-center justify-between text-[13px] text-[var(--text-primary)]">
        {preset.label}
        {active && <Check className="h-3.5 w-3.5 text-[var(--accent-600)]" />}
      </span>
    </button>
  );
}

/* ===== 字体下拉（外观专用） ===== */

function FontSelect({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string; stack: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  const active = options.find((option) => option.key === value) ?? options[0];
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      style={{ fontFamily: active.stack || undefined }}
      className="h-8 w-44 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2 text-[15px] text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-strong)] focus:border-[var(--accent-500)]"
    >
      {options.map((option) => (
        <option key={option.key} value={option.key}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** 文档渲染实时预览：直接挂 docs-prose，跟随字体/字号/行高/宽度设置 */
function ProsePreview() {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-card)] p-5">
      <div className="docs-prose">
        <h2 style={{ marginTop: 0 }}>预览标题</h2>
        <p style={{ marginBottom: "0.75rem" }}>
          这是一段正文预览——猫咪笔记会按照你选择的字体、字号与行高渲染笔记内容，
          行内代码如 <code>import()</code> 与代码块也会跟随等宽字体设置。
        </p>
        <pre style={{ marginTop: 0, marginBottom: 0 }}>
          <code className="language-js">{`const note = await readNote(id);`}</code>
        </pre>
      </div>
    </div>
  );
}
