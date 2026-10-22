import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  PROTECTION_COOKIE,
  clearProtectionPassword,
  changeProtectionPassword,
  createProtectedSessionToken,
  getProtectionTimeoutMinutes,
  hasProtectionPassword,
  setProtectionPassword,
  setProtectionTimeoutMinutes,
  verifyProtectedSessionToken,
} from "@/lib/protection";
import { decryptSecretField } from "@/lib/rsa";

/** 保护文档配置状态：是否单独设置密码 / 会话时间 / 当前受保护会话 */
export async function GET() {
  const store = await cookies();
  const session = await verifyProtectedSessionToken(store.get(PROTECTION_COOKIE)?.value);
  return NextResponse.json({
    hasCustomPassword: await hasProtectionPassword(),
    timeoutMinutes: await getProtectionTimeoutMinutes(),
    unlocked: Boolean(session),
    expiresAt: session ? session.exp : null,
  });
}

/**
 * 保护密码与会话时间管理（均要求已登录；未单独设置保护密码时默认使用登录密码）：
 * action: set { newPassword } | change { oldPassword, newPassword } | clear { oldPassword } | set-timeout { timeoutMinutes }
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";

  // 活动续期：页面有操作时把受保护会话从当前时刻重新起算（滑动过期）。
  // 无会话/已过期/设置为「每次打开时询问」都返回 401，前端静默忽略。
  if (action === "touch") {
    const store = await cookies();
    const session = await verifyProtectedSessionToken(store.get(PROTECTION_COOKIE)?.value);
    if (!session || (await getProtectionTimeoutMinutes()) <= 0) {
      return NextResponse.json({ error: "受保护会话已过期" }, { status: 401 });
    }
    const renewed = await createProtectedSessionToken(await getProtectionTimeoutMinutes());
    if (!renewed) {
      return NextResponse.json({ error: "受保护会话已过期" }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true, expiresAt: renewed.exp });
    response.cookies.set(PROTECTION_COOKIE, renewed.token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.max(0, renewed.exp - Math.floor(Date.now() / 1000)),
    });
    return response;
  }

  // 密码字段支持 RSA 信封（前端加密传输）或明文（兼容旧客户端）
  const secret = async (key: string): Promise<string | null> => decryptSecretField(body[key]);
  const badSecret = () => NextResponse.json({ error: "密码字段缺失或解密失败" }, { status: 400 });

  // 修改/清除保护密码会使既有受保护会话失效：直接下线会话 cookie
  const invalidateSession = (response: NextResponse) => {
    response.cookies.set(PROTECTION_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  };

  let result;
  switch (action) {
    case "set": {
      const newPassword = await secret("newPassword");
      if (newPassword === null) {
        return badSecret();
      }
      result = await setProtectionPassword(newPassword);
      break;
    }
    case "change": {
      const [oldPassword, newPassword] = await Promise.all([secret("oldPassword"), secret("newPassword")]);
      if (oldPassword === null || newPassword === null) {
        return badSecret();
      }
      result = await changeProtectionPassword(oldPassword, newPassword);
      break;
    }
    case "clear": {
      const oldPassword = await secret("oldPassword");
      if (oldPassword === null) {
        return badSecret();
      }
      result = await clearProtectionPassword(oldPassword);
      break;
    }
    case "set-timeout": {
      const minutes = Number(body.timeoutMinutes);
      result = Number.isFinite(minutes)
        ? await setProtectionTimeoutMinutes(minutes)
        : { ok: false, error: "无效的会话时间" };
      break;
    }
    default:
      return NextResponse.json({ error: "未知操作" }, { status: 400 });
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "操作失败" }, { status: 400 });
  }

  const response = NextResponse.json({
    ok: true,
    hasCustomPassword: await hasProtectionPassword(),
    timeoutMinutes: await getProtectionTimeoutMinutes(),
  });
  if (action === "set" || action === "change" || action === "clear") {
    invalidateSession(response);
  }
  return response;
}
