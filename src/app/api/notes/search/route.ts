import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { PROTECTION_COOKIE } from "@/lib/protection-shared";
import { verifyProtectedSessionToken } from "@/lib/protection";
import { searchNotes } from "@/lib/store";

/**
 * GET /api/notes/search?q=关键词 → 正文全文检索。
 * 标题命中由前端本地过滤负责，这里只返回正文命中（id + 片段）；
 * 受保护笔记在无有效解锁会话时跳过正文匹配，避免内容泄露。
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  if (!query.trim()) {
    return NextResponse.json({ hits: [] });
  }
  const store = await cookies();
  const protectedUnlocked = !!(await verifyProtectedSessionToken(store.get(PROTECTION_COOKIE)?.value));
  const hits = await searchNotes(query, { protectedUnlocked });
  return NextResponse.json({ hits });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
