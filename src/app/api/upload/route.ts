import { NextResponse } from "next/server";
import { addAttachment, importNote, isValidId } from "@/lib/store";

/** 单文件上限 200MB，与常见笔记附件场景匹配 */
const MAX_FILE_SIZE = 200 * 1024 * 1024;

/**
 * POST /api/upload (multipart: noteId + file)
 * - noteId = 笔记 ID：.md/.mdx 建为该笔记的子笔记（内容原样入库，标题取 frontmatter > 首个 # > 文件名）；
 *   其余文件挂为该笔记的附件
 * - noteId = "root"：仅接受 .md/.mdx 导入根级（附件必须挂靠具体笔记）
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "请求格式错误（需要 multipart 表单）" }, { status: 400 });
  }

  const noteId = typeof formData.get("noteId") === "string" ? String(formData.get("noteId")) : "";
  const isRoot = noteId === "root";
  if (!isRoot && !isValidId(noteId)) {
    return NextResponse.json({ error: "目标笔记不合法" }, { status: 400 });
  }
  // inline=1 来自编辑器粘贴/插入图片：属于正文内容，不作为文件节点显示在目录树
  const inline = formData.get("inline") === "1";

  const files = formData.getAll("file").filter((item): item is File => item instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "未收到文件" }, { status: 400 });
  }

  const attachments: { id: string; name: string; url: string; path: string }[] = [];
  const notes: { id: string; title: string }[] = [];
  try {
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json({ error: `文件 ${file.name} 超过 200MB 限制` }, { status: 413 });
      }
      if (/\.(md|mdx)$/i.test(file.name)) {
        const text = await file.text();
        const node = await importNote({ parentId: isRoot ? null : noteId, fileName: file.name, text });
        notes.push({ id: node.id, title: node.title });
        continue;
      }
      if (isRoot) {
        return NextResponse.json({ error: "根级只能导入 .md / .mdx 文档；其他文件请挂到具体笔记" }, { status: 400 });
      }
      const buffer = await file.arrayBuffer();
      const meta = await addAttachment(noteId, file.name, buffer, { inline });
      // path = 从笔记 md 所在目录出发的相对引用，本地编辑器可直接解析
      const blobRel = `../../files/${meta.id.slice(0, 2)}/${meta.id}${meta.ext ? `.${meta.ext}` : ""}`;
      attachments.push({ id: meta.id, name: meta.name, url: `/api/attachments/${meta.id}`, path: blobRel });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "上传失败" },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true, attachments, notes });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
