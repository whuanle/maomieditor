import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import matter from "gray-matter";
import { dump as yamlDump, load as yamlLoad } from "js-yaml";
import { DOCS_ROOT, guessMimeType, sanitizeName } from "./paths";

/**
 * 虚拟文档树存储层（Trilium/Siyuan 式平铺模型，元数据旁挂）：
 *
 * - 笔记正文 = docs/notes/{id前2位}/{id}.md(x) —— **纯内容，永远是干净的 markdown**，
 *   外部上传/手工投放的文件一个字节都不会被改动
 * - 结构元数据 = 同目录同名 .yaml 旁挂文件（id/title/parent/order/attachments），
 *   层级与顺序的唯一真相；元数据改动和内容改动在不同文件里，git 合并永不冲突
 * - 附件 = docs/files/{id前2位}/{id}.{ext}，归属记录在属主笔记的 yaml 里
 * - URL = /notes/{id}；改标题、拖动位置都不会改变身份或链接
 * - 自愈：yaml 缺失自动生成（笔记落到根级末尾）；文件名不是合法 ID 会自动改名收编；
 *   旧版「frontmatter 内嵌结构字段」的笔记在扫描时就地拆分为 yaml + 纯正文
 */

export const NOTES_DIR = path.join(DOCS_ROOT, "notes");
export const FILES_DIR = path.join(DOCS_ROOT, "files");
const DATA_DIR = path.join(process.cwd(), ".data");
const MIGRATION_MARKER = path.join(DATA_DIR, "store-v2-migrated.json");
const SHARES_PATH = path.join(DATA_DIR, "shares.json");

/** ID = 12 位小写 hex，笔记与附件共用格式 */
export const ID_RE = /^[0-9a-f]{12}$/;

export function isValidId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

/**
 * 历史版本备份文件（与笔记同目录）：{noteId}_delete_{毫秒时间戳}.md(x)。
 * 不是笔记：扫描时整体跳过，否则会被自愈逻辑改名收编成一篇可见的新笔记；
 * 回收站移动/恢复/彻底删除时随属主笔记一起搬动（见 moveBackupFiles/removeBackupFiles）
 */
export const BACKUP_FILE_RE = /^[0-9a-f]{12}_delete_\d+\.(md|mdx)$/i;

export interface AttachmentMeta {
  id: string;
  /** 展示/下载用的原始文件名 */
  name: string;
  size: number;
  mime: string;
  /** 不带点的小写扩展名，用于定位 blob 文件 */
  ext: string;
  /** 内联资源（编辑器粘贴/插入的图片）：属于正文，不在目录树中显示 */
  inline?: boolean;
}

export type NoteFormat = "md" | "mdx";

export interface NoteRecord {
  id: string;
  format: NoteFormat;
  /** yaml 里的标题（可能为空串，展示时用 fallbackTitle 兜底） */
  title: string;
  /** 正文推导的标题（用户 frontmatter title 或首个 # 标题），扫描时缓存 */
  headingTitle: string;
  /** yaml 里的 emoji 图标（空串 = 未设置） */
  icon: string;
  parent: string | null;
  order: number;
  /** yaml 里的保护标记：自身开启保护（父级开启时子文档自动受保护，见 effectiveProtected） */
  protected: boolean;
  attachments: AttachmentMeta[];
  absolute: string;
  sidecar: string;
}

/** 侧边栏树节点：笔记或附件（附件是属主笔记的叶子子节点） */
export interface TreeNode {
  id: string;
  type: "md" | "mdx" | "file";
  title: string;
  /** 笔记的 emoji 图标（附件没有） */
  icon?: string;
  /** 有效受保护状态（自身开启或任一祖先开启；附件跟随属主笔记） */
  protected?: boolean;
  parentId: string | null;
  /** parent 失效/成环回落到根级的笔记 */
  orphan?: boolean;
  children?: TreeNode[];
  size?: number;
  mime?: string;
}

/** 旁挂 yaml 的结构字段集合（旧模型内嵌在 frontmatter 里，扫描时自动拆出） */
const STRUCTURAL_KEYS = ["id", "title", "parent", "order", "attachments", "deletedAt"] as const;

// ---------------------------------------------------------------------------
// 扫描与缓存：stat 快照 + 仅重读变更文件
// ---------------------------------------------------------------------------

interface FileStat {
  mtimeMs: number;
  size: number;
}

const records = new Map<string, NoteRecord>(); // id → record
const recordsByPath = new Map<string, NoteRecord>();
const cachedStats = new Map<string, FileStat>();
const attIndex = new Map<string, { noteId: string; meta: AttachmentMeta }>();
let migrationPromise: Promise<void> | null = null;

async function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = runLegacyMigration().catch((error) => {
      migrationPromise = null; // 失败允许下次请求重试
      throw error;
    });
  }
  return migrationPromise;
}

async function statWalk(dir: string, out: Map<string, FileStat>): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (BACKUP_FILE_RE.test(entry.name)) {
      continue; // 历史版本备份文件不是笔记，不进扫描缓存
    }
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await statWalk(absolute, out);
    } else if (/\.(md|mdx|yaml)$/i.test(entry.name)) {
      try {
        const stat = await fs.stat(absolute);
        out.set(absolute, { mtimeMs: stat.mtimeMs, size: stat.size });
      } catch {
        // 与 readdir 竞态删除，忽略
      }
    }
  }
}

function sidecarPathOf(noteAbsolute: string): string {
  return noteAbsolute.replace(/\.(mdx?)$/i, ".yaml");
}

function parseAttachmentList(value: unknown): AttachmentMeta[] {
  const attachments: AttachmentMeta[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (
        item &&
        isValidId(item.id) &&
        typeof item.name === "string" &&
        typeof item.size === "number"
      ) {
        const mime = typeof item.mime === "string" ? item.mime : guessMimeType(item.name);
        attachments.push({
          id: item.id,
          name: item.name,
          size: item.size,
          mime,
          ext: typeof item.ext === "string" ? item.ext.replace(/[^a-z0-9]/gi, "").toLowerCase() : "",
          // 旧数据没有 inline 字段：图片类按内联处理（粘贴的图片不占目录树）
          inline:
            typeof item.inline === "boolean" ? item.inline : mime.startsWith("image/"),
        });
      }
    }
  }
  return attachments;
}

function serializeSidecar(meta: {
  id: string;
  title: string;
  icon?: string;
  parent: string | null;
  order: number;
  attachments: AttachmentMeta[];
  protected?: boolean;
  deletedAt?: string;
}): string {
  const dump: Record<string, unknown> = {
    id: meta.id,
    title: meta.title,
    parent: meta.parent,
    order: meta.order,
    attachments: meta.attachments.map((att) => (att.inline ? { ...att, inline: true } : { ...att })),
  };
  if (meta.icon) {
    dump.icon = meta.icon;
  }
  if (meta.protected) {
    dump.protected = true;
  }
  if (meta.deletedAt) {
    dump.deletedAt = meta.deletedAt;
  }
  return yamlDump(dump);
}

/**
 * 解析单篇笔记（md + 旁挂 yaml），带三重自愈：
 * 1. 文件名不是合法 ID（外部手工拷贝）→ 重命名为 {新ID}.{ext} 收编
 * 2. yaml 缺失 → 生成默认 yaml（parent=null、order 排根级末尾）
 * 3. 旧模型把结构字段内嵌在 md frontmatter 里 → 就地拆分：结构字段进 yaml，
 *    用户的其余 frontmatter（tags 等）原样留在正文里
 */
