#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从官方 llama.cpp WebUI 源码(tools/ui/src)精确提取 UI 字符串，
与现有 webui-i18n-zh.js 字典做差集，输出“仍然缺失”的候选列表。

提取三类高/中置信度来源：
  1) 配置对象字段值: label/help/description/ariaLabel/tooltip/placeholder/title/name/...
  2) HTML 属性: aria-label/title/placeholder/alt/aria-placeholder/value/aria-valuetext
  3) Svelte 模板文本节点: 去掉标签和 {...} 表达式后残留的整段文字

输出:
  scripts/ui_fields.txt   配置字段值
  scripts/ui_attrs.txt    属性值
  scripts/ui_text.txt     模板文本候选
  scripts/ui_missing.txt  三合一去重后、且不在现有字典中的候选(供人工校对)
"""
import os
import re

SRC = r"C:/Users/41325/Downloads/llama.cpp-master/llama.cpp-master/tools/ui/src"
JS = r"E:/工作区/Work-XXXXXLCat-llama.cpp/public/webui-i18n-zh.js"

FIELD_KEYS = [
    'label', 'help', 'description', 'ariaLabel', 'tooltip', 'placeholder',
    'title', 'name', 'text', 'message', 'header', 'subtitle',
    'confirmLabel', 'cancelLabel', 'actionLabel', 'emptyText', 'placeholderText',
    'successMessage', 'errorMessage', 'warningMessage', 'infoMessage',
]

ATTR_RE = re.compile(
    r"""(aria-label|title|placeholder|alt|aria-placeholder|value|aria-valuetext|aria-valuename)\s*=\s*['"]([^'"]+)['"]""")

FIELD_RE = re.compile(
    r"""(?:%s)\s*:\s*['"]([^'"]+)['"]""" % '|'.join(FIELD_KEYS))

# 判定是否为“像 UI 文本”的字符串
CODE_NOISE = re.compile(
    r'^(?:const|let|var|function|import|export|return|if|else|for|while|class|interface|type|async|await|new|true|false|null|undefined|this|super|extends|implements|from|as|of|in|on|src|href|class|style|width|height|id|key|role|tabindex|disabled|hidden|selected|checked|value|type)\b',
    re.I)


def is_ui(s: str) -> bool:
    s = s.strip()
    if not s:
        return False
    # 长度区间
    if len(s) < 2 or len(s) > 70:
        return False
    # 必须含至少一个字母
    if not re.search(r'[A-Za-z]', s):
        return False
    # 排除看起来像代码/路径/数字的内容
    if re.search(r'[\\/{}<>;=+\*\(\)\[\]]', s):
        return False
    if '://' in s or s.startswith('http'):
        return False
    # 含点但像文件路径/域名 (如 foo.bar.ts, README.md)
    if re.search(r'\b\w+\.\w{2,4}\b', s) and not re.search(r'\s', s):
        return False
    # 纯数字或带单位数字
    if re.fullmatch(r'[\d.,\s%°]+', s):
        return False
    # camelCase / 全大写缩写 大概率是标识符
    if re.fullmatch(r'[A-Z0-9_]{2,}', s):
        return False
    if re.search(r'[a-z][A-Z]', s) and not re.search(r'\s', s):
        return False
    # 关键字噪声
    if CODE_NOISE.match(s):
        return False
    # 仅含单字符的标点/符号
    if re.fullmatch(r'[\W_]+', s):
        return False
    return True


def extract_config_fields(text):
    return [m.group(1) for m in FIELD_RE.finditer(text)]


def extract_attrs(text):
    return [m.group(2) for m in ATTR_RE.finditer(text)]


def extract_template_text(text):
    # 去注释
    text = re.sub(r'<!--.*?-->', '\n', text, flags=re.S)
    # 去 <script> / <style>
    text = re.sub(r'<script[\s\S]*?</script>', '\n', text, flags=re.S)
    text = re.sub(r'<style[\s\S]*?</style>', '\n', text, flags=re.S)
    # 标签整体替换为换行(同时删掉标签名与属性，避免标签名泄漏)
    text = re.sub(r'<[^>]*>', '\n', text)
    # 去掉 svelte 表达式 {...} (含一层嵌套，多遍)
    for _ in range(4):
        text = re.sub(r'\{[^{}]*\}', ' ', text)
    # 按换行切段，每段即一段模板文本(保留空格，避免拆分多词短语)
    chunks = re.split(r'\n', text)
    out = []
    for c in chunks:
        c = c.strip()
        # 去掉首尾杂散符号
        c = c.strip(' \t|•·•·')
        if is_ui(c):
            out.append(c)
    return out


def main():
    fields, attrs, texts = [], [], []
    for root, _dirs, files in os.walk(SRC):
        for fn in files:
            if not (fn.endswith('.svelte') or fn.endswith('.ts') or fn.endswith('.tsx') or fn.endswith('.js')):
                continue
            p = os.path.join(root, fn)
            try:
                txt = open(p, encoding='utf-8', errors='ignore').read()
            except Exception:
                continue
            fields += extract_config_fields(txt)
            attrs += extract_attrs(txt)
            if fn.endswith('.svelte'):
                texts += extract_template_text(txt)

    # 现有字典键（反序列化时把转义单引号还原，便于与源码原始字符串比较）
    raw = open(JS, encoding='utf-8').read()
    existing = set(k.replace("\\'", "'") for k in
                   re.findall(r"'([^'\\]*(?:\\.[^'\\]*)*)'\s*:", raw))

    def clean(lst):
        seen = set()
        res = []
        for x in lst:
            x = x.strip()
            if not x:
                continue
            if x in seen:
                continue
            seen.add(x)
            res.append(x)
        return res

    fields = clean(fields)
    attrs = clean(attrs)
    texts = clean(texts)

    def write(name, lst):
        with open(os.path.join(os.path.dirname(__file__), name), 'w', encoding='utf-8') as f:
            f.write('\n'.join(lst))

    write('ui_fields.txt', fields)
    write('ui_attrs.txt', attrs)
    write('ui_text.txt', texts)

    # 合并去重
    merged = []
    seen = set()
    for x in fields + attrs + texts:
        if x not in seen:
            seen.add(x)
            merged.append(x)

    missing = [x for x in merged if x not in existing]
    # 再按 is_ui 收紧(合并后)
    missing = [x for x in missing if is_ui(x)]
    missing = clean(missing)
    # 排序便于人工校对
    missing.sort(key=lambda s: (len(s), s.lower()))

    write('ui_missing.txt', missing)
    print(f"配置字段值: {len(fields)}  属性值: {len(attrs)}  模板文本: {len(texts)}")
    print(f"合并去重: {len(merged)}  不在字典中(缺失): {len(missing)}")
    print("已写出 scripts/ui_fields.txt / ui_attrs.txt / ui_text.txt / ui_missing.txt")


if __name__ == '__main__':
    main()
