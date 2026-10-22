/**
 * 外观设置（参考 Trilium）：字体 / 正文排版 / 内容宽度 / 界面缩放 / 动效性能。
 * 落到 <html> 的 CSS 变量与类名上，实时生效；事实源是服务端 .data/settings.json
 * （settings-store.ts），浏览器只留一份非敏感 cookie 缓存；SETTINGS_INIT_SCRIPT
 * 在首帧前读取 cookie 应用（外观 + 配色模式），避免刷新闪烁。
 * 注意：本模块被服务端布局（取 INIT_SCRIPT 字符串）与客户端组件共同引用，必须保持纯浏览器安全代码。
 */

export interface AppearanceSettings {
  /** 界面字体（key，"" = 跟随主题） */
  uiFont: string;
  /** 正文字体（key，"" = 跟随界面） */
  proseFont: string;
  /** 等宽字体（key，"" = 跟随主题） */
  monoFont: string;
  /** 正文字号 px（同时按 em 比例带动标题/代码字号） */
  proseFontSize: number;
  /** 正文行高 */
  proseLineHeight: "compact" | "normal" | "relaxed";
  /** 内容最大宽度 */
  contentWidth: "narrow" | "medium" | "wide" | "full";
  /** 内容居中（否则左对齐铺满） */
  centerContent: boolean;
  /** 界面缩放（html zoom） */
  uiZoom: number;
  /** 过渡和动画 */
  animations: boolean;
  /** 阴影 */
  shadows: boolean;
  /** 弹窗/菜单毛玻璃背景效果 */
  glassEffects: boolean;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  uiFont: "",
  proseFont: "",
  monoFont: "",
  proseFontSize: 16,
  proseLineHeight: "normal",
  contentWidth: "full",
  centerContent: false,
  uiZoom: 1,
  animations: true,
  shadows: true,
  glassEffects: true,
};

