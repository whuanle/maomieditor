import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/**
 * 鉴权入口（Next 16 proxy 约定，Node 运行时）：
 * - 页面（/notes/**）未登录 → 跳转 /login?next=...
 * - 受保护 API 未登录 → 401
 * - /login、/share/**、/api/public/**、/api/auth/login 不经过本代理，天然公开
 * - /api/auth/mfa 精确匹配（两步验证设置需登录）；其子路径 /api/auth/mfa/challenge
 *   是登录第二步换会话的公开接口，不能被拦截
 */
export default async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  if (session) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/notes/:path*",
    "/api/notes/:path*",
    "/api/auth/password",
    "/api/auth/mfa",
    "/api/protection/:path*",
    "/api/upload",
    "/api/attachments/:path*",
    "/api/shares/:path*",
    "/api/sync",
    "/api/trash/:path*",
    "/api/versions/:path*",
    "/api/backup/:path*",
    "/files/:path*",
  ],
};
