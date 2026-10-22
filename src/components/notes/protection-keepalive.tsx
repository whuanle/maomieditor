"use client";

import { useEffect, useRef } from "react";

/** 活动检测的采样间隔（毫秒）：一分钟内有操作就续期一次受保护会话 */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * 受保护会话保活：有鼠标/键盘/滚动操作时每分钟 touch 一次，
 * 把会话从当前时刻重新起算（滑动过期）；闲置超过会话时间后 cookie 自然过期，
 * 下次打开受保护文档需重新输入保护密码。无会话时 touch 返回 401，静默忽略。
 */
export function ProtectionKeepAlive() {
  const lastActiveRef = useRef(Date.now());

  useEffect(() => {
    const markActive = () => {
      lastActiveRef.current = Date.now();
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "wheel"];
    for (const event of events) {
      window.addEventListener(event, markActive, { passive: true, capture: true });
    }

    const timer = window.setInterval(() => {
      if (Date.now() - lastActiveRef.current < TOUCH_INTERVAL_MS) {
        void fetch("/api/protection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "touch" }),
        }).catch(() => undefined);
      }
    }, TOUCH_INTERVAL_MS);

    return () => {
      for (const event of events) {
        window.removeEventListener(event, markActive, { capture: true });
      }
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
