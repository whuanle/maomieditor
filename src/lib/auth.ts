/**
 * 会话鉴权：HMAC-SHA256 签名的 Cookie（Web Crypto 实现，
 * 同时兼容 Node 运行时的 proxy 与 Route Handler）。
 *
 * Cookie 格式：base64url(payload).base64url(hmac)
 * payload: { sub: string; exp: number }
 */

export const SESSION_COOKIE = "note_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 天

interface SessionPayload {
  sub: string;
  exp: number;
}

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("AUTH_SECRET 未配置或过短，请在 .env.local 中设置（至少 16 字符）");
  }
  return secret;
}

export function getAuthCredentials(): { username: string; password: string } {
  return {
    username: process.env.AUTH_USERNAME || "admin",
    password: process.env.AUTH_PASSWORD || "",
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getAuthSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return toBase64Url(new Uint8Array(signature));
}

export async function createSessionToken(username: string): Promise<string> {
  return createSignedToken({
    sub: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  });
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  return verifySignedToken<SessionPayload>(token, (value) => {
    if (typeof value.sub !== "string" || typeof value.exp !== "number") {
      return null;
    }
    return { sub: value.sub, exp: value.exp };
  });
}

/** 通用签名令牌：base64url(payload).base64url(hmac)，payload 必须含 exp（秒级过期时间） */
export async function createSignedToken(payload: Record<string, unknown> & { exp: number }): Promise<string> {
  const payloadText = JSON.stringify(payload);
  const encodedPayload = toBase64Url(new TextEncoder().encode(payloadText));
  const signature = await sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

/** 验证签名令牌：签名比对 + exp 未过期，再交给调用方的 validate 做字段校验 */
export async function verifySignedToken<T>(
  token: string | undefined,
  validate: (value: Record<string, unknown>) => T | null
): Promise<T | null> {
  if (!token) {
    return null;
  }

  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0 || dotIndex === token.length - 1) {
    return null;
  }

  const encodedPayload = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  let expectedSignature: string;
  try {
    expectedSignature = await sign(encodedPayload);
  } catch {
    return null;
  }

  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const raw = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload))) as Record<string, unknown>;
    const payload = validate(raw);
    if (!payload) {
      return null;
    }
    if (typeof raw.exp !== "number" || raw.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};
