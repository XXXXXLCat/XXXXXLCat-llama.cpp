/*
 * webui-i18n.js — llama.cpp WebUI 界面语言注入脚本
 *
 * 注入方式：由本地反向代理在 llama-server 返回的 HTML 中插入
 *   <script src="/webui-i18n.js?v=N"></script>
 * 脚本在 iframe 内运行，遍历 DOM 文本节点与关键属性，按「当前语言」的字典替换英文。
 * 通过 MutationObserver 兜住 SPA 动态渲染（聊天气泡、模型列表、toast 等）。
 *
 * 语言来源 = 宿主应用「偏好设置 → 语言」：
 *   1) iframe 的 URL 查询参数 ?lang=<code>（宿主把当前语言拼进 src，跨域/同源都可靠）；
 *   2) 同源场景（dev 的 /llama 代理）读 localStorage['app-locale'] 兜底；
 *   3) 宿主 postMessage { __webuiI18n: 'set-lang', lang } —— 仅用于运行期切换语言，不做初始依赖。
 * 初始翻译以 URL ?lang 为准，不再依赖跨窗 postMessage 时序，避免信号丢失导致整页不翻。
 * 行为规则：**只要语言不是英语，就走该语言的字典**；只有英语（en）保持官方原版英文。
 * 每种语言在 LANGS 里各有一份独立字典，互不回退（避免简繁混排、语种串味）；
 * 某语言字典暂缺的词条，该词条就保持英文原样。
 * 切换语言时先把上一语言的替换「原地还原」再应用新语言，不刷新页面、不丢聊天状态。
 *
 * 维护：llama.cpp 升级后若新增/变更英文串，只需在对应语言字典里增删条目，无需重编译。
 * 安全：仅当「文本节点去空白后恰好等于某个字典键」时才替换，绝不碰用户聊天内容
 *       或模型路径等动态文本，避免误翻译。
 */
