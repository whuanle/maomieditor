import { NextResponse } from "next/server";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { verifyMfaChallengeToken, verifyMfaLoginCode } from "@/lib/mfa-store";

/**
 * 登录第二步（公开接口，与 /api/auth/login 同级）：
 * 密码通过后前端拿到 5 分钟有效的挑战令牌，凭令牌 + 6 位验证码在此换取正式会话。
 */
export async function POST(request: Request) {
  let body: { mfaToken?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const mfaToken = typeof body.mfaToken === "string" ? body.mfaToken : "";
  const code = typeof body.code === "string" ? body.code : "";
  if (!mfaToken || !code) {
    return NextResponse.json({ error: "请输入验证码" }, { status: 400 });
  }

  const username = await verifyMfaChallengeToken(mfaToken);
  if (!username) {
    return NextResponse.json({ error: "验证会话已过期，请重新登录" }, { status: 401 });
  }

  if (!(await verifyMfaLoginCode(code))) {
    return NextResponse.json({ error: "验证码错误或已失效" }, { status: 400 });
  }

  const token = await createSessionToken(username);
  const response = NextResponse.json({ ok: true, username });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}
