"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  DEFAULT_PROTECTION_TIMEOUT_MINUTES,
  PROTECTION_TIMEOUT_CHOICES,
} from "@/lib/protection-shared";
import { encryptFields } from "@/lib/rsa-client";
import { FormButton, FormInput, FormMessage, SettingsGroup, SettingsRow } from "./settings-ui";

interface ProtectionStatus {
  hasCustomPassword: boolean;
  timeoutMinutes: number;
  unlocked: boolean;
  expiresAt: number | null;
}

/** 密码设置：登录密码与保护密码不在页面平铺表单，点击按钮弹窗修改 */
export function PasswordSection() {
  return (
    <div className="flex h-full max-w-3xl flex-col py-8 pl-8 pr-2">
      <div className="border-b border-[var(--border-default)] pr-8 pb-4">
        <h1 className="text-[17px] font-semibold text-[var(--text-heading)]">密码</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">修改登录密码，管理受保护文档的独立密码与会话。</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-8 pb-10">
        <LoginPasswordGroup />
        <ProtectionGroup />
      </div>
    </div>
  );
}

/* ===== 通用密码弹窗 ===== */

interface PasswordDialogProps {
  title: string;
  description?: string;
  fields: { key: string; label: string; autoComplete?: string }[];
  submitLabel: string;
  /** 提交处理：返回错误文案，成功返回 null（弹窗自行关闭） */
  onSubmit: (values: Record<string, string>) => Promise<string | null>;
  onClose: () => void;
}

/** 密码弹窗：label 左输入右的表单行 + 取消/提交；Enter 提交，Esc / 点击遮罩关闭 */
function PasswordDialog({ title, description, fields, submitLabel, onSubmit, onClose }: PasswordDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, ""]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await onSubmit(values);
      if (message) {
        setError(message);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="dialog-panel w-full max-w-sm p-5" onClick={(event) => event.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--text-heading)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {description && <p className="mb-2 text-[13px] leading-relaxed text-[var(--text-tertiary)]">{description}</p>}
        <div className="space-y-3 py-2">
          {fields.map((field, index) => (
            <label key={field.key} className="flex items-center justify-between gap-4">
              <span className="shrink-0 text-[13px] text-[var(--text-primary)]">{field.label}</span>
              <FormInput
                type="password"
                value={values[field.key] ?? ""}
                autoFocus={index === 0}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void submit();
                  }
                }}
                aria-label={field.label}
                autoComplete={field.autoComplete ?? "new-password"}
              />
            </label>
          ))}
        </div>
        {error && (
          <div className="flex justify-end pt-1">
            <FormMessage error={error} />
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <FormButton onClick={onClose} disabled={busy}>
            取消
          </FormButton>
          <FormButton onClick={() => void submit()} disabled={busy}>
            {busy ? "提交中…" : submitLabel}
          </FormButton>
        </div>
      </div>
    </div>
  );
}

/* ===== 登录密码 ===== */

