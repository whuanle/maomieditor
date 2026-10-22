"use client";

import { useEffect, useState } from "react";
import { Hammer, X } from "lucide-react";
import { DEFAULT_SECTION, SETTING_SECTIONS } from "./sections";
import { AppearanceSection } from "./appearance-section";
import { BackupSection } from "./backup-section";
import { MfaSection } from "./mfa-section";
import { PasswordSection } from "./password-section";
import { SyncSection } from "./sync-section";

interface SettingsOverlayProps {
  onClose: () => void;
}

/** 设置独立页：整页覆盖工作台（不占用标签栏，笔记页在下方保持原状） */
export function SettingsOverlay({ onClose }: SettingsOverlayProps) {
  const [section, setSection] = useState(DEFAULT_SECTION);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      className="anim-fade-in fixed inset-0 z-50 flex bg-[var(--bg-primary)]"
    >
      <nav className="app-panel-bg flex w-56 shrink-0 flex-col border-r border-[var(--border-default)] py-3">
        <div className="flex items-center justify-between pl-4 pr-2 pb-2">
          <p className="text-[15px] font-semibold tracking-wide text-[var(--text-heading)]">设置</p>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="关闭设置"
            title="关闭设置（Esc）"
            className="flex h-7 w-7 items-center justify-center rounded-sm text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="anim-tree-in flex-1 space-y-px overflow-y-auto px-2 text-[15px]">
          {SETTING_SECTIONS.map((def) => {
            const active = def.key === section;
            const Icon = def.icon;
            return (
              <li key={def.key}>
                <button
                  type="button"
                  onClick={() => setSection(def.key)}
                  title={def.label}
                  className={`flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors ${
                    active
                      ? "bg-[var(--accent-100)] font-medium text-[var(--text-primary)] ring-1 ring-inset ring-[var(--accent-300)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? "text-[var(--accent-600)]" : "text-[var(--text-tertiary)]"}`} />
                  <span className="truncate">{def.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto">
        {section === "appearance" ? (
          <AppearanceSection />
        ) : section === "password" ? (
          <PasswordSection />
        ) : section === "backup" ? (
          <BackupSection />
        ) : section === "mfa" ? (
          <MfaSection />
        ) : section === "sync" ? (
          <SyncSection />
        ) : (
          <SectionPlaceholder section={section} />
        )}
      </div>
    </div>
  );
}

function SectionPlaceholder({ section }: { section: string }) {
  const def = SETTING_SECTIONS.find((item) => item.key === section) ?? SETTING_SECTIONS[0];
  const Icon = def.icon;

  return (
    <div key={def.key} className="anim-fade-in flex h-full max-w-3xl flex-col px-8 py-8">
      <div className="flex items-center gap-3 border-b border-[var(--border-default)] pb-4">
        <Icon className="h-5 w-5 shrink-0 text-[var(--accent-600)]" />
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold text-[var(--text-heading)]">{def.label}</h1>
          <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">{def.description}</p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md rounded-lg border border-dashed border-[var(--border-default)] px-6 py-10 text-center">
          <Hammer className="mx-auto h-7 w-7 text-[var(--text-tertiary)]" />
          <p className="mt-3 text-[15px] font-medium text-[var(--text-secondary)]">
            「{def.label}」设置即将上线
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
            该模块功能将在后续版本提供，敬请期待。
          </p>
        </div>
      </div>
    </div>
  );
}
