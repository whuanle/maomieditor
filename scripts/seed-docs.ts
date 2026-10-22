/**
 * 演示数据种子：在虚拟文档树里生成一套有真实结构的知识库（约 47 篇笔记 + 2 个附件）。
 * 用法：bun scripts/seed-docs.ts
 * 走 src/lib/store 的正规 CRUD（createNote/addAttachment），frontmatter/ID/order 全部由存储层生成。
 */
import { addAttachment, createNote, type TreeNode } from "../src/lib/store";

interface Spec {
  title: string;
  format?: "md" | "mdx";
  body: string;
  children?: Spec[];
}

const SPEC: Spec[] = [
  {
    title: "使用手册",
    body: "猫咪笔记的使用手册汇总。左侧树可以无限层级地组织文档，本手册本身就是用它搭出来的。",
    children: [
      {
        title: "快速上手",
        body: `三分钟上手：

1. 右键任意笔记 → 新建子笔记
2. 顶栏「编辑」进入编辑器，\`Ctrl+S\` 保存
3. 拖拽整理结构：中段=挂为子笔记，上下边缘=同级排序
4. 删除的笔记进回收站，可恢复到原位置

> 提示：URL 就是笔记 ID，改标题、挪位置都不会让链接失效。`,
      },
      {
        title: "文档树与拖拽",
        body: `文档树的组织方式：

| 操作 | 结果 |
| ---- | ---- |
| 拖到笔记中段 | 挂为它的子笔记 |
| 拖到上/下边缘 | 排到它的前面/后面 |
| 拖到底部虚线框 | 移到根级 |

排序值存在每篇笔记 frontmatter 的 \`order\` 字段里，拖拽取邻居中值，
常规调序只写被拖的那一个文件——对 git 同步非常友好。`,
      },
      {
        title: "附件管理",
        body: `附件（PDF、压缩包、表格等）挂在笔记下面，出现在目录树里，点击即下载，不参与渲染。

- 右键笔记 →「上传附件到此笔记」
- 编辑器里粘贴/插入的图片也走同一套附件系统，URL 是 \`/api/attachments/{id}\`
- 附件属于笔记：移动笔记时归属不变，删除笔记时附件一并进回收站`,
        children: [
          {
            title: "图片插入实践",
            body: `编辑器里处理图片的三种方式：

1. 工具栏「插入图片」→ 弹出上传
2. 直接粘贴剪贴板截图（最常用）
3. 拖拽图片文件进编辑器

插入后内容里生成 \`![描述](/api/attachments/{id})\`，
链接按 ID 寻址，笔记怎么移动图片都不会丢。`,
          },
          {
            title: "大文件与下载",
            body: `单个附件上限 200MB，支持 Range 请求：

- 视频可以拖进度条
- PDF 分段加载

只有图片（SVG 除外）/音频/视频/PDF 允许内联预览，其余一律强制下载，防止上传的 HTML 执行脚本。`,
          },
        ],
      },
      {
        title: "分享与协作",
        body: `顶栏「分享」生成免登录只读链接：

- 分享按笔记 ID 记录，移动/改名不影响已发出的链接
- 分享笔记的子树（子笔记及其附件）都在授权范围内
- 随时可在分享面板撤销`,
      },
      {
        title: "回收站与版本管理",
        body: `**回收站**：删除只是移入 \`docs/.trash\`，保留原位置信息；恢复时连带子笔记回到原处。

**版本**：手动快照，按时间戳排列：

- 保存不会自动备份，直接改当前文件
- 点「备份」才产生版本（每篇保留最近 50 个）
- 恢复某版本前，当前内容会先自动备份一份`,
      },
      {
        title: "快捷键",
        body: `\`Ctrl/Cmd + S\` 保存（编辑态）

其余操作以右键菜单和拖拽为主，刻意保持少快捷键。`,
      },
    ],
  },
  {
    title: "前端学习",
    body: "前端技术栈学习笔记，从 HTML 到 React，按依赖顺序排列。",
    children: [
      {
        title: "HTML 基础",
        body: "超文本标记语言：结构与语义。",
        children: [
          {
            title: "语义化标签",
            body: `用对的标签而不是一堆 div：

\`\`\`html
<article>
  <header><h1>标题</h1></header>
  <section>
    <p>正文……</p>
  </section>
  <footer>页脚</footer>
</article>
\`\`\`

语义化的收益：可访问性、SEO、代码可读性。`,
          },
          {
            title: "表单与校验",
            body: `原生校验够用的场景就不上 JS：

\`\`\`html
<input type="email" required placeholder="you@example.com" />
<input type="number" min="0" max="100" />
\`\`\`

复杂交互再考虑受控组件。`,
          },
        ],
      },
      {
        title: "CSS",
        body: "层叠样式表：布局、动画与工程化。",
        children: [
          {
            title: "布局（Flex/Grid）",
            body: `一维用 Flex，二维用 Grid：

\`\`\`css
.toolbar { display: flex; align-items: center; gap: 8px; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
\`\`\``,
          },
          {
            title: "动画与过渡",
            body: `过渡看 \`transition\`，关键帧看 \`animation\`：

\`\`\`css
.chevron { transition: transform 150ms ease; }
.chevron.open { transform: rotate(90deg); }
\`\`\`

侧边栏的展开箭头就是这个效果。`,
          },
        ],
      },
      {
        title: "JavaScript",
        body: "语言核心：类型、作用域、异步与模块。",
        children: [
          {
            title: "类型与作用域",
            body: `\`let\`/\`const\` 块级作用域，\`var\` 函数作用域（别再用）。

闭包的经典场景：

\`\`\`js
function counter() {
  let n = 0;
  return () => ++n;
}
\`\`\``,
          },
          {
            title: "异步编程（Promise/async）",
            body: `\`\`\`js
const notes = await fetch("/api/notes/tree").then((r) => r.json());
\`\`\`

错误处理：\`try/catch\` 包住 \`await\`，或 \`.catch()\` 链。
并行用 \`Promise.all\`，容错用 \`Promise.allSettled\`。`,
          },
          {
            title: "模块化",
            body: `ESM 是现在的事实标准：

\`\`\`js
import fs from "node:fs/promises";
export function scan() {}
\`\`\`

\`import()\` 动态导入可以做代码分割（编辑器就是 dynamic import 的）。`,
          },
        ],
      },
      {
        title: "TypeScript",
        body: "JS 的类型层，先类型后运行时。",
        children: [
          {
            title: "类型体操入门",
            body: `\`\`\`ts
type TreeNode = { id: string; children?: TreeNode[] };

type Flatten<T> = T extends { children?: (infer U)[] } ? T | Flatten<U> : T;
\`\`\`

看懂 \`infer\` 和递归类型就够了，别沉迷。`,
          },
          {
            title: "工具类型",
            body: `常用内置工具类型：

- \`Partial<T>\` / \`Required<T>\`
- \`Pick<T, K>\` / \`Omit<T, K>\`
- \`ReturnType<F>\`

\`satisfies\` 运算符可以在保留推断的同时校验字面量。`,
          },
        ],
      },
      {
        title: "React",
        body: "组件化 UI 库：Hooks、渲染模型与服务端组件。",
        format: "mdx",
        children: [
          {
            title: "Hooks 常用模式",
            format: "mdx",
            body: `状态放组件里，派生值用 useMemo，副作用收进 useEffect：

export const tips = ['状态最小化', '派生不存储', '副作用集中'];

<ul>
  {tips.map((t) => (
    <li key={t}>{t}</li>
  ))}
</ul>

> 列表渲染记得 key 稳定唯一。`,
          },
          {
            title: "性能优化",
            body: "先测量再优化：React DevTools Profiler 是第一站。",
            children: [
              {
                title: "memo 与依赖",
                body: `\`React.memo\` 只在 props 浅比较变化时重渲染；
\`useMemo\`/\`useCallback\` 稳定引用，配合 memo 才有意义。

依赖数组里放「真实依赖」，靠 lint 规则兜底，不要瞎瞒。`,
              },
            ],
          },
          {
            title: "服务端渲染 RSC",
            body: `RSC 的核心约束：**服务端组件的产物要能序列化**。

- 内容视图留在服务端渲染区
- 客户端交互（编辑器、对话框）单独拆成 "use client" 组件
- 函数/闭包不能跨边界传递

猫咪笔记的 MDX 渲染就是：服务端编译成函数体字符串，客户端求值。`,
          },
        ],
      },
    ],
  },
  {
    title: "后端与运维",
    body: "数据库、Linux、容器与网络基础。",
    children: [
      {
        title: "数据库",
        body: "关系型为主，索引与事务是永恒主题。",
        children: [
          {
            title: "SQL 索引原理",
            body: `B+ 树：非叶子节点只存键，叶子节点存数据并成链表。

- 联合索引遵循最左前缀
- 覆盖索引免回表
- 写多读少的表索引要克制

\`EXPLAIN\` 是最好的老师。`,
          },
          {
            title: "事务与隔离级别",
            body: `| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
| ---- | ---- | ---- | ---- |
| Read Committed | ✗ | ✓ | ✓ |
| Repeatable Read | ✗ | ✗ | ✓（InnoDB 基本避免） |
| Serializable | ✗ | ✗ | ✗ |`,
          },
        ],
      },
      {
        title: "Linux",
        body: "服务器日常：命令行与脚本。",
        children: [
          {
            title: "常用命令",
            body: `\`\`\`bash
ss -tlnp                 # 端口占用
journalctl -u nginx -f   # 跟服务日志
df -h && du -sh ./*      # 磁盘水位
\`\`\``,
          },
          {
            title: "Shell 脚本片段",
            body: `\`\`\`bash
# 批量重命名：空格换下划线
for f in *\ *; do mv "$f" "\${f// /_}"; done
\`\`\`

记得 \`set -euo pipefail\`。`,
          },
        ],
      },
      {
        title: "Docker",
        body: "镜像、容器与编排。",
        children: [
          {
            title: "镜像与容器",
            body: `\`\`\`bash
docker build -t notes:latest .
docker run -d -p 3000:3000 --name notes notes:latest
\`\`\`

镜像 = 分层只读模板；容器 = 镜像 + 可写层。`,
          },
          {
            title: "Compose 编排",
            body: `\`\`\`yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    volumes: ["./docs:/app/docs"]
\`\`\`

本地开发一条 \`docker compose up\` 拉起全部依赖。`,
          },
        ],
      },
      {
        title: "网络",
        body: "HTTP 与 TLS 的实用要点。",
        children: [
          {
            title: "HTTP 缓存",
            body: `强缓存：\`Cache-Control: max-age=31536000, immutable\`（带哈希的静态资源）
协商缓存：\`ETag\` / \`If-None-Match\` → 304

笔记附件用了 \`private, max-age=3600\`。`,
          },
          {
            title: "TLS 握手",
            body: `1. ClientHello（支持的套件+随机数）
2. ServerHello（选定套件+证书）
3. 密钥交换 → 会话密钥
4. 对称加密通信

TLS 1.3 把握手压缩到 1-RTT。`,
          },
        ],
      },
    ],
  },
  {
    title: "项目：猫咪笔记",
    body: "本笔记系统自己的开发文档——吃自己的狗粮。",
    children: [
      {
        title: "架构设计",
        body: `Bun + Next.js 16（Turbopack）+ Tailwind 4。

\`\`\`
浏览器 ── proxy.ts 鉴权 ── /notes/[id]（RSC 渲染）
                              └─ 客户端岛：编辑器 / 侧边栏 / 对话框
\`\`\`

MDX：服务端 @mdx-js/mdx 编译 → 客户端 mdx-runtime 求值（next-mdx-remote 同款架构，但不引那个包——它在 Windows + Turbopack 下会炸）。`,
      },
      {
        title: "存储模型 v2（虚拟文档树）",
        body: `核心决策：**文件系统是唯一真相源，没有数据库。**

- 笔记 = \`docs/notes/{id前2位}/{id}.md(x)\`，ID 为随机 12 位 hex，终身不变
- 层级/顺序 = 每篇笔记 frontmatter 的 \`parent\`/\`order\`
- 附件 = \`docs/files/{分桶}/{id}.{ext}\`，归属在属主笔记的 attachments 列表

否决过的方案：SQLite（git 二进制不可合并）、全局 map.json（整文件冲突）、每目录 jsonl（要维护嵌套层级）。`,
      },
      {
        title: "同步方案调研",
        body: "git 与 OSS 两条路线的对比结论。",
        children: [
          {
            title: "git 同步可行性",
            body: `结构随内容走，git 同步退化为纯文件同步：

- 创建 = 1 个新文件
- 移动 = 1 行 diff
- 改标题 = frontmatter 1 行
- 不同笔记的并发修改永不冲突

唯一的冲突点是同父下并发调序，冲突也只是几个数字。`,
          },
          {
            title: "OSS 对象存储选型",
            body: `按对象 mtime/hash 对账，markdown 天然可增量同步。

注意：回收站放在 \`docs/.trash\` 内部（同步的一部分），
否则 A 设备删除会被 B 设备的旧文件"复活"。`,
          },
        ],
      },
      {
        title: "踩坑记录",
        body: `- MDXEditor 缺 codeBlockPlugin 时导入在第一个代码围栏处静默截断
- next-mdx-remote 在 Windows + Turbopack 触发 junction panic（os error 80）
- 迁移期间调用带闸门的 refresh() 会自等待死锁
- 增量缓存必须逐文件比对 mtime，不能只看路径存在
- 版本文件名排序要先去 .md 后缀再 Number()（NaN 陷阱）`,
      },
      {
        title: "路线图",
        body: `- [x] 虚拟文档树 + 拖拽
- [x] 回收站与版本管理
- [ ] git / OSS 同步
- [ ] 全文搜索（SQLite FTS 派生索引）
- [ ] 双链与反向链接（基于笔记 ID）`,
      },
    ],
  },
  {
    title: "生活随笔",
    body: "工作之外的部分。",
    children: [
      {
        title: "读书清单",
        body: `| 书 | 状态 | 评分 |
| ---- | ---- | ---- |
| 《代码大全》 | 重读中 | ★★★★★ |
| 《清晰思考的艺术》 | 已读 | ★★★★ |
| 《置身事内》 | 已读 | ★★★★★ |`,
      },
      {
        title: "咖啡笔记",
        body: `手冲参数备忘：

- 粉水比 1:15（15g 粉 / 225g 水）
- 水温 90-93°C，浅烘偏高
- 三段式注水：闷蒸 30g → 绕圈到 150g → 补到 225g

研磨度按豆子调整，先固定其他变量再动一个。`,
      },
      {
        title: "健身计划",
        body: `每周三练，推/拉/腿循环：

1. 推：卧推 5×5 + 肩推 3×8 + 绳索下压 3×12
2. 拉：硬拉 3×5 + 划船 4×8 + 引体 3×力竭
3. 腿：深蹲 5×5 + 罗马尼亚硬拉 3×8 + 提踵 3×15

渐进超负荷，每周加 2.5kg 或 1 次。`,
      },
    ],
  },
  {
    title: "每日站会模板",
    body: `- 昨天：
- 今天：
- 阻塞：

保持 15 分钟内结束，细节会后单聊。`,
  },
  {
    title: "常用工具清单",
    body: `- 终端：Windows Terminal + Git Bash
- 编辑：VS Code / ZCode
- 抓包：F12 就够，复杂场景 mitmproxy
- 图床：直接丢笔记附件里

工具服务于流程，别反过来。`,
  },
];

