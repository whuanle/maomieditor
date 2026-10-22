/**
 * 运维重置登录凭证：忘记密码、丢失两步验证器（手机）时在服务器上直接重置。
 *
 * 用法（在项目根目录运行，其他目录也可，脚本会自动定位项目根）：
 *   bun scripts/reset-auth.ts                        # 交互式菜单
 *   bun scripts/reset-auth.ts --status               # 只查看当前状态，不做修改
 *   bun scripts/reset-auth.ts --password "新密码"    # 重置登录密码
 *   bun scripts/reset-auth.ts --generate-password    # 重置为随机密码（只在屏幕显示一次）
 *   bun scripts/reset-auth.ts --disable-mfa          # 关闭两步验证
 *   选项可组合，如：bun scripts/reset-auth.ts --generate-password --disable-mfa --yes
 *   （--yes 跳过确认；非交互终端必须加 --yes）
 *
 * 说明：密码哈希（.data/auth.json）与两步验证配置（.data/mfa.json）都是登录时实时
 * 读取的，重置立即生效、无需重启服务；被覆盖的文件会先备份为 *.bak-<时间戳>。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

// credential-store / mfa-store 在模块加载时按 process.cwd() 定位 .data 目录，先切到项目根再加载
const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
if (process.cwd() !== PROJECT_ROOT) {
  process.chdir(PROJECT_ROOT);
}
const { resetLoginPassword } = await import("../src/lib/credential-store");
const { forceDisableMfa } = await import("../src/lib/mfa-store");

const DATA_DIR = path.join(PROJECT_ROOT, ".data");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const MFA_FILE = path.join(DATA_DIR, "mfa.json");
const PROTECTION_FILE = path.join(DATA_DIR, "protection.json");

/** 从 .env.local 读 AUTH_USERNAME（仅用于展示；登录校验以服务端实际读取为准） */
function resolveUsername(): string {
  if (process.env.AUTH_USERNAME) {
    return process.env.AUTH_USERNAME;
  }
  try {
    const envText = fs.readFileSync(path.join(PROJECT_ROOT, ".env.local"), "utf-8");
    const line = envText
      .split(/\r?\n/)
      .find((text) => text.trimStart().startsWith("AUTH_USERNAME"));
    if (line) {
      const value = line.slice(line.indexOf("=") + 1).trim().replace(/^"|"$/g, "");
      if (value) {
        return value;
      }
    }
  } catch {
    // 无 .env.local 时落到默认值
  }
  return "admin";
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/** 修改前备份：file -> file.bak-<时间戳>（文件不存在则跳过） */
function backupIfExists(file: string): string | null {
  if (!fs.existsSync(file)) {
    return null;
  }
  const target = `${file}.bak-${timestamp()}`;
  fs.copyFileSync(file, target);
  return target;
}

// 去掉 0O1lI 等易混淆字符
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function generatePassword(length = 14): string {
  let out = "";
  for (const byte of randomBytes(length)) {
    out += PASSWORD_ALPHABET.charAt(byte % PASSWORD_ALPHABET.length);
  }
  return out;
}

function printStatus(): void {
  const auth = readJson(AUTH_FILE);
  const mfa = readJson(MFA_FILE);
  const protection = readJson(PROTECTION_FILE);
  console.log("当前登录凭证状态：");
  console.log(`  登录用户名：${resolveUsername()}（取自 AUTH_USERNAME）`);
  console.log(
    auth?.hash
      ? "  登录密码：哈希已落盘（.data/auth.json）"
      : "  登录密码：未落盘，使用 .env.local 的 AUTH_PASSWORD 原始密码"
  );
  console.log(
    mfa?.enabled && mfa?.secret
      ? "  两步验证：已开启（登录需 6 位动态验证码）"
      : "  两步验证：未开启"
  );
  console.log(
    protection?.hash
      ? "  笔记保护密码：已单独设置（不受本次重置影响）"
      : "  笔记保护密码：未单独设置（与登录密码相同，重置后跟随新密码）"
  );
}

interface ResetActions {
  password?: string;
  disableMfa?: boolean;
}

async function applyReset(actions: ResetActions): Promise<void> {
  const backups: string[] = [];

  if (actions.password !== undefined) {
    const backup = backupIfExists(AUTH_FILE);
    if (backup) {
      backups.push(backup);
    }
    const result = await resetLoginPassword(actions.password);
    if (!result.ok) {
      console.error(`✘ 密码重置失败：${result.error}`);
      process.exit(1);
    }
  }

  if (actions.disableMfa) {
    const backup = backupIfExists(MFA_FILE);
    if (backup) {
      backups.push(backup);
    }
    await forceDisableMfa();
  }

  console.log("✔ 重置完成，立即生效（无需重启服务）");
  if (actions.password !== undefined) {
    console.log(`  登录用户名：${resolveUsername()}`);
    console.log(`  新登录密码：${actions.password}`);
  }
  if (actions.disableMfa) {
    console.log("  两步验证：已关闭，可先用密码登录，之后在 设置 → MFA 认证 重新绑定");
  }
  for (const backup of backups) {
    console.log(`  已备份原文件：${path.relative(PROJECT_ROOT, backup)}`);
  }
  console.log("  提示：已登录的会话不受影响，最长仍可用 30 天；如需强制全部下线，");
  console.log("        修改 .env.local 的 AUTH_SECRET 后重启服务即可。");
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function interactive(): Promise<void> {
  printStatus();
  console.log("\n请选择要执行的操作：");
  console.log("  1) 重置登录密码（忘记密码）");
  console.log("  2) 关闭两步验证（丢失验证器/手机）");
  console.log("  3) 全部重置（密码 + 关闭两步验证）");
  console.log("  0) 退出");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let choice = "";
  let passwordInput = "";
  try {
    choice = (await rl.question("选择 [0-3]：")).trim();
    if (choice !== "1" && choice !== "2" && choice !== "3") {
      console.log("已退出，未做任何修改。");
      return;
    }
    if (choice === "1" || choice === "3") {
      passwordInput = await rl.question(
        "新密码（6-72 位，直接回车 = 生成随机密码；输入会明文显示）："
      );
      if (passwordInput.includes("\r")) {
        passwordInput = passwordInput.replace(/\r/g, "");
      }
    }
  } finally {
    rl.close();
  }

  const password = choice === "1" || choice === "3" ? passwordInput || generatePassword() : undefined;
  const disableMfa = choice === "2" || choice === "3";

  console.log("\n将执行：");
  if (password !== undefined) {
    console.log(`  - 重置登录密码为「${password}」（${password.length} 位）`);
  }
  if (disableMfa) {
    console.log("  - 关闭两步验证");
  }
  if (!(await confirm("确认执行？(y/N)："))) {
    console.log("已取消，未做任何修改。");
    return;
  }
  await applyReset({ password, disableMfa });
}

function printHelp(): void {
  console.log(
    `用法：bun scripts/reset-auth.ts [选项]
  （无选项时进入交互式菜单）
  --status               只查看当前状态，不做修改
  --password <新密码>    重置登录密码（6-72 位）
  --generate-password    重置为随机密码（只在屏幕显示一次）
  --disable-mfa          关闭两步验证（丢失验证器/手机）
  --yes                  跳过确认（非交互终端必须加）
  -h, --help             显示本帮助`
  );
}

interface Options {
  help?: boolean;
  status?: boolean;
  password?: string;
  generate?: boolean;
  disableMfa?: boolean;
  yes?: boolean;
}

function parseArgs(argv: string[]): { options: Options; error?: string } {
  const options: Options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return null;
      }
      i += 1;
      return value;
    };
    if (arg === "--status") {
      options.status = true;
    } else if (arg === "--password" || arg.startsWith("--password=")) {
      const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : next();
      if (!value) {
        return { options, error: "--password 需要跟一个密码值" };
      }
      options.password = value;
    } else if (arg === "--generate-password") {
      options.generate = true;
    } else if (arg === "--disable-mfa") {
      options.disableMfa = true;
    } else if (arg === "--yes" || arg === "-y") {
      options.yes = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      return { options, error: `未知选项：${arg}` };
    }
  }
  if (options.password !== undefined && options.generate) {
    return { options, error: "--password 与 --generate-password 不能同时使用" };
  }
  return { options };
}

const { options, error } = parseArgs(process.argv.slice(2));

if (error) {
  console.error(`✘ ${error}\n`);
  printHelp();
  process.exit(1);
}
if (options.help) {
  printHelp();
  process.exit(0);
}
if (options.status) {
  printStatus();
  process.exit(0);
}

const hasAction = options.password !== undefined || options.generate || options.disableMfa;
if (!hasAction) {
  await interactive();
  process.exit(0);
}

const actions: ResetActions = {
  password: options.password ?? (options.generate ? generatePassword() : undefined),
  disableMfa: options.disableMfa,
};

console.log("将执行：");
if (actions.password !== undefined) {
  console.log(`  - 重置登录密码（${actions.password.length} 位）`);
}
if (actions.disableMfa) {
  console.log("  - 关闭两步验证");
}

if (!options.yes) {
  if (!process.stdin.isTTY) {
    console.error("✘ 非交互终端无法确认，请加 --yes 或改用交互式运行");
    process.exit(1);
  }
  if (!(await confirm("确认执行？(y/N)："))) {
    console.log("已取消，未做任何修改。");
    process.exit(0);
  }
}

await applyReset(actions);
