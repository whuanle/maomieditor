import { cookies } from "next/headers";
import { PROTECTION_COOKIE } from "./protection-shared";
import { verifyProtectedSessionToken } from "./protection";
import { getNoteProtection } from "./store";

/**
 * 笔记级保护门禁（服务端专用）：
 * 笔记受保护（自身或任一祖先开启）且当前没有有效的受保护会话 → 锁定，
 * 页面渲染锁定屏、内容类 API 返回 403，直到输入保护密码解锁。
 */
export async function isNoteLocked(noteId: string): Promise<boolean> {
  const protection = await getNoteProtection(noteId);
  if (!protection || !(protection.self || protection.inherited)) {
    return false;
  }
  const store = await cookies();
  const session = await verifyProtectedSessionToken(store.get(PROTECTION_COOKIE)?.value);
  return !session;
}
