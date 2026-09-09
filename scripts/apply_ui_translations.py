#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""将官方 llama.cpp WebUI 源码(chat/server/mcp/model/dialog 等组件)中
仍缺失的真实界面英文文本翻译为中文，追加到 webui-i18n-zh.js 字典。
只追加字典中尚不存在的键。已剔除数学库/代码标识符/PWA meta 等噪声与
含 {插值} 的残缺片段。
"""
import re

JS = r"E:/工作区/Work-XXXXXLCat-llama.cpp/public/webui-i18n-zh.js"

T = {
    # ===== 通用按钮 / 状态 / 短标签 =====
    'Dismiss': '关闭',
    'Go Home': '返回主页',
    'Try again': '重试',
    'Reload app': '重新加载应用',
    'Running...': '运行中…',
    'Server URL': '服务器地址',
    'Completions': '补全',
    'Build Info': '构建信息',
    'Modalities': '多模态能力',
    'No matches': '无匹配',
    'Use Prompt': '使用提示词',
    'Hello there': '你好',
    'Allow use of': '允许使用',
    'Always allow': '始终允许',
    'Display name': '显示名称',
    'Save & Retry': '保存并重试',
    'Searching...': '搜索中…',
    'Select Model': '选择模型',
    'Branch': '分支',
    'No model': '无模型',
    'No output': '无输出',
    'No edits': '无编辑',
    'No resources': '无资源',
    'Success!': '成功！',
    'Timed out': '超时',
    'Validating...': '校验中…',
    'Pinned': '已固定',
    'Custom': '自定义',
    'Logging': '日志',
    'Prompts': '提示词',
    'Resources': '资源',
    'Console': '控制台',
    'details': '详情',
    'Output': '输出',
    'Input': '输入',
    'Title': '标题',
    'Tasks': '任务',
    'Deny': '拒绝',
    'or upload': '或上传',
    'Toggle content': '切换内容',

    # ===== 对话 / 聊天界面 =====
    'Conversation Name': '对话名称',
    'Recent conversations': '最近对话',
    'See parent conversation': '查看父级对话',
    'Branch conversation after edit': '编辑后分支对话',
    'Are you sure you want to delete': '你确定要删除吗',
    'with your existing conversations.': '与你现有的对话。',
    'No conversations found matching " "': '未找到匹配“ ”的对话',
    'Show system message in conversations': '在对话中显示系统消息',
    'Choose a new title for this conversation.': '为这段对话选择一个新标题。',
    'Choose a model to use for the conversation': '选择用于对话的模型',
    'Agentic turn limit reached. Continue?': '已达到智能体轮次上限。继续吗？',
    'Show full system message': '显示完整系统消息',
    'Empty Files Detected': '检测到空文件',
    'files to get started': '文件以开始',

    # ===== 模型选择器 / 模型信息 =====
    'Attach a file': '附加文件',
    'Chat Template': '对话模板',
    'Loaded models': '已加载模型',
    'Favorite models': '收藏模型',
    'Loading models…': '模型加载中…',
    'Available models': '可用模型',
    'Model Not Available': '模型不可用',
    'No models available.': '无可用模型。',
    'Model Information': '模型信息',
    'Loading model information...': '模型信息加载中…',
    'No model information available': '无可用模型信息',
    'Current model details and capabilities': '当前模型详情与能力',
    'Select an available model:': '选择一个可用模型：',
    'Search · llama.cpp': '搜索 · llama.cpp',

    # ===== 服务器面板 =====
    'Delete Server': '删除服务器',
    'Configure Server': '配置服务器',
    'Server instructions': '服务器指令',
    'Connecting to Server': '正在连接服务器',
    'Server Connection Error': '服务器连接错误',
    'Start the llama-server:': '启动 llama-server：',
    'Use llama-server proxy': '使用 llama-server 代理',
    'Retry Connection': '重试连接',
    'Update available': '有可用更新',
    'A new version is available. Reload to update.': '有新版本可用。重新加载以更新。',
    'Check server logs for any error messages': '检查服务器日志以查看错误信息',
    'Check that the server is accessible at the correct URL': '请确认服务器在正确的 URL 上可访问',
    'Verify your network connection': '请检查你的网络连接',
    'Available context size is only visible once the model is loaded.': '可用上下文大小仅在模型加载后可见。',

    # ===== MCP 服务器 =====
    'MCP Resources': 'MCP 资源',
    'Read Resource': '读取资源',
    'Attach Resource': '附加资源',
    'Available resources': '可用资源',
    'No resources available': '无可用资源',
    'No content available': '无可用内容',
    'Loading resources...': '资源加载中…',
    'Add New MCP Server': '新增 MCP 服务器',
    'Add another MCP server': '添加另一个 MCP 服务器',
    'Add your first MCP server': '添加你的第一个 MCP 服务器',
    'Recommended Servers': '推荐服务器',
    'Approve all tools from': '批准来自…的所有工具',
    'Always allow all tools from': '始终允许来自…的所有工具',
    'Include sensitive data': '包含敏感数据',
    'to protect your credentials.': '以保护你的凭据。',
    'Enter API Key': '输入 API 密钥',
    'Paste token here': '在此粘贴令牌',
    '✓ API key validated successfully! Connecting...': '✓ API 密钥验证成功！正在连接…',
    'Connect a remote MCP server by URL.': '通过 URL 连接远程 MCP 服务器。',
    'Select a resource to preview': '选择要预览的资源',
    'Select Conversations to': '选择对话以…',

    # ===== 附件 / 文件 =====
    'File Upload Error': '文件上传错误',
    'Unsupported File Types': '不支持的文件类型',
    'File type not supported': '不支持的文件类型',
    'Some files cannot be uploaded with the current model.': '部分文件无法用当前模型上传。',
    'You can try uploading files with content instead': '你可以尝试上传有内容的文件',
    'Drop your files here to upload': '将文件拖拽到此处上传',
    'Empty files cannot be processed or sent to the AI model': '空文件无法被处理或发送给 AI 模型',
    'These files have been automatically removed from your attachments': '这些文件已从你的附件中自动移除',
    'Include all attachments': '包含所有附件',
    'Media attachment not found in message extras': '在消息附件中未找到媒体文件',
    'Open file mention picker': '打开文件引用选择器',
    'Open working directory picker': '打开工作目录选择器',

    # ===== 工具调用 / 生成状态 =====
    'Generating diagram...': '图表生成中…',
    'Rendering svg...': 'SVG 渲染中…',
    'Waiting for result...': '等待结果…',
    'Waiting for media data...': '等待媒体数据…',
    'Waiting for file content...': '等待文件内容…',
    'Receiving arguments...': '正在接收参数…',
    'Response was truncated': '回复已被截断',
    'Unknown error occurred': '发生未知错误',
    'Troubleshooting': '故障排查',
    'Show raw output': '显示原始输出',
    'Reset Settings to Default': '将设置恢复为默认',
    'Update without re-sending': '更新但不重新发送',
    'Settings are saved in browser\'s localStorage': '设置已保存在浏览器的 localStorage 中',

    # ===== 杂项界面文本 =====
    'Save settings': '保存设置',
    'File Path': '文件路径',
    'File Path:': '文件路径：',
    'No matching folders': '无匹配文件夹',
    'No context info available': '无可用上下文信息',
}


def main():
    raw = open(JS, encoding='utf-8').read()
    existing = set(re.findall(r"'([^'\\]*(?:\\.[^'\\]*)*)'\s*:", raw))
    new_items = {k: v for k, v in T.items() if k not in existing}
    print(f"本批翻译: {len(T)}  已存在跳过: {len(T) - len(new_items)}  实际新增: {len(new_items)}")
    if not new_items:
        print("无需追加。")
        return
    lines = []
    lines.append('\n    // ===== 官方源码补全（chat/server/mcp/model/dialog 等组件真实界面文本）=====')
    for k, v in new_items.items():
        kk = k.replace("'", "\\'")
        vv = v.replace("'", "\\'")
        lines.append(f"    '{kk}': '{vv}',")
    block = '\n'.join(lines)
    marker = '  };'
    idx = raw.rfind(marker)
    if idx == -1:
        print("未找到 DICT 结尾标记，中止。")
        return
    out = raw[:idx] + block + '\n' + raw[idx:]
    open(JS, 'w', encoding='utf-8').write(out)
    print("已写入。新增条目示例：")
    for i, (k, v) in enumerate(list(new_items.items())[:8]):
        print(f"  {k!r} -> {v!r}")


if __name__ == '__main__':
    main()
