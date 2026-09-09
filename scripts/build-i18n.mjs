// build-i18n.mjs — 将「按语种拆分」的字典源文件合并成最终注入脚本 public/webui-i18n.js
//
// 设计：
//   - i18n-engine.js  : 注入脚本的「引擎 + 模板」，内含 /*__LANGS__*/ 占位符（不再内联任何语种数据）
//   - i18n-data/<lang>.js : 每个语种一个片段文件，内容为 `<langKey>: dict({...strings}, [...patterns]),`
//                           （当前保留 zh-CN/zh-TW/ja/ko 四种；de/es/fr/pt/ru 已移除）
//   - 本脚本把各语种片段拼进 i18n-engine.js 的占位符，写出 public/webui-i18n.js（自包含、无 import）
//
// 为什么这样拆：注入脚本运行在 llama-server 的 iframe 内（与我们的 dev/tauri 主机跨源），
// 运行时无法按 ?lang 去 fetch 独立文件（跨源 404）。因此「最终产物仍是单文件」以保证可用，
// 但「源码按语种拆分」以满足可维护性——由本脚本在构建期合并。
//
// 首次运行（i18n-engine.js 不存在）会从当前的单文件 public/webui-i18n.js 引导提取：
//   - 引擎部分（LANGS 之前 + 之后）写入 i18n-engine.js
//   - zh-CN 条目原样写入 i18n-data/zh-CN.js
// 引导仅执行一次；之后 public/webui-i18n.js 变为合并产物，不再触发引导。
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENGINE = path.join(ROOT, 'i18n-engine.js');
const DATA_DIR = path.join(ROOT, 'i18n-data');
const OUT = path.join(ROOT, 'public', 'webui-i18n.js');

// 与 i18n-engine.js 内 setLang / SUPPORTED 对应的语种顺序；决定合并后 LANGS 的键顺序。
// 简体中文键为 zh-CN（BCP-47），与宿主 HTML_LANG['zh']='zh-CN' 对齐。
const ORDER = ['zh-CN', 'zh-TW', 'ja', 'ko'];

function bootstrap() {
  const src = path.join(ROOT, 'public', 'webui-i18n.js');
  const text = fs.readFileSync(src, 'utf8');
  if (!text.includes('const LANGS = {')) {
    throw new Error('bootstrap: public/webui-i18n.js 已不是单文件形式，无法引导提取。请手动提供 i18n-engine.js。');
  }
  const lines = text.split(/\r?\n/);
  const idxLANGS = lines.findIndex((l) => l.trim().startsWith('const LANGS = {'));
  const idxATTR = lines.findIndex((l) => l.trim().startsWith('const ATTRS = ['));
  if (idxLANGS < 0 || idxATTR < 0) throw new Error('bootstrap: 找不到 LANGS / ATTRS 锚点');

  const engineA = lines.slice(0, idxLANGS).join('\n');
  const engineB = lines.slice(idxATTR).join('\n');

  // zh-CN 条目：LANGS 内第一个条目，到首个空占位 `dict(),` 之前结束（其余语种当前均为空占位）
  const idxZhStart = lines.findIndex((l, i) => i > idxLANGS && /'?\bzh-CN\b'?\s*:\s*dict\(/.test(l));
  if (idxZhStart < 0) throw new Error('bootstrap: 找不到 zh-CN 条目');
  const emptyRe = /^\s*('?[\w-]+'?)?:?\s*dict\(\),?\s*$/;
  const idxEmpty = lines.findIndex((l, i) => i > idxZhStart && emptyRe.test(l.trim()));
  const zhEnd = idxEmpty > idxZhStart ? idxEmpty : idxATTR;
  const zhSnippet = lines.slice(idxZhStart, zhEnd).join('\n');

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ENGINE, engineA + '\n  const LANGS = { /*__LANGS__*/ };\n' + engineB);
  fs.writeFileSync(path.join(DATA_DIR, 'zh-CN.js'), zhSnippet);
  console.log('[bootstrap] 已生成 i18n-engine.js 与 i18n-data/zh-CN.js');
}

function ensureStub(lang) {
  const f = path.join(DATA_DIR, `${lang}.js`);
  if (fs.existsSync(f)) return;
  // 含连字符等非标识符字符的语言代码（如 zh-CN / zh-TW）必须加引号，否则合并进
  // `const LANGS = { ... }` 后会变成非法对象字面量。
  const key = /^[A-Za-z_$][\w$]*$/.test(lang) ? lang : `'${lang}'`;
  fs.writeFileSync(f, `    ${key}: dict(),\n`);
  console.log(`[build] 创建空占位 ${f}`);
}

function build() {
  if (!fs.existsSync(ENGINE)) bootstrap();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const l of ORDER) ensureStub(l);

  const engine = fs.readFileSync(ENGINE, 'utf8');
  if (!engine.includes('/*__LANGS__*/')) {
    throw new Error('i18n-engine.js 缺少 /*__LANGS__*/ 占位符，无法合并。');
  }
  let snippets = '';
  let count = 0;
  for (const l of ORDER) {
    const f = path.join(DATA_DIR, `${l}.js`);
    const content = fs.readFileSync(f, 'utf8').replace(/\s+$/, '');
    if (!content.trim()) continue;
    snippets += content + '\n';
    count++;
  }
  // 用函数返回替换，避免片段内的 $ （如正则 `...remaining$`）被当作特殊模式
  const out = engine.replace('/*__LANGS__*/', () => snippets);
  fs.writeFileSync(OUT, out);
  console.log(`[build] 已生成 ${path.relative(ROOT, OUT)}（合并 ${count} 个语种片段）`);
}

build();
