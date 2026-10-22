import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { clearFinishedJobs, listJobs } from "@/lib/job-queue";
import { createSyncJob, registerSyncJobHandlers } from "@/lib/sync-jobs";
import { createGitJob, registerGitJobHandlers } from "@/lib/git-jobs";
import { readSyncConfig, s3Configured } from "@/lib/sync-store";
import { readGitStatus } from "@/lib/git-sync";

/**
 * 后台任务 API（服务端，Node 运行时）：
 * - GET：任务列表（新 → 旧，含状态/进度/日志；?type= 过滤、?limit= 截断）
 * - POST action：run-sync（后台发起同步任务；覆盖类模式必须 confirm=true）
 *               / run-git（git 提交/拉取/推送）
 *               / clear-finished（清空终态记录）
 * 任务本身在 worker 里串行执行，创建接口立即返回。
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? undefined;
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
  let jobs = await listJobs(200);
  if (type) {
    jobs = jobs.filter((job) => job.type === type);
  }
  return NextResponse.json({ jobs: jobs.slice(0, limit) });
}

export async function POST(request: Request) {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";

  try {
    switch (action) {
      case "run-sync": {
        const mode = typeof body.mode === "string" ? body.mode : "";
        if (mode !== "smart" && mode !== "push-all" && mode !== "pull-all") {
          return NextResponse.json({ error: "未知同步模式" }, { status: 400 });
        }
        // 覆盖类操作破坏性大，必须由前端确认弹窗显式带 confirm 才执行
        if (mode !== "smart" && body.confirm !== true) {
          return NextResponse.json({ error: "覆盖操作需要确认" }, { status: 400 });
        }
        const config = await readSyncConfig();
        if (!s3Configured(config.s3)) {
          return NextResponse.json({ error: "请先完成 S3 配置" }, { status: 400 });
        }
        registerSyncJobHandlers();
        const job = await createSyncJob(mode);
        return NextResponse.json({ ok: true, job });
      }

      case "run-git": {
        const gitAction = typeof body.gitAction === "string" ? body.gitAction : "";
        if (gitAction !== "commit" && gitAction !== "pull" && gitAction !== "push") {
          return NextResponse.json({ error: "未知 Git 操作" }, { status: 400 });
        }
        // 前置校验给即时反馈（任务内还会再验一层）
        const status = await readGitStatus();
        if (!status.initialized) {
          return NextResponse.json({ error: "Git 仓库尚未初始化，请先初始化" }, { status: 400 });
        }
        if (gitAction === "commit" && status.changes === 0) {
          return NextResponse.json({ error: "没有可提交的变更" }, { status: 400 });
        }
        if (gitAction !== "commit" && !status.remote) {
          return NextResponse.json({ error: "尚未绑定远程仓库，请先在 Git 配置里填写" }, { status: 400 });
        }
        registerGitJobHandlers();
        const job = await createGitJob(
          gitAction,
          typeof body.message === "string" ? body.message : undefined
        );
        return NextResponse.json({ ok: true, job });
      }

      case "clear-finished": {
        const removed = await clearFinishedJobs();
        return NextResponse.json({ ok: true, removed });
      }

      default:
        return NextResponse.json({ error: "未知操作" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失败" },
      { status: 400 }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
