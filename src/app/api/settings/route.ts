import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { SETTINGS_CACHE_COOKIE } from "@/lib/settings-shared";
import { readStoredSettings, writeStoredSettings } from "@/lib/settings-store";
import type { StoredSettings } from "@/lib/settings-shared";

function withCacheCookie(response: NextResponse, settings: StoredSettings): NextResponse {
  response.cookies.set(SETTINGS_CACHE_COOKIE, encodeURIComponent(JSON.stringify(settings)), {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

/** 读取设置（公开：不含敏感信息；登录页也靠 cookie 缓存渲染配色） */
export async function GET() {
  const { fresh, settings } = await readStoredSettings();
  return withCacheCookie(NextResponse.json({ fresh, settings }), settings);
}

/** 保存设置（需已登录；PATCH 语义：theme / themePreset* / appearance 部分更新） */
export async function POST(request: Request) {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const appearance = (body.appearance ?? undefined) as Record<string, unknown> | undefined;
  const settings = await writeStoredSettings({
    theme: body.theme,
    themePresetLight: body.themePresetLight,
    themePresetDark: body.themePresetDark,
    appearance:
      appearance && typeof appearance === "object"
        ? (appearance as Parameters<typeof writeStoredSettings>[0]["appearance"])
        : undefined,
  });
  return withCacheCookie(NextResponse.json({ ok: true, settings }), settings);
}
