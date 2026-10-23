import fs from "node:fs/promises";
import path from "node:path";
import { BACKUP_FILE_RE, NOTES_DIR, readNote, writeNote, getNote, notifyDocsChanged } from "./store";

/**
 * 笔记历史版本：与笔记同目录的完整快照文件 {noteId}_delete_{毫秒时间戳}.{md|mdx}
 * （docs/notes/{id前2位}/ 下，随笔记一起参与 git/同步；正常界面不可见——
 *  store 的扫描层会跳过这种文件名，回收站搬动时也随属主笔记一起移动）。
 * - 保存笔记不会自动产生版本，只有显式点「备份」才会生成快照
 * - 备份时与最新一份快照逐字比对，内容相同则跳过（不产生重复文件）
 * - 恢复版本 = 以快照内容回写当前主文件；结构字段（yaml 的 id/parent/order/attachments）保持现状
 * - 恢复前当前内容会自动先快照一份
 */

export interface VersionItem {
  /** 毫秒时间戳（文件名里的备份时间） */
  ts: number;
  size: number;
}

export interface BackupResult extends VersionItem {
  /** 内容与最新快照完全相同，未创建新文件 */
  skipped: boolean;
}

/** 笔记所在分片目录（与 store 的 noteAbsolute 同一套布局） */
function dirOf(noteId: string): string {
  return path.join(NOTES_DIR, noteId.slice(0, 2));
}

async function requireNote(noteId: string): Promise<"md" | "mdx"> {
  const note = await getNote(noteId);
  if (!note) {
    throw new Error("笔记不存在");
  }
  return note.format;
}

/** 列出某笔记的全部备份文件（新→旧） */
async function listBackupFiles(noteId: string): Promise<{ ts: number; file: string }[]> {
  const prefix = `${noteId}_delete_`;
  let names: string[];
  try {
    names = await fs.readdir(dirOf(noteId));
  } catch {
    return [];
  }
  return names
    .filter((name) => BACKUP_FILE_RE.test(name) && name.toLowerCase().startsWith(prefix))
    .map((name) => ({ ts: Number(name.slice(prefix.length, name.lastIndexOf("."))), file: name }))
    .filter((item) => Number.isFinite(item.ts) && item.ts > 0)
    .sort((a, b) => b.ts - a.ts);
}

/** 旧方案迁移：.data/versions/{noteId}/{ts}.md → 笔记同目录 {noteId}_delete_{ts}.{format}；幂等 */
async function migrateLegacyVersions(noteId: string, format: string): Promise<void> {
  const legacyDir = path.join(process.cwd(), ".data", "versions", noteId);
  try {
    const names = (await fs.readdir(legacyDir)).filter((name) => /^\d+\.md$/.test(name));
    for (const name of names) {
      const ts = Number(name.replace(/\.md$/, ""));
      const target = path.join(dirOf(noteId), `${noteId}_delete_${ts}.${format}`);
      await fs.rename(path.join(legacyDir, name), target).catch(() => undefined);
    }
    await fs.rm(legacyDir, { recursive: true, force: true });
  } catch {
    // 旧目录不存在（已迁移或从未用过旧方案）
  }
}

/** 备份当前已保存内容（编辑中的草稿不含在内，前端备份前会先冲刷草稿）；与最新快照相同则跳过 */
export async function backupVersion(noteId: string): Promise<BackupResult> {
  const content = await readNote(noteId);
  if (content === null) {
    throw new Error("笔记不存在");
  }
  const format = await requireNote(noteId);
  await migrateLegacyVersions(noteId, format);
  const files = await listBackupFiles(noteId);
  if (files[0]) {
    const newest = await fs.readFile(path.join(dirOf(noteId), files[0].file), "utf8").catch(() => null);
    if (newest === content) {
      const stat = await fs.stat(path.join(dirOf(noteId), files[0].file));
      return { ts: files[0].ts, size: stat.size, skipped: true };
    }
  }
  let ts = Date.now();
  while (files.some((f) => f.ts === ts)) {
    ts += 1;
  }
  await fs.writeFile(path.join(dirOf(noteId), `${noteId}_delete_${ts}.${format}`), content, "utf8");
  notifyDocsChanged();
  return { ts, size: Buffer.byteLength(content, "utf8"), skipped: false };
}

/** 版本列表（新→旧） */
export async function listVersions(noteId: string): Promise<VersionItem[]> {
  const format = await requireNote(noteId);
  await migrateLegacyVersions(noteId, format);
  const items: VersionItem[] = [];
  for (const { ts, file } of await listBackupFiles(noteId)) {
    try {
      const stat = await fs.stat(path.join(dirOf(noteId), file));
      items.push({ ts, size: stat.size });
    } catch {
      // 文件被并发删除时跳过
    }
  }
  return items;
}

export async function readVersion(noteId: string, ts: number): Promise<string | null> {
  if (!Number.isFinite(ts) || ts <= 0) {
    return null;
  }
  try {
    const files = await listBackupFiles(noteId);
    const hit = files.find((f) => f.ts === ts);
    if (!hit) {
      return null;
    }
    return await fs.readFile(path.join(dirOf(noteId), hit.file), "utf8");
  } catch {
    return null;
  }
}

/** 恢复到指定版本：当前内容先自动快照（内容相同则跳过），再以版本内容回写主文件 */
export async function restoreVersion(noteId: string, ts: number): Promise<void> {
  const versionContent = await readVersion(noteId, ts);
  if (versionContent === null) {
    throw new Error("版本不存在");
  }
  await backupVersion(noteId);
  await writeNote(noteId, versionContent);
}

export async function deleteVersion(noteId: string, ts: number): Promise<void> {
  let removed = false;
  for (const { file } of await listBackupFiles(noteId)) {
    if (file.includes(`_delete_${ts}.`)) {
      await fs.rm(path.join(dirOf(noteId), file), { force: true });
      removed = true;
    }
  }
  if (removed) {
    notifyDocsChanged();
  }
}