async function loadRecord(absolute: string): Promise<NoteRecord | null> {
  let id = path.basename(absolute, path.extname(absolute));
  if (!isValidId(id)) {
    const newId = await generateId();
    const renamed = noteAbsolute(newId, /\.mdx$/i.test(absolute) ? "mdx" : "md");
    try {
      await fs.mkdir(path.dirname(renamed), { recursive: true });
      await fs.rename(absolute, renamed);
    } catch {
      return null;
    }
    absolute = renamed;
    id = newId;
  }
  const format: NoteFormat = /\.mdx$/i.test(absolute) ? "mdx" : "md";
  const sidecar = sidecarPathOf(absolute);

  let raw: string;
  try {
    raw = await fs.readFile(absolute, "utf8");
  } catch {
    return null;
  }

  // yaml 优先；读不到用空对象（下面按缺 yaml 补写）
  let meta: {
    title?: unknown;
    icon?: unknown;
    parent?: unknown;
    order?: unknown;
    attachments?: unknown;
    protected?: unknown;
    deletedAt?: unknown;
  } = {};
  let sidecarExists = true;
  try {
    const loaded = yamlLoad(await fs.readFile(sidecar, "utf8"));
    if (loaded && typeof loaded === "object") {
      meta = loaded as typeof meta;
    }
  } catch {
    sidecarExists = false;
  }

  // 旧模型自愈：只有 frontmatter 内嵌了我们 v2 结构字段（id 为合法 ID 且等于文件名）才拆分；
  // 用户自己的 frontmatter（如 Obsidian 的 title/tags）不是我们的，原样保留、一字节不动
  const parsed = matter(raw);
  const structuralInFrontmatter = isValidId(parsed.data.id) && parsed.data.id === id;
  if (structuralInFrontmatter) {
    if (typeof parsed.data.title === "string" && parsed.data.title.trim() && typeof meta.title !== "string") {
      meta.title = parsed.data.title.trim();
    }
    if (isValidId(parsed.data.parent) && parsed.data.parent !== id && !isValidId(meta.parent)) {
      meta.parent = parsed.data.parent;
    }
    if (typeof parsed.data.order === "number" && Number.isFinite(parsed.data.order) && typeof meta.order !== "number") {
      meta.order = parsed.data.order;
    }
    if (parseAttachmentList(parsed.data.attachments).length > 0 && !Array.isArray(meta.attachments)) {
      meta.attachments = parsed.data.attachments;
    }
    const leftover = Object.fromEntries(
      Object.entries(parsed.data).filter(([key]) => !(STRUCTURAL_KEYS as readonly string[]).includes(key))
    );
    raw = Object.keys(leftover).length > 0
      ? matter.stringify(parsed.content, leftover)
      : parsed.content.replace(/^\s+/, "");
    try {
      await fs.writeFile(absolute, raw, "utf8");
    } catch {
      // 拆分写回失败时按原样读取
    }
    sidecarExists = false; // 强制重写 yaml
  }

  // 正文推导标题（用户自己的 frontmatter title > 首个 # 标题）
  const contentParsed = matter(raw);
  const headingTitle =
    (typeof contentParsed.data.title === "string" && contentParsed.data.title.trim()) ||
    contentParsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    "";

  const record: NoteRecord = {
    id,
    format,
    title: typeof meta.title === "string" ? meta.title.trim() : "",
    icon: typeof meta.icon === "string" ? meta.icon.trim().slice(0, 16) : "",
    headingTitle,
    parent: isValidId(meta.parent) && meta.parent !== id ? meta.parent : null,
    order: typeof meta.order === "number" && Number.isFinite(meta.order) ? meta.order : 1e9, // 缺省排根级末尾
    protected: meta.protected === true,
    attachments: parseAttachmentList(meta.attachments),
    absolute,
    sidecar,
  };

  if (!sidecarExists) {
    try {
      await fs.mkdir(path.dirname(sidecar), { recursive: true });
      // 写默认 yaml 前再探一次：避免把并发写入的正确元数据覆盖成默认值
      if (!(await pathExists(sidecar))) {
        await fs.writeFile(sidecar, serializeSidecar(record), "utf8");
      }
    } catch {
      // yaml 写失败不阻塞读取，下次扫描再补
    }
  }
  return record;
}

/** 纯扫描（不含迁移闸门）：迁移过程中必须走这个，否则会等待未完成的迁移自身而死锁 */
let rescanInFlight: Promise<void> | null = null;

async function rescan(): Promise<void> {
  // 并发调用合流：等待进行中的扫描结束后再补一次脏检查，
  // 防止两个扫描交错重写同一批文件（批量自愈拆分时会把正确元数据覆盖成默认值）
  for (let hop = 0; hop < 4; hop += 1) {
    while (rescanInFlight) {
      await rescanInFlight;
    }
    if (await treeUnchanged()) {
      return;
    }
    if (rescanInFlight) {
      continue; // 等待期间有人开始了新扫描，回去等它
    }
    const run = doRescan().finally(() => {
      rescanInFlight = null;
    });
    rescanInFlight = run;
    await run;
    return;
  }
}

async function treeUnchanged(): Promise<boolean> {
  const current = new Map<string, FileStat>();
  await statWalk(NOTES_DIR, current);
  return (
    cachedStats.size === current.size &&
    [...current.entries()].every(
      ([absolute, stat]) => cachedStats.get(absolute)?.mtimeMs === stat.mtimeMs && cachedStats.get(absolute)?.size === stat.size
    )
  );
}

async function doRescan(): Promise<void> {
  const current = new Map<string, FileStat>();
  await statWalk(NOTES_DIR, current);

  if (
    cachedStats.size === current.size &&
    [...current.entries()].every(
      ([absolute, stat]) => cachedStats.get(absolute)?.mtimeMs === stat.mtimeMs && cachedStats.get(absolute)?.size === stat.size
    )
  ) {
    return;
  }

  const nextRecords = new Map<string, NoteRecord>();
  const nextByPath = new Map<string, NoteRecord>();
  for (const [absolute, stat] of current) {
    if (!/\.(md|mdx)$/i.test(absolute)) {
      continue; // yaml 跟随所属 md 一起判断
    }
    // 正文或旁挂 yaml 任一变化（含 yaml出现/消失）都需要重新解析该笔记
    const sidecar = sidecarPathOf(absolute);
    const sidecarStat = current.get(sidecar);
    const sidecarChanged =
      !!sidecarStat !== !!cachedStats.get(sidecar) ||
      (!!sidecarStat &&
        (cachedStats.get(sidecar)?.mtimeMs !== sidecarStat.mtimeMs || cachedStats.get(sidecar)?.size !== sidecarStat.size));
    const mdChanged =
      !cachedStats.get(absolute) ||
      cachedStats.get(absolute)!.mtimeMs !== stat.mtimeMs ||
      cachedStats.get(absolute)!.size !== stat.size;

    const cached = recordsByPath.get(absolute);
    if (cached && !mdChanged && !sidecarChanged) {
      nextRecords.set(cached.id, cached);
      nextByPath.set(absolute, cached);
      continue;
    }
    const loaded = await loadRecord(absolute);
    if (loaded) {
      nextRecords.set(loaded.id, loaded);
      nextByPath.set(absolute, loaded);
    }
  }

  records.clear();
  for (const [id, rec] of nextRecords) records.set(id, rec);
  recordsByPath.clear();
  for (const [absolute, rec] of nextByPath) recordsByPath.set(absolute, rec);
  cachedStats.clear();
  for (const [absolute, stat] of current) cachedStats.set(absolute, stat);

  attIndex.clear();
  for (const rec of records.values()) {
    for (const att of rec.attachments) {
      attIndex.set(att.id, { noteId: rec.id, meta: att });
    }
  }

  for (const id of searchTextCache.keys()) {
    if (!nextRecords.has(id)) {
      searchTextCache.delete(id); // 已删除/收编改名的笔记不留旧正文缓存
    }
  }
}

async function refresh(): Promise<void> {
  await ensureMigrated();
  await rescan();
}

async function getRecords(): Promise<Map<string, NoteRecord>> {
  await refresh();
  return records;
}

// ---------------------------------------------------------------------------
// 文档变更通知：所有写操作（store 内部 + versions/backup 的直接改写）成功后触发，
// 供自动推送等订阅方感知。这是 API 写路径的直达信号（不经文件监听，延迟最低）；
// 不经 API 的外部直改（AI/脚本写文件）由 sync-watcher 的 fs.watch 事件兜底。
// 订阅方不得同步做重活（自动推送是防抖 + 后台任务）；也不能反向 import store
// 依赖链上的模块（sync-engine → store，这里只回调不引用）。
//
// 钩子集合必须挂 globalThis：instrumentation 与 API 路由可能各持一份 store 模块
// 副本（独立 bundle），模块级 Set 会导致「装配在 A 副本、触发在 B 副本」信号丢失。
// ---------------------------------------------------------------------------

const hooksGlobal = globalThis as typeof globalThis & { __docsChangedHooks?: Set<() => void> };
const docsChangedHooks = (hooksGlobal.__docsChangedHooks ??= new Set<() => void>());

/** 订阅文档变更信号，返回取消订阅函数。服务启动时由 instrumentation 装配 */
export function onDocsChanged(hook: () => void): () => void {
  docsChangedHooks.add(hook);
  return () => docsChangedHooks.delete(hook);
}

/** 发出变更信号。store 的写函数自动调用；versions/backup 直接改写 docs 后也需调用 */
export function notifyDocsChanged(): void {
  for (const hook of docsChangedHooks) {
    try {
      hook();
    } catch {
      // 订阅方异常不阻塞写操作本身
    }
  }
}

