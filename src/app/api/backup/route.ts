import { NextResponse } from "next/server";
import { createBackup, deleteBackup, listBackups, MAX_BACKUPS } from "@/lib/backup";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** GET /api/backup → 备份列表（新→旧）与上限 */
export async function GET() {
  return NextResponse.json({ backups: await listBackups(), max: MAX_BACKUPS });
}

/**
 * POST /api/backup
 * - { action: "create" }         → 立即备份（满 5 份时 400 报错，需先删除）
 * - { action: "delete", name }   → 删除指定备份
 */
export async function POST(request: Request) {
  let body: { action?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("请求格式错误");
  }

  try {
    if (body.action === "create") {
      const backup = await createBackup();
      return NextResponse.json({ ok: true, backup });
    }
    if (body.action === "delete") {
      if (typeof body.name !== "string" || !body.name) {
        return badRequest("缺少备份文件名");
      }
      await deleteBackup(body.name);
      return NextResponse.json({ ok: true });
    }
    return badRequest("未知的 action");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失败" },
      { status: 400 }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
