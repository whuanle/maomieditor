/**
 * 用户设置存储（服务端专用，node:fs）：
 * 外观 + 配色模式统一落盘 .data/settings.json——不落浏览器 localStorage（用户点名）。
 * 首选事实源；浏览器只保留一份非敏感 cookie 缓存用于首帧渲染（见 settings-shared.ts）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_APPEARANCE, clampSettings, type AppearanceSettings } from "./appearance";
import { isThemeMode, type StoredSettings, type ThemeMode } from "./settings-shared";

const SETTINGS_FILE = path.join(process.cwd(), ".data", "settings.json");

export const DEFAULT_STORED_SETTINGS: StoredSettings = {
  theme: "system",
  appearance: DEFAULT_APPEARANCE,
};

async function readRaw(): Promise<StoredSettings | null> {
  try {
    const data = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf-8")) as Partial<StoredSettings>;
    const theme: ThemeMode = isThemeMode(data.theme) ? data.theme : "system";
    const appearance = clampSettings(data.appearance as Partial<AppearanceSettings> | undefined);
    return { theme, appearance };
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
  appearance?: Partial<AppearanceSettings>;
}): Promise<StoredSettings> {
  const current = (await readRaw()) ?? DEFAULT_STORED_SETTINGS;
  const next: StoredSettings = {
    theme: isThemeMode(patch.theme) ? patch.theme : current.theme,
    appearance: clampSettings({ ...current.appearance, ...(patch.appearance ?? {}) }),
  };
  await writeRaw(next);
  return next;
}