/** 字体选项：label 展示、stack 落到 CSS 变量（按 Windows 常见字体挑选，缺失自动回退） */
export const UI_FONT_OPTIONS: { key: string; label: string; stack: string }[] = [
  { key: "", label: "跟随主题", stack: "" },
  { key: "yahei", label: "微软雅黑", stack: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif' },
  { key: "song", label: "宋体（衬线）", stack: 'SimSun, "Songti SC", Serif, serif' },
  { key: "kai", label: "楷体", stack: 'KaiTi, "Kaiti SC", "STKaiti", serif' },
  { key: "fangsong", label: "仿宋", stack: 'FangSong, "Fangsong SC", serif' },
];

export const PROSE_FONT_OPTIONS: { key: string; label: string; stack: string }[] = [
  { key: "", label: "跟随界面字体", stack: "" },
  { key: "yahei", label: "微软雅黑", stack: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif' },
  { key: "song", label: "宋体（衬线）", stack: 'SimSun, "Songti SC", Serif, serif' },
  { key: "kai", label: "楷体", stack: 'KaiTi, "Kaiti SC", "STKaiti", serif' },
  { key: "hei", label: "黑体", stack: '"Heiti SC", SimHei, "Microsoft YaHei", sans-serif' },
];

export const MONO_FONT_OPTIONS: { key: string; label: string; stack: string }[] = [
  { key: "", label: "跟随主题", stack: "" },
  { key: "consolas", label: "Consolas", stack: 'Consolas, "SF Mono", Monaco, monospace' },
  { key: "cascadia", label: "Cascadia Code", stack: '"Cascadia Code", "Cascadia Mono", Consolas, monospace' },
  { key: "jetbrains", label: "JetBrains Mono", stack: '"JetBrains Mono", "Cascadia Code", Consolas, monospace' },
  { key: "courier", label: "Courier New", stack: '"Courier New", Courier, monospace' },
];

export const CONTENT_WIDTH_OPTIONS: { key: AppearanceSettings["contentWidth"]; label: string; value: string }[] = [
  { key: "narrow", label: "紧凑", value: "720px" },
  { key: "medium", label: "标准", value: "900px" },
  { key: "wide", label: "宽敞", value: "1100px" },
  { key: "full", label: "不限制", value: "none" },
];

export const LINE_HEIGHT_OPTIONS: { key: AppearanceSettings["proseLineHeight"]; label: string; value: string }[] = [
  { key: "compact", label: "紧凑", value: "1.6" },
  { key: "normal", label: "标准", value: "1.75" },
  { key: "relaxed", label: "宽松", value: "2.05" },
];

export const ZOOM_OPTIONS: { label: string; value: number }[] = [
  { label: "80%", value: 0.8 },
  { label: "90%", value: 0.9 },
  { label: "100%", value: 1 },
  { label: "110%", value: 1.1 },
  { label: "125%", value: 1.25 },
  { label: "150%", value: 1.5 },
];

function findStack(options: { key: string; stack: string }[], key: string | undefined): string {
  if (!key) {
    return "";
  }
  return options.find((option) => option.key === key)?.stack ?? "";
}

export function clampSettings(raw: Partial<AppearanceSettings> | null | undefined): AppearanceSettings {
  const merged = { ...DEFAULT_APPEARANCE, ...(raw ?? {}) };
  return {
    ...merged,
    uiFont: typeof merged.uiFont === "string" ? merged.uiFont : "",
    proseFont: typeof merged.proseFont === "string" ? merged.proseFont : "",
    monoFont: typeof merged.monoFont === "string" ? merged.monoFont : "",
    proseFontSize: Math.min(22, Math.max(14, Number(merged.proseFontSize) || DEFAULT_APPEARANCE.proseFontSize)),
    proseLineHeight: LINE_HEIGHT_OPTIONS.some((o) => o.key === merged.proseLineHeight)
      ? merged.proseLineHeight
      : DEFAULT_APPEARANCE.proseLineHeight,
    contentWidth: CONTENT_WIDTH_OPTIONS.some((o) => o.key === merged.contentWidth)
      ? merged.contentWidth
      : DEFAULT_APPEARANCE.contentWidth,
    centerContent: Boolean(merged.centerContent),
    uiZoom: ZOOM_OPTIONS.some((o) => o.value === merged.uiZoom) ? merged.uiZoom : 1,
    animations: Boolean(merged.animations),
    shadows: Boolean(merged.shadows),
    glassEffects: Boolean(merged.glassEffects),
  };
}

/** 把设置落到 <html>：CSS 变量 + 类名 + zoom。客户端任何改动后调用即实时生效。 */
export function applyAppearance(settings: AppearanceSettings): void {
  const root = document.documentElement;
  const style = root.style;
  const setVar = (name: string, value: string) => {
    if (value) {
      style.setProperty(name, value);
    } else {
      style.removeProperty(name);
    }
  };

  setVar("--ui-font-family", findStack(UI_FONT_OPTIONS, settings.uiFont));
  setVar("--prose-font-family", findStack(PROSE_FONT_OPTIONS, settings.proseFont));
  setVar("--mono-font-family", findStack(MONO_FONT_OPTIONS, settings.monoFont));
  setVar("--prose-font-size", `${settings.proseFontSize}px`);
  setVar("--prose-line-height", LINE_HEIGHT_OPTIONS.find((o) => o.key === settings.proseLineHeight)?.value ?? "");
  setVar("--content-max-width", CONTENT_WIDTH_OPTIONS.find((o) => o.key === settings.contentWidth)?.value ?? "");

  root.classList.toggle("content-centered", settings.centerContent);
  root.classList.toggle("anim-off", !settings.animations);
  root.classList.toggle("shadow-off", !settings.shadows);
  root.classList.toggle("glass-off", !settings.glassEffects);

  style.zoom = settings.uiZoom === 1 ? "" : String(settings.uiZoom);
}

/**
 * 首帧前应用的内联脚本（防刷新闪烁）：读取 cookie 缓存 notes_settings_cache，
 * 应用外观变量与配色模式类名。与 applyAppearance/applyTheme 保持同一套逻辑的精简版，
 * 由根布局注入 <head>；只能用 ES5 语法与直接量（不 import 本模块）。
 */
export const SETTINGS_INIT_SCRIPT = `(function(){try{
var d=document.documentElement,s=d.style,c=d.classList;
function st(k,v){if(v)s.setProperty(k,v);else s.removeProperty(k);}
function fs(o,k){for(var i=0;i<o.length;i++)if(o[i][0]===k)return o[i][1];return"";}
var UI=[["",''],["yahei",'"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif'],["song",'SimSun, "Songti SC", Serif, serif'],["kai",'KaiTi, "Kaiti SC", "STKaiti", serif'],["fangsong",'FangSong, "Fangsong SC", serif']];
var PR=[["",''],["yahei",'"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif'],["song",'SimSun, "Songti SC", Serif, serif'],["kai",'KaiTi, "Kaiti SC", "STKaiti", serif'],["hei",'"Heiti SC", SimHei, "Microsoft YaHei", sans-serif']];
var MO=[["",''],["consolas",'Consolas, "SF Mono", Monaco, monospace'],["cascadia",'"Cascadia Code", "Cascadia Mono", Consolas, monospace'],["jetbrains",'"JetBrains Mono", "Cascadia Code", Consolas, monospace'],["courier",'"Courier New", Courier, monospace']];
var CW=[["narrow","720px"],["medium","900px"],["wide","1100px"],["full","none"]];
var LH=[["compact","1.6"],["normal","1.75"],["relaxed","2.05"]];
var ZM=[0.8,0.9,1,1.1,1.25,1.5];
var v="";var m=document.cookie.match(/(?:^|; )notes_settings_cache=([^;]*)/);
if(m){try{v=decodeURIComponent(m[1])}catch(e){v=m[1]}}
var a={};try{a=JSON.parse(v||"{}")||{}}catch(e){a={}}
var p=a.appearance||a;
st("--ui-font-family",fs(UI,p.uiFont));
st("--prose-font-family",fs(PR,p.proseFont));
st("--mono-font-family",fs(MO,p.monoFont));
st("--prose-font-size",(Math.min(22,Math.max(14,+p.proseFontSize||16)))+"px");
st("--prose-line-height",fs(LH,p.proseLineHeight||"normal"));
st("--content-max-width",fs(CW,p.contentWidth||"full"));
c.toggle("content-centered",!!p.centerContent);
c.toggle("anim-off",p.animations===false);
c.toggle("shadow-off",p.shadows===false);
c.toggle("glass-off",p.glassEffects===false);
var z=+p.uiZoom;
s.zoom=(ZM.indexOf(z)>-1&&z!==1)?String(z):"";
var t=a.theme;var r=(t==="light"||t==="dark")?t:((window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light");
if(r==="dark")c.add("dark");else c.remove("dark");
}catch(e){}})();`;
