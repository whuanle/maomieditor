"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { encryptFields } from "@/lib/rsa-client";
import { FormButton, FormInput, FormMessage, SettingsGroup, SettingsRow, Toggle } from "./settings-ui";

/** 同步设置：S3 对象存储自动推送 / 手动全量同步 + docs 目录 Git 版本管理 */

interface SyncSummaryDto {
  uploaded: number;
  downloaded: number;
  deleted: number;
  skipped: number;
  errors: { key: string; error: string }[];
}

interface S3View {
  enabled: boolean;
  configured: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  hasSecret: boolean;
}

interface GitView {
  initialized: boolean;
  userName: string;
  userEmail: string;
  remote: string;
  branch: string;
  changes: number;
}

interface SyncData {
  s3: S3View;
  git: GitView;
  state: {
    lastAuto?: { at: string; summary: SyncSummaryDto };
    lastManual?: { at: string; mode: string; summary: SyncSummaryDto };
    tracked: number;
  };
  syncing: boolean;
}

const SYNC_MODE_LABELS: Record<string, string> = {
  smart: "智能同步",
  "push-all": "覆盖 S3",
  "pull-all": "覆盖本地",
};

function formatSummary(summary: SyncSummaryDto): string {
  const parts = [`上传 ${summary.uploaded}`, `下载 ${summary.downloaded}`, `删除 ${summary.deleted}`];
  if (summary.errors.length > 0) {
    parts.push(`${summary.errors.length} 个失败`);
  }
  return parts.join(" · ");
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

export function SyncSection() {
  const [data, setData] = useState<SyncData | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/sync", { cache: "no-store" });
      if (response.ok) {
        setData((await response.json()) as SyncData);
      }
    } catch {
      // 拉取失败保留上次结果
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex h-full max-w-3xl flex-col py-8 pl-8 pr-2">
      <div className="border-b border-[var(--border-default)] pr-8 pb-4">
        <h1 className="text-[17px] font-semibold text-[var(--text-heading)]">同步</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">
          笔记自动推送到 S3 兼容对象存储，或在 docs 目录用 Git 做版本管理。
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-8 pb-10">
        <S3Group data={data} refresh={refresh} />
        <GitGroup data={data} refresh={refresh} />
      </div>
    </div>
  );
}

/* ===== 通用弹窗（文本/密码字段 + 可选附加操作按钮） ===== */

interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "password";
  placeholder?: string;
  autoComplete?: string;
}

interface SyncDialogProps {
  title: string;
  description?: string;
  fields: FieldDef[];
  /** 初始值（编辑已有配置时回显） */
  initial?: Record<string, string>;
  submitLabel: string;
  /** 附加操作（如「测试连接」）：返回展示在弹窗内的结果 */
  extraAction?: {
    label: string;
    run: (values: Record<string, string>) => Promise<{ error?: string; success?: string }>;
  };
  onSubmit: (values: Record<string, string>) => Promise<string | null>;
  onClose: () => void;
}

