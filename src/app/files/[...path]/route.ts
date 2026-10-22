import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { isNoteLocked, isTrashedNoteLocked } from "@/lib/note-guard";
import { getAttachment, getTrashedAttachment, isValidId } from "@/lib/store";

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

/**
 * GET /files/{分桶}/{附件ID}.{ext}
 * 兼容本地相对引用：正文里写 `../../files/9f/xxx.png`，浏览器在 /notes/{id} 页面
 * 上解析该相对路径恰好落到这里（编辑器预览等不经渲染管线的场景）。
 * 需要登录（proxy 拦截）；按附件 ID 寻址实际文件，路径中的分桶/扩展名仅作摆设。
 */
export async function GET(request: Request, context: RouteContext) {
  const { path: segments } = await context.params;
  const fileName = segments[segments.length - 1] ?? "";
  const id = fileName.replace(/\.[a-z0-9]+$/i, "");
  if (!isValidId(id)) {
    return NextResponse.json({ error: "附件 id 不合法" }, { status: 400 });
  }

  const active = await getAttachment(id);
  const attachment = active ?? (await getTrashedAttachment(id));
  if (!attachment) {
    return NextResponse.json({ error: "附件不存在" }, { status: 404 });
  }

  // 与 /api/attachments 同步：属主笔记受保护且未解锁时不下发内容（属主在回收站时沿 .trash 祖先链判定）
  if (await (active ? isNoteLocked(attachment.noteId) : isTrashedNoteLocked(attachment.noteId))) {
    return NextResponse.json({ error: "所属文档已开启保护，请先解锁" }, { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(attachment.absolute);
  } catch {
    return NextResponse.json({ error: "附件不存在" }, { status: 404 });
  }

  // 与 /api/attachments 相同的内联安全策略
  const inlineSafe = /^(image\/(?!svg)|video\/|audio\/)|^application\/pdf$|^font\//.test(attachment.mime);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const headers = new Headers({
    "Content-Type": attachment.mime || "application/octet-stream",
    "Content-Disposition": `${download || !inlineSafe ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });

  const rangeHeader = request.headers.get("range");
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        headers.set("Content-Length", String(end - start + 1));
        const stream = Readable.toWeb(
          fs.createReadStream(attachment.absolute, { start, end })
        ) as ReadableStream;
        return new Response(stream, { status: 206, headers });
      }
    }
  }

  headers.set("Content-Length", String(stat.size));
  const stream = Readable.toWeb(fs.createReadStream(attachment.absolute)) as ReadableStream;
  return new Response(stream, { status: 200, headers });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
