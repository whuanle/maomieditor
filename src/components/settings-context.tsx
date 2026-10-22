"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_APPEARANCE,
  applyAppearance,
  clampSettings,
  type AppearanceSettings,
} from "@/lib/appearance";
import {
  SETTINGS_CACHE_COOKIE,
  isThemeMode,
  type StoredSettings,
  type ThemeMode,
} from "@/lib/settings-shared";

/**
 * 设置上下文：外观 + 配色模式的唯一客户端入口。
 * 事实源在服务端（.data/settings.json，GET/POST /api/settings）；
 * cookie notes_settings_cache 只作首帧缓存（SETTINGS_INIT_SCRIPT 读取）。
 * 挂载时若服务端还没有设置文件（fresh），把旧 localStorage 的 notes-appearance/theme 迁移上去后清除。
 */

interface SettingsContextValue {
  settings: StoredSettings;
  /** hydrate 完成前为 false（首帧展示已由内联脚本保证，不阻塞渲染） */
  ready: boolean;
  resolvedTheme: "light" | "dark";
  setTheme: (mode: ThemeMode) => void;
  updateAppearance: (patch: Partial<AppearanceSettings>) => void;
  resetAppearance: () => void;
}

const DEFAULTS: StoredSettings = { theme: "system", appearance: DEFAULT_APPEARANCE };

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<StoredSettings>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [systemDark, setSystemDark] = useState(false);

  // 跟随系统：监听系统配色变化
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const writeCacheCookie = useCallback((next: StoredSettings) => {
    document.cookie = `${SETTINGS_CACHE_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  // 拉取服务端设置；fresh 时顺带迁移旧 localStorage 数据（外观 / next-themes 的 theme）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: StoredSettings = DEFAULTS;
      try {
        const response = await fetch("/api/settings", { cache: "no-store" });
        if (response.ok) {
          const data = (await response.json()) as { fresh?: boolean; settings?: StoredSettings };
          if (data.settings) {
            next = {
              theme: isThemeMode(data.settings.theme) ? data.settings.theme : "system",
              appearance: clampSettings(data.settings.appearance),
            };
          }
          if (data.fresh) {
            const legacyAppearance = window.localStorage.getItem("notes-appearance");
            const legacyTheme = window.localStorage.getItem("theme");
            const patch: { theme?: ThemeMode; appearance?: Partial<AppearanceSettings> } = {};
            if (legacyAppearance) {
              try {
                patch.appearance = clampSettings(JSON.parse(legacyAppearance));
              } catch {
                // 旧数据损坏则忽略
              }
            }
            if (isThemeMode(legacyTheme)) {
              patch.theme = legacyTheme;
            }
            if (patch.appearance || patch.theme) {
              const saved = await fetch("/api/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              });
              if (saved.ok) {
                const result = (await saved.json()) as { settings?: StoredSettings };
                if (result.settings) {
                  next = result.settings;
                }
              }
            }
            window.localStorage.removeItem("notes-appearance");
            window.localStorage.removeItem("theme");
          }
        }
      } catch {
        // 拉取失败：保留首帧脚本用 cookie 缓存渲染出的状态，不写 cookie 也不覆盖内存默认值
        if (!cancelled) {
          setReady(true);
        }
        return;
      }
      if (!cancelled) {
        setSettings(next);
        applyAppearance(next.appearance);
        writeCacheCookie(next);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [writeCacheCookie]);

  const resolvedTheme: "light" | "dark" =
    settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;

  // 配色落到 <html>（含跟随系统的实时变化）
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  const push = useCallback(
    async (patch: { theme?: ThemeMode; appearance?: Partial<AppearanceSettings> }) => {
      let optimistic: StoredSettings;
      setSettings((prev) => {
        optimistic = {
          theme: isThemeMode(patch.theme) ? patch.theme : prev.theme,
          appearance: clampSettings({ ...prev.appearance, ...(patch.appearance ?? {}) }),
        };
        applyAppearance(optimistic.appearance);
        writeCacheCookie(optimistic);
        return optimistic;
      });
      try {
        const response = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (response.ok) {
          const data = (await response.json()) as { settings?: StoredSettings };
          if (data.settings) {
            setSettings(data.settings);
            applyAppearance(data.settings.appearance);
            writeCacheCookie(data.settings);
          }
        }
      } catch {
        // 网络失败：本地/cookie 已生效，服务端下次再同步
      }
    },
    [writeCacheCookie]
  );

  const setTheme = useCallback((mode: ThemeMode) => void push({ theme: mode }), [push]);
  const updateAppearance = useCallback(
    (patch: Partial<AppearanceSettings>) => void push({ appearance: patch }),
    [push]
  );
  const resetAppearance = useCallback(
    () => void push({ appearance: DEFAULT_APPEARANCE }),
    [push]
  );

  return (
    <SettingsContext.Provider
      value={{ settings, ready, resolvedTheme, setTheme, updateAppearance, resetAppearance }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings 必须在 SettingsProvider 内使用");
  }
  return context;
}
