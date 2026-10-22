import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { collectSubtreeNoteIds, getNote } from "./store";

/**
 * 分享链接存储于 .data/shares.json（docs 之外，避免污染笔记目录）。
 * 一条分享 = 一个 token 指向一篇笔记（按笔记 ID，移动/改名不影响分享）。
 */

export interface ShareEntry {
  token: string;
  /** 被分享的笔记 ID */
  noteId: string;
  noteTitle: string;
  createdAt: string;
  expiresAt: string | null;
}

interface ShareStore {
  shares: ShareEntry[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(DATA_DIR, "shares.json");

async function readStore(): Promise<ShareStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as ShareStore;
    return Array.isArray(parsed.shares) ? parsed : { shares: [] };
  } catch {
    return { shares: [] };
  }
}

async function writeStore(store: ShareStore): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export async function listShares(): Promise<ShareEntry[]> {
  const store = await readStore();
  return store.shares.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findShareByNote(noteId: string): Promise<ShareEntry | null> {
  const store = await readStore();
  return store.shares.find((share) => share.noteId === noteId) ?? null;
}

export async function findShareByToken(token: string): Promise<ShareEntry | null> {
  const store = await readStore();
  const entry = store.shares.find((share) => share.token === token) ?? null;
  if (!entry) {
    return null;
  }
  if (entry.expiresAt && new Date(entry.expiresAt).getTime() < Date.now()) {
    return null;
  }
  // 惰性校验：笔记被删除后分享自动失效
  if (!(await getNote(entry.noteId))) {
    return null;
  }
  return entry;
}

export async function createShare(noteId: string, noteTitle: string): Promise<ShareEntry> {
  const existing = await findShareByNote(noteId);
  if (existing) {
    return existing;
  }

  const entry: ShareEntry = {
    token: randomBytes(9).toString("base64url"),
    noteId,
    noteTitle,
    createdAt: new Date().toISOString(),
    expiresAt: null,
  };

  const store = await readStore();
  store.shares.push(entry);
  await writeStore(store);
  return entry;
}

export async function revokeShare(token: string): Promise<boolean> {
  const store = await readStore();
  const index = store.shares.findIndex((share) => share.token === token);
  if (index < 0) {
    return false;
  }
  store.shares.splice(index, 1);
  await writeStore(store);
  return true;
}

/** 分享允许访问的附件范围：附件属主笔记在分享笔记的子树内 */
export async function isAttachmentAllowedForShare(entry: ShareEntry, ownerNoteId: string): Promise<boolean> {
  const subtree = await collectSubtreeNoteIds(entry.noteId);
  return subtree !== null && subtree.has(ownerNoteId);
}