// ---------------------------------------------------------------------------
// 树聚合
// ---------------------------------------------------------------------------

/** 保守的循环/失效检测：parent 链走到失效节点或成环时，该笔记按根级处理 */
function resolveEffectiveParent(rec: NoteRecord, all: Map<string, NoteRecord>): { parent: string | null; orphan: boolean } {
  if (!rec.parent) {
    return { parent: null, orphan: false };
  }
  const seen = new Set([rec.id]);
  let cursor: string | null = rec.parent;
  while (cursor && all.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    cursor = all.get(cursor)!.parent;
  }
  // cursor 为 null：链正常到达根；否则 parent 指向不存在/成环的笔记
  return cursor === null
    ? { parent: rec.parent, orphan: false }
    : { parent: null, orphan: true };
}

function fallbackTitle(rec: NoteRecord): string {
  return rec.title || rec.headingTitle || "无标题";
}

export /** 有效保护状态：自身开启，或 parent 链上任一祖先开启（成环/失效链按已有节点为准） */
function effectiveProtected(rec: NoteRecord, all: Map<string, NoteRecord>): { self: boolean; inherited: boolean } {
  let inherited = false;
  const seen = new Set([rec.id]);
  let cursor: string | null = rec.parent;
  while (cursor && all.has(cursor) && !seen.has(cursor)) {
    if (all.get(cursor)!.protected) {
      inherited = true;
      break;
    }
    seen.add(cursor);
    cursor = all.get(cursor)!.parent;
  }
  return { self: rec.protected, inherited };
}

function buildTree(all: Map<string, NoteRecord>): TreeNode[] {
  const byParent = new Map<string, NoteRecord[]>();
  const effective = new Map<string, { parent: string | null; orphan: boolean }>();
  for (const rec of all.values()) {
    const resolved = resolveEffectiveParent(rec, all);
    effective.set(rec.id, resolved);
    const key = resolved.parent ?? "";
    const list = byParent.get(key) ?? [];
    list.push(rec);
    byParent.set(key, list);
  }

  const toNode = (rec: NoteRecord, inherited: boolean): TreeNode => {
    const selfProtected = rec.protected || inherited;
    const childNotes = (byParent.get(rec.id) ?? []).sort(
      (a, b) => a.order - b.order || fallbackTitle(a).localeCompare(fallbackTitle(b), "zh-Hans-CN")
    );
    // 内联资源（粘贴的图片）属于正文，不作为子节点展示
    const childAttachments = rec.attachments.filter((att) => !att.inline).sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    return {
      id: rec.id,
      type: rec.format,
      title: fallbackTitle(rec),
      icon: rec.icon || undefined,
      protected: selfProtected || undefined,
      parentId: effective.get(rec.id)?.parent ?? null,
      orphan: effective.get(rec.id)?.orphan,
      children: [
        ...childNotes.map((child) => toNode(child, selfProtected)),
        ...childAttachments.map<TreeNode>((att) => ({
          id: att.id,
          type: "file",
          title: att.name,
          parentId: rec.id,
          size: att.size,
          mime: att.mime,
        })),
      ],
    };
  };

  return (byParent.get("") ?? []).sort(
    (a, b) => a.order - b.order || fallbackTitle(a).localeCompare(fallbackTitle(b), "zh-Hans-CN")
  ).map((rec) => toNode(rec, false));
}

export async function getTree(): Promise<TreeNode[]> {
  const all = await getRecords();
  return buildTree(all);
}

/** id → 子树内全部笔记 id（含自身），用于删除与分享子树判定 */
export async function collectSubtreeNoteIds(rootId: string): Promise<Set<string> | null> {
  const all = await getRecords();
  if (!all.has(rootId)) {
    return null;
  }
  const byParent = new Map<string, string[]>();
  for (const rec of all.values()) {
    if (rec.parent) {
      const list = byParent.get(rec.parent) ?? [];
      list.push(rec.id);
      byParent.set(rec.parent, list);
    }
  }
  const result = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of byParent.get(current) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// ID 与路径
// ---------------------------------------------------------------------------

async function pathExists(absolute: string): Promise<boolean> {
  try {
    await fs.access(absolute);
    return true;
  } catch {
    return false;
  }
}

async function generateId(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = randomBytes(6).toString("hex");
    if (records.has(candidate)) {
      continue;
    }
    const shard = path.join(NOTES_DIR, candidate.slice(0, 2));
    if (
      (await pathExists(path.join(shard, `${candidate}.md`))) ||
      (await pathExists(path.join(shard, `${candidate}.mdx`))) ||
      (await pathExists(path.join(shard, `${candidate}.yaml`))) ||
      (await pathExists(path.join(FILES_DIR, candidate.slice(0, 2))))
    ) {
      continue;
    }
    return candidate;
  }
  throw new Error("生成笔记 ID 失败，请重试");
}

function noteAbsolute(id: string, format: NoteFormat): string {
  return path.join(NOTES_DIR, id.slice(0, 2), `${id}.${format}`);
}

function noteSidecarAbsolute(id: string): string {
  return path.join(NOTES_DIR, id.slice(0, 2), `${id}.yaml`);
}

function attachmentAbsolute(att: Pick<AttachmentMeta, "id" | "ext">): string {
  return path.join(FILES_DIR, att.id.slice(0, 2), `${att.id}${att.ext ? `.${att.ext}` : ""}`);
}

// ---------------------------------------------------------------------------
// 读写与 CRUD
// ---------------------------------------------------------------------------

export interface NoteView {
  id: string;
  format: NoteFormat;
  title: string;
  icon: string;
  /** 自身开启保护 */
  protectedSelf: boolean;
  /** 有效保护（自身或祖先开启） */
  protectedEffective: boolean;
}

export async function getNote(id: string): Promise<NoteView | null> {
  if (!isValidId(id)) {
    return null;
  }
  const all = await getRecords();
  const rec = all.get(id);
  if (!rec) {
    return null;
  }
  const prot = effectiveProtected(rec, all);
  return {
    id: rec.id,
    format: rec.format,
    title: fallbackTitle(rec),
    icon: rec.icon,
    protectedSelf: prot.self,
    protectedEffective: prot.self || prot.inherited,
  };
}

/** 笔记的有效保护状态（自身开启 / 祖先开启，二者任一即受保护）；笔记不存在返回 null */
export async function getNoteProtection(id: string): Promise<{ self: boolean; inherited: boolean } | null> {
  if (!isValidId(id)) {
    return null;
  }
  const all = await getRecords();
  const rec = all.get(id);
  if (!rec) {
    return null;
  }
  return effectiveProtected(rec, all);
}

/**
 * 开启/关闭笔记保护。父级开启时全部子文档自动受保护，
 * 因此祖先已受保护的子文档不能单独关闭（只能到开启保护的祖先上关）。
 */
export async function setNoteProtection(id: string, on: boolean): Promise<void> {
  const all = await getRecords();
  const rec = all.get(id);
  if (!rec) {
    throw new Error("笔记不存在");
  }
  if (!on) {
    const prot = effectiveProtected(rec, all);
    if (prot.inherited) {
      throw new Error("该文档由上级文档保护，请到开启保护的上级文档关闭");
    }
  }
  await mutateNoteMeta(id, (data) => {
    data.protected = on;
  });
}

