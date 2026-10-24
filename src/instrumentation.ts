/**
 * 服务启动钩子（Next 约定）：
 * - 生成 RSA 密钥对（已存在则跳过）；失败只告警、不阻塞启动——
 *   首次请求 /api/rsa/key 时会懒加载兜底
 * - 启动后台任务 worker（.data/jobs.json：恢复中断任务、串行执行队列）
 * - 装配自动推送的双通道触发：
 *   1. store 的文档变更信号（API 写操作成功后触发，直达防抖器）
 *   2. docs 目录监听（fs.watch 事件转发，兜底 AI/脚本等不经 API 的外部直改）
 *   均防抖 5 秒后增量推送 S3；未启用同步时事件只是空转定时器，无 I/O。
 *   启动后另安排一次补推，兜住服务停机期间落盘的外部变更。
 *
 * register() 会被 Node 与 Edge 两种运行时各编译一次（proxy 存在时必有 Edge pass），
 * 必须 NEXT_RUNTIME 精确字面量判断，打包器才能把 node:fs 等内置模块从 Edge
 * 产物中摇掉，否则构建期报 "Ecmascript file had an error"。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  try {
    const { ensureRsaKeyPair } = await import("./lib/rsa");
    await ensureRsaKeyPair();
    console.log("[rsa] 密钥对已就绪（.data/rsa.json）");
  } catch (error) {
    console.warn("[rsa] 启动时生成密钥失败，将在首次请求时重试：", error);
  }

  try {
    const { startJobWorker } = await import("./lib/job-queue");
    const { registerSyncJobHandlers } = await import("./lib/sync-jobs");
    const { registerGitJobHandlers } = await import("./lib/git-jobs");
    registerSyncJobHandlers();
    registerGitJobHandlers();
    await startJobWorker();
  } catch (error) {
    console.warn("[jobs] 后台任务 worker 启动失败：", error);
  }

  try {
    const { onDocsChanged } = await import("./lib/store");
    const { scheduleAutoSync } = await import("./lib/auto-sync");
    onDocsChanged(() => scheduleAutoSync());
    scheduleAutoSync(15_000); // 启动补推：服务停机期间 AI/脚本直写的文件靠这次兜底
    const { startSyncWatcher } = await import("./lib/sync-watcher");
    startSyncWatcher();
  } catch (error) {
    console.warn("[sync] 自动推送触发装配失败：", error);
  }
}
