import fs from "node:fs";
import { DOCS_ROOT } from "./paths";
import { runSync } from "./sync-engine";
import { readSyncConfig, s3Configured } from "./sync-store";

/**
 * docs 目录监听：开启 S3 同步后，文件变化（应用内编辑、拖入、外部工具直改）
 * 防抖 5 秒后自动做一次增量推送（只推不拉，见 sync-engine 的 auto 模式）。
 *
 * 由 instrumentation.register() 在服务启动时拉起；globalThis 防止 dev 热重载
 * 重复注册。每次触发都现读 .data/sync.json——配置变更（启停/改桶）无需重启即时生效。
 */

const DEBOUNCE_MS = 5_000;

interface WatcherGlobal {
  __syncWatcherStarted?: boolean;
  __syncWatcherTimer?: NodeJS.Timeout;
}

const g = globalThis as typeof globalThis & WatcherGlobal;

/** 立即安排一次自动推送（启用 S3 / 保存配置后调用，保证首次开启就有一次全量推送） */
export function kickAutoSync(delayMs = DEBOUNCE_MS): void {
  schedule(delayMs);
}

function schedule(delayMs: number): void {
  if (g.__syncWatcherTimer) {
    clearTimeout(g.__syncWatcherTimer);
  }
  g.__syncWatcherTimer = setTimeout(() => {
    g.__syncWatcherTimer = undefined;
    void autoPush().catch(() => undefined); // doSync 内部已把逐文件错误记进 summary
  }, delayMs);
  g.__syncWatcherTimer.unref?.();
}

async function autoPush(): Promise<void> {
  const config = await readSyncConfig();
  if (!s3Configured(config.s3) || !config.s3!.enabled) {
    return;
  }
  try {
    await runSync("auto");
  } catch (error) {
    console.warn("[sync] 自动推送失败：", error instanceof Error ? error.message : error);
  }
}

export function startSyncWatcher(): void {
  if (g.__syncWatcherStarted) {
    return;
  }
  g.__syncWatcherStarted = true;

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(DOCS_ROOT, { recursive: true }, (_event, fileName) => {
      if (typeof fileName === "string" && fileName.split(/[\\/]/).some((part) => part.startsWith("."))) {
        return; // .trash 等隐藏目录不触发（同步范围本就不含它们）
      }
      schedule(DEBOUNCE_MS);
    });
  } catch (error) {
    console.warn("[sync] docs 目录监听启动失败，自动推送将只依赖手动/保存触发：", error);
    return;
  }
  watcher.on("error", (error) => {
    console.warn("[sync] docs 目录监听异常，5 秒后重建：", error);
    g.__syncWatcherStarted = false;
    setTimeout(() => startSyncWatcher(), 5_000).unref?.();
  });
  console.log("[sync] docs 目录监听已启动（S3 自动推送）");
}
