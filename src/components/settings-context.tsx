"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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
  DEFAULT_DARK_PRESET,
  DEFAULT_LIGHT_PRESET,
  SETTINGS_CACHE_COOKIE,
  THEME_PRESETS,
  getThemePreset,
  isThemeMode,
  isThemePresetKey,
  resolvePresetForFamily,
  resolveTheme,
  type StoredSettings,
  type ThemeMode,
} from "@/lib/settings-shared";

/**
 * 设置上下文：外观 + 配色模式 + 主题预设的唯一客户端入口。
 * 事实源在服务端（.data/settings.json，GET/POST /api/settings）；
 * cookie notes_settings_cache 只作首帧缓存（SETTINGS_INIT_SCRIPT 读取）。
 * 挂载时若服务端还没有设置文件（fresh），把旧 localStorage 的 notes-appearance/theme 迁移上去后清除。
 */

interface SettingsContextValue {
  settings: StoredSettings;
  /** hydrate 完成前为 false（首帧展示已由内联脚本保证，不阻塞渲染） */
  ready: boolean;
  resolvedTheme: "light" | "dark";
  /** 解析后的主题预设 key（跟随系统时随昼/夜切换） */
  resolvedPreset: string;
  setTheme: (mode: ThemeMode) => void;
  /** 选中某个主题预设卡片：记录到对应家族；若切换了明暗家族则同时切换配色模式 */
  setThemePreset: (key: string) => void;
  updateAppearance: (patch: Partial<AppearanceSettings>) => void;
  /** 恢复默认外观（配色模式 / 主题预设 / 排版全部还原） */
  resetAppearance: () => void;
}

const DEFAULTS: StoredSettings = {
  theme: "system",
  themePresetLight: DEFAULT_LIGHT_PRESET,
  themePresetDark: DEFAULT_DARK_PRESET,
  appearance: DEFAULT_APPEARANCE,
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

function sanitizeSettings(raw: Partial<StoredSettings> | null | undefined): {
  theme: ThemeMode;
  themePresetLight: string;
  themePresetDark: string;
} {
  const theme = isThemeMode(raw?.theme) ? raw.theme : "system";
  const themePresetLight = isThemePresetKey(raw?.themePresetLight)
    ? resolvePresetForFamily(raw.themePresetLight, "light")
    : DEFAULT_LIGHT_PRESET;
  const themePresetDark = isThemePresetKey(raw?.themePresetDark)
    ? resolvePresetForFamily(raw.themePresetDark, "dark")
    : DEFAULT_DARK_PRESET;
  return { theme, themePresetLight, themePresetDark };
}

/** 配色落到 <html>：dark 类（语法高亮等）+ theme-<preset> 类（全套配色变量） */
function applyThemeClasses(dark: boolean, preset: string): void {
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  THEME_PRESETS.forEach((presetMeta) => root.classList.remove(`theme-${presetMeta.key}`));
  root.classList.add(`theme-${preset}`);
}

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
              ...sanitizeSettings(data.settings),
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
                  next = {
                    ...sanitizeSettings(result.settings),
                    appearance: clampSettings(result.settings.appearance),
                  };
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

  const resolved = resolveTheme(settings.theme, systemDark, settings.themePresetLight, settings.themePresetDark);
  const resolvedTheme: "light" | "dark" = resolved.dark ? "dark" : "light";

  // 配色落到 <html>（含跟随系统的实时变化）。
  // 首帧已由 SETTINGS_INIT_SCRIPT 按 cookie 缓存应用，首次挂载跳过，避免 fetch 返回前闪回默认主题。
  const themeAppliedRef = useRef(false);
  useEffect(() => {
    if (!themeAppliedRef.current) {
      themeAppliedRef.current = true;
      return;
    }
    applyThemeClasses(resolved.dark, resolved.preset);
  }, [resolved.dark, resolved.preset]);

  const push = useCallback(
    async (patch: {
      theme?: ThemeMode;
      themePresetLight?: string;
      themePresetDark?: string;
      appearance?: Partial<AppearanceSettings>;
    }) => {
      let optimistic: StoredSettings;
      setSettings((prev) => {
        optimistic = {
          ...sanitizeSettings({
            theme: isThemeMode(patch.theme) ? patch.theme : prev.theme,
            themePresetLight: patch.themePresetLight ?? prev.themePresetLight,
            themePresetDark: patch.themePresetDark ?? prev.themePresetDark,
          }),
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
            const next: StoredSettings = {
              ...sanitizeSettings(data.settings),
              appearance: clampSettings(data.settings.appearance),
            };
            setSettings(next);
            applyAppearance(next.appearance);
            writeCacheCookie(next);
          }
        }
      } catch {
        // 网络失败：本地/cookie 已生效，服务端下次再同步
      }
    },
    [writeCacheCookie]
  );

  const setTheme = useCallback((mode: ThemeMode) => void push({ theme: mode }), [push]);

  const setThemePreset = useCallback(
    (key: string) => {
      const preset = getThemePreset(key);
      if (!preset) {
        return;
      }
      const patch: { theme?: ThemeMode; themePresetLight?: string; themePresetDark?: string } =
        preset.family === "light"
          ? { themePresetLight: preset.key }
          : { themePresetDark: preset.key };
      // 与当前明暗家族不一致时顺带切换配色模式，让选中的主题立即生效
      if (preset.family !== resolvedTheme) {
        patch.theme = preset.family;
      }
      void push(patch);
    },
    [push, resolvedTheme]
  );

  const updateAppearance = useCallback(
    (patch: Partial<AppearanceSettings>) => void push({ appearance: patch }),
    [push]
  );
  const resetAppearance = useCallback(
    () =>
      void push({
        theme: "system",
        themePresetLight: DEFAULT_LIGHT_PRESET,
        themePresetDark: DEFAULT_DARK_PRESET,
        appearance: DEFAULT_APPEARANCE,
      }),
    [push]
  );

  return (
    <SettingsContext.Provider
      value={{
        settings,
        ready,
        resolvedTheme,
        resolvedPreset: resolved.preset,
        setTheme,
        setThemePreset,
        updateAppearance,
        resetAppearance,
      }}
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
