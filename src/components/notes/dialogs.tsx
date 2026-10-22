"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

/**
 * 通用输入弹窗：替代 window.prompt。
 * onSubmit 返回 null 表示成功（弹窗自动关闭）；返回错误文案则保持打开并内联显示。
 */
interface PromptDialogProps {
  title: string;
  /** 输入框上方的说明文字 */
  label?: React.ReactNode;
  initialValue?: string;
  placeholder?: string;
  confirmText?: string;
  /** 允许提交空值（如“留空移除图标”） */
  allowEmpty?: boolean;
  /** 快捷选项（如 emoji），点击直接填入输入框 */
  quickPicks?: string[];
  onSubmit: (value: string) => Promise<string | null>;
  onClose: () => void;
}

export function PromptDialog({
  title,
  label,
  initialValue = "",
  placeholder,
  confirmText = "确定",
  allowEmpty = false,
  quickPicks,
  onSubmit,
  onClose,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit() {
    const next = value.trim();
    if (!next && !allowEmpty) {
      setError("内容不能为空");
      return;
    }
    setBusy(true);
    setError("");
    const err = await onSubmit(next);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  }

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => !busy && onClose()}
    >
      <form
        className="dialog-panel w-full max-w-sm p-5"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) {
            void submit();
          }
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-heading)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {label && <p className="mb-2 text-[13px] text-[var(--text-secondary)]">{label}</p>}

        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !busy) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-400)]"
        />

        {quickPicks && quickPicks.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {quickPicks.map((pick) => (
              <button
                key={pick}
                type="button"
                onClick={() => {
                  setValue(pick);
                  setError("");
                }}
                className="flex h-8 w-8 items-center justify-center rounded-md text-base transition-colors hover:bg-[var(--bg-hover)]"
                title={pick}
              >
                {pick}
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="mt-2.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-[var(--border-default)] px-3.5 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-600)] px-3.5 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmText}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * 通用确认弹窗：替代 window.confirm。
 * onSubmit 约定同 PromptDialog；danger 时确认按钮为红色且默认聚焦“取消”以防误触。
 */
interface ConfirmDialogProps {
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  danger?: boolean;
  onSubmit: () => Promise<string | null>;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmText = "确定",
  danger = false,
  onSubmit,
  onClose,
}: ConfirmDialogProps) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit() {
    setBusy(true);
    setError("");
    const err = await onSubmit();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  }

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => !busy && onClose()}
    >
      <div className="dialog-panel w-full max-w-sm p-5" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-heading)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="text-sm leading-relaxed text-[var(--text-secondary)]">{message}</div>

        {error && (
          <p className="mt-2.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-[var(--border-default)] px-3.5 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 ${
              danger ? "bg-red-600" : "bg-[var(--accent-600)]"
            }`}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