function LoginPasswordGroup() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(values: Record<string, string>): Promise<string | null> {
    const current = values.current ?? "";
    const next = values.next ?? "";
    const confirm = values.confirm ?? "";
    if (!current || !next || !confirm) {
      return "请填写全部密码字段";
    }
    if (next !== confirm) {
      return "两次输入的新密码不一致";
    }
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 密码经 RSA 信封加密后传输，明文不出网
        body: JSON.stringify(
          await encryptFields({ currentPassword: current, newPassword: next }, ["currentPassword", "newPassword"])
        ),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        return data.error ?? "修改失败";
      }
      setSuccess("登录密码已修改，下次登录请使用新密码");
      return null;
    } catch {
      return "网络错误或安全传输初始化失败，请重试";
    }
  }

  return (
    <SettingsGroup title="登录密码">
      <SettingsRow label="登录密码" description="用于登录本应用，修改时需验证当前密码">
        <FormButton
          onClick={() => {
            setSuccess(null);
            setDialogOpen(true);
          }}
        >
          修改密码
        </FormButton>
      </SettingsRow>
      {success && (
        <div className="flex justify-end py-2">
          <FormMessage success={success} />
        </div>
      )}
      {dialogOpen && (
        <PasswordDialog
          title="修改登录密码"
          fields={[
            { key: "current", label: "当前密码", autoComplete: "current-password" },
            { key: "next", label: "新密码" },
            { key: "confirm", label: "确认新密码" },
          ]}
          submitLabel="修改"
          onSubmit={submit}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </SettingsGroup>
  );
}

/* ===== 保护文档 ===== */

function ProtectionGroup() {
  const [status, setStatus] = useState<ProtectionStatus | null>(null);
  const [dialog, setDialog] = useState<"edit" | "clear" | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/protection", { cache: "no-store" });
      if (response.ok) {
        setStatus((await response.json()) as ProtectionStatus);
      }
    } catch {
      // 状态拉取失败保留上次结果
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasCustom = status?.hasCustomPassword ?? false;

  async function postProtection(payload: Record<string, unknown>): Promise<string | null> {
    try {
      const response = await fetch("/api/protection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 密码字段经 RSA 信封加密后传输，明文不出网（set-timeout 等无密码 payload 不受影响）
        body: JSON.stringify(await encryptFields(payload, ["oldPassword", "newPassword"])),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        return data.error ?? "操作失败";
      }
      await refresh();
      return null;
    } catch {
      return "网络错误或安全传输初始化失败，请重试";
    }
  }

  async function submitEdit(values: Record<string, string>): Promise<string | null> {
    const next = values.next ?? "";
    const confirm = values.confirm ?? "";
    if (hasCustom && !values.current) {
      return "请输入当前保护密码";
    }
    if (!next || !confirm) {
      return "请输入新密码并确认";
    }
    if (next !== confirm) {
      return "两次输入的新密码不一致";
    }
    const error = hasCustom
      ? await postProtection({ action: "change", oldPassword: values.current, newPassword: next })
      : await postProtection({ action: "set", newPassword: next });
    if (error) {
      return error;
    }
    setSuccess(hasCustom ? "保护密码已修改" : "已设置独立保护密码，打开受保护笔记时将使用此密码");
    return null;
  }

  async function submitClear(values: Record<string, string>): Promise<string | null> {
    if (!values.current) {
      return "请输入当前保护密码";
    }
    const error = await postProtection({ action: "clear", oldPassword: values.current });
    if (error) {
      return error;
    }
    setSuccess("已清除保护密码，恢复为默认使用登录密码");
    return null;
  }

  return (
    <SettingsGroup title="保护文档">
      <p className="px-1 pb-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
        受保护的笔记默认使用登录密码解锁，也可单独设置保护密码；解锁一次后的有效期由受保护会话时间决定。
      </p>
      <SettingsRow
        label="保护密码"
        description={hasCustom ? "已设置独立密码——打开受保护笔记时需输入此密码" : "未单独设置，默认使用登录密码"}
      >
        <div className="flex items-center gap-3">
          <span
            className={`text-[13px] ${hasCustom ? "text-[#1a7f37] dark:text-[#3fb950]" : "text-[var(--text-tertiary)]"}`}
          >
            {hasCustom ? "独立密码" : "同登录密码"}
          </span>
          <FormButton
            onClick={() => {
              setSuccess(null);
              setDialog("edit");
            }}
          >
            {hasCustom ? "修改密码" : "设置独立密码"}
          </FormButton>
        </div>
      </SettingsRow>
      {hasCustom && (
        <SettingsRow label="清除保护密码" description="清除后恢复为默认使用登录密码">
          <FormButton
            danger
            onClick={() => {
              setSuccess(null);
              setDialog("clear");
            }}
          >
            清除
          </FormButton>
        </SettingsRow>
      )}
      {success && (
        <div className="flex justify-end py-2">
          <FormMessage success={success} />
        </div>
      )}

      <TimeoutRow status={status} onChanged={refresh} />

      {dialog === "edit" && (
        <PasswordDialog
          title={hasCustom ? "修改保护密码" : "设置保护密码"}
          description={hasCustom ? undefined : "当前保护密码与登录密码相同，设置后将使用独立密码。"}
          fields={
            hasCustom
              ? [
                  { key: "current", label: "当前保护密码", autoComplete: "current-password" },
                  { key: "next", label: "新密码" },
                  { key: "confirm", label: "确认新密码" },
                ]
              : [
                  { key: "next", label: "新密码" },
                  { key: "confirm", label: "确认新密码" },
                ]
          }
          submitLabel={hasCustom ? "修改" : "设置"}
          onSubmit={submitEdit}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "clear" && (
        <PasswordDialog
          title="清除保护密码"
          description="清除后将恢复为默认使用登录密码解锁受保护笔记。"
          fields={[{ key: "current", label: "当前保护密码", autoComplete: "current-password" }]}
          submitLabel="清除"
          onSubmit={submitClear}
          onClose={() => setDialog(null)}
        />
      )}
    </SettingsGroup>
  );
}

function TimeoutRow({ status, onChanged }: { status: ProtectionStatus | null; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const value = status?.timeoutMinutes ?? DEFAULT_PROTECTION_TIMEOUT_MINUTES;

  async function change(minutes: number) {
    if (minutes === value || busy) {
      return;
    }
    setBusy(true);
    try {
      await fetch("/api/protection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-timeout", timeoutMinutes: minutes }),
      });
      await onChanged();
    } catch {
      // 失败时刷新会回到旧值
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsRow label="受保护会话时间" description="解锁一次后多久内不再询问（0 = 每次打开都要求输入）">
      <select
        value={String(value)}
        disabled={busy}
        onChange={(event) => void change(Number(event.target.value))}
        aria-label="受保护会话时间"
        className="h-8 w-44 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2 text-[15px] text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-strong)] focus:border-[var(--accent-500)]"
      >
        {PROTECTION_TIMEOUT_CHOICES.map((choice) => (
          <option key={choice.minutes} value={choice.minutes}>
            {choice.label}
          </option>
        ))}
      </select>
    </SettingsRow>
  );
}