export async function readNote(id: string): Promise<string | null> {
  if (!isValidId(id)) {
    return null;
  }
  const all = await getRecords();
  const rec = all.get(id);
  if (!rec) {
    return null;
  }
  try {
    return await fs.readFile(rec.absolute, "utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 正文检索：按 mtime/size 缓存去 frontmatter 的正文，关键词 AND、忽略大小写
// ---------------------------------------------------------------------------

interface SearchTextEntry {
  mtimeMs: number;
  size: number;
  text: string;
  lower: string;
}

const searchTextCache = new Map<string, SearchTextEntry>();

/** 笔记正文纯文本（frontmatter 不参与检索）；缓存有效性跟随 cachedStats 的 stat 快照 */
async function searchableText(rec: NoteRecord): Promise<SearchTextEntry> {
  const stat = cachedStats.get(rec.absolute);
  const cached = searchTextCache.get(rec.id);
  if (cached && stat && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }
  let text = "";
  try {
    text = matter(await fs.readFile(rec.absolute, "utf8")).content;
  } catch {
    return { mtimeMs: 0, size: 0, text: "", lower: "" };
  }
  const entry: SearchTextEntry = {
    mtimeMs: stat?.mtimeMs ?? 0,
    size: stat?.size ?? 0,
    text,
    lower: text.toLowerCase(),
  };
  searchTextCache.set(rec.id, entry);
  return entry;
}

/** 取第一个关键词前后的上下文做命中片段；压缩空白，越界补省略号 */
function buildContentSnippet(text: string, lower: string, terms: string[]): string {
  let index = -1;
  for (const term of terms) {
    const at = lower.indexOf(term);
    if (at >= 0 && (index < 0 || at < index)) {
      index = at;
    }
  }
  if (index < 0) {
    index = 0;
  }
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + 90);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) {
    snippet = `…${snippet}`;
  }
  if (end < text.length) {
    snippet = `${snippet}…`;
  }
  return snippet;
}

export interface NoteSearchHit {
  id: string;
  title: string;
  /** 命中上下文片段（对齐到第一个关键词） */
  snippet: string;
}

/**
 * 正文关键词检索：全部关键词 AND、不区分大小写，最多返回 limit 条。
 * protectedUnlocked=false 时跳过受保护笔记（含继承保护），避免未解锁会话泄露正文；
 * 标题命中不在这里返回，由前端本地过滤负责。
 */
export async function searchNotes(
  query: string,
  opts: { protectedUnlocked: boolean; limit?: number }
): Promise<NoteSearchHit[]> {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return [];
  }
  const limit = opts.limit ?? 100;
  const all = await getRecords();
  const hits: NoteSearchHit[] = [];
  for (const rec of all.values()) {
    if (!opts.protectedUnlocked) {
      const prot = effectiveProtected(rec, all);
      if (prot.self || prot.inherited) {
        continue;
      }
    }
    const entry = await searchableText(rec);
    if (!entry.lower || !terms.every((term) => entry.lower.includes(term))) {
      continue;
    }
    hits.push({ id: rec.id, title: fallbackTitle(rec), snippet: buildContentSnippet(entry.text, entry.lower, terms) });
    if (hits.length >= limit) {
      break;
    }
  }
  return hits;
}

/** 修改旁挂 yaml 元数据（正文 md 一个字节都不动） */
async function mutateNoteMeta(id: string, mutate: (meta: SidecarMeta) => void): Promise<NoteRecord> {
  const all = await getRecords();
  const rec = all.get(id);
  if (!rec) {
    throw new Error("笔记不存在");
  }
  const meta: SidecarMeta = {
    id: rec.id,
    title: rec.title,
    icon: rec.icon,
    parent: rec.parent,
    order: rec.order,
    protected: rec.protected,
    attachments: rec.attachments.map((att) => ({ ...att })),
  };
  mutate(meta);
  if (!meta.protected) {
    delete meta.protected; // 关闭保护后不再写该字段
  }
  await fs.writeFile(rec.sidecar, serializeSidecar(meta), "utf8");
  await refresh();
  notifyDocsChanged();
  return records.get(id) ?? rec;
}

interface SidecarMeta {
  id: string;
  title: string;
  icon?: string;
  parent: string | null;
  order: number;
  protected?: boolean;
  attachments: AttachmentMeta[];
  deletedAt?: string;
}

/** 保存正文：纯内容写入，结构在旁挂 yaml 里，无需任何强制回写 */
export async function writeNote(id: string, content: string): Promise<void> {
  const all = await getRecords();
  const rec = all.get(id);
  if (!rec) {
    throw new Error("笔记不存在");
  }
  await fs.writeFile(rec.absolute, content, "utf8");
  await refresh();
  notifyDocsChanged();
}

function siblingOrders(all: Map<string, NoteRecord>, parent: string | null): number[] {
  return [...all.values()]
    .filter((rec) => (rec.parent ?? null) === parent)
    .map((rec) => rec.order);
}

function recordToNode(rec: NoteRecord): TreeNode {
  return {
    id: rec.id,
    type: rec.format,
    title: fallbackTitle(rec),
    icon: rec.icon || undefined,
    protected: rec.protected || undefined,
    parentId: rec.parent,
    children: rec.attachments
      .filter((att) => !att.inline)
      .map<TreeNode>((att) => ({
        id: att.id,
        type: "file",
        title: att.name,
        parentId: rec.id,
        size: att.size,
        mime: att.mime,
      })),
  };
}

export async function createNote(opts: {
  parentId: string | null;
  title: string;
  format: NoteFormat;
}): Promise<TreeNode> {
  const all = await getRecords();
  if (opts.parentId && !all.has(opts.parentId)) {
    throw new Error("父笔记不存在");
  }
  const title = opts.title.trim() || "无标题";
  const orders = siblingOrders(all, opts.parentId);
  const order = orders.length > 0 ? Math.max(...orders) + 1000 : 1000;

  const id = await generateId();
  const absolute = noteAbsolute(id, opts.format);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, `# ${title}\n\n`, "utf8");
  await fs.writeFile(
    noteSidecarAbsolute(id),
    serializeSidecar({ id, title, parent: opts.parentId, order, attachments: [] }),
    "utf8"
  );
  await refresh();
  notifyDocsChanged();
  return recordToNode(records.get(id)!);
}

/** 导入外部 md/mdx：内容原样入库（含用户自己的 frontmatter），标题取 frontmatter 标题 > 首个 # > 文件名 */
export async function importNote(opts: {
  parentId: string | null;
  fileName: string;
  text: string;
}): Promise<TreeNode> {
  const all = await getRecords();
  if (opts.parentId && !all.has(opts.parentId)) {
    throw new Error("父笔记不存在");
  }
  const format: NoteFormat = /\.mdx$/i.test(opts.fileName) ? "mdx" : "md";
  const parsed = matter(opts.text);
  const derivedTitle =
    (typeof parsed.data.title === "string" && parsed.data.title.trim()) ||
    parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    opts.fileName.replace(/\.(mdx?)$/i, "").trim() ||
    "导入笔记";

  const orders = siblingOrders(all, opts.parentId);
  const order = orders.length > 0 ? Math.max(...orders) + 1000 : 1000;
  const id = await generateId();
  const absolute = noteAbsolute(id, format);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, opts.text, "utf8");
  await fs.writeFile(
    noteSidecarAbsolute(id),
    serializeSidecar({ id, title: derivedTitle, parent: opts.parentId, order, attachments: [] }),
    "utf8"
  );
  await refresh();
  notifyDocsChanged();
  return recordToNode(records.get(id)!);
}

export async function renameNote(id: string, title: string): Promise<void> {
  const cleaned = title.trim();
  if (!cleaned) {
    throw new Error("标题不能为空");
  }
  await mutateNoteMeta(id, (data) => {
    data.title = cleaned;
  });
}

/** 设置/清除笔记的 emoji 图标（icon 传空串 = 清除） */
export async function setNoteIcon(id: string, icon: string): Promise<void> {
  const cleaned = icon.trim();
  if (cleaned && (Array.from(cleaned).length > 4 || /[\n\r\t]/.test(cleaned))) {
    throw new Error("图标只支持 1-4 个字符的 emoji");
  }
  await mutateNoteMeta(id, (data) => {
    data.icon = cleaned;
  });
}

async function isDescendantOf(all: Map<string, NoteRecord>, ancestorId: string, noteId: string): Promise<boolean> {
  const seen = new Set<string>();
  let cursor = all.get(noteId)?.parent ?? null;
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorId) {
      return true;
    }
    seen.add(cursor);
    cursor = all.get(cursor)?.parent ?? null;
  }
  return false;
}

/** 移动到新父笔记下（追加到末尾）；拖拽改父级走这里 */
export async function moveNote(id: string, parentId: string | null): Promise<void> {
  const all = await getRecords();
  if (!all.has(id)) {
    throw new Error("笔记不存在");
  }
  if (parentId) {
    if (!all.has(parentId)) {
      throw new Error("目标笔记不存在");
    }
    if (parentId === id || (await isDescendantOf(all, id, parentId))) {
      throw new Error("不能把笔记移动到它自己或它的子笔记下面");
    }
  }
  const orders = siblingOrders(all, parentId);
  const order = orders.length > 0 ? Math.max(...orders) + 1000 : 1000;
  await mutateNoteMeta(id, (data) => {
    data.parent = parentId;
    data.order = order;
  });
}

