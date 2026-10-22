/**
 * 受保护文档（服务端专用，node:crypto）：
 * - 未单独设置保护密码时默认使用登录密码；单独设置后存放于 .data/protection.json（scrypt 哈希）
 * - 受保护会话时间（timeoutMinutes）：解锁一次后多久内不再询问；0 = 每次打开都要求输入
 * - 会话令牌复用 auth.ts 的 HMAC 签名（cookie "note_protection_session"，payload { scope, exp }）
 * 后续笔记级"保护"功能直接消费 verifyProtectionPassword / 受保护会话即可。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createSignedToken, verifySignedToken } from "./auth";
import { verifyLoginPassword } from "./credential-store";
import { DEFAULT_PROTECTION_TIMEOUT_MINUTES, PROTECTION_COOKIE, PROTECTION_TIMEOUT_CHOICES } from "./protection-shared";

const PROTECTION_FILE = path.join(process.cwd(), ".data", "protection.json");

export { DEFAULT_PROTECTION_TIMEOUT_MINUTES, PROTECTION_COOKIE, PROTECTION_TIMEOUT_CHOICES };

const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72;

interface ProtectionConfig {
  /** scrypt 哈希（hex），未设置保护密码时缺省 */
  hash?: string;
  salt?: string;
  /** 受保护会话时间（分钟），0 = 每次打开都询问 */
  timeoutMinutes?: number;
}

async function readConfig(): Promise<ProtectionConfig> {
  try {
    const data = JSON.parse(await fs.readFile(PROTECTION_FILE, "utf-8")) as ProtectionConfig;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

async function writeConfig(config: ProtectionConfig): Promise<void> {
  await fs.mkdir(path.dirname(PROTECTION_FILE), { recursive: true });
  await fs.writeFile(PROTECTION_FILE, JSON.stringify(config, null, 2), "utf-8");
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

/** 是否已单独设置保护密码（未设置时默认使用登录密码） */
export async function hasProtectionPassword(): Promise<boolean> {
  const config = await readConfig();
  return Boolean(config.hash && config.salt);
}

/** 校验保护密码：已单独设置则比对独立哈希，否则回退为登录密码 */
export async function verifyProtectionPassword(password: string): Promise<boolean> {
  const config = await readConfig();
  if (config.hash && config.salt) {
    return equalsHex(hashPassword(password, config.salt), config.hash);
  }
  return verifyLoginPassword(password);
}

export interface ProtectionResult {
  ok: boolean;
  error?: string;
}

function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `密码长度需在 ${PASSWORD_MIN}-${PASSWORD_MAX} 个字符之间`;
  }
  return null;
}

/** 首次设置保护密码 */
export async function setProtectionPassword(newPassword: string): Promise<ProtectionResult> {
  if (await hasProtectionPassword()) {
    return { ok: false, error: "保护密码已设置，请使用「修改密码」" };
  }
  const invalid = validatePassword(newPassword);
  if (invalid) {
    return { ok: false, error: invalid };
  }
  const salt = randomBytes(16).toString("hex");
  const config = await readConfig();
  await writeConfig({ ...config, hash: hashPassword(newPassword, salt), salt });
  return { ok: true };
}

/** 修改保护密码（需提供旧密码；未单独设置时旧密码即登录密码） */
export async function changeProtectionPassword(oldPassword: string, newPassword: string): Promise<ProtectionResult> {
  if (!(await verifyProtectionPassword(oldPassword))) {
    return { ok: false, error: "当前保护密码不正确" };
  }
  const invalid = validatePassword(newPassword);
  if (invalid) {
    return { ok: false, error: invalid };
  }
  if (newPassword === oldPassword) {
    return { ok: false, error: "新密码不能与当前密码相同" };
  }
  const salt = randomBytes(16).toString("hex");
  const config = await readConfig();
  await writeConfig({ ...config, hash: hashPassword(newPassword, salt), salt });
  return { ok: true };
}

/** 清除保护密码（需提供旧密码；会话时间设置保留） */
export async function clearProtectionPassword(oldPassword: string): Promise<ProtectionResult> {
  if (!(await hasProtectionPassword())) {
    return { ok: false, error: "尚未设置保护密码" };
  }
  if (!(await verifyProtectionPassword(oldPassword))) {
    return { ok: false, error: "当前保护密码不正确" };
  }
  const config = await readConfig();
  delete config.hash;
  delete config.salt;
  await writeConfig(config);
  return { ok: true };
}

export async function getProtectionTimeoutMinutes(): Promise<number> {
  const config = await readConfig();
  if (typeof config.timeoutMinutes !== "number" || !PROTECTION_TIMEOUT_CHOICES.some((c) => c.minutes === config.timeoutMinutes)) {
    return DEFAULT_PROTECTION_TIMEOUT_MINUTES;
  }
  return config.timeoutMinutes;
}

export async function setProtectionTimeoutMinutes(minutes: number): Promise<ProtectionResult> {
  if (!PROTECTION_TIMEOUT_CHOICES.some((c) => c.minutes === minutes)) {
    return { ok: false, error: "无效的会话时间选项" };
  }
  const config = await readConfig();
  await writeConfig({ ...config, timeoutMinutes: minutes });
  return { ok: true };
}

/* ===== 受保护会话令牌 ===== */

interface ProtectedSessionPayload {
  scope: "protection";
  exp: number;
}

export interface ProtectedSession {
  /** 过期时间（秒级 Unix 时间戳） */
  exp: number;
}

/** 签发受保护会话令牌；timeoutMinutes 为 0 表示每次都要询问，返回 null（不建立会话） */
export async function createProtectedSessionToken(timeoutMinutes: number): Promise<{ token: string; exp: number } | null> {
  if (timeoutMinutes <= 0) {
    return null;
  }
  const exp = Math.floor(Date.now() / 1000) + timeoutMinutes * 60;
  const token = await createSignedToken({ scope: "protection", exp });
  return { token, exp };
}

/**
 * 「每次打开时询问」（timeout=0）模式的临时通行令牌：只活 TRANSIENT_SESSION_SECONDS，
 * 供解锁后的一次页面渲染使用；客户端渲染完成后立即删除 cookie，再次打开仍需输入密码。
 */
export const TRANSIENT_SESSION_SECONDS = 60;

export async function createTransientProtectedSessionToken(): Promise<{ token: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + TRANSIENT_SESSION_SECONDS;
  const token = await createSignedToken({ scope: "protection", exp });
  return { token, exp };
}

export async function verifyProtectedSessionToken(token: string | undefined): Promise<ProtectedSession | null> {
  const payload = await verifySignedToken<ProtectedSessionPayload>(token, (value) => {
    if (value.scope !== "protection" || typeof value.exp !== "number") {
      return null;
    }
    return { scope: value.scope, exp: value.exp };
  });
  return payload ? { exp: payload.exp } : null;
}
