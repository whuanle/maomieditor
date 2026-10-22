import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { deleteJob, getJob, requestJobCancel } from "@/lib/job-queue";

/**
 * 单个后台任务 API：
 * - GET：任务详情（含全部日志；运行中任务带实时进度）
 * - POST action=cancel：请求取消（排队中立即终态；运行中协作式中止）
 * - DELETE：删除终态记录（进行中的不可删）
 */

async function requireSession(): Promise<boolean> {
  const store = await cookies();
  return !!(await verifySessionToken(store.get(SESSION_COOKIE)?.value));
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ job });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (body.action !== "cancel") {
    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  }
  const job = await requestJobCancel(id);
  if (!job) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, job });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const { id } = await params;
  const removed = await deleteJob(id);
  if (!removed) {
    return NextResponse.json({ error: "任务不存在或仍在进行中" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