function SyncDialog({ title, description, fields, initial, submitLabel, extraAction, onSubmit, onClose }: SyncDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries(fields.map((field) => [field.key, ""])),
    ...(initial ?? {}),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extraBusy, setExtraBusy] = useState(false);
  const [extraResult, setExtraResult] = useState<{ error?: string; success?: string } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await onSubmit(values);
      if (message) {
        setError(message);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function runExtra() {
    if (!extraAction || extraBusy) {
      return;
    }
    setExtraBusy(true);
    setExtraResult(null);
    try {
      setExtraResult(await extraAction.run(values));
    } catch {
      setExtraResult({ error: "网络错误，请重试" });
    } finally {
      setExtraBusy(false);
    }
  }

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="dialog-panel w-full max-w-md p-5" onClick={(event) => event.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--text-heading)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {description && <p className="mb-2 text-[13px] leading-relaxed text-[var(--text-tertiary)]">{description}</p>}
        <div className="space-y-3 py-2">
          {fields.map((field, index) => (
            <label key={field.key} className="flex items-center justify-between gap-4">
              <span className="shrink-0 text-[13px] text-[var(--text-primary)]">{field.label}</span>
              <FormInput
                type={field.type ?? "text"}
                value={values[field.key] ?? ""}
                placeholder={field.placeholder}
                autoFocus={index === 0}
                spellCheck={false}
                onChange={(event) => setValues((prev) => ({ ...prev, [field.key]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void submit();
                  }
                }}
                aria-label={field.label}
                autoComplete={field.autoComplete ?? "off"}
                className="w-60"
              />
            </label>
          ))}
        </div>
        {(error || extraResult) && (
          <div className="flex justify-end pt-1">
            <FormMessage error={error ?? extraResult?.error} success={extraResult?.success} />
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          {extraAction && (
            <FormButton onClick={() => void runExtra()} disabled={busy || extraBusy}>
              {extraBusy ? "测试中…" : extraAction.label}
            </FormButton>
          )}
          <div className="flex-1" />
          <FormButton onClick={onClose} disabled={busy}>
            取消
          </FormButton>
          <FormButton onClick={() => void submit()} disabled={busy}>
            {busy ? "提交中…" : submitLabel}
          </FormButton>
        </div>
      </div>
    </div>
  );
}

/** 破坏性操作确认弹窗 */
function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function confirm() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const message = await onConfirm();
      if (message) {
        setError(message);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="dialog-panel w-full max-w-sm p-5" onClick={(event) => event.stopPropagation()}>
        <h2 className="text-[15px] font-semibold text-[var(--text-heading)]">{title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-tertiary)]">{description}</p>
        {error && (
          <div className="flex justify-end pt-2">
            <FormMessage error={error} />
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <FormButton onClick={onClose} disabled={busy}>
            取消
          </FormButton>
          <FormButton danger={danger} onClick={() => void confirm()} disabled={busy}>
            {busy ? "执行中…" : confirmLabel}
          </FormButton>
        </div>
      </div>
    </div>
  );
}

/* ===== S3 同步 ===== */

function S3Group({ data, refresh }: { data: SyncData | null; refresh: () => Promise<void> }) {
  const s3 = data?.s3;
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"push-all" | "pull-all" | null>(null);
  const [busyMode, setBusyMode] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const busy = data?.syncing === true || busyMode !== null;

  async function toggleEnabled(enabled: boolean) {
    if (!s3?.configured || busy) {
      return;
    }
    setResult(null);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-s3-enabled", enabled }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setResult({ ok: false, text: payload.error ?? "操作失败" });
      } else if (enabled) {
        setResult({ ok: true, text: "S3 同步已开启，稍后将自动推送一次全部变更" });
      }
    } catch {
      setResult({ ok: false, text: "网络错误，请重试" });
    }
    await refresh();
  }

  async function runSyncMode(mode: "smart" | "push-all" | "pull-all"): Promise<string | null> {
    if (busy) {
      return "有同步正在进行，请稍候";
    }
    setBusyMode(mode);
    setResult(null);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", mode, confirm: mode !== "smart" }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        summary?: SyncSummaryDto;
      };
      if (!response.ok || !payload.summary) {
        return payload.error ?? "同步失败";
      }
      setResult({
        ok: payload.summary.errors.length === 0,
        text: `${SYNC_MODE_LABELS[mode] ?? mode}完成：${formatSummary(payload.summary)}`,
      });
      return null;
    } catch {
      return "网络错误，请重试";
    } finally {
      setBusyMode(null);
      await refresh();
    }
  }

  async function saveS3Config(values: Record<string, string>): Promise<string | null> {
    if (!values.bucket?.trim()) {
      return "请填写存储桶名";
    }
    if (!values.accessKeyId?.trim()) {
      return "请填写 Access Key ID";
    }
    if (!values.secretAccessKey && !s3?.hasSecret) {
      return "请填写 Secret Access Key";
    }
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Secret 经 RSA 信封加密后传输，明文不出网
        body: JSON.stringify(
          await encryptFields(
            {
              action: "save-s3",
              endpoint: values.endpoint ?? "",
              region: values.region ?? "",
              bucket: values.bucket ?? "",
              prefix: values.prefix ?? "",
              accessKeyId: values.accessKeyId ?? "",
              secretAccessKey: values.secretAccessKey ?? "",
            },
            ["secretAccessKey"]
          )
        ),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        return payload.error ?? "保存失败";
      }
      setResult({ ok: true, text: "S3 配置已保存" });
      return null;
    } catch {
      return "网络错误或安全传输初始化失败，请重试";
    } finally {
      await refresh();
    }
  }

  async function testS3Config(values: Record<string, string>): Promise<{ error?: string; success?: string }> {
    if (!values.bucket?.trim()) {
      return { error: "请先填写存储桶名" };
    }
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          await encryptFields(
            {
              action: "test-s3",
              endpoint: values.endpoint ?? "",
              region: values.region ?? "",
              bucket: values.bucket ?? "",
              accessKeyId: values.accessKeyId ?? "",
              secretAccessKey: values.secretAccessKey ?? "",
            },
            ["secretAccessKey"]
          )
        ),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; objectCount?: number };
      if (!response.ok) {
        return { error: payload.error ?? "连接失败" };
      }
      return { success: `连接成功（桶内约 ${payload.objectCount ?? 0}+ 个对象）` };
    } catch {
      return { error: "网络错误，请重试" };
    }
  }

  const state = data?.state;
  const statusDescription = !s3?.configured
    ? "尚未配置——配置后可开启自动推送"
    : s3.enabled
      ? `${s3.bucket} @ ${s3.endpoint || "AWS 默认端点"}${s3.prefix ? ` / ${s3.prefix}` : ""}`
      : `已配置 ${s3.bucket}，自动推送未开启`;

  return (
    <SettingsGroup title="S3 对象存储同步">
      <p className="px-1 pb-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
        开启后，docs 目录（笔记、附件与历史版本）的文件变化会自动推送到 S3
        兼容存储（AWS S3、MinIO、Cloudflare R2、阿里云 OSS 等）；也可手动执行全量对比同步。
      </p>
      <SettingsRow label="S3 同步" description={statusDescription}>
        <div className="flex items-center gap-3">
          <Toggle checked={!!s3?.enabled} onChange={(value) => void toggleEnabled(value)} />
          <FormButton
            onClick={() => {
              setResult(null);
              setConfigOpen(true);
            }}
          >
            配置
          </FormButton>
        </div>
      </SettingsRow>
      {s3?.configured && (
        <SettingsRow
          label="手动同步"
          description="智能同步双向对比（冲突以本地为准）；覆盖类操作会重建另一侧的完整镜像"
        >
          <div className="flex items-center gap-2">
            <FormButton onClick={() => void runSyncMode("smart")} disabled={busy}>
              {busyMode === "smart" ? "同步中…" : "智能同步"}
            </FormButton>
            <FormButton
              onClick={() => {
                setResult(null);
                setConfirmMode("push-all");
              }}
              disabled={busy}
            >
              覆盖 S3
            </FormButton>
            <FormButton
              danger
              onClick={() => {
                setResult(null);
                setConfirmMode("pull-all");
              }}
              disabled={busy}
            >
              覆盖本地
            </FormButton>
          </div>
        </SettingsRow>
      )}
      {(state?.lastAuto || state?.lastManual || state?.tracked) && (
        <SettingsRow label="同步状态" description={syncStatusText(state)}>
          <span className="text-[13px] text-[var(--text-tertiary)]">
            已跟踪 {state?.tracked ?? 0} 个文件
          </span>
        </SettingsRow>
      )}
      {result && (
        <div className="flex justify-end py-2">
          <FormMessage error={result.ok ? null : result.text} success={result.ok ? result.text : null} />
        </div>
      )}

      {configOpen && (
        <SyncDialog
          title="配置 S3 存储"
          description="连接信息保存在服务端 .data 目录；Secret Access Key 经加密传输、不会回显。"
          initial={
            s3
              ? {
                  endpoint: s3.endpoint,
                  region: s3.region,
                  bucket: s3.bucket,
                  prefix: s3.prefix,
                  accessKeyId: s3.accessKeyId,
                }
              : undefined
          }
          fields={[
            { key: "endpoint", label: "服务端点", placeholder: "https://s3.amazonaws.com 或 MinIO 地址" },
            { key: "region", label: "地区", placeholder: "us-east-1" },
            { key: "bucket", label: "存储桶" },
            { key: "prefix", label: "对象前缀", placeholder: "可选，如 notes/maomi" },
            { key: "accessKeyId", label: "Access Key ID" },
            {
              key: "secretAccessKey",
              label: "Secret Access Key",
              type: "password",
              placeholder: s3?.hasSecret ? "留空保持不变" : undefined,
            },
          ]}
          submitLabel="保存"
          extraAction={{ label: "测试连接", run: testS3Config }}
          onSubmit={saveS3Config}
          onClose={() => setConfigOpen(false)}
        />
      )}
      {confirmMode === "push-all" && (
        <ConfirmDialog
          title="以本地覆盖 S3"
          description="本地 docs 下的全部文件都会重新上传到 S3，桶内前缀下本地不存在的对象将被删除。此操作不可撤销。"
          confirmLabel="覆盖 S3"
          onConfirm={() => runSyncMode("push-all")}
          onClose={() => setConfirmMode(null)}
        />
      )}
      {confirmMode === "pull-all" && (
        <ConfirmDialog
          title="以 S3 覆盖本地"
          description="S3 桶内前缀下的全部对象都会下载并覆盖本地文件，本地存在而桶内没有的文件将被删除。此操作不可撤销。"
          confirmLabel="覆盖本地"
          danger
          onConfirm={() => runSyncMode("pull-all")}
          onClose={() => setConfirmMode(null)}
        />
      )}
    </SettingsGroup>
  );
}

