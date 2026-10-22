import { NextResponse } from "next/server";
import { getNote } from "@/lib/store";
import { createShare, listShares, revokeShare } from "@/lib/share";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** GET /api/shares → 全部分享列表 */
export async function GET() {
  const shares = await listShares();
  return NextResponse.json({ shares });
}

/** POST /api/shares { id } → 为笔记创建（或复用）分享 */
export async function POST(request: Request) {
  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("请求格式错误");
  }

  const noteId = typeof body.id === "string" ? body.id : "";
  const note = await getNote(noteId);
  if (!note) {
    return badRequest("只能分享已存在的笔记");
  }

  // 受保护（含子文档）的笔记内容需要保护密码才能看，不允许生成公开分享链接绕过
  if (note.protectedEffective) {
    return badRequest("受保护的笔记不能创建分享链接，请先关闭保护");
  }

  const entry = await createShare(note.id, note.title);
  return NextResponse.json({ ok: true, share: entry });
}

/** DELETE /api/shares?token=xxx → 撤销分享 */
export async function DELETE(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) {
    return badRequest("缺少 token");
  }
  const removed = await revokeShare(token);
  if (!removed) {
    return NextResponse.json({ error: "分享不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
