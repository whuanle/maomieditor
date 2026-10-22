import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DOCS_ROOT } from "./paths";

/**
 * Git 版本管理（服务端专用）：在 docs/ 目录初始化 git 仓库并绑定提交账号，
 * 支持一键 提交（add -A + commit）/ 拉取 / 推送（后台任务执行，见 git-jobs.ts）。
 * 全部走 execFile（无 shell），参数为固定白名单，用户输入只作为 config 值或
 * commit message 单个参数出现，不可能被解析成选项或命令。
 */

const execFileAsync = promisify(execFile) as (
  command: string,
  args: string[],
  options?: Record<string, unknown>
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;
const GIT_DIR = path.join(DOCS_ROOT, ".git");
const GITIGNORE_FILE = path.join(DOCS_ROOT, ".gitignore");

export interface GitStatus {
  /** docs/.git 是否存在 */
  initialized: boolean;
  userName: string;
  userEmail: string;
  remote: string;
  branch: string;
  /** 工作区变更文件数（git status --porcelain 行数；无提交历史时也有效） */
  changes: number;
}

/** git 失败时把 stdout/stderr 细节带出来（网络/冲突/认证问题用户才看得懂） */
function describeGitError(error: unknown): string {
  const err = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
  const text = [err.stderr?.toString(), err.stdout?.toString()]
    .filter(Boolean)
    .join("\n")
    .trim();
  return text.split("\n").filter(Boolean).slice(-6).join("\n") || err.message || "git 命令执行失败";
}

async function gitRaw(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: DOCS_ROOT,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { stdout: stdout.toString("utf-8"), stderr: stderr.toString("utf-8") };
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await gitRaw(args);
  return stdout;
}

async function gitTry(args: string[]): Promise<string | null> {
  try {
    return await git(args);
  } catch {
    return null;
  }
}

export async function readGitStatus(): Promise<GitStatus> {
  let initialized = false;
  try {
    await fsp.access(GIT_DIR);
    initialized = true;
  } catch {
    // 未初始化
  }

  if (!initialized) {
    return { initialized: false, userName: "", userEmail: "", remote: "", branch: "", changes: 0 };
  }

  const [userName, userEmail, remote, branch, status] = await Promise.all([
    gitTry(["config", "--local", "user.name"]),
    gitTry(["config", "--local", "user.email"]),
    gitTry(["remote", "get-url", "origin"]),
    gitTry(["symbolic-ref", "--short", "HEAD"]),
    // -uall：未跟踪目录展开成单个文件（默认折叠成一行会导致计数远小于实际）
    gitTry(["status", "--porcelain", "-uall"]),
  ]);

  return {
    initialized: true,
    userName: (userName ?? "").trim(),
    userEmail: (userEmail ?? "").trim(),
    remote: (remote ?? "").trim(),
    branch: (branch ?? "").trim() || "main",
    changes: (status ?? "").split("\n").filter((line) => line.trim().length > 0).length,
  };
}

/** 远程地址合法性：拦截以 - 开头被 git 当作选项的值，其余常见形态（https/ssh/scp/本地路径）放行 */
export function isValidRemoteUrl(remote: string): boolean {
  if (remote.startsWith("-") || remote.includes("\0")) {
    return false;
  }
  return /^(https?:\/\/|ssh:\/\/|git@|[\w.@-]+:[\w./~-]+|\/|~\/|\.\.?\/)/.test(remote) || /^[A-Za-z]:[\\/]/.test(remote);
}

/**
 * 初始化 / 更新 docs 仓库：init（幂等）+ 绑定提交账号 + 远程（可选）。
 * remote 传空字符串表示不改动现有远程。
 */
export async function setupGit(opts: { userName: string; userEmail: string; remote?: string }): Promise<GitStatus> {
  const userName = opts.userName.trim();
  const userEmail = opts.userEmail.trim();
  const remote = (opts.remote ?? "").trim();
  if (!userName) {
    throw new Error("请填写提交账号姓名");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
    throw new Error("邮箱格式不正确");
  }
  if (remote && !isValidRemoteUrl(remote)) {
    throw new Error("远程仓库地址格式不正确");
  }

  try {
    await fsp.access(GIT_DIR);
  } catch {
    try {
      await git(["init", "-b", "main"]);
    } catch {
      // 老版本 git 不支持 -b：退回传统 init（默认分支名交给 git 配置）
      await git(["init"]);
    }
  }

  // 回收站不进版本库（.data 在项目根、仓库在 docs，本就不包含）
  try {
    let current = "";
    try {
      current = await fsp.readFile(GITIGNORE_FILE, "utf-8");
    } catch {
      // 尚无 .gitignore
    }
    if (!/^\.\s*trash\s*\/?\s*$/m.test(current)) {
      await fsp.writeFile(GITIGNORE_FILE, `${current}${current.endsWith("\n") || !current ? "" : "\n"}.trash/\n`, "utf-8");
    }
  } catch {
    // .gitignore 写失败不阻塞初始化
  }

  await git(["config", "--local", "user.name", userName]);
  await git(["config", "--local", "user.email", userEmail]);

  if (remote) {
    const existing = await gitTry(["remote", "get-url", "origin"]);
    if (existing !== null) {
      await git(["remote", "set-url", "origin", remote]);
    } else {
      await git(["remote", "add", "origin", remote]);
    }
  }

  return readGitStatus();
}

/* ===== 一键操作（由 git-jobs.ts 包装成后台任务执行） ===== */

/** 提交全部变更（含新增/删除）：git add -A + commit。返回 git 输出摘要 */
export async function gitCommit(message?: string): Promise<string> {
  const status = await readGitStatus();
  if (!status.initialized) {
    throw new Error("Git 仓库尚未初始化");
  }
  if (status.changes === 0) {
    throw new Error("没有可提交的变更");
  }
  const msg =
    message?.trim() ||
    `猫咪笔记备份：${status.changes} 个文件变更（${new Date().toLocaleString("zh-CN", { hour12: false })}）`;
  await git(["add", "-A"]);
  try {
    const { stdout } = await gitRaw(["commit", "-m", msg]);
    return stdout.trim();
  } catch (error) {
    throw new Error(describeGitError(error));
  }
}

/** 从 origin 拉取当前分支（rebase + autostash，避免分叉合并提交） */
export async function gitPull(): Promise<string> {
  const status = await readGitStatus();
  if (!status.initialized) {
    throw new Error("Git 仓库尚未初始化");
  }
  if (!status.remote) {
    throw new Error("尚未绑定远程仓库，请先在「修改配置」里填写远程地址");
  }
  try {
    const { stdout, stderr } = await gitRaw(["pull", "--rebase", "--autostash", "origin", status.branch]);
    return `${stdout.trim()}\n${stderr.trim()}`.trim() || "拉取完成";
  } catch (error) {
    throw new Error(describeGitError(error));
  }
}

/** 推送当前分支到 origin（-u 顺带建立上游跟踪） */
export async function gitPush(): Promise<string> {
  const status = await readGitStatus();
  if (!status.initialized) {
    throw new Error("Git 仓库尚未初始化");
  }
  if (!status.remote) {
    throw new Error("尚未绑定远程仓库，请先在「修改配置」里填写远程地址");
  }
  try {
    const { stdout, stderr } = await gitRaw(["push", "-u", "origin", status.branch]);
    return `${stdout.trim()}\n${stderr.trim()}`.trim() || "推送完成";
  } catch (error) {
    throw new Error(describeGitError(error));
  }
}
