import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getAttachment, getNoteProtection, isValidId } from "@/lib/store";
import { findShareByToken, isAttachmentAllowedForShare } from "@/lib/share";

interface RouteContext {
  params: Promise<{ token: string; id: string }>;
}

/**
 * GET /api/public/share/{token}/attachments/{id}
 * 免登录访问分享笔记子树内的附件，仅限分享笔记后代笔记挂载的附件。
 */
export async function GET(request: Request, context: RouteContext) {
  const { token, id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "附件 id 不合法" }, { status: 400 });
  }

  const entry = await findShareByToken(token);
  if (!entry) {
    return NextResponse.json({ error: "分享不存在或已失效" }, { status: 404 });
  }

  const attachment = await getAttachment(id);
  if (!attachment) {
    return NextResponse.json({ error: "附件不存在" }, { status: 404 });
  }
  if (!(await isAttachmentAllowedForShare(entry, attachment.noteId))) {
    return NextResponse.json({ error: "该附件不在分享范围内" }, { status: 403 });
  }
  // 附件属主笔记受保护（含祖先继承）：公开路由一并停用
  const protection = await getNoteProtection(attachment.noteId);
  if (protection && (protection.self || protection.inherited)) {
    return NextResponse.json({ error: "所属文档已开启保护，分享已停用" }, { status: 403 });
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(attachment.absolute);
  } catch {
    return NextResponse.json({ error: "附件不存在" }, { status: 404 });
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  const inlineSafe = /^(image\/(?!svg)|video\/|audio\/)|^application\/pdf$|^font\//.test(attachment.mime);
  const dispositionType = download || !inlineSafe ? "attachment" : "inline";
  const headers = new Headers({
    "Content-Type": attachment.mime || "application/octet-stream",
    "Content-Disposition": `${dispositionType}; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
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