function syncStatusText(state: SyncData["state"] | undefined): string {
  const parts: string[] = [];
  if (state?.lastAuto) {
    const failed = state.lastAuto.summary.errors.length > 0;
    parts.push(
      `上次自动推送 ${formatTime(state.lastAuto.at)}：${failed ? `${state.lastAuto.summary.errors.length} 个失败` : "全部最新"}`
    );
  }
  if (state?.lastManual) {
    parts.push(
      `上次手动${SYNC_MODE_LABELS[state.lastManual.mode] ?? "同步"} ${formatTime(state.lastManual.at)}：${formatSummary(state.lastManual.summary)}`
    );
  }
  return parts.join("；") || "尚未执行过同步";
}

/* ===== Git 版本管理 ===== */

function GitGroup({ data, refresh }: { data: SyncData | null; refresh: () => Promise<void> }) {
  const git = data?.git;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function saveGit(values: Record<string, string>): Promise<string | null> {
    if (!values.userName?.trim()) {
      return "请填写提交账号姓名";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.userEmail ?? "")) {
      return "请填写正确的邮箱";
    }
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save-git",
          userName: values.userName ?? "",
          userEmail: values.userEmail ?? "",
          remote: values.remote ?? "",
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        return payload.error ?? "保存失败";
      }
      setSuccess("Git 配置已保存，可在 docs 目录手动提交推送");
      return null;
    } catch {
      return "网络错误，请重试";
    } finally {
      await refresh();
    }
  }

  const initialized = !!git?.initialized;

  return (
    <SettingsGroup title="Git 版本管理">
      <p className="px-1 pb-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
        在 docs 目录初始化 git 仓库并绑定提交账号后，可自行用 git 管理笔记版本：
        <code className="mx-1 rounded bg-[var(--bg-hover)] px-1 py-0.5 text-[12px]">cd docs</code>后
        add / commit / push。回收站（.trash）不会纳入版本库。
      </p>
      <SettingsRow
        label="Git 仓库"
        description={
          initialized
            ? `${git!.branch} 分支 · ${git!.changes} 个未提交变更 · ${git!.remote || "未绑定远程"}`
            : "未初始化——初始化后绑定提交账号，提交与推送由你手动完成"
        }
      >
        <FormButton
          onClick={() => {
            setSuccess(null);
            setDialogOpen(true);
          }}
        >
          {initialized ? "修改配置" : "初始化 Git"}
        </FormButton>
      </SettingsRow>
      {initialized && (
        <SettingsRow label="提交账号" description={`${git!.userName} <${git!.userEmail}>`}>
          <span className="text-[13px] text-[var(--text-tertiary)]">写入仓库本地配置</span>
        </SettingsRow>
      )}
      {success && (
        <div className="flex justify-end py-2">
          <FormMessage success={success} />
        </div>
      )}

      {dialogOpen && (
        <SyncDialog
          title={initialized ? "修改 Git 配置" : "初始化 Git 仓库"}
          description={
            initialized
              ? "更新提交账号与远程仓库；远程地址留空表示不改动。"
              : "将在 docs 目录创建 .git 仓库（默认 main 分支），并写入仓库本地配置。"
          }
          initial={
            initialized && git
              ? { userName: git.userName, userEmail: git.userEmail, remote: git.remote }
              : undefined
          }
          fields={[
            { key: "userName", label: "姓名", placeholder: "如：猫咪" },
            { key: "userEmail", label: "邮箱", placeholder: "如：cat@example.com" },
            {
              key: "remote",
              label: "远程仓库",
              placeholder: "可选，如 https://github.com/user/notes.git（留空不改动）",
            },
          ]}
          submitLabel={initialized ? "保存" : "初始化"}
          onSubmit={saveGit}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </SettingsGroup>
  );
}
