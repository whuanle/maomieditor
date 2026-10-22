"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock } from "lucide-react";
import { encryptFields } from "@/lib/rsa-client";

interface NoteLockScreenProps {
  noteId: string;
  title: string;
  icon: string;
}

/**
 * 受保护笔记的锁定屏：代替笔记内容渲染，输入保护密码解锁。
 * 「每次打开时询问」模式下解锁走 60 秒临时会话，渲染完成后立即删除 cookie，
 * 下次打开仍需重新输入。
 */
export function NoteLockScreen({ noteId, title, icon }: NoteLockScreenProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function submit() {
    if (busy) {
      return;
    }
    if (!password) {
      setError("请输入保护密码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/protection/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 密码经 RSA 信封加密后传输，明文不出网
        body: JSON.stringify(await encryptFields({ password }, ["password"])),
      });
      const data = (await response.json().catch(() => ({}))) as { transient?: boolean; error?: string };
      if (!response.ok) {
        setError(data.error ?? "解锁失败");
        setBusy(false);
        return;
      }
      await router.refresh(); // cookie 已就位，服务端重新渲染出正文
      if (data.transient) {
        // 临时会话只服务本次渲染，稍等正文送达后立即上锁
        window.setTimeout(() => {
          void fetch("/api/protection/unlock", { method: "DELETE" }).catch(() => undefined);
        }, 1500);
      }
    } catch {
      setError("网络错误或安全传输初始化失败，请重试");
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto px-4 py-10">
      <div className="anim-pop-in w-full max-w-sm rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-8 text-center shadow-[var(--shadow-pop)]">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-100)] text-[var(--accent-700)]">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="truncate text-[15px] font-semibold text-[var(--text-heading)]">
          {icon ? `${icon} ` : ""}
          {title}
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
          此文档已开启保护，输入保护密码后查看。
          <br />
          未单独设置保护密码时与登录密码相同。
        </p>
        <div className="mt-5 flex items-center gap-2">
          <div className="relative flex-1 text-left">
            <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submit();
                }
              }}
              placeholder="保护密码"
              autoComplete="current-password"
              aria-label="保护密码"
              className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] pl-8 pr-3 text-[15px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-tertiary)] focus:border-[var(--accent-500)]"
            />
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="h-9 shrink-0 rounded-md bg-[var(--accent-600)] px-4 text-[15px] font-medium text-white transition-colors hover:bg-[var(--accent-700)] disabled:opacity-60"
          >
            {busy ? "解锁中…" : "解锁"}
          </button>
        </div>
        {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}
      </div>
    </div>
  );
}
