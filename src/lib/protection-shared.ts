/**
 * 受保护文档的纯常量（客户端组件可安全 import；
 * 服务端逻辑在 protection.ts，会 re-export 这些值，改动时保持两边同一来源即可）。
 */

export const PROTECTION_COOKIE = "note_protection_session";

/** 未配置时的默认受保护会话时间（分钟） */
export const DEFAULT_PROTECTION_TIMEOUT_MINUTES = 15;

export const PROTECTION_TIMEOUT_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 5, label: "5 分钟" },
  { minutes: 15, label: "15 分钟" },
  { minutes: 30, label: "30 分钟" },
  { minutes: 60, label: "1 小时" },
  { minutes: 240, label: "4 小时" },
  { minutes: 720, label: "12 小时" },
  { minutes: 1440, label: "24 小时" },
  { minutes: 0, label: "每次打开时询问" },
];
