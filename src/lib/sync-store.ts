import fs from "node:fs/promises";
import path from "node:path";

/**
 * 同步配置与状态（服务端专用，node:fs）：
 * - 配置 = .data/sync.json：S3 连接信息（含 Secret，永不回传给前端）与 Git 绑定账号
 * - 状态 = .data/sync-state.json：S3 同步清单（文件 → etag/mtime，用于增量与删除传播）
 *   与最近一次同步结果（UI 展示用）
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const SYNC_CONFIG_FILE = path.join(DATA_DIR, "sync.json");
const SYNC_STATE_FILE = path.join(DATA_DIR, "sync-state.json");

export interface S3StoredConfig {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  /** 对象 key 前缀（不带首尾斜杠；空串 = 桶根） */
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface GitStoredConfig {
  userName: string;
  userEmail: string;
  /** 远程仓库地址（可选；为空表示未绑定） */
  remote: string;
}

export interface SyncConfig {
  s3?: S3StoredConfig;
  git?: GitStoredConfig;
}

export interface SyncStateEntry {
  /** 上次同步成功后远端对象的 ETag（单段 PUT 即内容 MD5） */
  etag: string;
  size: number;
  /** 上次同步时本地文件的 mtime（未变可跳过重算哈希） */
  mtimeMs: number;
}

export interface SyncSummary {
  uploaded: number;
  downloaded: number;
  deleted: number;
  skipped: number;
  errors: { key: string; error: string }[];
  /** 智能同步发现的两边都改过的文件：不覆盖，只记录待人工处理 */
  conflicts: { key: string; detail: string }[];
}

export interface SyncState {
  /** 相对 docs 根的 posix 路径 → 上次同步结果 */
  entries: Record<string, SyncStateEntry>;
  /** 最近一次自动推送 */
  lastAuto?: { at: string; summary: SyncSummary };
  /** 最近一次手动同步 */
  lastManual?: { at: string; mode: string; summary: SyncSummary };
}

/** 同步模式：auto=变化后自动推送（只推不拉）；smart=全量对比双向；push/pull-all=单向覆盖 */
export type SyncMode = "auto" | "smart" | "push-all" | "pull-all";

export function emptySummary(): SyncSummary {
  return { uploaded: 0, downloaded: 0, deleted: 0, skipped: 0, errors: [], conflicts: [] };
}

export async function readSyncConfig(): Promise<SyncConfig> {
  try {
    const parsed = JSON.parse(await fs.readFile(SYNC_CONFIG_FILE, "utf-8")) as SyncConfig;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // 文件不存在或损坏按未配置处理
  }
  return {};
}

export async function readSyncState(): Promise<SyncState> {
  try {
    const parsed = JSON.parse(await fs.readFile(SYNC_STATE_FILE, "utf-8")) as SyncState;
    if (parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object") {
      return parsed;
    }
  } catch {
    // 忽略
  }
  return { entries: {} };
}

export async function writeSyncConfig(config: SyncConfig): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SYNC_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export async function writeSyncState(state: SyncState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SYNC_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

/** S3 配置是否已填齐（可用于判断"已配置"状态） */
export function s3Configured(s3: S3StoredConfig | undefined): s3 is S3StoredConfig {
  return (
    !!s3 &&
    typeof s3.bucket === "string" &&
    s3.bucket.trim().length > 0 &&
    typeof s3.accessKeyId === "string" &&
    s3.accessKeyId.trim().length > 0 &&
    typeof s3.secretAccessKey === "string" &&
    s3.secretAccessKey.length > 0
  );
}

/** 前缀规范化：去首尾斜杠与空白，内部多余斜杠压缩 */
export function normalizePrefix(prefix: string): string {
  return prefix.trim().replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}

/** GET /api/sync 返回给前端的 S3 配置视图（不含 Secret） */
export interface S3ConfigView {
  enabled: boolean;
  configured: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  hasSecret: boolean;
}

export function toS3View(s3: S3StoredConfig | undefined): S3ConfigView {
  return {
    enabled: !!s3?.enabled && s3Configured(s3),
    configured: s3Configured(s3),
    endpoint: s3?.endpoint ?? "",
    region: s3?.region ?? "",
    bucket: s3?.bucket ?? "",
    prefix: s3?.prefix ?? "",
    accessKeyId: s3?.accessKeyId ?? "",
    hasSecret: typeof s3?.secretAccessKey === "string" && s3.secretAccessKey.length > 0,
  };
}
