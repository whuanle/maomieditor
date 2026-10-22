"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import { encryptFields } from "@/lib/rsa-client";
import { FormButton, FormMessage, SettingsGroup, SettingsRow, SettingsSubgroup, Toggle } from "./settings-ui";

/** 同步设置：左列 S3 对象存储同步 + docs 目录 Git 版本管理，右列任务记录（独立栏、栏内滚动） */

interface SyncSummaryDto {
  uploaded: number;
  downloaded: number;
  deleted: number;
  skipped: number;
  errors: { key: string; error: string }[];
  conflicts: { key: string; detail: string }[];
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
  activeJob: JobDto | null;
}

type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface JobDto {
  id: string;
  type: string;
  label: string;
  params?: Record<string, unknown>;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress?: { phase: string; done: number; total: number };
  /** sync 任务 = 同步摘要；git 任务 = 输出末行等文本 */
  result?: unknown;
  error?: string;
  logs: { at: string; level: "info" | "warn" | "error"; message: string }[];
}

const SYNC_MODE_LABELS: Record<string, string> = {
  smart: "智能同步",
  "push-all": "覆盖 S3",
  "pull-all": "覆盖本地",
};

function formatSummary(summary: SyncSummaryDto): string {
  const parts = [`上传 ${summary.uploaded}`, `下载 ${summary.downloaded}`, `删除 ${summary.deleted}`];
  if (summary.conflicts?.length) {
    parts.push(`${summary.conflicts.length} 个冲突`);
  }
  if (summary.errors.length > 0) {
    parts.push(`${summary.errors.length} 个失败`);
  }
  return parts.join(" · ");
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDuration(job: JobDto): string {
  if (!job.startedAt || !job.finishedAt) {
    return "";
  }
  const seconds = Math.max(1, Math.round((Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}

function isActiveJob(job: JobDto | null | undefined): boolean {
  return job?.status === "queued" || job?.status === "running";
}

export function SyncSection() {
  const [data, setData] = useState<SyncData | null>(null);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refreshData = useCallback(async () => {
    try {
      const response = await fetch("/api/sync", { cache: "no-store" });
      if (response.ok) {
        setData((await response.json()) as SyncData);
      }
    } catch {
      // 拉取失败保留上次结果
    }
  }, []);

  const refreshJobs = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/jobs?limit=30", { cache: "no-store" });
      if (response.ok) {
        const payload = (await response.json()) as { jobs: JobDto[] };
        setJobs(payload.jobs);
        return payload.jobs.some(isActiveJob);
      }
    } catch {
      // 忽略
    }
    return false;
  }, []);

  // 轮询：有任务在跑时 2 秒一次盯进度，空闲时降到 15 秒同步状态
  const hasActiveRef = useRef(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      const [active] = await Promise.all([refreshJobs(), refreshData()]);
      hasActiveRef.current = active;
      if (!stopped) {
        timer = setTimeout(loop, active ? 2_000 : 15_000);
      }
    };
    void loop();
    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [refreshData, refreshJobs]);

  return (
    <div className="flex h-full">
      <div className="flex h-full min-w-0 max-w-3xl flex-col py-8 pl-8 pr-2">
        <div className="border-b border-[var(--border-default)] pr-8 pb-4">
          <h1 className="text-[17px] font-semibold text-[var(--text-heading)]">同步</h1>
          <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">
            笔记自动推送到 S3 兼容对象存储；手动同步在后台运行，过程与错误留有记录。
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-8 pb-10">
          <S3Group
            data={data}
            jobs={jobs}
            message={message}
            setMessage={setMessage}
            refreshData={refreshData}
            refreshJobs={refreshJobs}
          />
          <GitGroup data={data} jobs={jobs} refreshData={refreshData} refreshJobs={refreshJobs} />
        </div>
      </div>
      <JobsPanel jobs={jobs} refreshJobs={refreshJobs} />
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
      <div className="dialog-panel w-full max-w-lg p-6" onClick={(event) => event.stopPropagation()}>
        <div className="mb-1.5 flex items-center justify-between">
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
        {description && <p className="mb-3 text-[13px] leading-relaxed text-[var(--text-tertiary)]">{description}</p>}
        <div className="space-y-4 py-3">
          {fields.map((field, index) => (
            <label key={field.key} className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[var(--text-primary)]">{field.label}</span>
              <input
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
                className="h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-card)] px-3 text-[15px] text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border-strong)] focus:border-[var(--accent-500)]"
              />
            </label>
          ))}
        </div>
        {(error || extraResult) && (
          <div className="flex justify-end pt-1">
            <FormMessage error={error ?? extraResult?.error} success={extraResult?.success} />
          </div>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
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

/* ===== 状态徽章：分组标题右侧，一眼可辨开/关 ===== */

function StatusChip({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium ${
        on
          ? "bg-[var(--accent-100)] text-[var(--accent-700)] ring-1 ring-inset ring-[var(--accent-300)]"
          : "bg-[var(--bg-hover)] text-[var(--text-tertiary)]"
      }`}
    >
      {label}
    </span>
  );
}

/* ===== S3 同步 ===== */

interface S3GroupProps {
  data: SyncData | null;
  jobs: JobDto[];
  message: { ok: boolean; text: string } | null;
  setMessage: (message: { ok: boolean; text: string } | null) => void;
  refreshData: () => Promise<void>;
  refreshJobs: () => Promise<boolean>;
}

function S3Group({ data, jobs, message, setMessage, refreshData, refreshJobs }: S3GroupProps) {
  const s3 = data?.s3;
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmMode, setConfirmMode] = useState<"push-all" | "pull-all" | null>(null);

  const activeJob = jobs.find(isActiveJob) ?? (isActiveJob(data?.activeJob) ? data!.activeJob : null);
  const busy = data?.syncing === true || activeJob !== null;
  /** 正在跑的任务模式：让对应按钮自身转 loading，不额外插行撑开布局 */
  const activeMode =
    activeJob && typeof activeJob.params?.mode === "string" ? (activeJob.params.mode as string) : null;

  async function toggleEnabled(enabled: boolean) {
    if (!s3?.configured || busy) {
      return;
    }
    setMessage(null);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-s3-enabled", enabled }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setMessage({ ok: false, text: payload.error ?? "操作失败" });
      } else if (enabled) {
        setMessage({ ok: true, text: "S3 同步已开启，稍后将自动推送一次全部变更" });
      }
    } catch {
      setMessage({ ok: false, text: "网络错误，请重试" });
    }
    await refreshData();
  }

  /** 发起后台同步任务：接口立即返回，进度与取消见下方「同步记录」 */
  async function startSyncJob(mode: "smart" | "push-all" | "pull-all"): Promise<string | null> {
    if (busy) {
      return "有同步任务正在进行，请稍候";
    }
    setMessage(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run-sync", mode, confirm: mode !== "smart" }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        return payload.error ?? "发起同步失败";
      }
      setMessage({
        ok: true,
        text:
          mode === "smart"
            ? "智能同步已在后台开始，可关闭设置页，结果见右侧任务记录"
            : "覆盖任务已在后台开始，结果见右侧任务记录",
      });
      await Promise.all([refreshJobs(), refreshData()]);
      return null;
    } catch {
      return "网络错误，请重试";
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
      setMessage({ ok: true, text: "S3 配置已保存" });
      return null;
    } catch {
      return "网络错误或安全传输初始化失败，请重试";
    } finally {
      await refreshData();
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
  const chip = !s3?.configured ? (
    <StatusChip on={false} label="未配置" />
  ) : s3.enabled ? (
    <StatusChip on label="已开启" />
  ) : (
    <StatusChip on={false} label="已暂停" />
  );

  return (
    <SettingsGroup title="S3 对象存储同步" spaced={false} titleExtra={chip}>
      <p className="pr-1 pt-3 pb-2 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
        docs 目录与 S3 兼容存储（AWS S3、MinIO、Cloudflare R2、阿里云 OSS 等）双向同步；
        编辑后自动推送，也可手动在后台执行同步。
      </p>
      <SettingsRow
        label="自动推送"
        description={
          s3?.configured
            ? `${s3.bucket} @ ${s3.endpoint || "AWS 默认端点"}${s3.prefix ? ` / ${s3.prefix}` : ""}`
            : "尚未配置存储桶，点击右侧「配置」开始"
        }
      >
        <div className="flex items-center gap-3">
          <Toggle checked={!!s3?.enabled} onChange={(value) => void toggleEnabled(value)} />
          <FormButton
            onClick={() => {
              setMessage(null);
              setConfigOpen(true);
            }}
          >
            配置
          </FormButton>
        </div>
      </SettingsRow>
      {s3?.configured && (
        <>
          <SettingsSubgroup title="手动同步" />
          <SettingsRow
            nested
            label="智能同步"
            description="后台运行：OSS 没有的文件上传、本地没有的从 OSS 下载；两边内容不一致的记入同步记录，不自动覆盖"
          >
            <FormButton onClick={() => void startSyncJob("smart")} disabled={busy}>
              <ButtonLabel loading={activeMode === "smart"} queued={activeJob?.status === "queued"}>
                {activeMode === "smart" ? "同步中…" : "开始智能同步"}
              </ButtonLabel>
            </FormButton>
          </SettingsRow>
          <SettingsRow
            nested
            label="覆盖 S3"
            description="以本地为准重建桶内对象：全部重新上传，桶内多出的删除（不可撤销）"
          >
            <FormButton
              onClick={() => {
                setMessage(null);
                setConfirmMode("push-all");
              }}
              disabled={busy}
            >
              <ButtonLabel loading={activeMode === "push-all"} queued={activeJob?.status === "queued"}>
                {activeMode === "push-all" ? "覆盖中…" : "覆盖 S3"}
              </ButtonLabel>
            </FormButton>
          </SettingsRow>
          <SettingsRow
            nested
            label="覆盖本地"
            description="以桶内对象为准重建本地 docs：全部下载覆盖，本地多出的删除（不可撤销）"
          >
            <FormButton
              danger
              onClick={() => {
                setMessage(null);
                setConfirmMode("pull-all");
              }}
              disabled={busy}
            >
              <ButtonLabel loading={activeMode === "pull-all"} queued={activeJob?.status === "queued"}>
                {activeMode === "pull-all" ? "覆盖中…" : "覆盖本地"}
              </ButtonLabel>
            </FormButton>
          </SettingsRow>
        </>
      )}
      {(state?.lastAuto || state?.lastManual) && (
        <SettingsRow label="同步状态" description={syncStatusText(state)}>
          {state?.tracked ? (
            <span className="text-[13px] text-[var(--text-tertiary)]">已跟踪 {state.tracked} 个文件</span>
          ) : (
            <span />
          )}
        </SettingsRow>
      )}
      {message && (
        <div className="flex justify-end py-2">
          <FormMessage error={message.ok ? null : message.text} success={message.ok ? message.text : null} />
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
            { key: "region", label: "地区", placeholder: "如 us-east-1，自建存储可留空" },
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
          onConfirm={() => startSyncJob("push-all")}
          onClose={() => setConfirmMode(null)}
        />
      )}
      {confirmMode === "pull-all" && (
        <ConfirmDialog
          title="以 S3 覆盖本地"
          description="S3 桶内前缀下的全部对象都会下载并覆盖本地文件，本地存在而桶内没有的文件将被删除。此操作不可撤销。"
          confirmLabel="覆盖本地"
          danger
          onConfirm={() => startSyncJob("pull-all")}
          onClose={() => setConfirmMode(null)}
        />
      )}
    </SettingsGroup>
  );
}

/** 按钮内文字 + 转圈：loading 时显示进行中状态（不额外插行撑开布局） */
function ButtonLabel({ loading, queued, children }: { loading: boolean; queued?: boolean; children: ReactNode }) {
  if (!loading) {
    return <>{children}</>;
  }
  return (
    <span className="flex items-center justify-center gap-1.5">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {queued ? "排队中…" : children}
    </span>
  );
}

function syncStatusText(state: SyncData["state"] | undefined): string {
  const parts: string[] = [];
  if (state?.lastAuto) {
    const failed = state.lastAuto.summary.errors.length > 0 || state.lastAuto.summary.conflicts?.length;
    parts.push(
      `上次自动推送 ${formatTime(state.lastAuto.at)}：${failed ? "存在失败/冲突，见同步记录" : "全部最新"}`
    );
  }
  if (state?.lastManual) {
    parts.push(
      `上次手动${SYNC_MODE_LABELS[state.lastManual.mode] ?? "同步"} ${formatTime(state.lastManual.at)}：${formatSummary(state.lastManual.summary)}`
    );
  }
  return parts.join("；") || "尚未执行过同步";
}

/* ===== 同步记录（后台任务历史，含日志） ===== */

const JOB_STATUS_META: Record<JobStatus, { label: string; className: string }> = {
  queued: { label: "排队中", className: "text-[var(--text-tertiary)]" },
  running: { label: "进行中", className: "text-[var(--accent-600)]" },
  completed: { label: "已完成", className: "text-[#1a7f37] dark:text-[#3fb950]" },
  failed: { label: "失败", className: "text-red-600 dark:text-red-400" },
  cancelled: { label: "已取消", className: "text-[var(--text-tertiary)]" },
};

/** 任务记录：右侧独立栏，栏内滚动，不占用左侧设置列的长度 */
function JobsPanel({ jobs, refreshJobs }: { jobs: JobDto[]; refreshJobs: () => Promise<boolean> }) {
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function clearFinished() {
    if (busy || jobs.some(isActiveJob)) {
      return;
    }
    if (!window.confirm("确定清空全部已结束的同步记录吗？（进行中的任务不受影响）")) {
      return;
    }
    setBusy(true);
    try {
      await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear-finished" }),
      });
    } finally {
      setBusy(false);
    }
    await refreshJobs();
  }

  /** 取消排队/运行中的任务（协作式：任务在当前文件处理完后停止） */
  async function cancelJob(id: string) {
    try {
      await fetch(`/api/jobs/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
    } catch {
      // 下次轮询会看到实际状态
    }
    await refreshJobs();
  }

  const activeCount = jobs.filter(isActiveJob).length;
  const finishedCount = jobs.length - activeCount;

  return (
    <aside className="flex h-full min-w-0 max-w-2xl flex-1 flex-col border-l border-[var(--border-default)] py-8 pl-6 pr-6">
      <div className="flex items-center gap-3 border-b border-[var(--border-default)] pb-4">
        <h2 className="flex-1 text-[15px] font-semibold text-[var(--text-heading)]">任务记录</h2>
        {jobs.length > 0 && (
          <span className="shrink-0 text-[12.5px] text-[var(--text-tertiary)]">
            {jobs.length} 条{activeCount > 0 ? ` · ${activeCount} 个进行中` : ""}
          </span>
        )}
        {finishedCount > 0 && (
          <FormButton onClick={() => void clearFinished()} disabled={busy}>
            清空记录
          </FormButton>
        )}
      </div>
      <div className="min-h-0 flex-1 divide-y divide-[var(--border-faint,var(--border-default))] overflow-y-auto pb-6">
        {jobs.length === 0 ? (
          <p className="pt-4 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
            暂无记录——同步与 Git 操作的执行过程、冲突和错误都会留存在这里（服务重启不丢失）。
          </p>
        ) : (
          jobs.map((job) => (
            <JobItem
              key={job.id}
              job={job}
              open={openJobId === job.id}
              onToggle={() => setOpenJobId(openJobId === job.id ? null : job.id)}
              onCancel={cancelJob}
            />
          ))
        )}
      </div>
    </aside>
  );
}

function JobItem({
  job,
  open,
  onToggle,
  onCancel,
}: {
  job: JobDto;
  open: boolean;
  onToggle: () => void;
  onCancel: (id: string) => Promise<void>;
}) {
  const meta = JOB_STATUS_META[job.status];
  /** 同步任务的摘要；Git 任务的结果是文本（取末行展示） */
  const summary = job.type === "sync" && job.result ? (job.result as SyncSummaryDto) : undefined;
  const textResult = typeof job.result === "string" ? job.result : "";
  const duration = formatDuration(job);
  const conflictCount = summary?.conflicts?.length ?? 0;
  const errorCount = summary?.errors?.length ?? (job.status === "failed" ? 1 : 0);
  const total = job.progress?.total ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round(((job.progress?.done ?? 0) / total) * 100)) : 0;

  return (
    <div className="py-2.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        {job.status === "running" ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--accent-600)]" />
        ) : job.status === "completed" ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#1a7f37] dark:text-[#3fb950]" />
        ) : job.status === "failed" ? (
          <XCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
        ) : job.status === "cancelled" ? (
          <Ban className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
        ) : (
          <Clock3 className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[14px] text-[var(--text-primary)]">{job.label}</span>
            <span className={`text-[12px] font-medium ${meta.className}`}>{meta.label}</span>
            {conflictCount > 0 && (
              <span className="rounded-full bg-orange-100 px-1.5 py-px text-[12px] font-medium text-orange-700 ring-1 ring-inset ring-orange-300 dark:bg-orange-950 dark:text-orange-400 dark:ring-orange-800">
                {conflictCount} 冲突
              </span>
            )}
            {errorCount > 0 && (
              <span className="rounded-full bg-red-100 px-1.5 py-px text-[12px] font-medium text-red-700 ring-1 ring-inset ring-red-300 dark:bg-red-950 dark:text-red-400 dark:ring-red-800">
                {errorCount} 失败
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-[var(--text-tertiary)]">
            {formatTime(job.createdAt)}
            {duration && ` · 耗时 ${duration}`}
            {job.status === "running" && job.progress && job.progress.total > 0
              ? ` · ${job.progress.phase} ${job.progress.done}/${job.progress.total}`
              : ""}
            {job.status === "completed" && summary ? ` · ${formatSummary(summary)}` : ""}
            {job.status === "completed" && !summary && textResult ? ` · ${textResult}` : ""}
            {job.status === "failed" && job.error ? ` · ${job.error}` : ""}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--text-tertiary)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {isActiveJob(job) && (
          <FormButton onClick={() => void onCancel(job.id)} title="取消此任务（当前文件处理完后停止）">
            取消
          </FormButton>
        )}
      </div>
      {job.status === "running" && total > 0 && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--bg-hover)]">
          <div
            className="h-full rounded-full bg-[var(--accent-500)] transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {open && (
        <div className="mt-2 pl-5">
          {job.logs.length === 0 ? (
            <p className="pl-1 text-[12.5px] text-[var(--text-tertiary)]">暂无日志</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md bg-[var(--bg-hover)] p-2.5 font-mono text-[12px] leading-5">
              {job.logs.map((entry, index) => (
                <div
                  key={index}
                  className={
                    entry.level === "error"
                      ? "text-red-600 dark:text-red-400"
                      : entry.level === "warn"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-[var(--text-secondary)]"
                  }
                >
                  <span className="mr-2 text-[var(--text-tertiary)]">{formatClock(entry.at)}</span>
                  {entry.message}
                </div>
              ))}
            </div>
          )}
          {conflictCount > 0 && (
            <p className="mt-1.5 pl-1 text-[12.5px] leading-relaxed text-[var(--text-tertiary)]">
              冲突文件未做改动；确认后可用「覆盖 S3」以本地为准、或「覆盖本地」以远端为准处理。
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ===== Git 版本管理 ===== */

function GitGroup({
  data,
  jobs,
  refreshData,
  refreshJobs,
}: {
  data: SyncData | null;
  jobs: JobDto[];
  refreshData: () => Promise<void>;
  refreshJobs: () => Promise<boolean>;
}) {
  const git = data?.git;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const activeGitJob = jobs.find((job) => job.type === "git" && isActiveJob(job));
  const activeGitAction =
    activeGitJob && typeof activeGitJob.params?.gitAction === "string"
      ? (activeGitJob.params.gitAction as string)
      : null;
  const gitBusy = activeGitJob !== undefined;

  async function runGitAction(action: "commit" | "pull" | "push"): Promise<string | null> {
    if (gitBusy) {
      return "有 Git 任务正在进行，请稍候";
    }
    setMessage(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run-git", gitAction: action }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        return payload.error ?? "发起失败";
      }
      setMessage({ ok: true, text: "已在后台开始，结果见右侧任务记录" });
      await Promise.all([refreshJobs(), refreshData()]);
      return null;
    } catch {
      return "网络错误，请重试";
    }
  }

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
      setMessage({ ok: true, text: "Git 配置已保存" });
      return null;
    } catch {
      return "网络错误，请重试";
    } finally {
      await refreshData();
    }
  }

  const initialized = !!git?.initialized;

  return (
    <SettingsGroup
      title="Git 版本管理"
      titleExtra={<StatusChip on={initialized} label={initialized ? "已初始化" : "未初始化"} />}
    >
      <p className="pr-1 pt-3 pb-2 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
        在 docs 目录用 git 管理笔记版本：可一键提交全部变更到本地仓库，绑定远程后可拉取 / 推送；回收站（.trash）不纳入版本库。
      </p>
      <SettingsRow
        label="Git 仓库"
        description={
          initialized
            ? `${git!.branch} 分支 · ${git!.changes} 个未提交变更 · ${git!.remote || "未绑定远程"}`
            : "初始化后在此绑定提交账号，提交与推送由你手动完成"
        }
      >
        <FormButton
          onClick={() => {
            setMessage(null);
            setDialogOpen(true);
          }}
        >
          {initialized ? "修改配置" : "初始化 Git"}
        </FormButton>
      </SettingsRow>
      {initialized && (
        <>
          <SettingsRow
            label="提交"
            description={
              git!.changes > 0
                ? `一键 git add -A + commit，提交全部 ${git!.changes} 个变更（笔记、附件与历史备份）`
                : "工作区干净，没有待提交的变更"
            }
          >
            <FormButton onClick={() => void runGitAction("commit")} disabled={gitBusy || git!.changes === 0}>
              <ButtonLabel loading={activeGitAction === "commit"} queued={activeGitJob?.status === "queued"}>
                提交
              </ButtonLabel>
            </FormButton>
          </SettingsRow>
          <SettingsRow
            label="拉取 / 推送"
            description={
              git!.remote
                ? `origin/${git!.branch}（拉取用 rebase 自动收纳本地改动；推送建立上游跟踪）`
                : "绑定远程仓库后可用"
            }
          >
            <div className="flex items-center gap-2">
              <FormButton onClick={() => void runGitAction("pull")} disabled={gitBusy || !git!.remote}>
                <ButtonLabel loading={activeGitAction === "pull"} queued={activeGitJob?.status === "queued"}>
                  拉取
                </ButtonLabel>
              </FormButton>
              <FormButton onClick={() => void runGitAction("push")} disabled={gitBusy || !git!.remote}>
                <ButtonLabel loading={activeGitAction === "push"} queued={activeGitJob?.status === "queued"}>
                  推送
                </ButtonLabel>
              </FormButton>
            </div>
          </SettingsRow>
        </>
      )}
      {message && (
        <div className="flex justify-end py-2">
          <FormMessage error={message.ok ? null : message.text} success={message.ok ? message.text : null} />
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
