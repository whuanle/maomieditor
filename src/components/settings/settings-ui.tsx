"use client";

import type { ReactNode } from "react";

/** 设置分区共享 UI：Trilium 风格分组/设置行/分段按钮/开关（外观与密码等分区复用） */

export function SettingsGroup({ title, children, spaced = true }: { title: string; children: ReactNode; spaced?: boolean }) {
  return (
    <section className={spaced ? "mt-7 first:mt-6" : "mt-7"}>
      <h2 className="border-b border-[var(--border-default)] pb-2 text-[15px] font-semibold text-[var(--text-heading)]">
        {title}
      </h2>
      <div className="divide-y divide-[var(--border-faint,var(--border-default))]">{children}</div>
    </section>
  );
}

export function SettingsRow({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="min-w-0">
        <p className="text-[15px] text-[var(--text-primary)]">{label}</p>
        <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="flex rounded-md border border-[var(--border-default)] bg-[var(--bg-hover)] p-0.5" role="group">
      {options.map((option) => {
        const active = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.key)}
            className={`rounded-[5px] px-2.5 py-1 text-[13px] transition-colors ${
              active
                ? "bg-[var(--bg-card)] font-medium text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-[var(--accent-600)]" : "bg-[var(--border-strong)]"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 block h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/** 表单行的状态提示（错误红 / 成功绿），空时不占位 */
export function FormMessage({ error, success }: { error?: string | null; success?: string | null }) {
  if (!error && !success) {
    return null;
  }
  return (
    <p className={`text-[13px] ${error ? "text-red-600 dark:text-red-400" : "text-[#1a7f37] dark:text-[#3fb950]"}`}>
      {error ?? success}
    </p>
  );
}

/** 密码/文本输入框（设置页表单统一样式） */
export function FormInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-8 w-44 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2 text-[15px] text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-strong)] focus:border-[var(--accent-500)] ${props.className ?? ""}`}
    />
  );
}

/** 次要操作按钮（表单提交/立即锁定等） */
export function FormButton({
  children,
  onClick,
  disabled,
  danger,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-8 rounded-md border px-3 text-[14px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          : "border-[var(--border-default)] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]"
      }`}
    >
      {children}
    </button>
  );
}
