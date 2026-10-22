/**
 * 用户设置的共享类型与常量（客户端可安全 import）。
 * 事实源是服务端 .data/settings.json（settings-store.ts）；
 * 一个非敏感 cookie（SETTINGS_CACHE_COOKIE）作为首帧缓存，让内联脚本在刷新时不闪烁。
 */
import type { AppearanceSettings } from "./appearance";

export const SETTINGS_CACHE_COOKIE = "notes_settings_cache";

export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export type ThemeFamily = "light" | "dark";

/** 内置主题预设：浅色 / 深色各一套默认（classic）+ 变体，覆盖背景/文字/强调色全套变量 */
export interface ThemePreset {
  key: string;
  label: string;
  family: ThemeFamily;
  /** 设置页预览卡片用的色板（与 globals.css 中 theme-<key> 类的字面量保持一致） */
  colors: {
    bgSidebar: string;
    bgPrimary: string;
    accent: string;
    text: string;
    border: string;
  };
}

export const THEME_PRESETS: ThemePreset[] = [
  // ===== 浅色系 =====
  {
    key: "classic",
    label: "经典白",
    family: "light",
    colors: { bgSidebar: "#f8f8f8", bgPrimary: "#ffffff", accent: "#005fb8", text: "#1f2328", border: "#e5e7ea" },
  },
  {
    key: "paper",
    label: "米黄纸",
    family: "light",
    colors: { bgSidebar: "#f3eee3", bgPrimary: "#faf7f0", accent: "#8a5a24", text: "#3d3a33", border: "#e4ddcd" },
  },
  {
    key: "sakura",
    label: "樱花粉",
    family: "light",
    colors: { bgSidebar: "#f9eff1", bgPrimary: "#fdf8f9", accent: "#ab3a64", text: "#403038", border: "#f0dde2" },
  },
  {
    key: "mint",
    label: "薄荷绿",
    family: "light",
    colors: { bgSidebar: "#ecf5f0", bgPrimary: "#f9fdfb", accent: "#0e7a5f", text: "#293832", border: "#dcebe3" },
  },
  // ===== 深色系 =====
  {
    key: "classic-dark",
    label: "经典黑",
    family: "dark",
    colors: { bgSidebar: "#181818", bgPrimary: "#1f1f1f", accent: "#3794ff", text: "#cccccc", border: "#2b2b2b" },
  },
  {
    key: "midnight",
    label: "午夜蓝",
    family: "dark",
    colors: { bgSidebar: "#0b1016", bgPrimary: "#0f1419", accent: "#60a5fa", text: "#c3cedb", border: "#1d2833" },
  },
  {
    key: "forest",
    label: "墨玉绿",
    family: "dark",
    colors: { bgSidebar: "#0c110e", bgPrimary: "#101613", accent: "#4ade80", text: "#c2cfc6", border: "#1e2a23" },
  },
  {
    key: "violet",
    label: "暗夜紫",
    family: "dark",
    colors: { bgSidebar: "#120e19", bgPrimary: "#17131f", accent: "#a78bfa", text: "#cdc8db", border: "#271f33" },
  },
];

export const DEFAULT_LIGHT_PRESET = "classic";
export const DEFAULT_DARK_PRESET = "classic-dark";

export function isThemePresetKey(value: unknown): value is string {
  return typeof value === "string" && THEME_PRESETS.some((preset) => preset.key === value);
}

export function getThemePreset(key: string): ThemePreset | undefined {
  return THEME_PRESETS.find((preset) => preset.key === key);
}

/** 指定家族下合法的预设 key，不合法则回退到该家族默认（classic / classic-dark） */
export function resolvePresetForFamily(key: string, family: ThemeFamily): string {
  const preset = getThemePreset(key);
  return preset && preset.family === family ? preset.key : (family === "dark" ? DEFAULT_DARK_PRESET : DEFAULT_LIGHT_PRESET);
}

/**
 * 由配色模式 + 系统偏好 + 两个家族的已选预设，解析出最终主题：
 * dark 决定 <html> 的 dark 类（语法高亮等），preset 决定 theme-<key> 类（全套配色变量）。
 */
export function resolveTheme(theme: ThemeMode, systemPrefersDark: boolean, presetLight: string, presetDark: string): {
  dark: boolean;
  preset: string;
} {
  const dark = theme === "dark" || (theme === "system" && systemPrefersDark);
  return { dark, preset: resolvePresetForFamily(dark ? presetDark : presetLight, dark ? "dark" : "light") };
}

export interface StoredSettings {
  theme: ThemeMode;
  /** 浅色家族选中的主题预设 key */
  themePresetLight: string;
  /** 深色家族选中的主题预设 key（跟随系统时昼/夜各自套用所选预设） */
  themePresetDark: string;
  appearance: AppearanceSettings;
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}
