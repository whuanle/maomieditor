"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { encryptFields } from "@/lib/rsa-client";

interface LoginFormProps {
  next: string;
}

/** 登录表单：密码通过后，若开启了两步验证则进入验证码步骤（挑战令牌 5 分钟内有效） */
export function LoginForm({ next }: LoginFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 密码经 RSA 信封加密后传输，明文不出网
        body: JSON.stringify(await encryptFields({ username, password }, ["password"])),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "登录失败");
        return;
      }

      if (data.mfaRequired) {
        setMfaToken(data.mfaToken);
        setMfaCode("");
        return;
      }

      router.replace(next);
      router.refresh();
    } catch {
      setError("网络错误或安全传输初始化失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  async function handleMfa(event: FormEvent) {
    event.preventDefault();
    if (!mfaToken) {
      return;
    }
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/mfa/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mfaToken, code: mfaCode }),
      });

      const data = await response.json();
      if (!response.ok) {
        // 挑战令牌过期：退回第一步重新登录
        if (response.status === 401) {
          backToCredentials(data.error ?? "验证会话已过期，请重新登录");
          return;
        }
        setError(data.error ?? "验证失败");
        return;
      }

      router.replace(next);
      router.refresh();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  function backToCredentials(message: string) {
    setMfaToken(null);
    setMfaCode("");
    setError(message);
  }

  if (mfaToken) {
    return (
      <form onSubmit={handleMfa} className="space-y-4">
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <ShieldCheck className="h-4 w-4 text-[var(--accent-600)]" />
          <p className="text-sm">两步验证已开启，请输入验证器 App 中的 6 位验证码</p>
        </div>

        <div>
          <label htmlFor="mfa-code" className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
            验证码
          </label>
          <input
            id="mfa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={mfaCode}
            onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            autoFocus
            className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-center text-lg tracking-[0.5em] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-600)]"
            required
          />
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-[var(--accent-600)] py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "验证中..." : "验证并登录"}
        </button>

        <button
          type="button"
          onClick={() => backToCredentials("")}
          className="flex w-full items-center justify-center gap-1 text-sm text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回重新登录
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
          用户名
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-600)]"
          required
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium text-[var(--text-primary)]">
          密码
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-600)]"
          required
        />
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-[var(--accent-600)] py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {loading ? "登录中..." : "登录"}
      </button>
    </form>
  );
}
