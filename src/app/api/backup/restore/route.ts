import { NextResponse } from "next/server";
import { restoreFromZip } from "@/lib/backup";

/**
 * POST /api/backup/restore（multipart/form-data，字段 file = zip）
 * 上传备份并全量覆盖 docs 的 notes/files/.trash；压缩包先解压校验，非法包不会触碰现有数据。
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "请求格式错误，应为 multipart 表单" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "请选择要恢复的备份压缩包" }, { status: 400 });
  }
  if (file.size > 2 * 1024 * 1024 * 1024) {
    return NextResponse.json({ error: "备份文件超过 2GB 上限" }, { status: 400 });
  }

  try {
    const result = await restoreFromZip(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ ok: true, noteFiles: result.noteFiles });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "恢复失败" },
      { status: 400 }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
