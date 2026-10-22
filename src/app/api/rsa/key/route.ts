import { NextResponse } from "next/server";
import { getRsaPublicKeyPem } from "@/lib/rsa";

/**
 * 获取 RSA 公钥（公开接口，不经过 proxy：登录页也要用它加密密码；
 * 公钥本身不含敏感信息，只用于浏览器端加密）。
 */
export async function GET() {
  try {
    return NextResponse.json(
      { publicKey: await getRsaPublicKeyPem() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "密钥服务不可用" }, { status: 500 });
  }
}
