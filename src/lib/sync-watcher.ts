import fs from "node:fs";
import { DOCS_ROOT } from "./paths";
import { scheduleAutoSync } from "./auto-sync";

/**
 * docs 目录监听：兜底捕捉「不经 API 的外部变更」——本地部署时 AI/脚本直接写 md、
 * 手工投放文件等。只做事件转发：OS 推送变更事件 → 防抖安排一次推送，
 * 不轮询、不扫描任何文件（空闲时零开销）；与 store 的 API 变更信号在
 * auto-sync 的防抖窗口里自然合流，同一次编辑不会推两遍。
 *
 * - .git/.trash 等隐藏目录的变更与推送范围无关，忽略（也避免 git 备份时自触发）
 * - 由 instrumentation.register() 在服务启动时拉起；globalThis 防止 dev 热重载
 *   重复注册。是否真的推送由 enqueueAutoSync 现读 .data/sync.json 决定，
 *   未启用同步时事件只是空转一个定时器，无任何 I/O
 * - 服务停机期间的外部变更由启动时的补推兜底（见 instrumentation）
 */

interface WatcherGlobal {
  __syncWatcherStarted?: boolean;
}

const g = globalThis as typeof globalThis & WatcherGlobal;

export function startSyncWatcher(): void {
  if (g.__syncWatcherStarted) {
    return;
  }

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(DOCS_ROOT, { recursive: true }, (_event, fileName) => {
      if (typeof fileName === "string" && fileName.split(/[\\/]/).some((part) => part.startsWith("."))) {
        return; // .git/.trash/.data 等隐藏目录不触发
      }
      scheduleAutoSync();
    });
  } catch (error) {
    console.warn("[sync] docs 目录监听启动失败（外部变更将依赖 API 信号与启动补推）：", error);
    return;
  }

  watcher.on("error", (error) => {
    console.warn("[sync] docs 目录监听异常，5 秒后重建，并补一次推送兜底丢失的事件：", error);
    g.__syncWatcherStarted = false;
    watcher.close();
    scheduleAutoSync();
    setTimeout(() => startSyncWatcher(), 5_000).unref?.();
  });

  g.__syncWatcherStarted = true;
}
