/**
 * 前端 RSA 信封加密（纯 Web Crypto，无 node 依赖，可安全进 client bundle）：
 * 明文用随机 AES-256-GCM 密钥加密（不限长度），AES 密钥再用服务端 RSA-OAEP(SHA-256)
 * 公钥加密，整体作为 { __rsa: 1, k, i, d } 信封随请求体提交，服务端私钥解密。
 * 公钥取自 GET /api/rsa/key（模块级缓存，整个页面生命周期内复用）。
 *
 * Web Crypto 仅在安全上下文（HTTPS / localhost）暴露：HTTP 内网直连时
 * crypto.subtle 不存在，encryptFields 会跳过信封让字段明文直传
 * （服务端兼容明文字段；明文 HTTP 上信封也起不到保护作用）。
 */

export interface RsaEnvelope {
  __rsa: 1;
  k: string;
  i: string;
  d: string;
}

let cachedKey: CryptoKey | null = null;
let keyPromise: Promise<CryptoKey> | null = null;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
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

async function fetchPublicKey(): Promise<CryptoKey> {
  if (cachedKey) {
    return cachedKey;
  }
  if (!keyPromise) {
    keyPromise = (async () => {
      const response = await fetch("/api/rsa/key", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("获取 RSA 公钥失败");
      }
      const { publicKey } = (await response.json()) as { publicKey?: string };
      if (typeof publicKey !== "string" || !publicKey.includes("PUBLIC KEY")) {
        throw new Error("RSA 公钥格式错误");
      }
      cachedKey = await crypto.subtle.importKey(
        "spki",
        pemToArrayBuffer(publicKey),
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["encrypt"]
      );
      return cachedKey;
    })().catch((error: unknown) => {
      keyPromise = null; // 失败后允许下次重试
      throw error;
    });
  }
  return keyPromise;
}

/** 加密任意文本为信封对象（可直接放进 JSON 请求体） */
export async function rsaEncrypt(plaintext: string): Promise<RsaEnvelope> {
  const publicKey = await fetchPublicKey();
  const aesRaw = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey("raw", aesRaw, "AES-GCM", false, ["encrypt"]);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, new TextEncoder().encode(plaintext));
  const encryptedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, aesRaw);
  return {
    __rsa: 1,
    k: toBase64(new Uint8Array(encryptedKey)),
    i: toBase64(iv),
    d: toBase64(new Uint8Array(data)),
  };
}

function webCryptoAvailable(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}

/**
 * 便捷方法：把 body 中指定的字符串字段就地替换为信封（其余字段原样保留）。
 * 非安全上下文（无 Web Crypto）时原样返回，由后端按明文兼容处理。
 * 空值字段不动，由后端继续做必填校验。
 */
export async function encryptFields<T extends Record<string, unknown>>(
  body: T,
  fields: (keyof T & string)[]
): Promise<T> {
  const result = { ...body };
  if (!webCryptoAvailable()) {
    return result;
  }
  for (const field of fields) {
    const value = result[field];
    if (typeof value === "string" && value) {
      (result as Record<string, unknown>)[field] = await rsaEncrypt(value);
    }
  }
  return result;
}
