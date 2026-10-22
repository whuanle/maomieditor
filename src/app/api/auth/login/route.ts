import { NextResponse } from "next/server";
import {
  createSessionToken,
  sessionCookieOptions,
  getAuthCredentials,
  SESSION_COOKIE,
} from "@/lib/auth";
import { verifyLoginPassword } from "@/lib/credential-store";
import { createMfaChallengeToken, isMfaEnabled } from "@/lib/mfa-store";
import { decryptSecretField } from "@/lib/rsa";

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username : "";
  // 密码支持 RSA 信封（前端加密传输）或明文（兼容旧客户端）
  const password = await decryptSecretField(body.password);

  if (!username || !password) {
    return NextResponse.json({ error: "请输入用户名和密码" }, { status: 400 });
  }

  // 用户名取环境变量；密码走 .data/auth.json 哈希校验（首次自动从 env 迁移）
  const expected = getAuthCredentials();
  if (username !== expected.username || !(await verifyLoginPassword(password))) {
    return NextResponse.json({ error: "用户名或密码错误" }, { status: 401 });
  }

  // 已开启两步验证：不直接发会话，改发短时挑战令牌，验证码通过后才建立会话
  if (await isMfaEnabled()) {
    return NextResponse.json({ mfaRequired: true, mfaToken: await createMfaChallengeToken(username) });
  }

  const token = await createSessionToken(username);
  const response = NextResponse.json({ ok: true, username });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}
