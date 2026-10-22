import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { zipSync, unzipSync, type Zippable } from "fflate";
import { DOCS_ROOT } from "./paths";

/**
 * 整库备份（设置→备份分区）：把 docs/ 全部内容打包成 zip 存放在 .data/backups/。
 * - 备份对象 = notes/ + files/ + .trash/ 三个白名单顶层目录（笔记正文、旁挂 yaml、
 *   笔记内 _delete_ 历史快照、附件 blob 与回收站都包含）
 * - 上限 5 份，满了必须先删再备（不自动淘汰）
 * - 恢复 = 上传 zip → 先解压到临时目录完整校验 → 一次性整体替换 docs/ 下三个目录
 *   （全量覆盖语义；非法压缩包在触碰现有数据之前就会被拒绝）
 */

const BACKUP_DIR = path.join(process.cwd(), ".data", "backups");
export const MAX_BACKUPS = 5;

/** 文件名格式 backup-{YYYYMMDD}-{HHmmss}-{SSS}.zip（本地时间，毫秒段防同秒冲突） */
const BACKUP_NAME_RE = /^backup-(\d{8})-(\d{6})-(\d{3})\.zip$/;

/** 恢复允许写入 docs/ 的顶层目录白名单 */
const RESTORE_ROOTS = ["notes", "files", ".trash"] as const;

export interface VaultBackupItem {
  /** zip 文件名（同时作为下载/删除的凭据） */
  name: string;
  /** 备份时刻（毫秒时间戳，由文件名本地时间分量解析） */
  ts: number;
  size: number;
}

export interface RestoreResult {
  /** 恢复出的 md/mdx 笔记数（含历史快照文件） */
  noteFiles: number;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** 文件名 → 毫秒时间戳；不匹配命名规则的文件（含正在写入的临时文件）忽略 */
function tsOf(name: string): number | null {
  const match = BACKUP_NAME_RE.exec(name);
  if (!match) {
    return null;
  }
  const [, date, time, ms] = match;
  const ts = new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6)),
    Number(ms)
  ).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function nextBackupName(): string {
  const now = new Date();
  return (
    `backup-${pad(now.getFullYear(), 4)}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}` +
    `-${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}` +
    `-${pad(now.getMilliseconds(), 3)}.zip`
  );
}

export async function listBackups(): Promise<VaultBackupItem[]> {
  let names: string[];
  try {
    names = await fs.readdir(BACKUP_DIR);
  } catch {
    return [];
  }
  const items: VaultBackupItem[] = [];
  for (const name of names) {
    const ts = tsOf(name);
    if (ts === null) {
      continue;
    }
    try {
      const stat = await fs.stat(path.join(BACKUP_DIR, name));
      if (stat.isFile()) {
        items.push({ name, ts, size: stat.size });
      }
    } catch {
      // 文件被并发删除时跳过
    }
  }
  return items.sort((a, b) => b.ts - a.ts);
}

/** 递归收集目录下全部普通文件的 posix 相对路径（跳过符号链接） */
async function walkFiles(root: string, prefix: string, out: Map<string, string>): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return; // 目录不存在（如还没有任何附件）
  }
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkFiles(absolute, rel, out);
    } else if (entry.isFile()) {
      // 符号链接 isFile() 为 false，天然跳过
      out.set(rel, absolute);
    }
  }
}

/** 立即备份：打包 docs 的 notes/files/.trash → .data/backups；满 5 份时抛错 */
export async function createBackup(): Promise<VaultBackupItem> {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const existing = await listBackups();
  if (existing.length >= MAX_BACKUPS) {
    throw new Error(`已有 ${MAX_BACKUPS} 份备份，达到上限，请先删除旧备份再创建`);
  }

  const files = new Map<string, string>();
  for (const root of RESTORE_ROOTS) {
    await walkFiles(path.join(DOCS_ROOT, root), root, files);
  }
  if (files.size === 0) {
    throw new Error("docs 目录为空，没有可备份的内容");
  }

  const zippable: Zippable = {};
  for (const [rel, absolute] of files) {
    zippable[rel] = new Uint8Array(await fs.readFile(absolute));
  }
  const zip = zipSync(zippable);

  // 同名（同毫秒）冲突时等待后重取（毫秒位必然变化）
  let name = nextBackupName();
  while (await fs.stat(path.join(BACKUP_DIR, name)).then(() => true, () => false)) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    name = nextBackupName();
  }
  const target = path.join(BACKUP_DIR, name);
  await fs.writeFile(target, zip);
  return { name, ts: tsOf(name) ?? Date.now(), size: zip.byteLength };
}

function requireValidName(name: string): string {
  if (!BACKUP_NAME_RE.test(name)) {
    throw new Error("备份文件名不合法");
  }
  return path.join(BACKUP_DIR, name);
}

export async function deleteBackup(name: string): Promise<void> {
  await fs.rm(requireValidName(name), { force: true });
}

/** 读出备份 zip 内容（下载用） */
export async function readBackup(name: string): Promise<Buffer> {
  return fs.readFile(requireValidName(name));
}

/** 校验 zip 内部条目：全部位于白名单顶层目录下、无路径穿越、确有笔记内容 */
function validateEntries(entries: string[]): void {
  if (entries.length === 0) {
    throw new Error("压缩包内没有文件，不是有效的备份");
  }
  if (!entries.some((key) => /^notes\//.test(key))) {
    throw new Error("压缩包内缺少 notes/ 目录，不是有效的备份");
  }
  for (const key of entries) {
    if (
      key.includes("\\") ||
      key.startsWith("/") ||
      key.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
      !RESTORE_ROOTS.some((root) => key === root || key.startsWith(`${root}/`))
    ) {
      throw new Error(`压缩包内包含不被允许的路径：${key.slice(0, 80)}`);
    }
  }
}

/** 上传恢复：解压 → 校验 → 临时目录落盘 → 整体替换 docs 的三个顶层目录（全量覆盖） */
export async function restoreFromZip(buffer: Buffer): Promise<RestoreResult> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("无法解压，请确认上传的是本系统导出的 zip 备份");
  }
  const fileKeys = Object.keys(entries).filter((key) => !key.endsWith("/")); // 跳过目录占位条目
  validateEntries(fileKeys);

  // 先完整解压到 .data/backups/.restore-tmp-*，校验失败不会影响线上数据
  const tempRoot = path.join(BACKUP_DIR, `.restore-tmp-${Date.now()}`);
  try {
    for (const key of fileKeys) {
      const target = path.join(tempRoot, ...key.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, entries[key]);
    }

    // 替换：删除现有目录后把临时目录里的顶层目录逐个 rename 进 docs
    for (const root of RESTORE_ROOTS) {
      await fs.rm(path.join(DOCS_ROOT, root), { recursive: true, force: true });
    }
    for (const root of await fs.readdir(tempRoot, { withFileTypes: true })) {
      if (root.isDirectory()) {
        await fs.rename(path.join(tempRoot, root.name), path.join(DOCS_ROOT, root.name));
      }
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  return { noteFiles: fileKeys.filter((key) => /^notes\/.+\.(md|mdx)$/i.test(key)).length };
}
