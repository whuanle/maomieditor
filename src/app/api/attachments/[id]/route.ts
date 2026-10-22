import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { isNoteLocked } from "@/lib/note-guard";
import { getAttachment, isValidId } from "@/lib/store";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function contentDisposition(fileName: string, mime: string, download: boolean): string {
  // 只有图片（SVG 除外）/视频/音频/PDF 允许内联展示，其余强制下载，防止上传的 HTML/SVG 执行脚本
  const inlineSafe = /^(image\/(?!svg)|video\/|audio\/)|^application\/pdf$|^font\//.test(mime);
  const type = download || !inlineSafe ? "attachment" : "inline";
  return `${type}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * GET /api/attachments/{id}            → 内联展示（图片/视频/PDF 预览）
 * GET /api/attachments/{id}?download=1 → 强制下载（用上传时的原始文件名）
 * 支持 Range 请求（视频拖动、PDF 分段加载）。
 */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "附件 id 不合法" }, { status: 400 });
  }

  const attachment = await getAttachment(id);
  if (!attachment) {
    return NextResponse.json({ error: "附件不存在" }, { status: 404 });
  }

  // 附件跟随属主笔记的保护状态：属主受保护且未解锁时不下发内容
  if (await isNoteLocked(attachment.noteId)) {
    return NextResponse.json({ error: "所属文档已开启保护，请先解锁" }, { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(attachment.absolute);
  } catch {
    return NextResponse.json({ error: "附件不存在" }, { status: 404 });
  }

  const contentType = attachment.mime || "application/octet-stream";
  const download = new URL(request.url).searchParams.get("download") === "1";
  const headers = new Headers({
    "Content-Type": contentType,
    "Content-Disposition": contentDisposition(attachment.name, contentType, download),
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
