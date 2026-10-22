"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SmilePlus } from "lucide-react";
import { refreshTree } from "./notes-context";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "常用",
    emojis: ["📝", "✏️", "📌", "📂", "📁", "🗂️", "📋", "🗒️", "📓", "📔", "📕", "📗", "📘", "📙", "📚", "📖", "🏷️", "🔖", "🧷", "📎", "📇", "📄", "📃", "🗞️"],
  },
  {
    label: "表情",
    emojis: ["😀", "😄", "😅", "😂", "🥰", "😍", "🤩", "😎", "🤓", "🧐", "🤔", "🤯", "😱", "🥺", "😪", "🥳", "🤗", "😏", "🤫", "🙃", "😇", "🤠", "😴", "😤"],
  },
  {
    label: "手势",
    emojis: ["👍", "👎", "👌", "✌️", "🤞", "🤝", "👏", "🙌", "👋", "🤙", "💪", "🙏", "🫶", "🤌", "🖐️", "✋", "👆", "👇", "👉", "👈", "🖖", "🤛", "🤜", "👊"],
  },
  {
    label: "工作",
    emojis: ["💼", "📅", "📆", "🗓️", "⏰", "⏳", "📈", "📉", "📊", "💹", "🖥️", "💻", "⌨️", "🖱️", "🖨️", "📱", "☎️", "📞", "📧", "📮", "📦", "🗃️", "🪪", "🧾"],
  },
  {
    label: "学习",
    emojis: ["🎓", "📐", "📏", "🔬", "🔭", "🧪", "🧬", "🌐", "🔢", "➗", "➕", "➖", "✖️", "🧮", "♻️", "🎯", "🔍", "💡", "🧩", "🖊️", "🖍️", "🪄", "🧿", "📯"],
  },
  {
    label: "技术",
    emojis: ["🤖", "🛠️", "⚙️", "🔧", "🔨", "🔩", "🧰", "🔌", "🔋", "🔑", "🔒", "🔓", "🐛", "💾", "📀", "🎛️", "🖲️", "🧵", "🪛", "🪚", "🧱", "⛓️", "🧲", "⚗️"],
  },
  {
    label: "生活",
    emojis: ["🏠", "🏡", "🛏️", "🚪", "🧹", "🍳", "🍜", "🍱", "🍎", "🍌", "🍇", "🍉", "🍓", "🥕", "🌽", "🍞", "🧀", "☕", "🍵", "🥤", "🍺", "🍰", "🍩", "🍪"],
  },
  {
    label: "出行",
    emojis: ["🚗", "🚕", "🚌", "🚲", "🛴", "🚂", "✈️", "🚀", "🛸", "⛵", "🚢", "🗺️", "🧭", "🏝️", "🏔️", "🗻", "🌋", "🏕️", "🎪", "🎡", "🎢", "🏖️", "🚦", "⛽"],
  },
  {
    label: "动物",
    emojis: ["🐱", "🐶", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦆", "🦅", "🦉", "🦄", "🐝", "🦋", "🐬"],
  },
  {
    label: "植物",
    emojis: ["🌱", "🌿", "🍀", "🌸", "🌼", "🌻", "🌹", "🌷", "🌺", "🪷", "🥀", "🌵", "🌲", "🌳", "🌾", "🪴", "🍁", "🍂", "🎄", "🎍", "🪸", "🍄", "🌰", "🌴"],
  },
  {
    label: "天气",
    emojis: ["☀️", "🌙", "⭐", "🌟", "✨", "⚡", "🔥", "🌈", "☁️", "🌧️", "⛈️", "🌪️", "❄️", "☃️", "🌊", "💧", "🌍", "🌏", "🌎", "🪨", "🌌", "🧊", "🌫️", "🌤️"],
  },
  {
    label: "符号",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💖", "💗", "🎉", "🎊", "🎁", "🏆", "🥇", "🎖️", "⚠️", "❗", "❓", "✅", "❌", "🚫", "💎", "🏁"],
  },
];

const ALL_EMOJIS = EMOJI_GROUPS.flatMap((group) => group.emojis);

interface NoteIconButtonProps {
  noteId: string;
  /** 当前图标（空串 = 未设置） */
  icon: string;
}

/** 笔记 emoji 图标：点击弹出选择器，设置/更换/移除图标 */
export function NoteIconButton({ noteId, icon }: NoteIconButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(icon);
  const [custom, setCustom] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrent(icon);
  }, [icon]);

  // 点外部关闭
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setCustom("");
    }
  }, [open]);

  async function apply(next: string) {
    setOpen(false);
    if (next === current) {
      return;
    }
    setCurrent(next); // 乐观更新
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-icon", id: noteId, icon: next }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        window.alert((data as { error?: string }).error ?? "设置图标失败");
        setCurrent(current);
        return;
      }
      refreshTree(); // 侧边栏与标签栏的图标
      router.refresh(); // 本页服务端渲染的图标
    } catch {
      window.alert("网络错误");
      setCurrent(current);
    }
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title="设置图标"
        aria-label="设置图标"
        className="flex h-8 w-8 items-center justify-center rounded-sm text-xl leading-none transition-colors hover:bg-[var(--bg-hover)]"
      >
        {current ? (
          <span>{current}</span>
        ) : (
          <SmilePlus className="h-4 w-4 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]" />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border border-[var(--border-strong)] bg-[var(--bg-card)] shadow-lg">
          <div className="max-h-[65vh] overflow-y-auto p-2">
            {EMOJI_GROUPS.map((group) => (
              <div key={group.label} className="mb-1.5">
                <p className="px-1 pb-0.5 text-[11px] text-[var(--text-tertiary)]">{group.label}</p>
                <div className="grid grid-cols-8 gap-1">
                  {group.emojis.map((emoji) => (
                    <button
                      key={group.label + emoji}
                      type="button"
                      onClick={() => void apply(emoji)}
                      className={`flex h-8 w-8 items-center justify-center rounded-sm text-xl leading-none transition-colors hover:bg-[var(--bg-hover)] ${
                        emoji === current ? "bg-[var(--accent-100)]" : ""
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1 border-t border-[var(--border-default)] p-2">
            <input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && custom.trim()) {
                  void apply(custom.trim());
                }
              }}
              placeholder="粘贴自定义 emoji"
              className="h-7 min-w-0 flex-1 rounded-sm border border-[var(--border-default)] bg-transparent px-1.5 text-[13px] outline-none focus:border-[var(--accent-600)]"
            />
            <button
              type="button"
              onClick={() => void apply(ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)])}
              className="rounded-sm px-1.5 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
              title="随机换一个"
            >
              随机
            </button>
            <button
              type="button"
              onClick={() => void apply("")}
              className="rounded-sm px-1.5 py-1 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
              title="移除图标"
            >
              移除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
