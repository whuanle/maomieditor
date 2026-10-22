import { NextResponse } from "next/server";
import { isNoteLocked } from "@/lib/note-guard";
import { isValidId, readNote, writeNote } from "@/lib/store";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** GET /api/notes/file?id=xxx → 笔记原文（含 frontmatter）；受保护且未解锁时拒绝 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isValidId(id)) {
    return badRequest("笔记 id 不合法");
  }
  if (await isNoteLocked(id)) {
    return NextResponse.json({ error: "文档已开启保护，请先在页面输入保护密码解锁" }, { status: 403 });
  }
  const content = await readNote(id);
  if (content === null) {
    return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  }
  return NextResponse.json({ id, content });
}

/** PUT /api/notes/file { id, content } → 保存笔记（结构字段以磁盘为准强制回写） */
export async function PUT(request: Request) {
  let body: { id?: unknown; content?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("请求格式错误");
  }
  if (!isValidId(body.id) || typeof body.content !== "string") {
    return badRequest("缺少 id 或 content");
  }

  try {
    await writeNote(body.id, body.content);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存失败";
    const status = message === "笔记不存在" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
