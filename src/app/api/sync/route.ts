import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { decryptSecretField } from "@/lib/rsa";
import { isSyncing, testS3Connection } from "@/lib/sync-engine";
import { getActiveSyncJob } from "@/lib/sync-jobs";
import type { JobRecord } from "@/lib/job-queue";
import { kickAutoSync } from "@/lib/sync-watcher";
import {
  normalizePrefix,
  readSyncConfig,
  readSyncState,
  s3Configured,
  toS3View,
  writeSyncConfig,
  type S3StoredConfig,
} from "@/lib/sync-store";
import { readGitStatus, setupGit } from "@/lib/git-sync";

/**
 * 同步设置 API（服务端，Node 运行时）：
 * - GET：S3 配置视图（不含 Secret）、Git 仓库状态、最近同步结果、进行中的同步任务
 * - POST action：save-s3 / set-s3-enabled / test-s3 / save-git
 *   （手动同步已移至后台任务 API：POST /api/jobs action=run-sync）
 * Secret Access Key 经 RSA 信封加密传输（decryptSecretField 兼容明文字符串）。
 */

interface SyncStatusResponse {
  s3: ReturnType<typeof toS3View>;
  git: Awaited<ReturnType<typeof readGitStatus>>;
  state: {
    lastAuto?: { at: string; summary: unknown };
    lastManual?: { at: string; mode: string; summary: unknown };
    tracked: number;
  };
  syncing: boolean;
  activeJob: JobRecord | null;
}

export async function GET() {
  const [config, git, state] = await Promise.all([readSyncConfig(), readGitStatus(), readSyncState()]);
  const activeJob = (await getActiveSyncJob()) ?? null;
  const body: SyncStatusResponse = {
    s3: toS3View(config.s3),
    git,
    state: {
      lastAuto: state.lastAuto,
      lastManual: state.lastManual,
      tracked: Object.keys(state.entries).length,
    },
    syncing: isSyncing() || activeJob !== null,
    activeJob,
  };
  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const store = await cookies();
  const session = await verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";

  const str = (value: unknown): string => (typeof value === "string" ? value : "");

  try {
    switch (action) {
      case "save-s3": {
        const config = await readSyncConfig();
        const existing = config.s3;
        const bucket = str(body.bucket).trim();
        const accessKeyId = str(body.accessKeyId).trim() || existing?.accessKeyId || "";
        if (!bucket || /[\s/]/.test(bucket)) {
          return NextResponse.json({ error: "存储桶名不能为空，且不含空格或斜杠" }, { status: 400 });
        }
        if (!accessKeyId) {
          return NextResponse.json({ error: "请填写 Access Key ID" }, { status: 400 });
        }
        const endpoint = str(body.endpoint).trim().replace(/\/+$/, "");
        if (endpoint && /\s/.test(endpoint)) {
          return NextResponse.json({ error: "服务端点地址不能包含空格" }, { status: 400 });
        }
        // 地区允许留空：自建 MinIO/OSS 等无地区概念，签名时客户端回退 us-east-1
        const region = str(body.region).trim();

        // Secret：信封加密或明文；未提供（空串/缺字段）= 沿用已保存值
        let secret = existing?.secretAccessKey ?? "";
        if (body.secretAccessKey !== undefined && body.secretAccessKey !== null && body.secretAccessKey !== "") {
          const decrypted = await decryptSecretField(body.secretAccessKey);
          if (decrypted === null || !decrypted) {
            return NextResponse.json({ error: "Secret Access Key 解密失败，请刷新页面重试" }, { status: 400 });
          }
          secret = decrypted;
        }
        if (!secret) {
          return NextResponse.json({ error: "请填写 Secret Access Key" }, { status: 400 });
        }

        const enabled =
          typeof body.enabled === "boolean" ? body.enabled : (existing?.enabled ?? false);
        const next: S3StoredConfig = {
          enabled: enabled && true,
          endpoint,
          region,
          bucket,
          prefix: normalizePrefix(str(body.prefix)),
          accessKeyId,
          secretAccessKey: secret,
        };
        config.s3 = next;
        await writeSyncConfig(config);
        if (next.enabled) {
          kickAutoSync(1_000); // 启用即补一次推送（覆盖此前未开启期间的变更）
        }
        return NextResponse.json({ ok: true, s3: toS3View(next) });
      }

      case "set-s3-enabled": {
        const config = await readSyncConfig();
        if (!s3Configured(config.s3)) {
          return NextResponse.json({ error: "请先完成 S3 配置" }, { status: 400 });
        }
        const enabled = body.enabled === true;
        config.s3!.enabled = enabled;
        await writeSyncConfig(config);
        if (enabled) {
          kickAutoSync(1_000);
        }
        return NextResponse.json({ ok: true, s3: toS3View(config.s3) });
      }

      case "test-s3": {
        const config = await readSyncConfig();
        const bucket = str(body.bucket).trim();
        const accessKeyId = str(body.accessKeyId).trim() || config.s3?.accessKeyId || "";
        if (!bucket || !accessKeyId) {
          return NextResponse.json({ error: "请先填写存储桶与 Access Key ID" }, { status: 400 });
        }
        let secret = config.s3?.secretAccessKey ?? "";
        if (body.secretAccessKey !== undefined && body.secretAccessKey !== null && body.secretAccessKey !== "") {
          const decrypted = await decryptSecretField(body.secretAccessKey);
          if (decrypted === null || !decrypted) {
            return NextResponse.json({ error: "Secret Access Key 解密失败，请刷新页面重试" }, { status: 400 });
          }
          secret = decrypted;
        }
        if (!secret) {
          return NextResponse.json({ error: "请填写 Secret Access Key" }, { status: 400 });
        }
        const result = await testS3Connection({
          endpoint: str(body.endpoint).trim(),
          region: str(body.region).trim(),
          bucket,
          accessKeyId,
          secretAccessKey: secret,
        });
        return NextResponse.json({ ok: true, objectCount: result.objectCount });
      }

      case "save-git": {
        const status = await setupGit({
          userName: str(body.userName),
          userEmail: str(body.userEmail),
          remote: str(body.remote),
        });
        return NextResponse.json({ ok: true, git: status });
      }

      default:
        return NextResponse.json({ error: "未知操作" }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失败" },
      { status: 400 }
    );
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
