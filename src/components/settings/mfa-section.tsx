"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { FormButton, FormMessage, SettingsGroup, SettingsRow } from "./settings-ui";

interface SetupData {
  secret: string;
  otpauthUrl: string;
  qrSvg: string;
}

/** MFA 认证：TOTP 两步验证的开启（扫码绑定 → 验证确认）与关闭 */
export function MfaSection() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/mfa", { cache: "no-store" });
      if (response.ok) {
        const data = (await response.json()) as { enabled: boolean };
        setEnabled(data.enabled);
      }
    } catch {
      // 状态拉取失败保留上次结果
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function beginSetup(): Promise<string | null> {
    try {
      const response = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setup" }),
      });
      const data = (await response.json().catch(() => ({}))) as Partial<SetupData> & { error?: string };
      if (!response.ok) {
        return data.error ?? "生成二维码失败";
      }
      setSuccess(null);
      setSetup(data as SetupData);
      return null;
    } catch {
      return "网络错误，请重试";
    }
  }

  async function cancelSetup(): Promise<void> {
    setSetup(null);
    try {
      await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
    } catch {
      // 服务端待确认密钥在下次 setup 时会被覆盖，这里失败可忽略
    }
  }

  return (
    <div className="flex h-full max-w-3xl flex-col py-8 pl-8 pr-2">
      <div className="border-b border-[var(--border-default)] pr-8 pb-4">
        <h1 className="text-[17px] font-semibold text-[var(--text-heading)]">MFA 认证</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">多因素认证（两步验证），为登录增加一道动态验证码保护。</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-8 pb-10">
        <SettingsGroup title="两步验证">
          <p className="pr-1 py-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
            开启后，登录需在密码之外输入验证器 App（如 Google Authenticator、Microsoft Authenticator、1Password）生成的 6 位动态验证码。
            若更换或丢失设备，可在服务器删除 .data/mfa.json 重置。
          </p>
          <SettingsRow
            label="两步验证"
            description={enabled ? "已开启——登录时需要输入动态验证码" : "未开启——仅使用用户名和密码登录"}
          >
            <div className="flex items-center gap-3">
              <span
                className={`text-[13px] ${enabled ? "text-[#1a7f37] dark:text-[#3fb950]" : "text-[var(--text-tertiary)]"}`}
              >
                {enabled ? "已开启" : "未开启"}
              </span>
              {enabled === null ? (
                <span className="text-[13px] text-[var(--text-tertiary)]">加载中…</span>
              ) : enabled ? (
                <FormButton
                  danger
                  onClick={() => {
                    setSuccess(null);
                    setDisableOpen(true);
                  }}
                >
                  关闭
                </FormButton>
              ) : (
                <FormButton
                  onClick={() => {
                    setSuccess(null);
                    void beginSetup();
                  }}
                >
                  开启两步验证
                </FormButton>
              )}
            </div>
          </SettingsRow>
          {success && (
            <div className="flex justify-end py-2">
              <FormMessage success={success} />
            </div>
          )}
        </SettingsGroup>
      </div>

      {setup && (
        <SetupDialog
          setup={setup}
          onDone={(message) => {
            setSetup(null);
            setSuccess(message);
            void refresh();
          }}
          onCancel={() => void cancelSetup()}
        />
      )}
      {disableOpen && (
        <DisableDialog
          onClose={() => setDisableOpen(false)}
          onDone={(message) => {
            setDisableOpen(false);
            setSuccess(message);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/* ===== 开启：扫码 → 验证 ===== */

function SetupDialog({
  setup,
  onDone,
  onCancel,
}: {
  setup: SetupData;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<"scan" | "verify">("scan");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function confirm() {
    if (busy) {
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError("请输入 6 位验证码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", code }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "绑定失败");
        return;
      }
      onDone("两步验证已开启，下次登录需输入动态验证码");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="开启两步验证"
      onClick={onCancel}
    >
      <div className="dialog-panel w-full max-w-md p-5" onClick={(event) => event.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--text-heading)]">
            {stage === "scan" ? "开启两步验证" : "验证动态码"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {stage === "scan" ? (
          <>
            <p className="mb-4 mt-1 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
              用验证器 App 扫描下方二维码；无法扫码时可手动录入密钥。
            </p>
            <div className="flex flex-col items-center gap-3">
              <div
                className="rounded-lg bg-white p-2 shadow-sm [&>svg]:h-44 [&>svg]:w-44"
                // 自家服务端生成的二维码 SVG，内容为 otpauth URL
                dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
              />
              <SecretText secret={setup.secret} />
            </div>
            {error && (
              <div className="flex justify-end pt-2">
                <FormMessage error={error} />
              </div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <FormButton onClick={onCancel}>取消</FormButton>
              <FormButton onClick={() => setStage("verify")}>我已扫码，下一步</FormButton>
            </div>
          </>
        ) : (
          <>
            <p className="mb-2 mt-1 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
              输入验证器 App 中当前显示的 6 位验证码，确认绑定。
            </p>
            <div className="flex flex-col items-center gap-2 py-2">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void confirm();
                  }
                }}
                aria-label="验证码"
                className="h-11 w-44 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2 text-center text-xl tracking-[0.4em] text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-strong)] focus:border-[var(--accent-500)]"
              />
            </div>
            {error && (
              <div className="flex justify-end pt-1">
                <FormMessage error={error} />
              </div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <FormButton onClick={() => setStage("scan")}>上一步</FormButton>
              <FormButton onClick={() => void confirm()} disabled={busy}>
                {busy ? "验证中…" : "确认开启"}
              </FormButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 手动录入密钥：等宽展示 + 点击复制 */
function SecretText({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时用户可手动选中复制
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="点击复制密钥"
      className="flex items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-hover)] px-3 py-1.5 font-mono text-[13px] tracking-wide text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)]"
    >
      <span className="break-all">{secret}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-[#1a7f37] dark:text-[#3fb950]" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
      )}
    </button>
  );
}

/* ===== 关闭 ===== */

function DisableDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [code, setCode] = useState("");
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
    if (!/^\d{6}$/.test(code)) {
      setError("请输入 6 位验证码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disable", code }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "关闭失败");
        return;
      }
      onDone("两步验证已关闭，登录恢复为仅密码验证");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="关闭两步验证"
      onClick={onClose}
    >
      <div className="dialog-panel w-full max-w-sm p-5" onClick={(event) => event.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--text-heading)]">关闭两步验证</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-2 mt-1 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
          输入当前验证码以确认关闭，之后登录将不再需要动态验证码。
        </p>
        <div className="flex justify-center py-2">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void submit();
              }
            }}
            aria-label="验证码"
            className="h-11 w-44 rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-2 text-center text-xl tracking-[0.4em] text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-strong)] focus:border-[var(--accent-500)]"
          />
        </div>
        {error && (
          <div className="flex justify-end pt-1">
            <FormMessage error={error} />
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <FormButton onClick={onClose}>取消</FormButton>
          <FormButton danger onClick={() => void submit()} disabled={busy}>
            {busy ? "提交中…" : "确认关闭"}
          </FormButton>
        </div>
      </div>
    </div>
  );
}
