import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "登录",
};

interface LoginPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/notes";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-secondary)] px-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--border-default)] bg-[var(--bg-card)] p-8 shadow-[var(--shadow-md)]">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="猫咪笔记" className="mx-auto mb-4 h-14 w-14 rounded-2xl" />
          <h1 className="text-xl font-bold text-[var(--text-heading)]">猫咪笔记</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">登录后开始记录</p>
        </div>
        <LoginForm next={safeNext} />
      </div>
    </main>
  );
}
