/**
 * TOTP 时间型一次性验证码（RFC 6238，node:crypto 实现）：
 * HMAC-SHA1 / 6 位 / 30 秒周期，校验允许 ±1 个时间窗（±30s 时钟偏差）。
 * 仅服务端使用；secret 为 Base32（RFC 4648，无 padding）。
 */
import { createHmac, randomBytes } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** 校验容忍的时间窗偏移（±1 步 ≈ ±30 秒） */
const VERIFICATION_WINDOW = 1;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("非法的 Base32 字符");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 生成 160 位随机 secret（Base32，32 字符），足够主流验证器使用 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** 当前时间步（counter） */
export function totpStep(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** otpauth:// URL，供验证器 App 扫码或手动录入 */
export function buildOtpauthUrl(params: { issuer: string; account: string; secret: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.account}`);
  const query = new URLSearchParams({
    issuer: params.issuer,
    secret: params.secret,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

function hotp(secret: Buffer, counter: number): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(counterBytes).digest();
  // RFC 4226 动态截断
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(code % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

function normalizeCode(code: string): string | null {
  const cleaned = code.replace(/\s/g, "");
  return /^\d{6}$/.test(cleaned) ? cleaned : null;
}

/**
 * 校验验证码，返回匹配的时间步（含 ±1 窗口），未匹配返回 null。
 * 返回步数便于调用方做防重放（同一步的码只用一次）。
 */
export function matchTotpStep(secretBase32: string, code: string, atMs: number = Date.now()): number | null {
  const normalized = normalizeCode(code);
  if (!normalized) {
    return null;
  }
  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return null;
  }
  const step = totpStep(atMs);
  for (let offset = -VERIFICATION_WINDOW; offset <= VERIFICATION_WINDOW; offset += 1) {
    const candidate = step + offset;
    if (candidate < 0) {
      continue;
    }
    if (hotp(secret, candidate) === normalized) {
      return candidate;
    }
  }
  return null;
}
