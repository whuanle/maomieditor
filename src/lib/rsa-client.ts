/**
 * 前端密码字段 RSA 加密（任何环境都加密，只针对指定字段、请求体其余字段原样）：
 * - 安全上下文（HTTPS / localhost）：Web Crypto 信封——随机 AES-256-GCM 加密内容，
 *   AES 密钥再用服务端 RSA-OAEP(SHA-256) 公钥加密，整体 { __rsa: 1, k, i, d }；
 * - 非安全上下文（HTTP 内网直连）：浏览器不提供 crypto.subtle，改用纯 JS 的
 *   jsencrypt（RSA PKCS#1 v1.5）分块直接加密，整体 { __rsa: 2, d: [块 base64] }，
 *   服务端同样解出明文——两条路径对后端透明。
 * 公钥取自 GET /api/rsa/key（模块级缓存，整个页面生命周期内复用）。
 */

import { JSEncrypt } from "jsencrypt";

export interface RsaEnvelopeV1 {
  __rsa: 1;
  k: string;
  i: string;
  d: string;
}

export interface RsaEnvelopeV2 {
  __rsa: 2;
  /** 每块为 RSA(PKCS#1 v1.5) 密文的 base64；按序拼接即明文 UTF-8 */
  d: string[];
}

export type RsaEnvelope = RsaEnvelopeV1 | RsaEnvelopeV2;

/** PKCS#1 v1.5 单块明文上限 245 字节，取 128 留足余量（按 UTF-8 字节切块，不切断码点） */
const V2_CHUNK_BYTES = 128;

let cachedPem: string | null = null;
let pemPromise: Promise<string> | null = null;
let cachedCryptoKey: CryptoKey | null = null;
let cryptoKeyPromise: Promise<CryptoKey> | null = null;
let cachedJsEncrypt: JSEncrypt | null = null;

function webCryptoAvailable(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

async function fetchPublicKeyPem(): Promise<string> {
  if (cachedPem) {
    return cachedPem;
  }
  if (!pemPromise) {
    pemPromise = (async () => {
      const response = await fetch("/api/rsa/key", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("获取 RSA 公钥失败");
      }
      const { publicKey } = (await response.json()) as { publicKey?: string };
      if (typeof publicKey !== "string" || !publicKey.includes("PUBLIC KEY")) {
        throw new Error("RSA 公钥格式错误");
      }
      cachedPem = publicKey;
      return publicKey;
    })().catch((error: unknown) => {
      pemPromise = null; // 失败后允许下次重试
      throw error;
    });
  }
  return pemPromise;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function fetchCryptoKey(): Promise<CryptoKey> {
  if (cachedCryptoKey) {
    return cachedCryptoKey;
  }
  if (!cryptoKeyPromise) {
    cryptoKeyPromise = (async () => {
      const pem = await fetchPublicKeyPem();
      cachedCryptoKey = await crypto.subtle.importKey(
        "spki",
        pemToArrayBuffer(pem),
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["encrypt"]
      );
      return cachedCryptoKey;
    })().catch((error: unknown) => {
      cryptoKeyPromise = null;
      throw error;
    });
  }
  return cryptoKeyPromise;
}

async function fetchJsEncrypt(): Promise<JSEncrypt> {
  if (cachedJsEncrypt) {
    return cachedJsEncrypt;
  }
  const pem = await fetchPublicKeyPem();
  const encryptor = new JSEncrypt();
  encryptor.setPublicKey(pem);
  cachedJsEncrypt = encryptor;
  return encryptor;
}

/* ===== 路径一：Web Crypto 信封（安全上下文） ===== */

async function rsaEncryptV1(plaintext: string): Promise<RsaEnvelopeV1> {
  const publicKey = await fetchCryptoKey();
  const aesRaw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey("raw", aesRaw, "AES-GCM", false, ["encrypt"]);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, new TextEncoder().encode(plaintext));
  const encryptedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, aesRaw);
  return {
    __rsa: 1,
    k: btoa(String.fromCharCode(...new Uint8Array(encryptedKey))),
    i: btoa(String.fromCharCode(...iv)),
    d: btoa(String.fromCharCode(...new Uint8Array(data))),
  };
}

/* ===== 路径二：jsencrypt 纯 JS RSA（非安全上下文） ===== */

function chunkUtf8(text: string, maxBytes: number): string[] {
  const bytes = new TextEncoder().encode(text);
  const chunks: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + maxBytes, bytes.length);
    if (end < bytes.length) {
      while (end > start && (bytes[end] & 0xc0) === 0x80) {
        end -= 1; // 回退到 UTF-8 码点边界，避免切开多字节字符
      }
    }
    chunks.push(new TextDecoder().decode(bytes.subarray(start, end)));
    start = end;
  }
  return chunks;
}

async function rsaEncryptV2(plaintext: string): Promise<RsaEnvelopeV2> {
  const encryptor = await fetchJsEncrypt();
  const parts: string[] = [];
  for (const chunk of chunkUtf8(plaintext, V2_CHUNK_BYTES)) {
    const encrypted = encryptor.encrypt(chunk);
    if (!encrypted) {
      throw new Error("RSA 加密失败");
    }
    parts.push(encrypted);
  }
  return { __rsa: 2, d: parts };
}

/** 加密任意文本为信封对象（可直接放进 JSON 请求体），按环境自动选择实现 */
export async function rsaEncrypt(plaintext: string): Promise<RsaEnvelope> {
  if (webCryptoAvailable()) {
    return rsaEncryptV1(plaintext);
  }
  return rsaEncryptV2(plaintext);
}

/**
 * 便捷方法：把 body 中指定的密码/密钥字段就地替换为信封（其余字段原样保留，
 * 不做整体请求体加密）。空值字段不动，由后端继续做必填校验。
 */
export async function encryptFields<T extends Record<string, unknown>>(
  body: T,
  fields: (keyof T & string)[]
): Promise<T> {
  const result = { ...body };
  for (const field of fields) {
    const value = result[field];
    if (typeof value === "string" && value) {
      (result as Record<string, unknown>)[field] = await rsaEncrypt(value);
    }
  }
  return result;
}
