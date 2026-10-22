import { NextResponse } from "next/server";
import { isValidId } from "@/lib/store";
import { backupVersion, deleteVersion, listVersions, restoreVersion } from "@/lib/versions";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** GET /api/versions?noteId=xxx → 版本列表（新→旧）。版本内容预览走 /notes/{id}?v={ts} 页面路由 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const noteId = searchParams.get("noteId") ?? "";
  if (!isValidId(noteId)) {
    return badRequest("笔记 id 不合法");
  }
  return NextResponse.json({ versions: await listVersions(noteId) });
}

/**
 * POST /api/versions
 * - { noteId, action: "backup" }          → 备份当前已保存内容（与最新快照相同则 skipped=true）
 * - { noteId, action: "restore", ts }     → 恢复（当前内容会先自动备份）
 * - { noteId, action: "delete", ts }      → 删除某版本
 */
export async function POST(request: Request) {
  let body: { noteId?: unknown; action?: unknown; ts?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("请求格式错误");
  }

  const noteId = typeof body.noteId === "string" ? body.noteId : "";
  if (!isValidId(noteId)) {
    return badRequest("笔记 id 不合法");
  }

  try {
    if (body.action === "backup") {
      const version = await backupVersion(noteId);
      return NextResponse.json({ ok: true, version, skipped: version.skipped });
    }
    if (body.action === "restore" || body.action === "delete") {
      const ts = Number(body.ts);
      if (!Number.isFinite(ts) || ts <= 0) {
        return badRequest("版本时间戳不合法");
      }
      if (body.action === "restore") {
        await restoreVersion(noteId, ts);
      } else {
        await deleteVersion(noteId, ts);
      }
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