/** 拖到某笔记的上/下边缘：与其同级并列，插入到对应位置 */
export async function reorderNote(id: string, targetId: string, position: "before" | "after"): Promise<void> {
  const all = await getRecords();
  const rec = all.get(id);
  const target = all.get(targetId);
  if (!rec || !target) {
    throw new Error("笔记不存在");
  }
  if (id === targetId || (await isDescendantOf(all, id, targetId))) {
    throw new Error("不能相对自己的子笔记排序");
  }

  const newParent = target.parent;
  const siblings = [...all.values()]
    .filter((item) => item.id !== id && (item.parent ?? null) === (newParent ?? null))
    .sort((a, b) => a.order - b.order || fallbackTitle(a).localeCompare(fallbackTitle(b), "zh-Hans-CN"));
  const targetIndex = siblings.indexOf(target);
  const insertAt = position === "before" ? targetIndex : targetIndex + 1;
  const ordered = [...siblings.slice(0, insertAt), rec, ...siblings.slice(insertAt)];

  // 取邻居中值（double 精度，同点连续插入 ~46 次才会触发一次同级重排），
  // 两端用 ±1000 外推；任何情况下重排都只影响同级笔记
  const prev = ordered[insertAt - 1];
  const next = ordered[insertAt + 1];
  let newOrder: number;
  if (!prev) {
    newOrder = next.order - 1000;
  } else if (!next) {
    newOrder = prev.order + 1000;
  } else {
    newOrder = (prev.order + next.order) / 2;
  }

  if (!Number.isFinite(newOrder) || newOrder === prev?.order || newOrder === next?.order) {
    // 间隔耗尽：整体按当前排列重排（1000, 2000, ...），只写有变化的笔记
    await Promise.all(
      ordered.map((item, index) =>
        item === rec || item.order !== (index + 1) * 1000
          ? mutateNoteMeta(item.id, (data) => {
              data.parent = item === rec ? newParent : item.parent;
              data.order = (index + 1) * 1000;
            })
          : Promise.resolve()
      )
    );
    return;
  }

  await mutateNoteMeta(id, (data) => {
    data.parent = newParent;
    data.order = newOrder;
  });
}

export async function addAttachment(
  noteId: string,
  fileName: string,
  data: Uint8Array | ArrayBuffer,
  opts?: { inline?: boolean }
): Promise<AttachmentMeta> {
  const all = await getRecords();
  if (!all.has(noteId)) {
    throw new Error("笔记不存在");
  }
  const rawExt = path.extname(fileName).toLowerCase();
  const ext = rawExt.replace(/[^a-z0-9.]/g, "").replace(/^\./, "");
  const displayName = sanitizeName(path.basename(fileName, rawExt) + rawExt) ?? `附件${rawExt}`;
  const id = await generateId();
  const absolute = attachmentAbsolute({ id, ext });
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, data instanceof Uint8Array ? data : Buffer.from(data));

  const meta: AttachmentMeta = {
    id,
    name: displayName,
    size: data.byteLength,
    mime: guessMimeType(displayName),
    ext,
    inline: opts?.inline ?? false,
  };
  const updated = await mutateNoteMeta(noteId, (frontmatter) => {
    const list = Array.isArray(frontmatter.attachments) ? frontmatter.attachments : [];
    list.push(meta);
    frontmatter.attachments = list;
  });
  void updated;
  return meta;
}

export async function removeAttachment(noteId: string, attachmentId: string): Promise<void> {
  const all = await getRecords();
  const rec = all.get(noteId);
  if (!rec) {
    throw new Error("笔记不存在");
  }
  const target = rec.attachments.find((att) => att.id === attachmentId);
  if (!target) {
    throw new Error("附件不存在");
  }
  await mutateNoteMeta(noteId, (data) => {
    data.attachments = (Array.isArray(data.attachments) ? data.attachments : []).filter(
      (item: { id?: unknown }) => item?.id !== attachmentId
    );
  });
  const attPath = attachmentAbsolute(target);
  await fs.rm(attPath, { force: true });
  await fs.rmdir(path.dirname(attPath)).catch(() => undefined);
}

export interface AttachmentRef extends AttachmentMeta {
  noteId: string;
  absolute: string;
}

export async function getAttachment(id: string): Promise<AttachmentRef | null> {
  if (!isValidId(id)) {
    return null;
  }
  await refresh();
  const hit = attIndex.get(id);
  if (!hit) {
    return null;
  }
  const absolute = attachmentAbsolute(hit.meta);
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) {
      return null;
    }
    return { ...hit.meta, noteId: hit.noteId, absolute };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 回收站：docs/.trash（随内容一起被同步；旁挂 yaml 的 parent/order 保留，恢复即回原位）
// ---------------------------------------------------------------------------

export const TRASH_NOTES_DIR = path.join(DOCS_ROOT, ".trash", "notes");
export const TRASH_FILES_DIR = path.join(DOCS_ROOT, ".trash", "files");

interface TrashRecord {
  id: string;
  format: NoteFormat;
  title: string;
  deletedAt: string;
  parent: string | null;
  /** 回收站里的正文 md */
  absolute: string;
  /** 回收站里的旁挂 yaml */
  sidecar: string;
  /** yaml 原文解析出的完整元数据（含 icon/protected/attachments） */
  meta: Partial<SidecarMeta>;
}

async function scanTrash(): Promise<Map<string, TrashRecord>> {
  const result = new Map<string, TrashRecord>();
  const visit = async (dir: string): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!/\.(yaml)$/i.test(entry.name)) {
        continue;
      }
      try {
        const loaded = yamlLoad(await fs.readFile(absolute, "utf8"));
        if (!loaded || typeof loaded !== "object") {
          continue;
        }
        const meta = loaded as Record<string, unknown>;
        const id = isValidId(meta.id) ? meta.id : entry.name.replace(/\.yaml$/i, "");
        const format: NoteFormat = (await fs.stat(absolute.replace(/\.yaml$/i, ".mdx")).then(() => true, () => false))
          ? "mdx"
          : "md";
        const mdPath = absolute.replace(/\.yaml$/i, format === "mdx" ? ".mdx" : ".md");
        // 标题兜底：正文 frontmatter / 首个 # 标题
        let heading = "";
        try {
          const raw = await fs.readFile(mdPath, "utf8");
          const parsed = matter(raw);
          heading =
            (typeof parsed.data.title === "string" && parsed.data.title.trim()) ||
            parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
            "";
        } catch {
          // 正文缺失时仅用 yaml 标题
        }
        result.set(id, {
          id,
          format,
          title: typeof meta.title === "string" && meta.title.trim() ? meta.title.trim() : heading || "无标题",
          deletedAt: typeof meta.deletedAt === "string" ? meta.deletedAt : "",
          parent: isValidId(meta.parent) ? meta.parent : null,
          absolute: mdPath,
          sidecar: absolute,
          meta: loaded as Partial<SidecarMeta>,
        });
      } catch {
        // 解析失败的文件跳过
      }
    }
  };
  await visit(TRASH_NOTES_DIR);
  return result;
}

/** scanTrash 的短缓存：回收站预览一次渲染会并发拉取多张图片，避免每个附件请求都全量扫 .trash */
let trashScanCache: { at: number; promise: Promise<Map<string, TrashRecord>> } | null = null;

function scanTrashCached(): Promise<Map<string, TrashRecord>> {
  if (trashScanCache && Date.now() - trashScanCache.at < 5_000) {
    return trashScanCache.promise;
  }
  const promise = scanTrash().catch((error: unknown) => {
    trashScanCache = null;
    throw error;
  });
  trashScanCache = { at: Date.now(), promise };
  return promise;
}

function invalidateTrashCache(): void {
  trashScanCache = null;
}

export interface TrashedNoteView {
  id: string;
  format: NoteFormat;
  title: string;
  icon: string;
  deletedAt: string;
  /** 回收站里的正文内容；文件缺失时为 null */
  content: string | null;
}

/** 读取回收站内某篇笔记（预览用）；不在回收站返回 null */
export async function getTrashedNote(id: string): Promise<TrashedNoteView | null> {
  if (!isValidId(id)) {
    return null;
  }
  const trash = await scanTrashCached();
  const rec = trash.get(id);
  if (!rec) {
    return null;
  }
  let content: string | null = null;
  try {
    content = await fs.readFile(rec.absolute, "utf8");
  } catch {
    // 正文缺失仍返回视图（标题/时间可用）
  }
  return {
    id,
    format: rec.format,
    title: rec.title,
    icon: typeof rec.meta.icon === "string" ? rec.meta.icon : "",
    deletedAt: rec.deletedAt,
    content,
  };
}

