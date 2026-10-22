import { NextResponse } from "next/server";
import { readBackup } from "@/lib/backup";

/** GET /api/backup/download?name=xxx.zip → 下载备份压缩包 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name") ?? "";
  try {
    const zip = await readBackup(name);
    return new NextResponse(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(zip.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "备份不存在" }, { status: 404 });
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
