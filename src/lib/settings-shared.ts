/**
 * 用户设置的共享类型与常量（客户端可安全 import）。
 * 事实源是服务端 .data/settings.json（settings-store.ts）；
 * 一个非敏感 cookie（SETTINGS_CACHE_COOKIE）作为首帧缓存，让内联脚本在刷新时不闪烁。
 */
import type { AppearanceSettings } from "./appearance";

export const SETTINGS_CACHE_COOKIE = "notes_settings_cache";

export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export interface StoredSettings {
  theme: ThemeMode;
  appearance: AppearanceSettings;
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}