/** 回收站内某附件的引用（属主也在回收站）；找不到返回 null，供附件路由回退到 .trash/files */
export async function getTrashedAttachment(id: string): Promise<AttachmentRef | null> {
  if (!isValidId(id)) {
    return null;
  }
  const trash = await scanTrashCached();
  for (const rec of trash.values()) {
    if (!Array.isArray(rec.meta.attachments)) {
      continue;
    }
    for (const att of rec.meta.attachments) {
      if (!att || !isValidId(att.id) || att.id !== id) {
        continue;
      }
      const ext = typeof att.ext === "string" ? att.ext.replace(/[^a-z0-9]/gi, "").toLowerCase() : "";
      const absolute = path.join(TRASH_FILES_DIR, id.slice(0, 2), `${id}${ext ? `.${ext}` : ""}`);
      try {
        const stat = await fs.stat(absolute);
        if (!stat.isFile()) {
          continue;
        }
      } catch {
        continue;
      }
      return {
        id,
        name: typeof att.name === "string" && att.name ? att.name : `${id}${ext ? `.${ext}` : ""}`,
        size: typeof att.size === "number" ? att.size : 0,
        mime: typeof att.mime === "string" ? att.mime : "application/octet-stream",
        ext,
        inline: att.inline === true,
        noteId: rec.id,
        absolute,
      };
    }
  }
  return null;
}

/**
 * 回收站内笔记的有效保护（预览门禁用）：祖先链在回收站内沿 trash parent 走，
 * 父级已恢复回活动区时（混合链）用活动树的有效保护；不在回收站返回 null。
 */
export async function getTrashedProtection(id: string): Promise<{ self: boolean; inherited: boolean } | null> {
  const trash = await scanTrashCached();
  const rec = trash.get(id);
  if (!rec) {
    return null;
  }
  let inherited = false;
  let cursor: string | null = rec.parent;
  const seen = new Set<string>([id]);
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const parentRec = trash.get(cursor);
    if (parentRec) {
      if (parentRec.meta.protected === true) {
        inherited = true;
        break;
      }
      cursor = parentRec.parent;
      continue;
    }
    // 父级不在回收站：链回到活动区，交给活动树的有效保护判断
    const prot = await getNoteProtection(cursor);
    if (prot && (prot.self || prot.inherited)) {
      inherited = true;
    }
    break;
  }
  return { self: rec.meta.protected === true, inherited };
}

export interface TrashItem {
  id: string;
  format: NoteFormat;
  title: string;
  deletedAt: string;
  parentId: string | null;
  /** 原位置：父笔记标题（活动树或回收站内）；null = 根级或父已不可考 */
  parentTitle: string | null;
  childCount: number;
}

export async function listTrash(): Promise<TrashItem[]> {
  const trash = await scanTrashCached();
  const active = await getRecords();
  const byParent = new Map<string, number>();
  for (const item of trash.values()) {
    if (item.parent) {
      byParent.set(item.parent, (byParent.get(item.parent) ?? 0) + 1);
    }
  }

  const items = [...trash.values()].map((item) => ({
    id: item.id,
    format: item.format,
    title: item.title,
    deletedAt: item.deletedAt,
    parentId: item.parent,
    parentTitle: item.parent
      ? (active.get(item.parent) ? fallbackTitle(active.get(item.parent)!) : null) ?? trash.get(item.parent)?.title ?? null
      : null,
    childCount: byParent.get(item.id) ?? 0,
  }));

  items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return items;
}

/** 回收站内 id 的后代集合（含自身）；找不到返回 null */
function collectTrashSubtree(trash: Map<string, TrashRecord>, rootId: string): Set<string> | null {
  if (!trash.has(rootId)) {
    return null;
  }
  const byParent = new Map<string, string[]>();
  for (const item of trash.values()) {
    if (item.parent) {
      const list = byParent.get(item.parent) ?? [];
      list.push(item.id);
      byParent.set(item.parent, list);
    }
  }
  const result = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of byParent.get(current) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}

/** 把笔记的历史版本备份文件（{id}_delete_*）随笔记一起搬到目标目录 */
async function moveBackupFiles(fromDir: string, toDir: string, noteId: string): Promise<void> {
  try {
    for (const name of await fs.readdir(fromDir)) {
      if (BACKUP_FILE_RE.test(name) && name.toLowerCase().startsWith(`${noteId}_delete_`)) {
        await fs.mkdir(toDir, { recursive: true });
        await fs.rename(path.join(fromDir, name), path.join(toDir, name)).catch(() => undefined);
      }
    }
  } catch {
    // 目录不存在或被并发清空时忽略
  }
}

/** 删除某笔记目录里的全部历史版本备份文件 */
async function removeBackupFiles(dir: string, noteId: string): Promise<void> {
  try {
    for (const name of await fs.readdir(dir)) {
      if (BACKUP_FILE_RE.test(name) && name.toLowerCase().startsWith(`${noteId}_delete_`)) {
        await fs.rm(path.join(dir, name), { force: true });
      }
    }
  } catch {
    // 目录不存在时忽略
  }
}

/** 软删除：笔记及其后代、附件移入回收站（不真正删除文件，同步语义上是一次移动） */
export async function trashNote(id: string): Promise<number> {
  invalidateTrashCache();
  const subtree = await collectSubtreeNoteIds(id);
  if (!subtree) {
    throw new Error("笔记不存在");
  }
  const all = await getRecords();
  const deletedAt = new Date().toISOString();
  const emptiedDirs = new Set<string>();

  for (const noteId of subtree) {
    const rec = all.get(noteId);
    if (!rec) {
      continue;
    }
    // yaml 打上删除时间（parent/order 原样保留，恢复时直接回到原位置），正文与元数据一起搬进回收站
    const trashMd = path.join(TRASH_NOTES_DIR, rec.id.slice(0, 2), `${rec.id}.${rec.format}`);
    const trashYaml = trashMd.replace(/\.(mdx?)$/i, ".yaml");
    await fs.mkdir(path.dirname(trashMd), { recursive: true });
    await fs.writeFile(
      trashYaml,
      serializeSidecar({
        id: rec.id,
        title: rec.title,
        icon: rec.icon,
        parent: rec.parent,
        order: rec.order,
        protected: rec.protected,
        attachments: rec.attachments,
        deletedAt,
      }),
      "utf8"
    );
    await fs.rename(rec.absolute, trashMd).catch(() => undefined);
    await fs.rm(rec.sidecar, { force: true });
    // 历史版本备份文件跟着笔记一起进回收站，恢复时一并搬回
    await moveBackupFiles(path.dirname(rec.absolute), path.dirname(trashMd), rec.id);
    emptiedDirs.add(path.dirname(rec.absolute));

    for (const att of rec.attachments) {
      const from = attachmentAbsolute(att);
      const to = path.join(TRASH_FILES_DIR, att.id.slice(0, 2), `${att.id}${att.ext ? `.${att.ext}` : ""}`);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to).catch(() => undefined); // blob 已缺失时跳过
    }
  }

  for (const dir of emptiedDirs) {
    await fs.rmdir(dir).catch(() => undefined);
  }
  invalidateTrashCache();
  await refresh();
  notifyDocsChanged();
  return subtree.size;
}

/** 从回收站恢复：id 及其在回收站内的全部后代回到原位置（父笔记已不存在则挂到根级并标记孤儿） */
export async function restoreNote(id: string): Promise<number> {
  invalidateTrashCache();
  const trash = await scanTrash();
  const subtree = collectTrashSubtree(trash, id);
  if (!subtree) {
    throw new Error("回收站中没有该笔记");
  }

  const emptiedDirs = new Set<string>();
  for (const noteId of subtree) {
    const rec = trash.get(noteId)!;
    // yaml 去掉 deletedAt 后回到活动区，正文原样搬回
    let meta: SidecarMeta | null = null;
    try {
      meta = yamlLoad(await fs.readFile(rec.sidecar, "utf8")) as SidecarMeta;
    } catch {
      // yaml 读不到就按默认结构恢复
    }
    if (meta && typeof meta === "object") {
      delete meta.deletedAt;
    }
    const backMd = noteAbsolute(rec.id, rec.format);
    const backYaml = noteSidecarAbsolute(rec.id);
    await fs.mkdir(path.dirname(backMd), { recursive: true });
    await fs.rename(rec.absolute, backMd).catch(() => undefined);
    // 备份文件从回收站搬回笔记目录
    await moveBackupFiles(path.dirname(rec.absolute), path.dirname(backMd), rec.id);
    if (meta && typeof meta === "object") {
      await fs.writeFile(backYaml, serializeSidecar(meta), "utf8");
      await fs.rm(rec.sidecar, { force: true });
    }
    emptiedDirs.add(path.dirname(rec.absolute));

    if (meta && Array.isArray(meta.attachments)) {
      for (const att of meta.attachments) {
        if (!att || !isValidId(att.id)) {
          continue;
        }
        const ext = typeof att.ext === "string" ? att.ext.replace(/[^a-z0-9]/gi, "").toLowerCase() : "";
        const from = path.join(TRASH_FILES_DIR, att.id.slice(0, 2), `${att.id}${ext ? `.${ext}` : ""}`);
        const to = attachmentAbsolute({ id: att.id, ext });
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(from, to).catch(() => undefined);
        emptiedDirs.add(path.dirname(from));
      }
    }
  }

  for (const dir of emptiedDirs) {
    await fs.rmdir(dir).catch(() => undefined);
  }
  invalidateTrashCache();
  await refresh();
  notifyDocsChanged();
  return subtree.size;
}

