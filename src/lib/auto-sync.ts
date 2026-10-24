import { enqueueAutoSync } from "./sync-jobs";

/**
 * 自动推送触发器：两路触发信号在这里合流、防抖 5 秒后做一次增量推送
 * （只推不拉，见 sync-engine 的 auto 模式），推送以后台任务执行：
 * - store 的 onDocsChanged：API 写操作成功后的直达信号（由 instrumentation 装配）
 * - sync-watcher 的 fs.watch 事件转发：AI/脚本等不经 API 的外部直改
 *
 * 不做任何轮询/扫描——两条路都是事件驱动，空闲时零开销。是否真的推送每次
 * 现读 .data/sync.json——配置变更（启停/改桶）无需重启即时生效；未启用时
 * enqueueAutoSync 内部静默跳过。
 *
 * 尾沿补推：推送请求被运行中的任务吸收（变更落在该任务的枚举之后）或任务运行期间
 * 又有新变更时，5 秒后自动再排一轮，直到推送真正创建——保证变更最终必被推送。
 */

const DEBOUNCE_MS = 5_000;

interface AutoSyncGlobal {
  __autoSyncTimer?: NodeJS.Timeout;
}

const g = globalThis as typeof globalThis & AutoSyncGlobal;

/** 防抖窗口内是否积累过未推送的变更 */
let pending = false;

/** 立即安排一次自动推送（启用 S3 / 保存配置后调用，保证首次开启就有一次全量推送） */
export function kickAutoSync(delayMs = DEBOUNCE_MS): void {
  scheduleAutoSync(delayMs);
}

/** 文档变更信号入口：防抖合并窗口内的连续变更只推一次 */
export function scheduleAutoSync(delayMs = DEBOUNCE_MS): void {
  console.log("[sync] 收到文档变更信号，安排推送");
  pending = true;
  schedule(delayMs);
}

function schedule(delayMs: number): void {
  if (g.__autoSyncTimer) {
    clearTimeout(g.__autoSyncTimer);
  }
  g.__autoSyncTimer = setTimeout(() => {
    g.__autoSyncTimer = undefined;
    void fire();
  }, delayMs);
  g.__autoSyncTimer.unref?.();
}

async function fire(): Promise<void> {
  if (!pending) {
    return;
  }
  pending = false;
  const accepted = await enqueueAutoSync().catch(() => false);
  if (!accepted || pending) {
    // 被运行中的任务吸收，或等待期间又有变更 → 稍后补一轮，直至推送真正创建
    pending = true;
    schedule(DEBOUNCE_MS);
  }
}
