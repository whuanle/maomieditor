import type { LucideIcon } from "lucide-react";
import {
  Bot,
  DatabaseBackup,
  KeyRound,
  Monitor,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

export interface SettingSectionDef {
  /** 分区标识 */
  key: string;
  label: string;
  /** 一句话说明，占位页展示 */
  description: string;
  icon: LucideIcon;
}

/** 设置分区清单：设置页左侧菜单用（主题已并入外观的配色模式，不再单列） */
export const SETTING_SECTIONS: SettingSectionDef[] = [
  { key: "appearance", label: "外观", description: "配色、字体、排版、内容宽度与动效", icon: Monitor },
  { key: "password", label: "密码", description: "修改登录密码、保护文档密码与受保护会话", icon: KeyRound },
  { key: "sync", label: "同步", description: "笔记跨设备同步配置", icon: RefreshCw },
  { key: "backup", label: "备份", description: "数据备份、导出与恢复", icon: DatabaseBackup },
  { key: "mfa", label: "MFA 认证", description: "多因素认证（两步验证）", icon: ShieldCheck },
  { key: "ai", label: "AI / LLM", description: "模型接入、提示词与智能功能配置", icon: Bot },
];

export const DEFAULT_SECTION = SETTING_SECTIONS[0].key;

export function findSection(key: string): SettingSectionDef | undefined {
  return SETTING_SECTIONS.find((section) => section.key === key);
}
