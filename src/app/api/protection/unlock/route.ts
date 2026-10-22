import { NextResponse } from "next/server";
import {
  PROTECTION_COOKIE,
  createProtectedSessionToken,
  createTransientProtectedSessionToken,
  getProtectionTimeoutMinutes,
  verifyProtectionPassword,
} from "@/lib/protection";
import { decryptSecretField } from "@/lib/rsa";

/** 解锁受保护会话：校验保护密码（未单独设置时即登录密码）后按设置的会话时间签发 cookie */
export async function POST(request: Request) {
  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  // 密码支持 RSA 信封（前端加密传输）或明文（兼容旧客户端）
  const password = await decryptSecretField(body.password);
  if (password === null) {
    return NextResponse.json({ error: "密码字段缺失或解密失败" }, { status: 400 });
  }
  if (!password) {
    return NextResponse.json({ error: "请输入保护密码" }, { status: 400 });
  }

  if (!(await verifyProtectionPassword(password))) {
    return NextResponse.json({ error: "保护密码不正确" }, { status: 401 });
  }

  // 「每次打开时询问」：签发只活一分钟的临时会话供本次渲染，前端加载完立即删除；
  // 其余设置按会话时间正常签发
  const timeoutMinutes = await getProtectionTimeoutMinutes();
  const transient = timeoutMinutes <= 0;
  const session = transient ? await createTransientProtectedSessionToken() : await createProtectedSessionToken(timeoutMinutes);
  if (!session) {
    return NextResponse.json({ error: "签发受保护会话失败" }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true, expiresAt: session.exp, transient });
  response.cookies.set(PROTECTION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: transient ? 60 : timeoutMinutes * 60,
  });
  return response;
}

/** 立即锁定：清除受保护会话 */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(PROTECTION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
