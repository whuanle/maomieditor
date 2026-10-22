import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 后台任务框架（服务端专用）：持久化任务队列 + 单 worker 串行执行。
 *
 * - 存储：.data/jobs.json（任务定义、状态、进度、逐条日志），写入走 tmp+rename 原子替换，
 *   状态变化立即落盘、日志/进度节流落盘
 * - 重启恢复：启动加载时把 running（进程中断）的任务重新排队——同步类任务幂等可安全续跑
 * - 记录留存：终态任务保留最近 MAX_JOBS 条（含全部日志），超量裁剪最旧的
 * - 协作式取消：cancel 请求写入记录，handler 在步骤间通过 ctx.isCancelled() 自查，
 *   抛错时若已请求取消则按「已取消」而非「失败」记录
 *
 * 任务类型由各业务模块 registerJobType 注册（如 sync-jobs.ts）；worker 在
 * instrumentation 启动时拉起，createJob 也会兜底 kick（防止钩子未跑）。
 */

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type JobLogLevel = "info" | "warn" | "error";

export interface JobLogEntry {
  at: string;
  level: JobLogLevel;
  message: string;
}

export interface JobProgress {
  /** 阶段描述，如「对比本地文件」「上传」 */
  phase: string;
  done: number;
  total: number;
}

export interface JobRecord {
  id: string;
  seq: number;
  /** 任务类型（注册键），如 "sync" */
  type: string;
  /** 展示名，如「智能同步」 */
  label: string;
  /** 任务参数（handler 解析，如 { mode: "smart" }） */
  params: Record<string, unknown>;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: JobProgress;
  /** handler 产出（同步摘要等，UI 展示用） */
  result?: unknown;
  /** 失败原因（status=failed 时） */
  error?: string;
  logs: JobLogEntry[];
  /** 取消请求（协作式：handler 自查后中断） */
  cancelRequested?: boolean;
}

export interface JobContext {
  job: JobRecord;
  log(level: JobLogLevel, message: string): void;
  progress(phase: string, done: number, total: number): void;
  isCancelled(): boolean;
  setResult(result: unknown): void;
}

type JobHandler = (ctx: JobContext) => Promise<void>;

interface JobQueueGlobal {
  __jobQueue?: {
    jobs: JobRecord[];
    seq: number;
    handlers: Map<string, JobHandler>;
    workerRunning: boolean;
    loaded: boolean;
    writeChain: Promise<void>;
    writeTimer?: NodeJS.Timeout;
    lastWriteAt: number;
  };
}

// dev 热重载下模块会重新求值：状态挂 globalThis，新旧模块共享同一份内存数据
const g = globalThis as typeof globalThis & JobQueueGlobal;
const state: NonNullable<JobQueueGlobal["__jobQueue"]> = (g.__jobQueue ??= {
  jobs: [],
  seq: 0,
  handlers: new Map(),
  workerRunning: false,
  loaded: false,
  writeChain: Promise.resolve(),
  lastWriteAt: 0,
});

const DATA_DIR = path.join(process.cwd(), ".data");
const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
const MAX_JOBS = 100;
const MAX_LOGS_PER_JOB = 500;
/** 日志/进度节流写盘间隔（状态变化不受此限） */
const THROTTLE_MS = 400;

function nowIso(): string {
  return new Date().toISOString();
}

/** 注册任务类型（重复注册覆盖，幂等） */
export function registerJobType(type: string, handler: JobHandler): void {
  state.handlers.set(type, handler);
}

/** 启动时调用：加载持久化任务并拉起 worker；幂等 */
export async function startJobWorker(): Promise<void> {
  await ensureJobsLoaded();
  kickWorker();
}

/** 确保任务文件已载入内存（读取类接口先调用它，避免读到空列表） */
export async function ensureJobsLoaded(): Promise<void> {
  await loadJobs();
}

async function loadJobs(): Promise<void> {
  if (state.loaded) {
    return;
  }
  state.loaded = true;
  try {
    const parsed = JSON.parse(await fsp.readFile(JOBS_FILE, "utf-8")) as {
      seq?: number;
      jobs?: JobRecord[];
    };
    if (Array.isArray(parsed.jobs)) {
      state.jobs = parsed.jobs.filter((job) => job && typeof job.id === "string");
    }
    if (typeof parsed.seq === "number") {
      state.seq = parsed.seq;
    }
  } catch {
    // 文件不存在或损坏：从空队列开始
  }
  // 进程中断遗留的 running 任务重新排队（同步任务幂等，可安全续跑）
  let recovered = 0;
  for (const job of state.jobs) {
    if (job.status === "running") {
      job.status = "queued";
      job.logs.push({ at: nowIso(), level: "warn", message: "服务重启，任务自动恢复排队" });
      recovered += 1;
    }
  }
  if (recovered > 0) {
    console.log(`[jobs] 恢复 ${recovered} 个中断任务`);
    persist(true);
  }
}

/** 创建任务并立即排队执行 */
export async function createJob(input: {
  type: string;
  label: string;
  params?: Record<string, unknown>;
}): Promise<JobRecord> {
  await loadJobs();
  state.seq += 1;
  const job: JobRecord = {
    id: `job-${state.seq}-${randomUUID().slice(0, 8)}`,
    seq: state.seq,
    type: input.type,
    label: input.label,
    params: input.params ?? {},
    status: "queued",
    createdAt: nowIso(),
    logs: [],
  };
  state.jobs.push(job); // 按创建时间序存放，worker 先进先出
  persist(true);
  kickWorker();
  return job;
}

