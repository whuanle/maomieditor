"use client";

import { useSettings } from "@/components/settings-context";

export function ThemeToggle() {
  const { ready, resolvedTheme, setTheme } = useSettings();

  const isDark = resolvedTheme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="flex h-9 w-9 items-center justify-center rounded-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      aria-label={isDark ? "切换到亮色主题" : "切换到暗色主题"}
      title={isDark ? "切换到亮色主题" : "切换到暗色主题"}
      disabled={!ready}
    >
      {isDark ? (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      ) : (
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="5" strokeWidth={1.5} />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      )}
    </button>
  );
}