/** 彻底删除回收站内某笔记及其后代（不可恢复） */
export async function purgeNote(id: string): Promise<number> {
  invalidateTrashCache();
  const trash = await scanTrash();
  const subtree = collectTrashSubtree(trash, id);
  if (!subtree) {
    throw new Error("回收站中没有该笔记");
  }
  for (const noteId of subtree) {
    const rec = trash.get(noteId)!;
    try {
      const loaded = yamlLoad(await fs.readFile(rec.sidecar, "utf8"));
      if (loaded && typeof loaded === "object" && Array.isArray((loaded as { attachments?: unknown[] }).attachments)) {
        for (const att of (loaded as { attachments: { id?: unknown; ext?: unknown }[] }).attachments) {
          if (att && isValidId(att.id)) {
            const ext = typeof att.ext === "string" ? att.ext : "";
            await fs.rm(path.join(TRASH_FILES_DIR, att.id.slice(0, 2), `${att.id}${ext ? `.${ext}` : ""}`), { force: true });
          }
        }
      }
    } catch {
      // 读不到就只删笔记文件
    }
    await fs.rm(rec.absolute, { force: true });
    await fs.rm(rec.sidecar, { force: true });
    await removeBackupFiles(path.dirname(rec.absolute), noteId);
    await fs.rmdir(path.dirname(rec.absolute)).catch(() => undefined);
  }
  invalidateTrashCache();
  await refresh();
  notifyDocsChanged();
  return subtree.size;
}

/** 清空回收站 */
export async function emptyTrash(): Promise<void> {
  invalidateTrashCache();
  await fs.rm(path.join(DOCS_ROOT, ".trash"), { recursive: true, force: true });
  invalidateTrashCache();
  await refresh();
  notifyDocsChanged();
}

// ---------------------------------------------------------------------------
// 一次性迁移：旧目录树 → 平铺存储
// ---------------------------------------------------------------------------

const LEGACY_SKIP_DIRS = new Set(["notes", "files"]);
const LEGACY_ORDER_PREFIX_RE = /^(\d+)[-.]\s*(.+)$/;

