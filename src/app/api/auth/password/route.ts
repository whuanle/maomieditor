import { NextResponse } from "next/server";
import { changeLoginPassword } from "@/lib/credential-store";
import { decryptSecretField } from "@/lib/rsa";

/** 修改登录密码（需已登录 + 当前密码验证通过）；两个密码字段均支持 RSA 信封加密 */
export async function POST(request: Request) {
  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const currentPassword = await decryptSecretField(body.currentPassword);
  const newPassword = await decryptSecretField(body.newPassword);
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "请填写当前密码与新密码" }, { status: 400 });
  }

  const result = await changeLoginPassword(currentPassword, newPassword);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "修改失败" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
