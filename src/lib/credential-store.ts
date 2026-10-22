/**
 * 登录密码存储（服务端专用，node:crypto）：
 * 密码哈希存放于 .data/auth.json（scrypt），首次以 .env.local 的 AUTH_PASSWORD 登录时自动迁移落盘，
 * 之后可在设置 → 密码中在线修改。用户名仍取自环境变量（AUTH_USERNAME）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getAuthCredentials } from "./auth";

const AUTH_FILE = path.join(process.cwd(), ".data", "auth.json");

const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72;

interface StoredCredential {
  /** scrypt 哈希（hex） */
  hash: string;
  /** 盐（hex） */
  salt: string;
}

function hashPassword(password: string, saltHex: string): string {
  return scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
}

function equalsHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

async function readStored(): Promise<StoredCredential | null> {
  try {
    const data = JSON.parse(await fs.readFile(AUTH_FILE, "utf-8")) as StoredCredential;
    if (typeof data.hash === "string" && typeof data.salt === "string") {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

async function writeStored(credential: StoredCredential): Promise<void> {
  await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });
  await fs.writeFile(AUTH_FILE, JSON.stringify(credential, null, 2), "utf-8");
}

/** 校验登录密码：优先比对 .data/auth.json 的哈希；无落盘记录时比对 env 并顺手迁移 */
export async function verifyLoginPassword(password: string): Promise<boolean> {
  const stored = await readStored();
  if (stored) {
    return equalsHex(hashPassword(password, stored.salt), stored.hash);
  }

  const envPassword = getAuthCredentials().password;
  if (!envPassword || password !== envPassword) {
    return false;
  }

  // 首次成功登录：把 env 密码迁移为哈希落盘（失败不阻塞登录）
  try {
    const salt = randomBytes(16).toString("hex");
    await writeStored({ hash: hashPassword(envPassword, salt), salt });
  } catch {
    // 迁移失败下次再试
  }
  return true;
}

export interface PasswordChangeResult {
  ok: boolean;
  error?: string;
}

/** 运维重置密码：跳过当前密码校验，直接落盘新哈希（供 scripts/reset-auth.ts 在忘记密码时使用） */
export async function resetLoginPassword(newPassword: string): Promise<PasswordChangeResult> {
  if (newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
    return { ok: false, error: `密码长度需在 ${PASSWORD_MIN}-${PASSWORD_MAX} 个字符之间` };
  }
  const salt = randomBytes(16).toString("hex");
  await writeStored({ hash: hashPassword(newPassword, salt), salt });
  return { ok: true };
}

/** 修改登录密码：校验当前密码正确、新密码合法后落盘新哈希 */
export async function changeLoginPassword(currentPassword: string, newPassword: string): Promise<PasswordChangeResult> {
  if (!(await verifyLoginPassword(currentPassword))) {
    return { ok: false, error: "当前密码不正确" };
  }
  if (newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
    return { ok: false, error: `新密码长度需在 ${PASSWORD_MIN}-${PASSWORD_MAX} 个字符之间` };
  }
  if (newPassword === currentPassword) {
    return { ok: false, error: "新密码不能与当前密码相同" };
  }
  const salt = randomBytes(16).toString("hex");
  await writeStored({ hash: hashPassword(newPassword, salt), salt });
  return { ok: true };
}
