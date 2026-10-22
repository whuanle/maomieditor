# maomiedtor · 猫咪笔记

基于 **Bun + Next.js 16** 的个人在线笔记系统。Trilium 式虚拟文档树（文档下可无限挂文档），笔记为 `docs/notes/` 下按 ID 存放的 `.md` / `.mdx` 文件，支持附件挂载、拖拽整理、公开分享与在线编辑，为 git / OSS 同步而生。

## 快速开始

```bash
bun install

# 配置账号（首次会生成随机密码，见 .env.local）
#   AUTH_USERNAME  用户名
#   AUTH_PASSWORD  密码
#   AUTH_SECRET    会话签名密钥（随机长字符串）

bun run dev        # http://localhost:3000
bun run build && bun run start   # 生产模式
```

## 存储模型（v3 旁挂元数据）

- **笔记正文 = 纯 markdown**：`docs/notes/{id前2位}/{id}.md(x)`，文件名即 ID（创建时随机 12 位 hex，终身不变）——外部上传或手工投放的文件**一个字节都不会被改动**
- **结构元数据 = 同目录同名 `.yaml` 旁挂文件**（id/title/parent/order/attachments），层级与顺序的唯一真相；元数据改动和内容改动在不同文件里，git 合并永不冲突
- **附件 = 独立 blob**：`docs/files/{id前2位}/{id}.{ext}`，归属记录在属主笔记的 yaml 里（可下载、不参与渲染）
- **URL 即 ID**：`/notes/{id}`，改标题、拖动位置都不会让链接失效
- 自愈：yaml 缺失自动生成（笔记落到根级末尾）；文件名不是合法 ID 会自动改名收编；上传/投放的 md 自带 frontmatter（如 Obsidian 的 title/tags）原样保留，展示标题取 sidecar > 用户 frontmatter > 首个 `#` 标题；旧版「frontmatter 内嵌结构字段」的笔记扫描时自动拆分为 yaml + 纯正文

## 功能

- **多标签页**：顶部标签栏多开文档、随时切换；每页记住是否在编辑态，刷新后标签自动恢复（localStorage）；关闭标签自动激活相邻标签
- **自动保存**：编辑即保存——停止输入约 0.8 秒后自动写盘，切换标签/关闭页面前兜底冲刷草稿；工具栏只显示状态（"已自动保存 HH:MM:SS"），无需手动点保存（Ctrl+S 仍可立即触发）
- **文档树**：文档下可继续挂文档；右键新建子笔记 / 上传文件 / 分享 / 重命名标题 / 删除（移入回收站，可恢复）
- **上传即入库**：上传 `.md` / `.mdx` 直接建为该笔记的子笔记（内容原样、不改一个字节）；其他文件作为附件挂载。**可以直接把本地文件拖进侧边栏**——拖到哪个笔记上就挂到哪里（不限类型），拖到空白处可导入 md/mdx 到根级；编辑器里粘贴图片自动保存为附件并插入
- **本地编辑器兼容的图片引用**：内容里写的是 `../../files/{分桶}/{附件ID}.{ext}` 相对路径——Typora/VS Code/Obsidian 等本地工具直接打开 `docs/notes/` 下的 md 就能渲染图片；Web 端渲染管线自动还原成 `/api/attachments/{id}`（分享页为其公开变体），Web 编辑器预览走 `/files/{分桶}/{id}.{ext}` 兼容路由，三端同一份引用
- **附件引用按 ID 寻址**：移动笔记、外部编辑器直接改 md 文件，引用都不会失效
- **拖拽整理**：拖到笔记中段 = 挂为其子笔记；拖到上/下边缘 = 同级排序；拖到底部虚线框 = 移到根级。排序只改被拖笔记 yaml 里的一个数字，正文文件不动
- **回收站**：删除 = 移入 `docs/.trash`（随内容同步，多设备删除语义一致），保留原 parent/order；恢复时连带子笔记回到原位置，父级已不存在则挂到根级；支持单篇彻底删除与清空
- **版本管理**：手动备份当前已保存内容（`.data/versions/{noteId}/{毫秒时间戳}.md`，每篇保留最近 50 个）；保存不会自动备份（直接修改当前文件）；恢复版本前当前内容自动先备份一份；恢复只回滚正文，结构元数据不受影响
- **编辑器**：MDXEditor 富文本编辑（工具栏、表格/列表/链接可视化编辑），支持「源码/差异」模式切换（复杂语法兜底），粘贴图片自动上传为附件并插入；正文与元数据彻底分离，保存无需任何强制回写
- **渲染**：GFM、代码高亮（PrismJS）、Mermaid、KaTeX 数学公式、代码 Tab 组、图片缩放、视频播放
- **分享**：`/share/{token}` 免登录只读页，按笔记 ID 存取（移动/改名不受影响），可随时撤销；分享笔记子树内（含子笔记）的附件均在授权范围
- **主题**：亮 / 暗 / 跟随系统（切换入口在侧边栏底部）
- **布局**：无全局头部，内容区与侧边栏对顶对齐；侧边栏宽度可拖拽调整（双击分隔条复位，记忆在浏览器本地）
- **鉴权**：HMAC 签名 Cookie 会话（30 天），`src/proxy.ts` 统一拦截；可选 TOTP 两步验证（设置 → MFA 认证，验证器 App 扫码绑定，开启后登录需输入 6 位动态码）

