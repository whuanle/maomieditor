import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DOCS_ROOT, guessMimeType } from "./paths";
import { S3Client, type S3ObjectInfo } from "./s3-client";
import {
  emptySummary,
  readSyncConfig,
  readSyncState,
  s3Configured,
  writeSyncState,
  type SyncMode,
  type SyncState,
  type SyncStateEntry,
  type SyncSummary,
} from "./sync-store";

/**
 * S3 同步引擎：本地 docs/ 目录 ↔ 桶内 prefix 前缀下的对象做镜像对比。
 *
 * 同步范围 = docs 下除隐藏目录（.trash/.git 等）外的全部文件——
 * notes（含 _delete_ 历史备份）与 files 附件都会同步，回收站不同步。
 *
 * 判定依据：单段 PUT 的 ETag 即内容 MD5，与本地 MD5 直接比对；
 * 远端 ETag 非 32 位 hex（分段上传/其他工具写入）时退化为仅比大小，
 * 避免无限重传。冲突（两边都改过）一律以本地为准（手动模式除外：
 * pull-all 以远端为准）。
 */

interface LocalFile {
  absolute: string;
  size: number;
  mtimeMs: number;
}

let syncInFlight: Promise<SyncSummary> | null = null;

/** 串行执行同步：并发调用合流为同一次结果 */
export function runSync(mode: SyncMode): Promise<SyncSummary> {
  if (syncInFlight) {
    return syncInFlight;
  }
  syncInFlight = doSync(mode).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

/** 是否有同步正在进行（UI 提示用） */
export function isSyncing(): boolean {
  return syncInFlight !== null;
}

function keyOf(prefix: string, rel: string): string {
  return prefix ? `${prefix}/${rel}` : rel;
}

/** 远端完整 key → 相对 docs 的路径；不在前缀段边界内（如前缀 a 命中 ab/x）返回 null */
function relOfKey(prefix: string, key: string): string | null {
  if (!prefix) {
    return key;
  }
  if (key === prefix) {
    return "";
  }
  if (key.startsWith(`${prefix}/`)) {
    return key.slice(prefix.length + 1);
  }
  return null;
}

/** 隐藏段（.trash/.git/.data 等）跳过：本地 walk 与远端 key 双向一致 */
function hasHiddenSegment(rel: string): boolean {
  return rel.split("/").some((segment) => segment.startsWith("."));
}

/** 遍历 docs 下全部非隐藏文件（posix 相对路径 → stat） */
async function walkDocs(): Promise<Map<string, LocalFile>> {
  const out = new Map<string, LocalFile>();
  const visit = async (dir: string, relBase: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const absolute = path.join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(absolute, rel);
      } else if (entry.isFile()) {
        try {
          const stat = await fsp.stat(absolute);
          out.set(rel, { absolute, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {
          // 与 readdir 竞态删除，忽略
        }
      }
    }
  };
  await visit(DOCS_ROOT, "");
  return out;
}

/** 流式计算文件 MD5（大附件也不整读内存两次） */
function md5File(absolute: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("md5");
    const stream = fs.createReadStream(absolute);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function isMd5Etag(etag: string): boolean {
  return /^[0-9a-f]{32}$/i.test(etag);
}

/** 删除本地文件后向上清理空目录（到 docs 根为止） */
async function removeEmptyDirsUp(dir: string): Promise<void> {
  let current = dir;
  while (current.startsWith(DOCS_ROOT) && current !== DOCS_ROOT) {
    await fsp.rmdir(current).catch(() => undefined); // 非空/占用即停
    current = path.dirname(current);
  }
}

async function doSync(mode: SyncMode): Promise<SyncSummary> {
  const config = await readSyncConfig();
  if (!s3Configured(config.s3)) {
    throw new Error("S3 尚未配置，请先在同步设置中填写存储桶信息");
  }
  if (mode === "auto" && !config.s3!.enabled) {
    throw new Error("S3 同步未启用");
  }

  const s3Config = config.s3!;
  const prefix = s3Config.prefix;
  const client = new S3Client(s3Config);
  const summary = emptySummary();

  // 1. 拉取两侧清单
  const local = await walkDocs();
  const remote = new Map<string, S3ObjectInfo>();
  for (const info of await client.list(prefix)) {
    const rel = relOfKey(prefix, info.key);
    if (rel === null || rel === "" || hasHiddenSegment(rel) || rel.endsWith("/")) {
      continue; // 前缀段边界外的对象 / 目录占位符 / 隐藏段
    }
    remote.set(rel, info);
  }

  const prevState = await readSyncState();
  const state: SyncState = { entries: prevState.entries };
  const manifest = state.entries;

  const hashes = new Map<string, Promise<string>>();
  const hashOf = (rel: string): Promise<string> => {
    let promise = hashes.get(rel);
    if (!promise) {
      promise = md5File(local.get(rel)!.absolute);
      hashes.set(rel, promise);
    }
    return promise;
  };

  /** 本地与远端内容是否一致（ETag 是 MD5 时比哈希，否则退化比大小） */
  const contentSame = async (rel: string, remoteInfo: S3ObjectInfo): Promise<boolean> => {
    if (!isMd5Etag(remoteInfo.etag)) {
      return local.get(rel)?.size === remoteInfo.size;
    }
    return (await hashOf(rel)) === remoteInfo.etag.toLowerCase();
  };

  const upload = async (rel: string): Promise<void> => {
    const file = local.get(rel)!;
    const body = await fsp.readFile(file.absolute);
    const etag = await client.put(keyOf(prefix, rel), body, guessMimeType(rel));
    manifest[rel] = { etag, size: file.size, mtimeMs: file.mtimeMs };
    summary.uploaded += 1;
  };

  const download = async (rel: string, remoteInfo: S3ObjectInfo): Promise<void> => {
    const body = await client.get(keyOf(prefix, rel));
    // 防 key 穿越兜底：rel 由 walk/白名单生成的段组成，这里再校验一次落在 docs 内
    const absolute = path.resolve(DOCS_ROOT, ...rel.split("/"));
    if (!absolute.startsWith(DOCS_ROOT + path.sep)) {
      throw new Error(`对象 key 越界：${rel}`);
    }
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, body);
    const stat = await fsp.stat(absolute);
    manifest[rel] = { etag: remoteInfo.etag, size: stat.size, mtimeMs: stat.mtimeMs };
    summary.downloaded += 1;
  };

  const noteError = (rel: string, error: unknown): void => {
    summary.errors.push({ key: rel, error: error instanceof Error ? error.message : String(error) });
  };

  // 2. 本地 → 远端
  for (const [rel, file] of local) {
    const remoteInfo = remote.get(rel);
    try {
      if (mode === "push-all") {
        await upload(rel);
        continue;
      }
      if (!remoteInfo) {
        await upload(rel);
        continue;
      }
      const entry = manifest[rel];
      // 快路径：本地 mtime/size 与上次同步一致，且远端 ETag 也没变 → 跳过（免哈希）
      if (
        entry &&
        entry.mtimeMs === file.mtimeMs &&
        entry.size === file.size &&
        entry.etag === remoteInfo.etag
      ) {
        summary.skipped += 1;
        continue;
      }
      if (await contentSame(rel, remoteInfo)) {
        manifest[rel] = { etag: remoteInfo.etag, size: file.size, mtimeMs: file.mtimeMs };
        summary.skipped += 1;
        continue;
      }
      // 两边都有但内容不同：pull-all 走远端；其余模式本地优先（本地改过，或远端被动过但本地也动过/首次同步）
      if (mode === "pull-all") {
        await download(rel, remoteInfo);
      } else {
        await upload(rel);
      }
    } catch (error) {
      noteError(rel, error);
    }
  }

  // 3. 远端-only 处理
  for (const [rel, remoteInfo] of remote) {
    if (local.has(rel)) {
      continue;
    }
    try {
      if (mode === "pull-all") {
        await download(rel, remoteInfo);
      } else if (mode === "push-all") {
        // 覆盖 S3：本地没有的对象清掉，让远端成为本地的精确镜像
        await client.delete(keyOf(prefix, rel));
        delete manifest[rel];
        summary.deleted += 1;
      } else if (manifest[rel]) {
        // 上次同步过、现在本地没了 → 删除已传播到远端（auto/smart 同语义）
        await client.delete(keyOf(prefix, rel));
        delete manifest[rel];
        summary.deleted += 1;
      } else if (mode === "smart") {
        // 远端新增（另一台设备推的）→ 智能同步拉下来
        await download(rel, remoteInfo);
      }
      // auto：远端有、本地没有、也没同步过 → 不动（自动推送只推不拉）
    } catch (error) {
      noteError(rel, error);
    }
  }

  // 4. pull-all 的本地侧镜像：远端没有的本地文件删除
  if (mode === "pull-all") {
    for (const [rel, file] of local) {
      if (remote.has(rel)) {
        continue;
      }
      try {
        await fsp.rm(file.absolute, { force: true });
        await removeEmptyDirsUp(path.dirname(file.absolute));
        delete manifest[rel];
        summary.deleted += 1;
      } catch (error) {
        noteError(rel, error);
      }
    }
  }

  // 5. 清掉清单里两侧都不存在的陈旧项，落盘状态
  for (const rel of Object.keys(manifest)) {
    if (!local.has(rel) && !remote.has(rel)) {
      delete manifest[rel];
    }
  }
  const now = new Date().toISOString();
  if (mode === "auto") {
    state.lastAuto = { at: now, summary };
  } else {
    state.lastManual = { at: now, mode, summary };
  }
  await writeSyncState(state);
  return summary;
}

/** 用给定配置做连通性测试（保存前的「测试连接」用，凭据可为未保存的表单值） */
export async function testS3Connection(config: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}): Promise<{ objectCount: number }> {
  const client = new S3Client(config);
  return client.test();
}