/** 取排队或运行中的任务（指定类型；同一时间每类最多一个是由业务层保证的） */
export function getActiveJob(type?: string): JobRecord | undefined {
  return state.jobs.find(
    (job) => (job.status === "queued" || job.status === "running") && (!type || job.type === type)
  );
}

/** 任务列表（新 → 旧），limit 截断 */
export async function listJobs(limit = 50): Promise<JobRecord[]> {
  await loadJobs();
  return state.jobs.slice(-limit).reverse();
}

export async function getJob(id: string): Promise<JobRecord | undefined> {
  await loadJobs();
  return state.jobs.find((job) => job.id === id);
}

/** 请求取消：排队中的任务直接终态；运行中的由 handler 协作中止 */
export async function requestJobCancel(id: string): Promise<JobRecord | undefined> {
  const job = await getJob(id);
  if (!job) {
    return undefined;
  }
  if (job.status === "queued") {
    job.status = "cancelled";
    job.finishedAt = nowIso();
    job.logs.push({ at: nowIso(), level: "warn", message: "任务在排队中被取消" });
    persist(true);
  } else if (job.status === "running") {
    job.cancelRequested = true;
    persist(true);
  }
  return job;
}

/** 删除记录（仅终态任务可删） */
export async function deleteJob(id: string): Promise<boolean> {
  const job = await getJob(id);
  if (!job || job.status === "queued" || job.status === "running") {
    return false;
  }
  state.jobs = state.jobs.filter((item) => item.id !== id);
  persist(true);
  return true;
}

/** 清空全部终态记录（进行中的保留） */
export async function clearFinishedJobs(): Promise<number> {
  await loadJobs();
  const before = state.jobs.length;
  state.jobs = state.jobs.filter((job) => job.status === "queued" || job.status === "running");
  persist(true);
  return before - state.jobs.length;
}

function appendLog(job: JobRecord, level: JobLogLevel, message: string): void {
  job.logs.push({ at: nowIso(), level, message });
  if (job.logs.length > MAX_LOGS_PER_JOB) {
    const dropped = job.logs.length - MAX_LOGS_PER_JOB;
    job.logs.splice(0, dropped, { at: nowIso(), level: "warn", message: `……（已省略最早 ${dropped} 条日志）` });
  }
}

function kickWorker(): void {
  if (state.workerRunning) {
    return;
  }
  state.workerRunning = true;
  void (async () => {
    try {
      for (;;) {
        const job = state.jobs.find((item) => item.status === "queued");
        if (!job) {
          break;
        }
        // 排队期间已请求取消 → 直接终态
        if (job.cancelRequested) {
          job.status = "cancelled";
          job.finishedAt = nowIso();
          appendLog(job, "warn", "任务在排队中被取消");
          persist(true);
          continue;
        }
        job.status = "running";
        job.startedAt = nowIso();
        persist(true);

        const handler = state.handlers.get(job.type);
        const ctx: JobContext = {
          job,
          log: (level, message) => {
            appendLog(job, level, message);
            persist(false);
          },
          progress: (phase, done, total) => {
            job.progress = { phase, done, total };
            persist(false);
          },
          isCancelled: () => job.cancelRequested === true,
          setResult: (result) => {
            job.result = result;
          },
        };
        try {
          if (!handler) {
            throw new Error(`未注册的任务类型：${job.type}`);
          }
          await handler(ctx);
          job.status = ctx.isCancelled() ? "cancelled" : "completed";
        } catch (error) {
          if (ctx.isCancelled()) {
            job.status = "cancelled";
            appendLog(job, "warn", "任务已取消");
          } else {
            job.status = "failed";
            job.error = error instanceof Error ? error.message : String(error);
            appendLog(job, "error", `任务失败：${job.error}`);
          }
        }
        job.finishedAt = nowIso();
        pruneHistory();
        persist(true);
      }
    } catch (error) {
      // worker 本体异常不应发生（handler 异常已在上方捕获）：记录后退出，下次 createJob 再拉起
      console.error("[jobs] worker 异常退出：", error);
    } finally {
      state.workerRunning = false;
    }
  })();
}

/** 终态记录超出保留上限时裁掉最旧的（进行中的永不裁剪；数组按时间序，最旧在前） */
function pruneHistory(): void {
  const terminal = state.jobs.filter((job) => job.status !== "queued" && job.status !== "running");
  const excess = terminal.length - MAX_JOBS;
  if (excess <= 0) {
    return;
  }
  const doomed = new Set(terminal.slice(0, excess).map((job) => job.id));
  state.jobs = state.jobs.filter((job) => !doomed.has(job.id));
}

/** 落盘：immediate（状态变化）立即写；日志/进度按 THROTTLE_MS 节流合并 */
function persist(immediate: boolean): void {
  if (immediate) {
    void flush();
    return;
  }
  if (state.writeTimer) {
    return;
  }
  const delay = Math.max(0, THROTTLE_MS - (Date.now() - state.lastWriteAt));
  state.writeTimer = setTimeout(() => {
    state.writeTimer = undefined;
    void flush();
  }, delay);
  state.writeTimer.unref?.();
}

async function flush(): Promise<void> {
  const snapshot = JSON.stringify({ seq: state.seq, jobs: state.jobs });
  // 写入串行化：先到先写，后到的带上最新快照（避免旧数据覆盖新数据）
  state.writeChain = state.writeChain
    .then(async () => {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      await fsp.writeFile(`${JOBS_FILE}.tmp`, snapshot, "utf-8");
      await fsp.rename(`${JOBS_FILE}.tmp`, JOBS_FILE);
      state.lastWriteAt = Date.now();
    })
    .catch((error) => {
      console.warn("[jobs] 任务记录写盘失败：", error instanceof Error ? error.message : error);
    });
}