(function () {
  'use strict';

  // -------------------------------------------------------------------------
  // 各语言字典：宿主「偏好设置 → 语言」里除英语外的 9 种语言各一份。
  //   strings : 精确匹配键（去空白后整节点相等才替换）
  //   patterns: 带数字/插值的动态串兜底规则（强锚定正则）
  // 字典为空 = 该语言暂不翻译，界面保持 llama.cpp 官方英文；逐条填充即可。
  // 英语（en）不在此列：它是 WebUI 的原文语言，永远不翻译。
  // -------------------------------------------------------------------------
  function dict(strings, patterns) {
    return { strings: strings || {}, patterns: patterns || [] };
  }

  const LANGS = { /*__LANGS__*/ };
  const ATTRS = ['placeholder', 'title', 'aria-label', 'aria-placeholder', 'value', 'alt'];
  const MSG = '__webuiI18n';
  const LOCALE_KEY = 'app-locale';
  const SUPPORTED = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'];

  // 宿主偏好持久化值是内部 LangCode（如 'zh'），而注入系统的字典键是 BCP-47（如 'zh-CN'）；
  // 这里做一层别名映射，确保 dev localStorage 兜底路径也能命中正确字典。
  const HOST_PREF_ALIAS = { 'zh': 'zh-CN' };

  let active = null; // 当前生效语言代码；null = 英语/未知语言（保持官方英文）
  let DICT = {};
  let PATTERNS = [];

  // node -> { text: {orig,next}, attrs: { name: {orig,next} } }
  // 记录每次替换的原文与译文，用于切语言时精准还原。
  const applied = typeof WeakMap === 'function' ? new WeakMap() : null;

  function tr(text) {
    if (text == null) return null;
    const trimmed = text.trim();
    if (trimmed === '') return null;
    // 归一化内部空白：Svelte 编译会把模板里的换行/缩进渲染成节点文本里的 "\n\t\t" 等，
    // 仅 trim 首尾会让精确键（如欢迎语 "Type a message or upload\n\t\tfiles to get started"）永远匹配不上。
    // 折叠为单空格后再查表/匹配，键与 PATTERNS 都用这份归一化文本。
    const norm = trimmed.replace(/\s+/g, ' ');
    if (norm in DICT) {
      const lead = text.length - text.trimStart().length;
      const trail = text.length - text.trimEnd().length;
      return text.slice(0, lead) + DICT[norm] + text.slice(text.length - trail);
    }
    for (let i = 0; i < PATTERNS.length; i++) {
      const m = PATTERNS[i].re.exec(norm);
      if (m) {
        const lead = text.length - text.trimStart().length;
        const trail = text.length - text.trimEnd().length;
        return text.slice(0, lead) + PATTERNS[i].fn(m) + text.slice(text.length - trail);
      }
    }
    return null;
  }

  function recOf(node) {
    if (!applied) return null;
    let rec = applied.get(node);
    if (!rec) {
      rec = {};
      applied.set(node, rec);
    }
    return rec;
  }

  // 翻译一个节点（文本节点翻文本，元素节点翻关键属性）
  function applyNode(node) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const r = tr(node.nodeValue);
      if (r === null || r === node.nodeValue) return;
      const rec = recOf(node);
      if (!rec) return;
      if (!rec.text) rec.text = { orig: node.nodeValue, next: r }; // 只在首次替换时记原文
      else rec.text.next = r;
      node.nodeValue = r;
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    for (const a of ATTRS) {
      const v = node.getAttribute(a);
      if (!v) continue;
      const r = tr(v);
      if (r === null || r === v) continue;
      const rec = recOf(node);
      if (!rec) return;
      if (!rec.attrs) rec.attrs = {};
      if (!rec.attrs[a]) rec.attrs[a] = { orig: v, next: r };
      else rec.attrs[a].next = r;
      node.setAttribute(a, r);
    }
  }

  // 还原一个节点：仅当现值仍等于我们写入的译文时才还原，
  // 避免把应用自己后来更新的内容（如流式状态）覆盖回旧值。
  function restoreNode(node) {
    if (!applied) return;
    const rec = applied.get(node);
    if (!rec) return;
    if (rec.text && node.nodeType === 3 && node.nodeValue === rec.text.next) {
      node.nodeValue = rec.text.orig;
    }
    if (rec.attrs && node.nodeType === 1) {
      for (const a in rec.attrs) {
        const r = rec.attrs[a];
        if (node.getAttribute(a) === r.next) node.setAttribute(a, r.orig);
      }
    }
    applied.delete(node);
  }

  function walk(node, fn) {
    if (!node) return;
    if (node.nodeType === 3 /* TEXT_NODE */) {
      fn(node);
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    const tag = node.tagName ? node.tagName.toLowerCase() : '';
    if (tag === 'script' || tag === 'style') return;
    fn(node);
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) walk(kids[i], fn);
  }

  function scanAll(fn) {
    walk(document.documentElement, fn);
  }

  // 规则：语言 ≠ 英语 → 取该语言字典翻译；英语 / 未知语言 → null，保持官方原版。
  // 各语言字典互不回退（简体不会掉进繁体、日语不会掉进英语之外的其它语种）。
  function setLang(lang) {
    const code = Object.prototype.hasOwnProperty.call(LANGS, lang) ? lang : null;
    if (code !== active) {
      if (active !== null) scanAll(restoreNode); // 先还原上一语言
      active = code;
      DICT = code ? LANGS[code].strings || {} : {};
      PATTERNS = code ? LANGS[code].patterns || [] : [];
    }
    // 同语言再次下发时也重新扫一遍：幂等，可兜住扫描窗口之后才出现的节点
    if (active !== null) scanAll(applyNode);
  }

  // 主通道：URL 上的 ?lang=<code>。宿主把偏好语言拼进 iframe src，
  // 脚本在 iframe 内直接读自己的 location.search——跨域/同源都可靠，
  // 无需依赖跨窗 postMessage 时序（旧方案曾因握手丢失而整页不翻）。
  function getUrlLang() {
    try {
      const p = new URLSearchParams(window.location.search);
      const l = p.get('lang');
      return l ? l : null;
    } catch (e) {
      return null;
    }
  }

  // 同源兜底：读宿主写进 localStorage 的语言偏好（dev /llama 代理场景）
  function fallbackLang() {
    try {
      const pref = localStorage.getItem(LOCALE_KEY);
      if (!pref) return null;
      if (pref !== 'system') return HOST_PREF_ALIAS[pref] || pref;
      const nav = (navigator.language || 'en').toLowerCase();
      for (const c of SUPPORTED) {
        if (c.toLowerCase() === nav) return c;
      }
      const base = nav.split('-')[0];
      for (const c of SUPPORTED) {
        if (c.toLowerCase() === base) return c;
      }
      return 'en';
    } catch (e) {
      return null;
    }
  }

  function startObserver() {
    if (typeof MutationObserver !== 'function') return;
    const mo = new MutationObserver(function (muts) {
      if (active === null) return; // 当前语言不需要翻译，直接忽略
      for (const m of muts) {
        if (m.type === 'attributes') {
          const a = m.attributeName;
          if (a && ATTRS.indexOf(a) !== -1) {
            const el = m.target;
            const v = el.getAttribute(a);
            if (!v) continue;
            const r = tr(v);
            if (r !== null && r !== v) {
              const rec = recOf(el);
              if (rec) {
                if (!rec.attrs) rec.attrs = {};
                if (!rec.attrs[a]) rec.attrs[a] = { orig: v, next: r };
                else rec.attrs[a].next = r;
                el.setAttribute(a, r);
              }
            }
          }
        } else if (m.type === 'characterData') {
          applyNode(m.target);
        } else {
          const added = m.addedNodes;
          for (let i = 0; i < added.length; i++) walk(added[i], applyNode);
        }
      }
    });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
    // 兜底：SPA 初始渲染可能晚于 observer 注册
    let n = 0;
    const iv = setInterval(function () {
      if (active !== null) scanAll(applyNode);
      if (++n > 20) clearInterval(iv);
    }, 500);
  }

  // -------------------------------------------------------------------------
  // 内嵌 WebView2：左侧边栏毛玻璃伪影修复
  //   llama.cpp 官方 WebUI 的侧边栏用 backdrop-filter（毛玻璃）+ 半透明背景，
  //   在 Tauri 的 WebView2 内嵌 iframe 下会渲染出杂色/条纹伪影。
  //   做法：定位侧边栏（几何位置为主、类名为辅），对其自身与子树
  //     ① backdrop-filter → none（去毛玻璃）
  //     ② 半透明背景（background-color / background-image 渐变里的 rgba|hsla）
  //        把 alpha 提到 1，保留原 RGB / 色相——否则"禁掉模糊"会变成
  //        透明能透视（见 0.1.x 的 v=42 教训）。
  //   只写内联样式、不注入全局 <style>：注入全局样式后，后续用 computed 值
  //   判定会被自己的样式覆盖成 none，导致一次都没改（v=43 的坑）。
  // -------------------------------------------------------------------------
  function alphaOf(v) {
    var m = String(v).match(/rgba?\(([^)]+)\)/i);
    if (m) {
      var p = m[1].split(',').map(function (s) { return s.trim(); });
      if (p.length >= 4) {
        var a = parseFloat(p[3]);
        return isNaN(a) ? 1 : a;
      }
      return 1;
    }
    var h = String(v).match(/hsla?\(([^)]+)\)/i);
    if (h) {
      var q = h[1].split(/[,\s/]+/).filter(Boolean);
      if (q.length >= 4) {
        var b = parseFloat(q[3]);
        return isNaN(b) ? 1 : b;
      }
    }
    return 1;
  }
  function toOpaque(v) {
    var s = String(v);
    s = s.replace(/rgba?\(([^)]+)\)/gi, function (_m, inner) {
      var p = inner.split(',').map(function (t) { return t.trim(); });
      return p.length >= 3 ? 'rgb(' + p[0] + ', ' + p[1] + ', ' + p[2] + ')' : _m;
    });
    s = s.replace(/hsla?\(([^)]+)\)/gi, function (_m, inner) {
      var p = inner.split(',').map(function (t) { return t.trim(); });
      return p.length >= 3 ? 'hsl(' + p[0] + ', ' + p[1] + ', ' + p[2] + ')' : _m;
    });
    return s;
  }
  // alpha=0（transparent）不算：提为 1 会变成纯黑，必须排除
  function isTranslucent(v) {
    if (!v) return false;
    var a = alphaOf(v);
    return a > 0 && a < 1;
  }
  function deblurEl(el) {
    if (!el || el.nodeType !== 1) return;
    var cs;
    try { cs = window.getComputedStyle(el); } catch (e) { return; }
    if (!cs || cs.display === 'none') return;
    try {
      var bf = cs.backdropFilter || cs.webkitBackdropFilter;
      if (bf && bf !== 'none') {
        el.style.setProperty('backdrop-filter', 'none', 'important');
        el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
      }
      if (isTranslucent(cs.backgroundColor)) {
        el.style.setProperty('background-color', toOpaque(cs.backgroundColor), 'important');
      }
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && isTranslucent(cs.backgroundImage)) {
        el.style.setProperty('background-image', toOpaque(cs.backgroundImage), 'important');
      }
    } catch (e) { /* 忽略单个元素的样式写入异常 */ }
  }
  function isSidebarEl(el) {
    if (!el || el.nodeType !== 1) return false;
    var cs;
    try { cs = window.getComputedStyle(el); } catch (e) { return false; }
    if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
    var r = el.getBoundingClientRect();
    var vw = window.innerWidth || document.documentElement.clientWidth || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!vw || !vh) return false;
    // 几何判定：贴左边缘 + 竖向占满大半屏 + 横向不过半屏
    var geometric = r.left <= Math.max(8, vw * 0.03) && r.height >= vh * 0.5 && r.width >= 100 && r.width <= vw * 0.55;
    if (geometric) return true;
    // 类名/ID 兜底：llama.cpp 若改结构导致几何不匹配，仍可按命名命中
    var name = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
    return /(^|[\s_-])(side|sidebar|side-bar|sidepanel|side-panel|drawer)([\s_-]|$)/i.test(name) && r.width >= 140 && r.height >= vh * 0.4;
  }
  function fixSidebarTree(root) {
    if (!isSidebarEl(root)) return;
    deblurEl(root);
    var kids = root.querySelectorAll('*');
    for (var i = 0; i < kids.length; i++) deblurEl(kids[i]);
  }
  function scanSidebars() {
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) fixSidebarTree(all[i]);
  }
  function startSidebarFix() {
    scanSidebars();
    // SPA 渲染晚于脚本执行：前 8 秒内每秒补扫一次
    var n = 0;
    var iv = setInterval(function () {
      scanSidebars();
      if (++n > 8) clearInterval(iv);
    }, 1000);
    if (!window.MutationObserver) return;
    var scheduled = false;
    var mo = new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () {
        scheduled = false;
        scanSidebars();
      });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // 接收宿主下发的语言
  window.addEventListener('message', function (e) {
    const d = e.data;
    if (!d || d[MSG] !== 'set-lang') return;
    if (typeof d.lang === 'string') setLang(d.lang);
  });

  // 启动：优先 URL ?lang（最可靠，跨域/同源都生效），其次同源 localStorage 兜底。
  // 宿主若运行期切换语言，仍会通过 postMessage 下发（见上方 message 监听）。
  const initial = getUrlLang() || fallbackLang();
  if (initial) setLang(initial);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      startSidebarFix();
      startObserver();
    });
  } else {
    startSidebarFix();
    startObserver();
  }

  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ __webuiI18n: 'ready' }, '*');
    }
  } catch (e) {
    /* 忽略跨域异常 */
  }
})();
