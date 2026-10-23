/**
 * 性能压测数据生成器：直接往 docs/notes/ 写入 md + 旁挂 yaml（存储层自愈机制会收编外部文件）。
 *
 * 用法：
 *   bun scripts/generate-perf-notes.mjs                # 默认生成 3000 篇
 *   bun scripts/generate-perf-notes.mjs --count 5000   # 指定数量
 *   bun scripts/generate-perf-notes.mjs --clean        # 按 .data/perf-notes.json 清掉全部压测笔记
 *
 * 结构：1 个「压测数据集」根笔记 → 25 个章节 → 每章节 8 个分组 → 分组下挂剩余全部叶子笔记。
 * 所有 ID 记录在 .data/perf-notes.json，--clean 按它精确删除，不碰用户自己的笔记。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

const ROOT_DIR = process.cwd();
const NOTES_DIR = path.join(ROOT_DIR, "docs", "notes");
const MANIFEST_PATH = path.join(ROOT_DIR, ".data", "perf-notes.json");

function parseArgs(argv) {
  const args = { count: 3000, clean: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--count") args.count = Number(argv[++i]);
    else if (argv[i] === "--clean") args.clean = true;
  }
  if (!Number.isInteger(args.count) || args.count < 1) {
    console.error("--count 必须是正整数");
    process.exit(1);
  }
  return args;
}

/** 12 位小写 hex，与存储层 ID_RE 一致，进程内去重 */
function newId(used) {
  let id;
  do {
    id = randomBytes(6).toString("hex");
  } while (used.has(id));
  used.add(id);
  return id;
}

const TOPICS = [
  "Kubernetes 编排实践", "PostgreSQL 索引优化", "React 渲染性能调优", "Vditor 编辑器集成",
  "Next.js 服务端渲染", "Docker 镜像分层缓存", "Redis 缓存穿透", "Git 分支管理策略",
  "TypeScript 类型体操", "WebGL 着色器入门", "Nginx 反向代理配置", "消息队列削峰填谷",
  "分布式锁的三种实现", "Markdown 渲染管线", "前端监控上报方案", "灰度发布流程",
  "单元测试覆盖率", "SQLite 并发写入", "CSS 容器查询", "HTTP/2 多路复用",
  "正则表达式回溯陷阱", "文件系统 mtime 缓存", "YAML 旁挂元数据", "回收站与版本备份",
  "全文搜索的分词", "虚拟列表滚动优化", "Web Worker 实践", "懒加载与代码分割",
  "错误边界与降级", "日志采集与轮转",
];

const PARAGRAPHS = [
  "这篇笔记用于压测：大量文档下目录树扫描、侧边栏渲染、搜索与正文打开的速度表现。内容本身由脚本生成，包含常见的 Markdown 元素，尽量贴近真实笔记的密度。",
  "在虚拟文档树模型里，层级与顺序的唯一真相是旁挂 yaml，正文永远只是干净的 Markdown。元数据改动和内容改动落在不同文件，git 合并不会冲突。",
  "扫描层按 mtime 和文件大小做增量缓存，只有发生变化的文件才会重新解析。首次全量扫描之后，后续请求都是读缓存，理论上不会随着文档数量线性变慢。",
  "URL 就是笔记 ID：改标题、拖动位置都不会改变身份或链接。删除的笔记进入回收站目录，随内容一起被同步，恢复时回到原来的位置。",
  "编辑器使用所见即所得模式，正文保存前会做一轮规范化。目录面板从正文标题里提取锚点，剔除标记符号后生成层级列表。",
  "附件挂在笔记下面，出现在目录树里，点击即下载，不参与渲染。编辑器里粘贴的图片走同一套附件系统，归属记录在属主笔记的 yaml 里。",
];

function makeBody(seq, topic, heavy) {
  const parts = [];
  parts.push(`# 压测 ${seq}｜${topic}`);
  parts.push(PARAGRAPHS[seq % PARAGRAPHS.length]);

  const sections = heavy ? 12 : 4;
  for (let s = 1; s <= sections; s++) {
    parts.push(`\n## ${s}. ${topic}——章节 ${seq}-${s}`);
    parts.push(PARAGRAPHS[(seq + s) % PARAGRAPHS.length]);

    parts.push("\n要点列表：");
    for (let k = 1; k <= 5; k++) {
      parts.push(`- 条目 ${k}：${topic}的第 ${k} 个观察点，用于填充列表渲染压力`);
    }

    parts.push(`\n### ${s}.1 示例代码`);
    parts.push("```ts");
    parts.push(`interface Sample${seq}_${s} {`);
    for (let k = 1; k <= 4; k++) {
      parts.push(`  field${k}: string; // ${topic} 字段 ${k}`);
    }
    parts.push("}");
    parts.push("");
    parts.push(`const sample${seq}${s} = (input: Partial<Sample${seq}_${s}>): Sample${seq}_${s} => ({`);
    for (let k = 1; k <= 4; k++) {
      parts.push(`  field${k}: input.field${k} ?? "default-${k}",`);
    }
    parts.push("});");
    parts.push("```");

    parts.push(`\n### ${s}.2 数据表`);
    parts.push("| 指标 | 数值 | 说明 |");
    parts.push("| ---- | ---- | ---- |");
    for (let k = 1; k <= 6; k++) {
      parts.push(`| metric_${k} | ${(seq * s * k) % 9973} | ${topic}采样点 ${k} |`);
    }

    parts.push(`\n> 引用块：${PARAGRAPHS[(seq * 2 + s) % PARAGRAPHS.length].slice(0, 40)}……`);
    if (s % 2 === 0) {
      parts.push(`\n#### 补充说明 ${seq}-${s}`);
      parts.push(PARAGRAPHS[(seq + s * 3) % PARAGRAPHS.length]);
      parts.push(`\n1. 有序列表一\n2. 有序列表二\n3. 有序列表三`);
    }
  }
  parts.push(`\n---\n\n*压测文档 #${seq}，生成于 ${new Date().toISOString()}*`);
  return parts.join("\n");
}

