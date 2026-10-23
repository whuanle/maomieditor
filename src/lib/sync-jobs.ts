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

/**
 * 自动推送入口（auto-sync 的变更信号调用）：未启用同步时静默跳过。
 * 返回 false 表示已有同步任务在排队/运行、本次请求被其吸收——调用方应在任务
 * 结束后重试，否则任务运行期间落盘的变更会漏推送（任务起来时的枚举不含它们）。
 */
export async function enqueueAutoSync(): Promise<boolean> {
  const config = await readSyncConfig();
  if (!s3Configured(config.s3) || !config.s3!.enabled) {
    return true; // 未启用：无事可做，也无需重试
  }
  if (await getActiveSyncJob()) {
    return false; // 已有任务在跑，不重复排队；由调用方稍后补推
  }
  registerSyncJobHandlers();
  await createJob({ type: "sync", label: MODE_LABELS.auto, params: { mode: "auto" } }).catch((error) => {
    console.warn("[sync] 自动推送任务创建失败：", error instanceof Error ? error.message : error);
  });
  return true;
}
