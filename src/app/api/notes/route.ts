import { NextResponse } from "next/server";
import { isValidId } from "@/lib/store";
import {
  createNote,
  moveNote,
  removeAttachment,
  renameNote,
  reorderNote,
  setNoteIcon,
  setNoteProtection,
  trashNote,
} from "@/lib/store";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

interface ActionBody {
  action?: unknown;
  id?: unknown;
  parentId?: unknown;
  targetId?: unknown;
  position?: unknown;
  title?: unknown;
  icon?: unknown;
  protected?: unknown;
  format?: unknown;
  noteId?: unknown;
  attachmentId?: unknown;
}

/**
 * POST /api/notes —— 树结构操作（全部按笔记 ID）
 * - { action: "create", parentId, title, format: "md" | "mdx" }
 * - { action: "rename", id, title }
 * - { action: "set-icon", id, icon }   icon 传空串清除图标
 * - { action: "set-protection", id, protected: boolean }  开启/关闭文档保护（祖先受保护时不能关闭）
 * - { action: "move", id, parentId }            拖到笔记中段（挂为其子笔记）
 * - { action: "reorder", id, targetId, position: "before" | "after" }  拖到笔记上/下边缘
 * - { action: "delete-attachment", noteId, attachmentId }
 */
export async function POST(request: Request) {
  let body: ActionBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("请求格式错误");
  }

  try {
    switch (body.action) {
      case "create": {
        const parentId = typeof body.parentId === "string" && isValidId(body.parentId) ? body.parentId : null;
        const title = typeof body.title === "string" ? body.title : "";
        const format = body.format === "mdx" ? "mdx" : "md";
        if (!title.trim()) {
          return badRequest("标题不能为空");
        }
        const node = await createNote({ parentId, title, format });
        return NextResponse.json({ ok: true, node });
      }
      case "rename": {
        if (!isValidId(body.id) || typeof body.title !== "string") {
          return badRequest("缺少 id 或 title");
        }
        await renameNote(body.id, body.title);
        return NextResponse.json({ ok: true });
      }
      case "set-icon": {
        if (!isValidId(body.id) || typeof body.icon !== "string") {
          return badRequest("缺少 id 或 icon");
        }
        await setNoteIcon(body.id, body.icon);
        return NextResponse.json({ ok: true });
      }
      case "set-protection": {
        if (!isValidId(body.id)) {
          return badRequest("缺少 id");
        }
        await setNoteProtection(body.id, body.protected === true);
        return NextResponse.json({ ok: true });
      }
      case "move": {
        if (!isValidId(body.id)) {
          return badRequest("缺少 id");
        }
        const parentId = typeof body.parentId === "string" && isValidId(body.parentId) ? body.parentId : null;
        await moveNote(body.id, parentId);
        return NextResponse.json({ ok: true });
      }
      case "reorder": {
        if (!isValidId(body.id) || !isValidId(body.targetId)) {
          return badRequest("缺少 id 或 targetId");
        }
        const position = body.position === "before" ? "before" : "after";
        await reorderNote(body.id, body.targetId, position);
        return NextResponse.json({ ok: true });
      }
      case "delete-attachment": {
        if (!isValidId(body.noteId) || !isValidId(body.attachmentId)) {
          return badRequest("缺少 noteId 或 attachmentId");
        }
        await removeAttachment(body.noteId, body.attachmentId);
        return NextResponse.json({ ok: true });
      }
      default:
        return badRequest("未知的 action");
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失败" },
      { status: 400 }
    );
  }
}

/** DELETE /api/notes?id=xxx → 移入回收站（含全部子笔记与附件，可恢复） */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isValidId(id)) {
    return badRequest("缺少笔记 id");
  }
  try {
    const count = await trashNote(id);
    return NextResponse.json({ ok: true, trashed: count });
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除失败";
    const status = message === "笔记不存在" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