## 目录结构

```
docs/
  notes/ab/abcd1234ef56.md    笔记正文（纯 markdown，按 ID 前 2 位分桶）
  notes/ab/abcd1234ef56.yaml  结构元数据（id/title/parent/order/attachments）
  files/9f/9f31...8c.png      附件 blob
  .trash/                     回收站（随内容同步）
.data/           运行时数据（分享记录、版本快照、迁移标记、旧数据备份；本机保存）
src/app/
  login/         登录页
  notes/[id]/    笔记工作台（需登录，URL 为笔记 ID）
  share/[token]/ 公开分享页（免登录）
  api/           auth（登录/登出/密码/MFA 两步验证） / notes / notes/file / attachments / upload / shares / trash / versions / public
src/components/  渲染组件（同步自 maomi-docs）+ 工作台组件
src/lib/         store（虚拟树存储层+回收站）、versions（版本快照）、auth、share、路径安全
```

## 编辑器说明

- 富文本模式为主（Notion 式），工具栏可切「Rich text / Diff / Source mode」
- 代码块由内嵌 CodeMirror 编辑，fence meta（如 `tab="TypeScript" default`）在往返保存中保留
- 图片：工具栏插入或直接粘贴，自动上传为当前笔记的附件并插入 `/api/attachments/{id}` 引用
- 含内嵌 HTML / MDX `export` 语句的复杂笔记建议切 Source mode 编辑，保存不经过富文本规范化
- 富文本保存会做语义等价的格式规范化（如列表 `-` 改 `*`、表格对齐重排），内容不会丢失

## 笔记内链接规则

- `[标题](/notes/{id})` → 站内笔记（ID 永不失效；旧版相对 `.md` 链接在迁移时已自动改写）
- `![图片](/api/attachments/{id})` → 附件引用（编辑器粘贴图片自动生成）

## 安全说明

- 上传文件仅按附件处理：除图片/视频/音频/PDF 外一律强制下载（`Content-Disposition: attachment`），不会内联执行
- 分享页只能访问分享笔记子树内笔记挂载的附件
- 所有笔记路由（`/notes`、`/api/notes`、`/api/attachments`、`/api/shares`、`/api/upload`）均要求登录
- 两步验证（TOTP，RFC 6238）：绑定密钥存 `.data/mfa.json`，校验允许 ±30 秒时钟偏差且同一验证码不可重复使用；密码通过后仅发放 5 分钟有效的挑战令牌，验证码通过才建立会话。丢失验证器时删除该文件即可重置回仅密码登录

## 后续规划

- git / OSS 同步（纯文件模型已就绪：结构随内容走，无独立状态需对账）
- 全文搜索（SQLite FTS 派生索引，可随时从文件重建）
- 双链 / 反向链接（基于笔记 ID）
