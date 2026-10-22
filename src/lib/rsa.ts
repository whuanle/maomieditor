/**
 * RSA 传输加密（服务端专用，node:crypto）：
 * - 密钥对 2048 位，持久化 .data/rsa.json（.data/ 已 gitignore，私钥不进 git）；
 *   已存在则复用、不重新生成——服务启动时由 instrumentation.ts 生成，
 *   首次 API 请求会懒加载兜底（单飞合流，防并发重复生成）
 * - 信封加密格式：明文用随机 AES-256-GCM 密钥加密（不限长度），
 *   AES 密钥再用 RSA-OAEP(SHA-256) 公钥加密；后端私钥先解出 AES 密钥再解内容。
 *   Web Crypto 的 GCM 输出 = 密文 + 末尾 16 字节 auth tag，解密时需拆出 setAuthTag
 * - API 敏感字段兼容两种取值：明文字符串（旧客户端直传）或信封对象
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  constants,
  createDecipheriv,
  createPrivateKey,
  generateKeyPairSync,
  privateDecrypt,
  type KeyObject,
} from "node:crypto";

const RSA_FILE = path.join(process.cwd(), ".data", "rsa.json");

interface StoredRsaKey {
  privateKeyPem: string;
  publicKeyPem: string;
  createdAt: string;
}

interface LoadedKeys {
  privateKey: KeyObject;
  publicKeyPem: string;
}

let cached: LoadedKeys | null = null;
let loadInFlight: Promise<LoadedKeys> | null = null;

async function readStored(): Promise<StoredRsaKey | null> {
  try {
    const data = JSON.parse(await fs.readFile(RSA_FILE, "utf-8")) as StoredRsaKey;
    if (typeof data.privateKeyPem === "string" && typeof data.publicKeyPem === "string") {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

async function generateAndStore(): Promise<StoredRsaKey> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const record: StoredRsaKey = {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(RSA_FILE), { recursive: true });
  await fs.writeFile(RSA_FILE, JSON.stringify(record, null, 2), "utf-8");
  return record;
}

async function loadKeys(): Promise<LoadedKeys> {
  if (cached) {
    return cached;
  }
  if (!loadInFlight) {
    loadInFlight = (async () => {
      const stored = await readStored();
      const record = stored ?? (await generateAndStore());
      const loaded: LoadedKeys = {
        privateKey: createPrivateKey(record.privateKeyPem),
        publicKeyPem: record.publicKeyPem,
      };
      cached = loaded;
      return loaded;
    })().finally(() => {
      loadInFlight = null;
    });
  }
  return loadInFlight;
}

/** 确保密钥对已生成（幂等；instrumentation.ts 启动时调用） */
export async function ensureRsaKeyPair(): Promise<void> {
  await loadKeys();
}

/** RSA 公钥（PEM / SPKI，可直接下发给前端 Web Crypto importKey） */
export async function getRsaPublicKeyPem(): Promise<string> {
  return (await loadKeys()).publicKeyPem;
}

/* ===== 信封解密 ===== */

export interface RsaEnvelope {
  __rsa: 1;
  /** base64：RSA-OAEP(SHA-256) 加密后的 AES-256 密钥 */
  k: string;
  /** base64：AES-256-GCM 12 字节 IV */
  i: string;
  /** base64：AES-GCM 密文（含末尾 16 字节 auth tag） */
  d: string;
}

export function isRsaEnvelope(value: unknown): value is RsaEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return v.__rsa === 1 && typeof v.k === "string" && typeof v.i === "string" && typeof v.d === "string";
}

/** 解密信封 → UTF-8 明文；任何一步失败返回 null（不抛错，调用方按请求非法处理） */
export async function decryptRsaEnvelope(envelope: RsaEnvelope): Promise<string | null> {
  try {
    const { privateKey } = await loadKeys();
    const aesKey = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      Buffer.from(envelope.k, "base64")
    );
    const data = Buffer.from(envelope.d, "base64");
    if (data.length < 16) {
      return null;
    }
    const decipher = createDecipheriv("aes-256-gcm", aesKey, Buffer.from(envelope.i, "base64"));
    decipher.setAuthTag(data.subarray(data.length - 16));
    const plaintext = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
    return plaintext.toString("utf-8");
  } catch {
    return null;
  }
}

/**
 * 解析请求体中的敏感字段：
 * - 字符串 → 原样返回（旧客户端明文，保持兼容）
 * - 信封对象 → RSA 解密
 * - 其它/解密失败 → null（调用方应按"字段缺失或解密失败"拒绝请求）
 */
export async function decryptSecretField(value: unknown): Promise<string | null> {
  if (typeof value === "string") {
    return value;
  }
  if (isRsaEnvelope(value)) {
    return decryptRsaEnvelope(value);
  }
  return null;
}
