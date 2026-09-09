#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把之前被截断的字典键（如 'Display' -> 完整句子）补成官方源码里的【完整】字符串，
并补齐真正缺失的设置/对话/对话框文本。同时修正写错的 model tags 例子键。
安全：只新增或定点替换，绝不删除通用动作键（Copy/Delete/Send 等）。
"""
import re

JS = r"E:/工作区/Work-XXXXXLCat-llama.cpp/public/webui-i18n-zh.js"

# 1) 定点修正：错误键 / 截断键 -> 完整键
REPLACES = [
    (
        "    'Display model tags (e.g. Q8_0, Q4_K_M) next to model names throughout the interface.': '在界面各处模型名称旁显示模型标签（如 Q8_0、Q4_K_M）。',",
        "    'Display model tags (e.g. \"vision\", \"reasoning\") next to model names throughout the interface.': '在界面各处模型名称旁显示模型标签（如 “vision”、“reasoning”）。',",
    ),
    (
        "    'The order at which samplers are applied, in simplified way. Default is': '采样器应用的顺序（简化表示）。默认是',",
        "    'The order at which samplers are applied, in simplified way. Default is \"top_k;typ_p;top_p;min_p;temperature\": top_k->typ_p->top_p->min_p->temperature': '采样器应用的顺序（简化表示）。默认为 \"top_k;typ_p;top_p;min_p;temperature\"：top_k→typ_p→top_p→min_p→temperature',",
    ),
]

# 2) 新增完整条目（覆盖被截断的帮助文本 + 真正缺失的 UI 文本）
ADD = [
    # ---- 设置面板：被截断的帮助文本（补全为完整句子）----
    ("Display full raw model identifiers (e.g. \"ggml-org/GLM-4.7-Flash-GGUF:Q8_0\") instead of parsed names with badges.",
     "显示完整的原始模型标识符（如 “ggml-org/GLM-4.7-Flash-GGUF:Q8_0”），而非带徽章的解析名称。"),
    ("Display quantization badges (e.g. Q8_0, Q4_K_M) next to model names throughout the interface.",
     "在界面各处模型名称旁显示量化徽章（如 Q8_0、Q4_K_M）。"),
    ("Display per-turn statistics (tokens, duration) under each turn in agentic responses. Shown only when \"Show message generation statistics\" is enabled.",
     "在智能体回复的每个轮次下方显示单轮统计（token、时长）。仅当启用“显示消息生成统计”时显示。"),
    ("Send reasoning_format=none so the server returns thinking tokens inline instead of extracting them into a separate field.",
     "发送 reasoning_format=none，使服务端将思考 token 内联返回，而不是提取到单独的字段中。"),
    ("Copy IndexedDB from LlamacppWebui to LlamaUi database (non-destructive)",
     "将 IndexedDB 从 LlamacppWebui 复制到 LlamaUi 数据库（非破坏性）。"),
    ("Copy legacy custom config key to customJson (non-destructive)",
     "将旧版自定义配置键复制到 customJson（非破坏性）。"),
    ("Copy localStorage keys from LlamaCppWebui to LlamaUi prefix (non-destructive)",
     "将 localStorage 键从 LlamaCppWebui 复制到 LlamaUi 前缀（非破坏性）。"),
    ("Copy mcpDefaultEnabled localStorage key into settings config (preserves legacy keys)",
     "将 mcpDefaultEnabled 的 localStorage 键并入设置配置（保留旧键）。"),
    ("Copy standalone theme key to config object (non-destructive)",
     "将独立的主题键复制到配置对象（非破坏性）。"),
    ("Seed per-conversation disabled tool keys from the global defaults and legacy per-conversation MCP server overrides (legacy field preserved)",
     "从全局默认值与旧版逐对话 MCP 服务器覆盖中初始化逐对话“已禁用工具”键（保留旧字段）。"),

    # ---- 真正缺失的设置文本 ----
    ("Choose how conversation titles are generated. The first non-empty line uses a fast deterministic rule; the LLM option uses a model-generated title from the first message exchange.",
     "选择对话标题的生成方式。首个非空行采用快速的确定性规则；LLM 选项会根据首次消息交互由模型生成标题。"),
    ("Counterpart of the conversation title radio; stored and synced without a dedicated UI field.",
     "对话标题单选的对应项；已存储并同步，但没有独立的 UI 字段。"),
    ("Render user messages using markdown formatting in the chat. Turn this off to keep a message exactly as typed; @-mention badges show either way.",
     "在聊天中用 Markdown 格式渲染用户消息。关闭后保留消息的原始输入内容；@提及徽章无论是否开启都会显示。"),
    ("MCP request timeout (seconds)", "MCP 请求超时（秒）"),
    ("Get runtime info (OS name), may call when user asks about local files or shell commands",
     "获取运行时信息（操作系统名称），当用户询问本地文件或 shell 命令时可调用。"),
    ("Optional template for the title generation prompt. Use {{USER}} for the user message and {{ASSISTANT}} for the assistant message.",
     "标题生成提示词的可选模板。用 {{USER}} 代表用户消息、{{ASSISTANT}} 代表助手消息。"),
    ("Symbolic math (nerdamer)", "符号数学（nerdamer）"),

    # ---- 两个 .svelte 专属帮助文本（用户点名的）----
    ("Applies to new conversations. Tool picks inside a chat only affect that chat.",
     "适用于新对话。在某对话内选择的工具仅影响该对话。"),
    ("Download your conversations as a ZIP of JSONL files. This includes all messages, attachments, and conversation history.",
     "将你的对话下载为 JSONL 文件的 ZIP 压缩包。包含全部消息、附件与对话历史。"),

    # ---- 删除对话确认对话框（动态模板的两种静态变体）----
    ("This action cannot be undone. The selected conversation and its messages will be permanently removed, including any forks.",
     "此操作无法撤销。所选对话及其消息将被永久删除，包括所有分支。"),
    ("This action cannot be undone. The selected conversations and their messages will be permanently removed, including any forks.",
     "此操作无法撤销。所选对话及其消息将被永久删除，包括所有分支。"),

    # ---- API Key 帮助（含 <code> 被 {@html} 拆分，用片段键翻译）----
    ("Set the API Key if you are using", "设置 API 密钥（若你为服务端启用了"),
    ("option for the server.", "选项）。"),

    # ---- 其它含插值的帮助文本：用稳定前缀片段键翻译 ----
    ("Execution timeout in milliseconds, default ", "执行超时（毫秒），默认 "),
    ("Message version ", "消息版本 "),
    ("PDF Page ", "PDF 第 "),
    ("Read a media file and attach it to the conversation so it can be perceived directly. Supports ",
     "读取媒体文件并附到对话中，使其可被直接感知。支持 "),

    # ---- 语言切换相关（确保存在）----
    ("中文", "中文"),
    ("中英", "中英"),

    # ---- 聊天起始问候语（ChatScreenGreeting，整句文本节点，Svelte 合并 expr+static）----
    ("Type a message or upload files to get started", "输入消息或上传文件以开始"),
    ("Record audio, type a message or upload files to get started", "录制音频、输入消息或上传文件以开始"),
]

def esc(s):
    return s.replace("\\", "\\\\").replace("'", "\\'")

def main():
    raw = open(JS, encoding="utf-8").read()

    # 现有键（支持转义单引号）
    existing = set(re.findall(r"'((?:[^'\\]|\\.)*)'\s*:", raw))

    # 1) 定点替换
    for old, new in REPLACES:
        if old in raw:
            raw = raw.replace(old, new, 1)
            print("REPLACED:", old.strip()[:60])
        else:
            print("WARN not found (skip replace):", old.strip()[:60])

    # 重新读取现有键（替换后可能新增）
    existing = set(re.findall(r"'((?:[^'\\]|\\.)*)'\s*:", raw))

    # 2) 追加缺失的完整条目（仅追加不存在的键）
    new_lines = []
    added = 0
    for k, v in ADD:
        if k in existing:
            continue
        new_lines.append("    '%s': '%s'," % (esc(k), esc(v)))
        existing.add(k)
        added += 1

    if new_lines:
        marker = "\n  };"
        assert raw.count(marker) == 1, "DICT 结束标记不唯一"
        inject = "\n".join(new_lines) + "\n"
        raw = raw.replace(marker, inject + "  };", 1)

    open(JS, "w", encoding="utf-8").write(raw)
    print("ADDED entries:", added)
    print("done.")

if __name__ == "__main__":
    main()
