import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DOCS_ROOT } from "./paths";

/**
 * Git 版本管理（服务端专用）：在 docs/ 目录初始化 git 仓库并绑定提交账号，
 * 之后由用户在 docs 目录手动 commit / push（应用不代替用户提交）。
 * 全部走 execFile（无 shell），参数为固定白名单，用户输入只作为 config 值出现。
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

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: DOCS_ROOT,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.toString("utf-8");
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
    gitTry(["status", "--porcelain"]),
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
