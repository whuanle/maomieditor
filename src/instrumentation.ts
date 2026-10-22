/**
 * 服务启动钩子（Next 约定）：
 * - 生成 RSA 密钥对（已存在则跳过）；失败只告警、不阻塞启动——
 *   首次请求 /api/rsa/key 时会懒加载兜底
 * - 启动后台任务 worker（.data/jobs.json：恢复中断任务、串行执行队列）
 * - 启动 docs 目录监听（S3 自动推送；未启用同步时不做任何事）
 */
export async function register() {
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
    const { startSyncWatcher } = await import("./lib/sync-watcher");
    startSyncWatcher();
  } catch (error) {
    console.warn("[sync] 自动推送监听启动失败：", error);
  }
}
