/**
 * 用户设置的存储（服务端专用，node:fs）：
 * 外观 + 配色模式 + 主题预设统一落盘 .data/settings.json——不落浏览器 localStorage（用户点名）。
 * 首选事实源；浏览器只保留一份非敏感 cookie 缓存用于首帧渲染（见 settings-shared.ts）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_APPEARANCE, clampSettings, type AppearanceSettings } from "./appearance";
import {
  DEFAULT_DARK_PRESET,
  DEFAULT_LIGHT_PRESET,
  THEME_PRESETS,
  isThemeMode,
  type StoredSettings,
  type ThemeFamily,
  type ThemeMode,
} from "./settings-shared";

const SETTINGS_FILE = path.join(process.cwd(), ".data", "settings.json");

export const DEFAULT_STORED_SETTINGS: StoredSettings = {
  theme: "system",
  themePresetLight: DEFAULT_LIGHT_PRESET,
  themePresetDark: DEFAULT_DARK_PRESET,
  appearance: DEFAULT_APPEARANCE,
};

/** 预设 key 合法且属于指定家族（类型守卫：通过则 value 可直接作为该家族的 key 使用） */
function isValidPresetForFamily(value: unknown, family: ThemeFamily): value is string {
  return typeof value === "string" && THEME_PRESETS.some((p) => p.key === value && p.family === family);
}

async function readRaw(): Promise<StoredSettings | null> {
  try {
    const data = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf-8")) as Partial<StoredSettings>;
    const theme: ThemeMode = isThemeMode(data.theme) ? data.theme : "system";
    const themePresetLight = isValidPresetForFamily(data.themePresetLight, "light") ? data.themePresetLight : DEFAULT_LIGHT_PRESET;
    const themePresetDark = isValidPresetForFamily(data.themePresetDark, "dark") ? data.themePresetDark : DEFAULT_DARK_PRESET;
    const appearance = clampSettings(data.appearance as Partial<AppearanceSettings> | undefined);
    return { theme, themePresetLight, themePresetDark, appearance };
  } catch {
    return null;
  }
}

async function writeRaw(settings: StoredSettings): Promise<void> {
  await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
}

/**
 * 读取设置。fresh = 磁盘上还没有设置文件（客户端可据此把旧 localStorage 数据一次性迁移上来）。
 */
export async function readStoredSettings(): Promise<{ fresh: boolean; settings: StoredSettings }> {
  const stored = await readRaw();
  return stored ? { fresh: false, settings: stored } : { fresh: true, settings: DEFAULT_STORED_SETTINGS };
}

/** 合并写入（部分更新），返回写后的完整设置 */
export async function writeStoredSettings(patch: {
  theme?: unknown;
  themePresetLight?: unknown;
  themePresetDark?: unknown;
  appearance?: Partial<AppearanceSettings>;
}): Promise<StoredSettings> {
  const current = (await readRaw()) ?? DEFAULT_STORED_SETTINGS;
  const next: StoredSettings = {
    theme: isThemeMode(patch.theme) ? patch.theme : current.theme,
    // 非法/跨家族的预设值直接忽略，保留现值（正常客户端只会发合法 key）
    themePresetLight:
      isValidPresetForFamily(patch.themePresetLight, "light") ? patch.themePresetLight : current.themePresetLight,
    themePresetDark:
      isValidPresetForFamily(patch.themePresetDark, "dark") ? patch.themePresetDark : current.themePresetDark,
    appearance: clampSettings({ ...current.appearance, ...(patch.appearance ?? {}) }),
  };
  await writeRaw(next);
  return next;
}