async function runLegacyMigration(): Promise<void> {
  try {
    await fs.access(MIGRATION_MARKER);
    return;
  } catch {
    // 未迁移，继续
  }

  const legacyFiles = await listLegacyFiles();
  if (legacyFiles.length === 0) {
    await writeMigrationMarker();
    return;
  }

  await fs.mkdir(path.join(process.cwd(), ".data"), { recursive: true });
  const backupRoot = path.join(DATA_DIR, "legacy-backup");

  // 1. 备份旧数据（docs 全量 + shares.json）
  for (const rel of legacyFiles) {
    const src = path.join(DOCS_ROOT, ...rel.split("/"));
    const dst = path.join(backupRoot, "docs", ...rel.split("/"));
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
  }
  try {
    await fs.copyFile(SHARES_PATH, path.join(backupRoot, "shares.json"));
  } catch {
    // 没有 shares.json 也正常
  }

  // 2. 按目录分组并按旧排序规则（NN- 前缀 > frontmatter order > 名称）排序
  const byDir = new Map<string, string[]>();
  for (const rel of legacyFiles) {
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const list = byDir.get(dir) ?? [];
    list.push(rel);
    byDir.set(dir, list);
  }

  const legacyMeta = new Map<string, { title?: string; order?: number }>();
  for (const rel of legacyFiles) {
    if (!/\.(mdx?)$/i.test(rel)) {
      continue;
    }
    try {
      const raw = await fs.readFile(path.join(DOCS_ROOT, ...rel.split("/")), "utf8");
      const { data } = matter(raw);
      legacyMeta.set(rel, {
        title: typeof data.title === "string" ? data.title : undefined,
        order: typeof data.order === "number" ? data.order : undefined,
      });
    } catch {
      // 忽略读取失败的文件
    }
  }

  const legacyTitle = (rel: string, isFolder: boolean): string => {
    const name = rel.split("/").pop()!;
    const fm = legacyMeta.get(rel)?.title;
    if (fm && fm.trim()) {
      return fm.trim();
    }
    let base = isFolder ? name : name.replace(/\.(mdx?|MDX?)$/, "");
    const prefixed = base.match(LEGACY_ORDER_PREFIX_RE);
    if (prefixed) {
      base = prefixed[2];
    }
    return base;
  };
  const legacyOrder = (rel: string, isFolder: boolean): number => {
    const fm = legacyMeta.get(rel)?.order;
    if (typeof fm === "number" && Number.isFinite(fm)) {
      return fm;
    }
    const name = rel.split("/").pop()!;
    const prefixed = name.match(LEGACY_ORDER_PREFIX_RE);
    if (prefixed) {
      return Number(prefixed[1]);
    }
    return isFolder ? 500 : 1000;
  };

  const noteMap = new Map<string, string>(); // 旧笔记路径 → 新笔记 id
  const assetMap = new Map<string, string>(); // 旧附件路径 → 新附件 id
  const containerOf = new Map<string, string>(); // 旧目录 → 容器笔记 id
  // 补全只包含子目录、自身没有文件的祖先目录，保证每个目录都会被处理
  const allDirs = new Set<string>(byDir.keys());
  for (const dir of byDir.keys()) {
    let parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
    while (parent && !allDirs.has(parent)) {
      allDirs.add(parent);
      parent = parent.includes("/") ? parent.slice(0, parent.lastIndexOf("/")) : "";
    }
  }
  const dirs = [...allDirs].sort((a, b) => a.split("/").length - b.split("/").length);

  const createMigratedNote = async (
    legacyRel: string,
    parentId: string | null,
    order: number
  ): Promise<string> => {
    const raw = await fs.readFile(path.join(DOCS_ROOT, ...legacyRel.split("/")), "utf8");
    const { data, content } = matter(raw);
    const format: NoteFormat = /\.mdx$/i.test(legacyRel) ? "mdx" : "md";
    const id = await generateId();
    const absolute = noteAbsolute(id, format);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const title = legacyTitle(legacyRel, false);
    // 旧 frontmatter 的非结构字段（date、tags 等）原样保留在正文里
    const extras = Object.fromEntries(
      Object.entries(data).filter(([key]) => !(STRUCTURAL_KEYS as readonly string[]).includes(key))
    );
    const body =
      Object.keys(extras).length > 0 ? matter.stringify(`${content.replace(/\s*$/, "\n")}`, extras) : `${content.replace(/^\s+/, "")}`;
    await fs.writeFile(absolute, body.endsWith("\n") ? body : `${body}\n`, "utf8");
    await fs.writeFile(
      noteSidecarAbsolute(id),
      serializeSidecar({ id, title, parent: parentId, order, attachments: [] }),
      "utf8"
    );
    noteMap.set(legacyRel, id);
    await rescan();
    return id;
  };

  const createSyntheticNote = async (title: string, parentId: string | null, order: number): Promise<string> => {
    const id = await generateId();
    const absolute = noteAbsolute(id, "md");
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, `# ${title}\n\n`, "utf8");
    await fs.writeFile(
      noteSidecarAbsolute(id),
      serializeSidecar({ id, title, parent: parentId, order, attachments: [] }),
      "utf8"
    );
    await rescan();
    return id;
  };

  /** 迁移专用附件写入：绕过 mutateNoteMeta/refresh（会等未完成的迁移自身而死锁） */
  const attachLegacyFile = async (ownerId: string, legacyRel: string): Promise<string> => {
    const fileName = legacyRel.split("/").pop()!;
    const buffer = await fs.readFile(path.join(DOCS_ROOT, ...legacyRel.split("/")));
    const rawExt = path.extname(fileName).toLowerCase();
    const ext = rawExt.replace(/[^a-z0-9.]/g, "").replace(/^\./, "");
    const displayName = sanitizeName(path.basename(fileName, rawExt) + rawExt) ?? `附件${rawExt}`;
    const id = await generateId();
    const absolute = attachmentAbsolute({ id, ext });
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, buffer);

    const owner = records.get(ownerId);
    if (!owner) {
      throw new Error("附件属主笔记不存在");
    }
    const meta: SidecarMeta = {
      id: owner.id,
      title: owner.title,
      parent: owner.parent,
      order: owner.order,
      attachments: [
        ...owner.attachments,
        { id, name: displayName, size: buffer.byteLength, mime: guessMimeType(displayName), ext },
      ],
    };
    await fs.writeFile(owner.sidecar, serializeSidecar(meta), "utf8");
    await rescan();
    return id;
  };

  const parentDirOf = (dirRel: string): string =>
    dirRel.includes("/") ? dirRel.slice(0, dirRel.lastIndexOf("/")) : "";

  // 3. 自顶向下：每个目录的「文件 + 子目录」按旧排序规则统一排序（子目录即未来的容器笔记），
  //    容器优先用目录里的 index.md(x)，没有则合成一篇空笔记；旧目录层级翻译为 parent 链
  for (const dirRel of dirs) {
    const container = dirRel === "" ? "" : containerOf.get(dirRel)!;
    const fileEntries = (byDir.get(dirRel) ?? [])
      .filter((file) => !/^index\.mdx?$/i.test(file.split("/").pop()!))
      .map((file) => ({ rel: file, folder: false }));
    const subdirEntries = [...allDirs]
      .filter((dir) => dir !== "" && parentDirOf(dir) === dirRel)
      .map((dir) => ({ rel: dir, folder: true }));

    const entries = [...fileEntries, ...subdirEntries].sort((a, b) => {
      const orderDiff = legacyOrder(a.rel, a.folder) - legacyOrder(b.rel, b.folder);
      if (orderDiff !== 0) {
        return orderDiff;
      }
      return legacyTitle(a.rel, a.folder).localeCompare(legacyTitle(b.rel, b.folder), "zh-Hans-CN");
    });

    let seq = 100;
    for (const entry of entries) {
      if (entry.folder) {
        // 子目录 → 容器笔记（index 迁移或合成），位置继承旧目录的排序
        const files = byDir.get(entry.rel) ?? [];
        const indexRel = files.find((file) => /^index\.mdx?$/i.test(file.split("/").pop()!));
        const containerId = indexRel
          ? await createMigratedNote(indexRel, container || null, seq)
          : await createSyntheticNote(legacyTitle(entry.rel, true), container || null, seq);
        containerOf.set(entry.rel, containerId);
      } else if (/\.(mdx?)$/i.test(entry.rel)) {
        await createMigratedNote(entry.rel, container || null, seq);
      } else {
        // 非笔记文件 → 附件，挂在容器（根目录没有容器时挂到第一篇根级笔记）
        let ownerId = container;
        if (!ownerId) {
          const rootNote = [...noteMap.entries()].find(([legacyRel]) => !legacyRel.includes("/"));
          ownerId = rootNote?.[1] ?? (await createSyntheticNote("已导入附件", null, seq));
        }
        const attId = await attachLegacyFile(ownerId, entry.rel);
        assetMap.set(entry.rel, attId);
      }
      seq += 100;
    }
  }

  // 4. 改写正文里的旧链接（/api/files/... 、 /notes/{旧路径} 、相对引用）
  const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i;
  const resolveLegacyRef = (dirRel: string, rawRef: string): { resolved: string; hash: string } | null => {
    let ref = rawRef;
    let hash = "";
    const hashIndex = ref.indexOf("#");
    if (hashIndex >= 0) {
      hash = ref.slice(hashIndex);
      ref = ref.slice(0, hashIndex);
    }
    const queryIndex = ref.indexOf("?");
    if (queryIndex >= 0) {
      ref = ref.slice(0, queryIndex);
    }
    if (!ref) {
      return null;
    }
    let decoded = ref;
    try {
      decoded = decodeURIComponent(ref);
    } catch {
      // 保留原样尝试
    }
    const joined = path.posix.normalize(path.posix.join(dirRel, decoded));
    if (joined.startsWith("..")) {
      return null; // 引用越出 docs，不解析
    }
    return { resolved: joined === "." ? "" : joined, hash };
  };

  for (const [legacyRel, id] of noteMap) {
    const rec = records.get(id);
    if (!rec) {
      continue;
    }
    const dirRel = legacyRel.includes("/") ? legacyRel.slice(0, legacyRel.lastIndexOf("/")) : "";
    const raw = await fs.readFile(rec.absolute, "utf8");
    const { data, content } = matter(raw);
    let next = content;

    next = next.replace(/\/api\/files\/([^\s)"'<>\]]+)/g, (match, captured: string) => {
      const target = resolveLegacyRef(dirRel, captured);
      const attId = target ? assetMap.get(target.resolved) : undefined;
      return attId ? `/api/attachments/${attId}` : match;
    });
    next = next.replace(/\/notes\/([^\s)"'<>\]]+)/g, (match, captured: string) => {
      const target = resolveLegacyRef(dirRel, captured);
      const noteId = target ? noteMap.get(target.resolved) : undefined;
      return noteId ? `/notes/${noteId}${target!.hash}` : match;
    });
    next = next.replace(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (match, ref: string) => {
      if (EXTERNAL_RE.test(ref)) {
        return match;
      }
      const target = resolveLegacyRef(dirRel, ref);
      if (!target) {
        return match;
      }
      if (/\.(mdx?)$/i.test(target.resolved)) {
        const noteId = noteMap.get(target.resolved);
        return noteId ? `](/notes/${noteId}${target.hash})` : match;
      }
      const attId = assetMap.get(target.resolved);
      return attId ? `](/api/attachments/${attId})` : match;
    });
    next = next.replace(/(src|href)=["']([^"']+)["']/g, (match, attr: string, ref: string) => {
      if (EXTERNAL_RE.test(ref)) {
        return match;
      }
      const target = resolveLegacyRef(dirRel, ref);
      if (!target) {
        return match;
      }
      if (/\.(mdx?)$/i.test(target.resolved)) {
        const noteId = noteMap.get(target.resolved);
        return noteId ? `${attr}="/notes/${noteId}${target.hash}"` : match;
      }
      const attId = assetMap.get(target.resolved);
      return attId ? `${attr}="/api/attachments/${attId}"` : match;
    });

    if (next !== content) {
      await fs.writeFile(rec.absolute, matter.stringify(next, data), "utf8");
    }
  }

  // 5. shares.json：notePath → noteId
  try {
    const rawShares = await fs.readFile(SHARES_PATH, "utf8");
    const parsedShares = JSON.parse(rawShares) as {
      shares?: { token: string; notePath: string; noteTitle: string; createdAt: string; expiresAt: string | null }[];
    };
    if (Array.isArray(parsedShares.shares)) {
      const migrated: { token: string; noteId: string; noteTitle: string; createdAt: string; expiresAt: string | null }[] = [];
      for (const share of parsedShares.shares) {
        const noteId = noteMap.get(share.notePath);
        if (noteId) {
          migrated.push({
            token: share.token,
            noteId,
            noteTitle: share.noteTitle,
            createdAt: share.createdAt,
            expiresAt: share.expiresAt ?? null,
          });
        }
      }
      await fs.writeFile(SHARES_PATH, JSON.stringify({ shares: migrated }, null, 2), "utf8");
    }
  } catch {
    // shares.json 不存在或损坏时跳过
  }

  // 6. 删除旧文件与空目录
  for (const rel of legacyFiles) {
    await fs.rm(path.join(DOCS_ROOT, ...rel.split("/")), { force: true });
  }
  for (const dirRel of [...dirs].sort((a, b) => b.split("/").length - a.split("/").length)) {
    if (!dirRel) {
      continue;
    }
    await fs.rmdir(path.join(DOCS_ROOT, ...dirRel.split("/"))).catch(() => undefined);
  }

  await rescan();
  await writeMigrationMarker();
}

async function listLegacyFiles(): Promise<string[]> {
  const out: string[] = [];
  const visit = async (rel: string): Promise<void> => {
    const absolute = rel ? path.join(DOCS_ROOT, ...rel.split("/")) : DOCS_ROOT;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (!rel && LEGACY_SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(childRel);
      } else {
        out.push(childRel);
      }
    }
  };
  await visit("");
  return out;
}

async function writeMigrationMarker(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(MIGRATION_MARKER, JSON.stringify({ migratedAt: new Date().toISOString() }, null, 2), "utf8");
}
