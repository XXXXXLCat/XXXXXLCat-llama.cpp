#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
对比官方 llama.cpp WebUI 源码与本地字典，找出：
  - truncated: 字典里存在某 key 是源码完整字符串的“前缀截断版”（精确匹配永远打不中完整 DOM 文本）
  - missing:    源码里有、字典里完全没有的完整字符串
输出到 scripts/truncated.txt 与 scripts/missing_full.txt 供人工翻译。
"""
import re, os, glob

SRC = r"C:/Users/41325/Downloads/llama.cpp-master/llama.cpp-master/tools/ui/src"
JS = r"E:/工作区/Work-XXXXXLCat-llama.cpp/public/webui-i18n-zh.js"

# 三类带引号字符串：单引号 / 双引号 / 反引号
QUOTED = r"""(?:'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`]*)`)"""

FIELD_RE = re.compile(r"""(?:help|label|description|tooltip|placeholder|title|ariaLabel|aria-label)\s*:\s*""" + QUOTED)
ATTR_RE  = re.compile(r"""(?:aria-label|title|placeholder|alt|aria-placeholder)\s*=\s*""" + QUOTED)

def collect():
    cands = set()
    for ext in ("*.ts", "*.svelte"):
        for path in glob.glob(os.path.join(SRC, "**", ext), recursive=True):
            try:
                txt = open(path, encoding="utf-8").read()
            except Exception:
                continue
            for m in FIELD_RE.finditer(txt):
                s = m.group(1) or m.group(2) or m.group(3) or ""
                if s.strip():
                    cands.add(s)
            for m in ATTR_RE.finditer(txt):
                s = m.group(1) or m.group(2) or m.group(3) or ""
                if s.strip():
                    cands.add(s)
    return cands

def load_dict_keys():
    raw = open(JS, encoding="utf-8").read()
    # 只取 DICT 块内、形如 '...': 的键（支持转义单引号）
    keys = set(re.findall(r"'((?:[^'\\]|\\.)*)'\s*:", raw))
    return keys

def main():
    cands = collect()
    keys = load_dict_keys()

    truncated = []   # (dict_prefix, full_source)
    missing = []     # full_source
    ok = 0
    for s in sorted(cands):
        if s in keys:
            ok += 1
            continue
        # dict 里是否存在“截断前缀”
        pref = [k for k in keys if s.startswith(k) and len(k) < len(s)]
        if pref:
            truncated.append((pref[0], s))
        else:
            missing.append(s)

    with open(os.path.join(os.path.dirname(__file__), "truncated.txt"), "w", encoding="utf-8") as f:
        for k, s in truncated:
            f.write(f"PREFIX||{k}\nFULL||{s}\n\n")
    with open(os.path.join(os.path.dirname(__file__), "missing_full.txt"), "w", encoding="utf-8") as f:
        for s in missing:
            f.write(s + "\n")

    print(f"source strings: {len(cands)}")
    print(f"already full-match: {ok}")
    print(f"truncated (dict key is prefix of source): {len(truncated)}")
    print(f"missing entirely: {len(missing)}")
    print("--- truncated list (prefix -> full) ---")
    for k, s in truncated:
        print(f"  [{k}]")
        print(f"    -> {s}")
    print("--- missing (first 40) ---")
    for s in missing[:40]:
        print(f"  {s}")

if __name__ == "__main__":
    main()
