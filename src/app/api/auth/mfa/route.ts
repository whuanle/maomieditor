import { NextResponse } from "next/server";
import QRCode from "qrcode";
import {
  beginMfaSetup,
  cancelMfaSetup,
  confirmMfaSetup,
  disableMfa,
  isMfaEnabled,
} from "@/lib/mfa-store";

/** 两步验证设置（需已登录）：GET 查询状态；POST 走 setup / confirm / cancel / disable */

export async function GET() {
  return NextResponse.json({ enabled: await isMfaEnabled() });
}

export async function POST(request: Request) {
  let body: { action?: unknown; code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const code = typeof body.code === "string" ? body.code : "";

  if (action === "setup") {
    if (await isMfaEnabled()) {
      return NextResponse.json({ error: "两步验证已开启" }, { status: 400 });
    }
    const { secret, otpauthUrl } = await beginMfaSetup();
    // 白底黑码，明暗主题下均可扫
    const qrSvg = await QRCode.toString(otpauthUrl, {
      type: "svg",
      margin: 1,
      width: 208,
      color: { dark: "#000000", light: "#ffffff" },
    });
    return NextResponse.json({ secret, otpauthUrl, qrSvg });
  }

  if (action === "confirm") {
    if (!code) {
      return NextResponse.json({ error: "请输入验证码" }, { status: 400 });
    }
    const result = await confirmMfaSetup(code);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "绑定失败" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "cancel") {
    await cancelMfaSetup();
    return NextResponse.json({ ok: true });
  }

  if (action === "disable") {
    if (!code) {
      return NextResponse.json({ error: "请输入验证码" }, { status: 400 });
    }
    const result = await disableMfa(code);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "关闭失败" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "未知操作" }, { status: 400 });
}
