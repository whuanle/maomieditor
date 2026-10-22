import { createJob, ensureJobsLoaded, getActiveJob, registerJobType, type JobRecord } from "./job-queue";
import { gitCommit, gitPull, gitPush } from "./git-sync";

/**
 * Git 任务接入后台任务框架：提交 / 拉取 / 推送在 worker 里串行执行
 * （与同步任务共用队列，避免 git 改写文件与 S3 同步并发），过程与
 * 网络错误全部留痕在任务记录里。
 */

export type GitAction = "commit" | "pull" | "push";

const ACTION_LABELS: Record<GitAction, string> = {
  commit: "Git 提交",
  pull: "Git 拉取",
  push: "Git 推送",
};

/** 注册 Git 任务处理器（幂等；jobs API 与 instrumentation 启动时都会调用） */
export function registerGitJobHandlers(): void {
  registerJobType("git", async (ctx) => {
    const action = ctx.job.params.gitAction;
    if (action !== "commit" && action !== "pull" && action !== "push") {
      throw new Error(`未知 Git 操作：${String(action)}`);
    }
    // 输出逐行进日志（git 的进度多在 stderr，函数内已合并）
    const message = typeof ctx.job.params.message === "string" ? ctx.job.params.message : undefined;
    const output =
      action === "commit"
        ? await gitCommit(message)
        : action === "pull"
          ? await gitPull()
          : await gitPush();
    const lines = output.split("\n").filter((line) => line.trim().length > 0);
    for (const line of lines) {
      ctx.log("info", line);
    }
    ctx.setResult(lines[lines.length - 1] ?? "完成");
  });
}

/** 当前排队/运行中的 Git 任务（没有则 undefined） */
export async function getActiveGitJob(): Promise<JobRecord | undefined> {
  await ensureJobsLoaded();
  return getActiveJob("git");
}

/** 发起 Git 任务：立即返回任务记录，后台执行；同类任务已在跑时直接返回它 */
export async function createGitJob(action: GitAction, message?: string): Promise<JobRecord> {
  registerGitJobHandlers();
  const active = await getActiveGitJob();
  if (active) {
    return active;
  }
  return createJob({
    type: "git",
    label: ACTION_LABELS[action],
    params: message ? { gitAction: action, message } : { gitAction: action },
  });
}
