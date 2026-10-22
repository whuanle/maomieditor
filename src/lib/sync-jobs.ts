import { createJob, ensureJobsLoaded, getActiveJob, registerJobType, type JobRecord } from "./job-queue";
import { runSync } from "./sync-engine";
import { readSyncConfig, s3Configured, type SyncMode } from "./sync-store";

/**
 * 同步任务接入后台任务框架（job-queue）：
 * - 手动同步（智能/覆盖 S3/覆盖本地）由 jobs API 发起，后台异步执行
 * - 自动推送（watcher）同样走任务队列，失败也能在记录里看到
 * - 同一时间最多一个同步任务排队/运行（引擎本身串行，任务层去重避免堆积）
 */

const MODE_LABELS: Record<SyncMode, string> = {
  auto: "自动推送",
  smart: "智能同步",
  "push-all": "覆盖 S3",
  "pull-all": "覆盖本地",
};

/** 注册同步任务处理器（幂等；jobs API 与 instrumentation 启动时都会调用） */
export function registerSyncJobHandlers(): void {
  registerJobType("sync", async (ctx) => {
    const mode = ctx.job.params.mode;
    if (typeof mode !== "string" || !(mode in MODE_LABELS)) {
      throw new Error(`未知同步模式：${String(mode)}`);
    }
    const summary = await runSync(mode as SyncMode, {
      log: (level, message) => ctx.log(level, message),
      progress: (phase, done, total) => ctx.progress(phase, done, total),
      isCancelled: () => ctx.isCancelled(),
    });
    ctx.setResult(summary);
  });
}

/** 当前排队/运行中的同步任务（没有则 undefined） */
export async function getActiveSyncJob(): Promise<JobRecord | undefined> {
  await ensureJobsLoaded();
  return getActiveJob("sync");
}

/**
 * 发起同步任务：立即返回任务记录，后台执行。
 * 已有同步任务在排队/运行时直接返回那个任务（语义被覆盖，无需重复排队）。
 */
export async function createSyncJob(mode: SyncMode): Promise<JobRecord> {
  registerSyncJobHandlers();
  return (await getActiveSyncJob()) ?? createJob({ type: "sync", label: MODE_LABELS[mode], params: { mode } });
}

/** 自动推送入口（watcher 调用）：未启用同步时静默跳过，失败记录在任务里 */
export async function enqueueAutoSync(): Promise<void> {
  const config = await readSyncConfig();
  if (!s3Configured(config.s3) || !config.s3!.enabled) {
    return;
  }
  await createSyncJob("auto").catch((error) => {
    console.warn("[sync] 自动推送任务创建失败：", error instanceof Error ? error.message : error);
  });
}