let created = 0;

async function createLevel(specs: Spec[], parentId: string | null): Promise<void> {
  for (const spec of specs) {
    const node: TreeNode = await createNote({
      parentId,
      title: spec.title,
      format: spec.format ?? "md",
    });
    // 写入真实内容（createNote 生成的是标题模板）
    const { writeNote } = await import("../src/lib/store");
    await writeNote(node.id, spec.body.trim() + "\n");
    created += 1;
    if (spec.children) {
      await createLevel(spec.children, node.id);
    }
  }
}

await createLevel(SPEC, null);

// 两个示例附件（挂在指定笔记下，展示树里的附件节点）
const tree = await (await import("../src/lib/store")).getTree();
const findByTitle = (nodes: TreeNode[], title: string): TreeNode | null => {
  for (const node of nodes) {
    if (node.title === title) {
      return node;
    }
    const found = node.children ? findByTitle(node.children, title) : null;
    if (found) {
      return found;
    }
  }
  return null;
};

const quickStart = findByTitle(tree, "快速上手");
if (quickStart) {
  await addAttachment(
    quickStart.id,
    "markdown-cheatsheet.csv",
    Buffer.from("语法,示例,备注\n标题,# 一级,支持到六级\n列表,- item,或 * item\n表格,| a | b |,GFM\n", "utf8")
  );
}
const roadmap = findByTitle(tree, "路线图");
if (roadmap) {
  await addAttachment(
    roadmap.id,
    "release-notes.txt",
    Buffer.from("v0.1 基架与渲染\nv0.2 虚拟文档树+拖拽\nv0.3 回收站+版本管理\n", "utf8")
  );
}

console.log(`✅ 已创建 ${created} 篇笔记 + 2 个附件`);