async function writeNote(id, title, parent, order, body) {
  const dir = path.join(NOTES_DIR, id.slice(0, 2));
  const mdPath = path.join(dir, `${id}.md`);
  const yamlPath = path.join(dir, `${id}.yaml`);
  // JSON.stringify 的双引号转义是合法的 YAML 标量写法，中文/冒号都安全
  const yaml = `id: ${id}\ntitle: ${JSON.stringify(title)}\nparent: ${parent ? JSON.stringify(parent) : "null"}\norder: ${order}\nattachments: []\n`;
  await fs.mkdir(dir, { recursive: true });
  await Promise.all([fs.writeFile(mdPath, body, "utf8"), fs.writeFile(yamlPath, yaml, "utf8")]);
}

async function writeAll(jobs) {
  const BATCH = 64;
  for (let i = 0; i < jobs.length; i += BATCH) {
    await Promise.all(jobs.slice(i, i + BATCH).map((job) => job()));
  }
}

async function clean() {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
  } catch {
    console.error("找不到 .data/perf-notes.json（或已损坏），无法确定要删除哪些压测笔记");
    process.exit(1);
  }
  let removed = 0;
  for (const id of manifest.ids) {
    const dir = path.join(NOTES_DIR, id.slice(0, 2));
    await Promise.all([
      fs.rm(path.join(dir, `${id}.md`), { force: true }),
      fs.rm(path.join(dir, `${id}.yaml`), { force: true }),
    ]);
    try {
      await fs.rmdir(dir); // 非空会抛错，忽略即可
    } catch {}
    removed++;
  }
  await fs.rm(MANIFEST_PATH, { force: true });
  console.log(`已删除 ${removed} 篇压测笔记（${manifest.ids.length} 个 ID）`);
}

async function main() {
  const { count, clean: doClean } = parseArgs(process.argv.slice(2));
  if (doClean) {
    await clean();
    return;
  }

  let existingIds = [];
  try {
    existingIds = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")).ids ?? [];
  } catch {}
  if (existingIds.length > 0) {
    console.log(`提示：已有 ${existingIds.length} 篇压测笔记，将追加生成（先 --clean 可全部重来）`);
  }

  const used = new Set(existingIds);
  const records = []; // { id, title, parent, order }
  const t0 = Date.now();

  // 结构：根 → 章节(25) → 分组(每章节 8 个) → 叶子均摊
  const root = newId(used);
  records.push({ id: root, title: "🧪 压测数据集", parent: null, order: 990000 });

  const SECTIONS = Math.min(25, Math.max(1, Math.round(count / 120)));
  const GROUPS_PER_SECTION = 8;
  const sections = [];
  for (let s = 0; s < SECTIONS; s++) {
    const sec = newId(used);
    sections.push(sec);
    records.push({ id: sec, title: `压测章节 ${s + 1}`, parent: root, order: (s + 1) * 100 });
  }
  const groups = [];
  for (let s = 0; s < SECTIONS; s++) {
    for (let g = 0; g < GROUPS_PER_SECTION; g++) {
      const grp = newId(used);
      groups.push({ id: grp, parent: sections[s] });
      records.push({
        id: grp,
        title: `压测分组 ${s + 1}-${g + 1}`,
        parent: sections[s],
        order: (g + 1) * 10,
      });
    }
  }

  const leafCount = Math.max(0, count - records.length);
  const jobs = [];
  for (let i = 0; i < leafCount; i++) {
    const id = newId(used);
    const group = groups[i % groups.length];
    const seq = existingIds.length + i + 1;
    const topic = TOPICS[seq % TOPICS.length];
    const heavy = seq % 20 === 0; // 5% 大文档
    const title = `压测 ${seq}｜${topic}`;
    records.push({ id, title, parent: group.parent, order: seq * 100 });
    // 叶子实际挂在分组下
    records[records.length - 1].parent = group.id;
    records[records.length - 1].order = Math.floor(i / groups.length) * 100;
    jobs.push(() => writeNote(id, title, group.id, Math.floor(i / groups.length) * 100, makeBody(seq, topic, heavy)));
  }
  // 根/章节/分组三个骨架也要落盘
  for (const rec of records.slice(0, records.length - leafCount)) {
    jobs.push(() =>
      writeNote(rec.id, rec.title, rec.parent, rec.order, makeBody(1, "结构节点", false).replace(/^# .*/m, `# ${rec.title}`)),
    );
  }

  await writeAll(jobs);

  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await fs.writeFile(
    MANIFEST_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), ids: [...used] }, null, 2),
    "utf8",
  );

  console.log(`生成完成：${records.length} 篇笔记（叶子 ${leafCount}，章节 ${SECTIONS}，分组 ${groups.length}），耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`清单：.data/perf-notes.json（--clean 按它删除）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
