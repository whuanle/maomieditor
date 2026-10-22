import { NextResponse } from "next/server";
import { isValidId, emptyTrash, listTrash, purgeNote, restoreNote } from "@/lib/store";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** GET /api/trash → 回收站列表 */
export async function GET() {
  const items = await listTrash();
  return NextResponse.json({ items });
}

/**
 * POST /api/trash
 * - { action: "restore", id } → 恢复到原位置（父级不存在则挂到根级）
 * - { action: "purge", id }   → 彻底删除该笔记及其后代
 * - { action: "empty" }       → 清空回收站
 */
export async function POST(request: Request) {
  let body: { action?: unknown; id?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("请求格式错误");
  }

  try {
    if (body.action === "restore" || body.action === "purge") {
      if (!isValidId(body.id)) {
        return badRequest("缺少笔记 id");
      }
      const count = body.action === "restore" ? await restoreNote(body.id) : await purgeNote(body.id);
      return NextResponse.json({ ok: true, count });
    }
    if (body.action === "empty") {
      await emptyTrash();
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
