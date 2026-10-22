/**
 * TOTP 两步验证存储（服务端专用）：
 * 配置存放于 .data/mfa.json——开启后登录需在密码之外输入 6 位动态验证码。
 * - secret：Base32 密钥（开启后用于每次登录校验；pendingSecret 为绑定流程中的待确认密钥）
 * - lastUsedStep：最近一次通过校验的时间步，防止同一个验证码在有效窗口内被重复使用
 * 忘记验证码且无法登录时，运行 bun scripts/reset-auth.ts 重置（等价于清空 .data/mfa.json，回到仅密码登录）。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { buildOtpauthUrl, generateTotpSecret, matchTotpStep } from "./totp";
import { createSignedToken, getAuthCredentials, verifySignedToken } from "./auth";

const MFA_FILE = path.join(process.cwd(), ".data", "mfa.json");

const APP_ISSUER = "猫咪笔记";

interface MfaConfig {
  /** 是否已开启两步验证 */
  enabled?: boolean;
  /** 已生效的 TOTP 密钥（Base32） */
  secret?: string;
  /** 绑定流程中的待确认密钥（Base32），确认通过后转正 */
  pendingSecret?: string;
  /** 最近一次登录校验通过的时间步（防重放） */
  lastUsedStep?: number;
}

async function readConfig(): Promise<MfaConfig> {
  try {
    const data = JSON.parse(await fs.readFile(MFA_FILE, "utf-8")) as MfaConfig;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

async function writeConfig(config: MfaConfig): Promise<void> {
  await fs.mkdir(path.dirname(MFA_FILE), { recursive: true });
  await fs.writeFile(MFA_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export async function isMfaEnabled(): Promise<boolean> {
  const config = await readConfig();
  return Boolean(config.enabled && config.secret);
}

/** 开始绑定：生成新的待确认密钥，返回给前端渲染二维码 / 手动录入 */
export async function beginMfaSetup(): Promise<{ secret: string; otpauthUrl: string }> {
  const secret = generateTotpSecret();
  const config = await readConfig();
  await writeConfig({ ...config, pendingSecret: secret });
  const otpauthUrl = buildOtpauthUrl({
    issuer: APP_ISSUER,
    account: getAuthCredentials().username,
    secret,
  });
  return { secret, otpauthUrl };
}

/** 放弃当前未完成的绑定流程 */
export async function cancelMfaSetup(): Promise<void> {
  const config = await readConfig();
  if (config.pendingSecret === undefined) {
    return;
  }
  delete config.pendingSecret;
  await writeConfig(config);
}

export interface MfaResult {
  ok: boolean;
  error?: string;
}

/** 确认绑定：用待确认密钥校验用户输入的验证码，通过后正式开启 */
export async function confirmMfaSetup(code: string): Promise<MfaResult> {
  const config = await readConfig();
  if (!config.pendingSecret) {
    return { ok: false, error: "请先生成二维码并完成扫码" };
  }
  if (matchTotpStep(config.pendingSecret, code) === null) {
    return { ok: false, error: "验证码错误，请确认时间同步后重试" };
  }
  await writeConfig({
    enabled: true,
    secret: config.pendingSecret,
    lastUsedStep: undefined,
  });
  return { ok: true };
}

/** 登录校验：验证码正确且未被使用过；通过后记录时间步防重放 */
export async function verifyMfaLoginCode(code: string): Promise<boolean> {
  const config = await readConfig();
  if (!config.enabled || !config.secret) {
    return false;
  }
  const matchedStep = matchTotpStep(config.secret, code);
  if (matchedStep === null) {
    return false;
  }
  if (config.lastUsedStep !== undefined && matchedStep <= config.lastUsedStep) {
    return false;
  }
  await writeConfig({ ...config, lastUsedStep: matchedStep });
  return true;
}

/** 关闭两步验证：需提供当前有效的验证码 */
export async function disableMfa(code: string): Promise<MfaResult> {
  if (!(await isMfaEnabled())) {
    return { ok: false, error: "两步验证尚未开启" };
  }
  if (!(await verifyMfaLoginCode(code))) {
    return { ok: false, error: "验证码错误" };
  }
  await writeConfig({});
  return { ok: true };
}

/** 运维重置：不校验验证码直接关闭两步验证（供 scripts/reset-auth.ts 在丢失验证器时使用） */
export async function forceDisableMfa(): Promise<void> {
  await writeConfig({});
}

/* ===== 登录挑战令牌 ===== */

/** 密码通过但等待验证码期间的临时令牌有效期（秒） */
export const MFA_CHALLENGE_SECONDS = 5 * 60;

/** 签发登录挑战令牌：密码校验通过后发给前端，换取验证码校验，5 分钟内有效 */
export async function createMfaChallengeToken(username: string): Promise<string> {
  return createSignedToken({
    purpose: "mfa-login",
    sub: username,
    exp: Math.floor(Date.now() / 1000) + MFA_CHALLENGE_SECONDS,
  });
}

/** 校验登录挑战令牌，返回用户名；无效/过期返回 null */
export async function verifyMfaChallengeToken(token: string | undefined): Promise<string | null> {
  const payload = await verifySignedToken<{ purpose: string; sub: string }>(token, (value) => {
    if (value.purpose !== "mfa-login" || typeof value.sub !== "string") {
      return null;
    }
    return { purpose: value.purpose, sub: value.sub };
  });
  return payload?.sub ?? null;
}
