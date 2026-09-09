// 无依赖的 DOM 打桩测试：验证 webui-i18n.js 的语言开关与「切语言原地还原」逻辑。
const vm = require('node:vm');
const fs = require('node:fs');

const src = fs.readFileSync('public/webui-i18n.js', 'utf8');
// 注入一个合成语言 __test 作为「非英语 → 走字典」的代表，
// 与生产字典内容解耦（生产字典无论空还是满，本测试都成立）。
const code = src.replace(
  '  const LANGS = {',
  "  const LANGS = {\n" +
  "    __test: { strings: { 'Send': '发送', 'Stop': '停止', 'Set the API Key if you are using': '如果使用服务端的', 'option for the server.': '参数选项，请在此设置 API 密钥。', 'Show system message in conversations': '在对话中显示系统提示' }, patterns: [] },\n" +
  "    __pt: { strings: { 'Send': 'Enviar' }, patterns: [] },"
);
if (code === src) throw new Error('测试语言注入失败');

function el(tag, attrs, children) {
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    attrs: attrs || {},
    childNodes: children || [],
    getAttribute(a) { return Object.prototype.hasOwnProperty.call(this.attrs, a) ? this.attrs[a] : null; },
    setAttribute(a, v) { this.attrs[a] = v; },
  };
}
function tx(v) { return { nodeType: 3, nodeValue: v }; }

const tSend = tx('Send');
const tStop = tx('Stop');
const tDynamic = tx('Generating...');
const tTheme = tx('Theme');      // 真实 zh-CN 字典条目，用于验证实词典翻译
const tAgentic = tx('Agentic');  // 真实 zh-CN 字典条目（分区标题）
const tSysMsg = tx('Show system message in conversations'); // standaloneField:false 特例分支硬编码显示串
const tCtrl = tx('NoTranslateCtrlString'); // 对照组：任何字典都没有此串，任何语言都不应翻译
const btn = el('button', { title: 'Send' }, [tSend]);
const root = el('html', {}, [btn, tStop, tDynamic, tTheme, tAgentic, tSysMsg, tCtrl]);

const msgListeners = [];
const win = {
  addEventListener(type, fn) { if (type === 'message') msgListeners.push(fn); },
  parent: null,
};
const doc = { documentElement: root, readyState: 'complete', addEventListener() {} };

const ctx = vm.createContext({
  document: doc,
  window: win,
  navigator: { language: 'en-US' },
  localStorage: { getItem: () => null },
  setInterval: () => 0,
  clearInterval: () => {},
  console,
});

vm.runInContext(code, ctx);

function post(lang) {
  for (const fn of msgListeners) fn({ data: { __webuiI18n: 'set-lang', lang } });
}

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got=${JSON.stringify(actual)} want=${JSON.stringify(expected)})`);
}

// 1) 英语：保持官方原版
post('en');
check('en: 文本不翻译', tSend.nodeValue, 'Send');
check('en: 属性不翻译', btn.getAttribute('title'), 'Send');

// 2) 非英语（__test）：走该语言字典，文本与属性都替换
post('__test');
check('非英语: 文本已翻译', tSend.nodeValue, '发送');
check('非英语: 属性已翻译', btn.getAttribute('title'), '发送');
check('非英语: 另一节点已翻译', tStop.nodeValue, '停止');
check('非英语: 复选框硬编码显示串已翻译', tSysMsg.nodeValue, '在对话中显示系统提示');

// 3) 模拟应用自己改了某个节点内容（流式状态），再切回英语
tDynamic.nodeValue = 'Stop'; // 应用把 Generating... 改成了 Stop
post('__test');
check('非英语: 应用改后的节点被翻译', tDynamic.nodeValue, '停止');
tDynamic.nodeValue = 'Done'; // 应用又改成 Done（我们写入的是"停止"，现值不同）
post('en');
check('en: 已还原', tSend.nodeValue, 'Send');
check('en: 属性已还原', btn.getAttribute('title'), 'Send');
check('en: 应用自改节点不回退', tDynamic.nodeValue, 'Done');

// 4) 已登记语言：任何语言都不应翻译「字典未收录」的串（对照组 tCtrl 不在任何字典中）
for (const lang of ['zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'ru', 'es', 'de', 'pt']) {
  post(lang);
  check(`${lang}: 未收录词条不翻译`, tCtrl.nodeValue, 'NoTranslateCtrlString');
}
// 未知语言同样不翻译
post('xx');
check('未知语言: 不翻译', tCtrl.nodeValue, 'NoTranslateCtrlString');

// 5) 非英语 -> 英语 -> 非英语 往返一致性
post('__test');
check('非英语: 再次翻译', tSend.nodeValue, '发送');
post('en');
check('en: 再次还原', tSend.nodeValue, 'Send');

// 6) 非英语之间互切：先还原上一语言，再应用新语言
post('__test');
check('互切: 先到 __test', tSend.nodeValue, '发送');
post('__pt');
check('互切: 切到 __pt（先还原再翻译）', tSend.nodeValue, 'Enviar');
post('en');
check('互切: 再切回英语', tSend.nodeValue, 'Send');

// 7) 真实 zh-CN 字典验证：贴源码扫描得到的实词条，确认翻译确实命中
post('zh-CN');
check('zh: 标签已翻译 (Theme→主题)', tTheme.nodeValue, '主题');
check('zh: 分区标题已翻译 (Agentic→智能体)', tAgentic.nodeValue, '智能体');
check('zh: 未收录词条不误翻 (Ctrl 保持)', tCtrl.nodeValue, 'NoTranslateCtrlString');
post('en');
check('zh: 切回英语已还原', tTheme.nodeValue, 'Theme');

// 8) URL ?lang 主通道：脚本加载时按 URL 参数自动翻译，无需 postMessage
{
  const t8 = tx('Send');
  const root8 = el('html', {}, [t8]);
  const win8 = { addEventListener() {}, parent: null, location: { search: '?lang=__test' } };
  const doc8 = { documentElement: root8, readyState: 'complete', addEventListener() {} };
  const ctx8 = vm.createContext({
    document: doc8, window: win8, navigator: { language: 'en-US' },
    localStorage: { getItem: () => null }, setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, console,
  });
  vm.runInContext(code, ctx8);
  check('URL?lang: 加载即翻译(无postMessage)', t8.nodeValue, '发送');
}

// 9) URL ?lang=en：保持官方原版
{
  const t9 = tx('Send');
  const root9 = el('html', {}, [t9]);
  const win9 = { addEventListener() {}, parent: null, location: { search: '?lang=en' } };
  const doc9 = { documentElement: root9, readyState: 'complete', addEventListener() {} };
  const ctx9 = vm.createContext({
    document: doc9, window: win9, navigator: { language: 'en-US' },
    localStorage: { getItem: () => null }, setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, console,
  });
  vm.runInContext(code, ctx9);
  check('URL?lang=en: 保持英文', t9.nodeValue, 'Send');
}

// 10) 含 <code> 的帮助串被拆成带首尾空格的文本节点：键是去空格文本、节点带空格也应翻译
{
  // 模拟 { @html } 渲染后的两个文本节点（首尾带空格，中间夹 <code>）
  const tHead = tx('Set the API Key if you are using '); // 末尾空格
  const tTail = tx(' option for the server.');            // 开头空格
  const root10 = el('html', {}, [tHead, tTail]);
  const win10 = { addEventListener() {}, parent: null, location: { search: '?lang=__test' } };
  const doc10 = { documentElement: root10, readyState: 'complete', addEventListener() {} };
  const ctx10 = vm.createContext({
    document: doc10, window: win10, navigator: { language: 'en-US' },
    localStorage: { getItem: () => null }, setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, console,
  });
  vm.runInContext(code, ctx10);
  check('API Key 片段1(带尾空格)已翻译', tHead.nodeValue, '如果使用服务端的 ');
  check('API Key 片段2(带头空格)已翻译', tTail.nodeValue, ' 参数选项，请在此设置 API 密钥。');
}

// 11) 真实 zh-CN 字典：工具页 / 导入导出页 静态串 + 动态 PATTERNS
{
  const tNoTools = tx('No tools available');
  const tApplies = tx('Applies to new conversations. Tool picks inside a chat only affect that chat.');
  const tTool = tx('Tool');
  const tEnabled = tx('Enabled');
  const tAlways = tx('Always allow');
  const tConv = tx('Conversations');
  const tSettings = tx('Settings');
  const tExpConv = tx('Export conversations');
  const tExport = tx('Export');
  const tImpConv = tx('Import conversations');
  const tDelAll = tx('Delete All');
  const tCancel = tx('Cancel');
  const tUntitled = tx('Untitled conversation');
  const tToast = tx('Settings exported');
  const tToastFail = tx('Failed to import settings');
  // 动态串（走 PATTERNS）
  const tToolCount = tx('5 tools');
  const tToolCount1 = tx('1 tool');
  const tSummary = tx('Exported 3 conversations');
  const tSummary2 = tx('Imported 1 conversation');
  const tAndMore = tx('... and 5 more');
  const tSkipped = tx('Skipped 2 conversations already in your library');
  const tParse = tx('Failed to parse file: not a zip');
  const root11 = el('html', {}, [
    tNoTools, tApplies, tTool, tEnabled, tAlways, tConv, tSettings, tExpConv, tExport,
    tImpConv, tDelAll, tCancel, tUntitled, tToast, tToastFail,
    tToolCount, tToolCount1, tSummary, tSummary2, tAndMore, tSkipped, tParse,
  ]);
  const win11 = { addEventListener() {}, parent: null, location: { search: '?lang=zh-CN' } };
  const doc11 = { documentElement: root11, readyState: 'complete', addEventListener() {} };
  const ctx11 = vm.createContext({
    document: doc11, window: win11, navigator: { language: 'en-US' },
    localStorage: { getItem: () => null }, setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, console,
  });
  vm.runInContext(code, ctx11);
  check('zh 工具页: No tools available', tNoTools.nodeValue, '暂无可用工具');
  check('zh 工具页: 说明长句', tApplies.nodeValue, '适用于新对话。在单个聊天中选择的工具仅影响该聊天。');
  check('zh 工具页: Tool 表头', tTool.nodeValue, '工具');
  check('zh 工具页: Enabled', tEnabled.nodeValue, '已启用');
  check('zh 工具页: Always allow', tAlways.nodeValue, '始终允许');
  check('zh 导入导出: Conversations', tConv.nodeValue, '对话');
  check('zh 导入导出: Settings', tSettings.nodeValue, '设置');
  check('zh 导入导出: Export conversations', tExpConv.nodeValue, '导出对话');
  check('zh 导入导出: Export 小标题', tExport.nodeValue, '导出');
  check('zh 导入导出: Import conversations', tImpConv.nodeValue, '导入对话');
  check('zh 导入导出: Delete All', tDelAll.nodeValue, '全部删除');
  check('zh 导入导出: Cancel', tCancel.nodeValue, '取消');
  check('zh 导入导出: Untitled conversation', tUntitled.nodeValue, '未命名对话');
  check('zh toast: Settings exported', tToast.nodeValue, '设置已导出');
  check('zh toast: Failed to import settings', tToastFail.nodeValue, '导入设置失败');
  // 动态 PATTERNS
  check('zh 动态: 5 tools', tToolCount.nodeValue, '5 个工具');
  check('zh 动态: 1 tool', tToolCount1.nodeValue, '1 个工具');
  check('zh 动态: Exported 3 conversations', tSummary.nodeValue, '导出了 3 个对话');
  check('zh 动态: Imported 1 conversation', tSummary2.nodeValue, '导入了 1 个对话');
  check('zh 动态: ... and 5 more', tAndMore.nodeValue, '… 以及另外 5 个');
  check('zh 动态: Skipped N already in library', tSkipped.nodeValue, '已跳过资料库中已有的 2 个对话');
  check('zh 动态: Failed to parse file: X', tParse.nodeValue, '解析文件失败：not a zip');
}

// 12) 真实 zh-CN 字典：第二批主 UI（侧栏/聊天/通用按钮）代表键回归
{
  const tNewChat = tx('New chat');
  const tStop = tx('Stop');
  const tSettings = tx('Settings');
  const tModel = tx('Model');
  const tTemp = tx('Temperature');
  const root12 = el('html', {}, [tNewChat, tStop, tSettings, tModel, tTemp]);
  const win12 = { addEventListener() {}, parent: null, location: { search: '?lang=zh-CN' } };
  const doc12 = { documentElement: root12, readyState: 'complete', addEventListener() {} };
  const ctx12 = vm.createContext({
    document: doc12, window: win12, navigator: { language: 'en-US' },
    localStorage: { getItem: () => null }, setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, console,
  });
  vm.runInContext(code, ctx12);
  check('zh 主UI: New chat', tNewChat.nodeValue, '新建对话');
  check('zh 主UI: Stop', tStop.nodeValue, '停止');
  check('zh 主UI: Settings', tSettings.nodeValue, '设置');
  check('zh 主UI: Model', tModel.nodeValue, '模型');
  check('zh 主UI: Temperature', tTemp.nodeValue, '温度');
}

// 13) 真实 zh-CN 字典：MCP 服务器编辑表单（McpServerForm.svelte）相关串回归
{
  const tAuth = tx('Authorization');
  const tBearer = tx('Bearer');
  const tPaste = tx('Paste token here');
  const tAdd = tx('Add');
  const tEmpty = tx('No custom headers configured.');
  const tHName = tx('Header name');
  const tCHeaders = tx('Custom Headers');
  const tValue = tx('Value');
  const root13 = el('html', {}, [tAuth, tBearer, tPaste, tAdd, tEmpty, tHName, tCHeaders, tValue]);
  const win13 = { addEventListener() {}, parent: null, location: { search: '?lang=zh-CN' } };
  const doc13 = { documentElement: root13, readyState: 'complete', addEventListener() {} };
  const ctx13 = vm.createContext({
    document: doc13, window: win13, navigator: { language: 'en-US' },
    localStorage: { getItem: () => null }, setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, console,
  });
  vm.runInContext(code, ctx13);
  check('zh MCP表单: Authorization', tAuth.nodeValue, '授权');
  check('zh MCP表单: Bearer(HTTP方案名保留)', tBearer.nodeValue, 'Bearer');
  check('zh MCP表单: Paste token here', tPaste.nodeValue, '在此粘贴令牌');
  check('zh MCP表单: Add', tAdd.nodeValue, '添加');
  check('zh MCP表单: No custom headers (含句点)', tEmpty.nodeValue, '尚未配置自定义请求头。');
  check('zh MCP表单: Header name', tHName.nodeValue, '请求头名称');
  check('zh MCP表单: Custom Headers', tCHeaders.nodeValue, '自定义请求头');
  check('zh MCP表单: Value', tValue.nodeValue, '值');
}

// 14) 真实 zh-CN 字典：都处理批次（设置页底部/侧栏批量选择条/会话右键菜单/消息操作/上下文量规）
//     覆盖用户列出的 14 串 + 各出处其他未翻串；动态串走本批次新增的 6 条 PATTERNS。
{
  const tResetDef = tx('Reset to Default');
  const tPin = tx('Pin');
  const tUnpin = tx('Unpin');
  const tPinAll = tx('Pin all');
  const tUnpinAll = tx('Unpin all');
  const tSelectAll = tx('Select all');
  const tDeselectAll = tx('Deselect all');
  const tExportSel = tx('Export selected');
  const tDelSel = tx('Delete selected');
  const tExitBulk = tx('Exit bulk selection mode');
  const tMixed = tx('Unavailable for mixed state selection');
  const tMore = tx('More actions');
  const tCopy = tx('Copy');
  const tRegen = tx('Regenerate');
  const tFork = tx('Fork conversation');
  const tDelMsg = tx('Are you sure you want to delete this message? This action cannot be undone.');
  const tCopied = tx('Message copied to clipboard');
  const tUsed = tx('used');
  const tRemaining = tx('1234 remaining');
  const tSelect = tx('Select');
  // 动态串（走 PATTERNS）
  const tSelCount = tx('3 / 5 selected');
  const tDelConv1 = tx('Delete 1 conversation');
  const tDelConv2 = tx('Delete 2 conversations');
  const tDelMsgN = tx('Delete 4 Messages');
  const tDelConvDesc = tx('This action cannot be undone. The selected conversation and its messages will be permanently removed, including any forks.');
  const tDelConvDescPlural = tx('This action cannot be undone. The selected conversations and their messages will be permanently removed, including any forks.');
  const tDelMsgDesc = tx('This will delete 3 messages including: 2 user messages and 1 assistant response. All messages in this branch and their responses will be permanently removed. This action cannot be undone.');
  const tResetDesc = tx('Are you sure you want to reset all settings to their default values? This will reset all parameters to the values provided by the server\'s /props endpoint and remove all your custom configurations.');
  const root14 = el('html', {}, [
    tResetDef, tPin, tUnpin, tPinAll, tUnpinAll, tSelectAll, tDeselectAll, tExportSel, tDelSel,
    tExitBulk, tMixed, tMore, tCopy, tRegen, tFork, tDelMsg, tCopied, tUsed, tRemaining, tSelect,
    tSelCount, tDelConv1, tDelConv2, tDelMsgN, tDelConvDesc, tDelConvDescPlural, tDelMsgDesc, tResetDesc,
  ]);
  const win14 = { addEventListener() {}, parent: null, location: { search: '?lang=zh-CN' } };
  const doc14 = { documentElement: root14, readyState: 'complete', addEventListener() {} };
  const ctx14 = vm.createContext({
    document: doc14, window: win14, navigator: { language: 'en-US' },
    localStorage: { getItem: () => null }, setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, console,
  });
  vm.runInContext(code, ctx14);
  check('zh 都处理: Reset to Default', tResetDef.nodeValue, '恢复为默认');
  check('zh 都处理: Pin', tPin.nodeValue, '固定');
  check('zh 都处理: Unpin', tUnpin.nodeValue, '取消固定');
  check('zh 都处理: Pin all', tPinAll.nodeValue, '全部固定');
  check('zh 都处理: Unpin all', tUnpinAll.nodeValue, '全部取消固定');
  check('zh 都处理: Select all', tSelectAll.nodeValue, '全选');
  check('zh 都处理: Deselect all', tDeselectAll.nodeValue, '取消全选');
  check('zh 都处理: Export selected', tExportSel.nodeValue, '导出所选');
  check('zh 都处理: Delete selected', tDelSel.nodeValue, '删除所选');
  check('zh 都处理: Exit bulk selection mode', tExitBulk.nodeValue, '退出批量选择模式');
  check('zh 都处理: Unavailable for mixed state', tMixed.nodeValue, '混合选择状态下不可用');
  check('zh 都处理: More actions', tMore.nodeValue, '更多操作');
  check('zh 都处理: Copy', tCopy.nodeValue, '复制');
  check('zh 都处理: Regenerate', tRegen.nodeValue, '重新生成');
  check('zh 都处理: Fork conversation', tFork.nodeValue, '分支此对话');
  check('zh 都处理: 删除消息确认', tDelMsg.nodeValue, '确定要删除此消息吗？此操作不可撤销。');
  check('zh 都处理: Message copied to clipboard', tCopied.nodeValue, '消息已复制到剪贴板');
  check('zh 都处理: used', tUsed.nodeValue, '已用');
  check('zh 都处理: 1234 remaining (动态)', tRemaining.nodeValue, '剩余 1234');
  check('zh 都处理: Select', tSelect.nodeValue, '选择');
  // 动态 PATTERNS
  check('zh 动态: 3 / 5 selected', tSelCount.nodeValue, '3 / 5 项已选');
  check('zh 动态: Delete 1 conversation', tDelConv1.nodeValue, '删除 1 个对话');
  check('zh 动态: Delete 2 conversations', tDelConv2.nodeValue, '删除 2 个对话');
  check('zh 动态: Delete 4 Messages', tDelMsgN.nodeValue, '删除 4 条消息');
  check('zh 动态: 删除对话确认(单数)', tDelConvDesc.nodeValue, '此操作不可撤销。所选对话 及其消息将被永久移除，包括任何分支。');
  check('zh 动态: 删除对话确认(复数)', tDelConvDescPlural.nodeValue, '此操作不可撤销。所选的全部对话 及其消息将被永久移除，包括任何分支。');
  check('zh 动态: 删除多条消息确认', tDelMsgDesc.nodeValue, '将删除 3 条消息，包括：2 条用户消息和 1 条助手回复。该分支中的所有消息及其回复将被永久移除。此操作不可撤销。');
  check('zh 动态: 重置设置确认', tResetDesc.nodeValue, '确定要将所有设置重置为默认值吗？这将把所有参数重置为服务端 /props 接口提供的值，并移除你所有的自定义配置。');
}

// 15) 授权卡片 / 统计 / 处理状态 / 附件菜单（本轮"开始翻译"批次）
{
  const tProc = tx('Processing...');
  const tReason = tx('Reasoning...');
  const tCancel = tx('Cancelled');
  const tPtok = tx('Prompt tokens');
  const tGtok = tx('Generated tokens');
  const tGspd = tx('Generation speed');
  const tPrev = tx('Previous version');
  const tNext = tx('Next version');
  const tCopy = tx('Copied to clipboard');
  const tGreet = tx('Type a message or upload files to get started');
  const tVision = tx('Vision');
  const tAudio = tx('Audio');
  const tAllow = tx('Allow use of get_info from Browser Tools?');
  // 动态串（走 PATTERNS）
  const tPct = tx('Processing 42%');
  const tEta = tx('Processing 42% (ETA: 3s)');
  const tCtx = tx('Context: 10/100 (10%)');
  const tOut = tx('Output: 50/∞');
  const tSpd = tx('1.2 t/s');
  const root15 = el('html', {}, [
    tProc, tReason, tCancel, tPtok, tGtok, tGspd, tPrev, tNext, tCopy, tGreet, tVision, tAudio, tAllow,
    tPct, tEta, tCtx, tOut, tSpd,
  ]);
  const win15 = { addEventListener() {}, parent: null, location: { search: '?lang=zh-CN' } };
  const doc15 = { documentElement: root15, readyState: 'complete', addEventListener() {} };
  const ctx15 = vm.createContext({
    document: doc15, window: win15, navigator: { language: 'en-US' },
    localStorage: { getItem: () => null }, setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, console,
  });
  vm.runInContext(code, ctx15);
  check('zh 批次15: Processing...', tProc.nodeValue, '处理中…');
  check('zh 批次15: Reasoning...', tReason.nodeValue, '推理中…');
  check('zh 批次15: Cancelled', tCancel.nodeValue, '已取消');
  check('zh 批次15: Prompt tokens', tPtok.nodeValue, '提示词 token 数');
  check('zh 批次15: Generated tokens', tGtok.nodeValue, '生成的 token 数');
  check('zh 批次15: Generation speed', tGspd.nodeValue, '生成速度');
  check('zh 批次15: Previous version', tPrev.nodeValue, '上一版本');
  check('zh 批次15: Next version', tNext.nodeValue, '下一版本');
  check('zh 批次15: Copied to clipboard', tCopy.nodeValue, '已复制到剪贴板');
  check('zh 批次15: 欢迎语(内部空白归一化)', tGreet.nodeValue, '输入消息，或上传文件以开始');
  check('zh 批次15: Vision', tVision.nodeValue, '视觉');
  check('zh 批次15: Audio', tAudio.nodeValue, '音频');
  check('zh 批次15: 授权卡片', tAllow.nodeValue, '允许使用来自 Browser Tools 的 get_info 吗？');
  check('zh 批次15: 动态 Processing 42%', tPct.nodeValue, '处理中 42%');
  check('zh 批次15: 动态 ETA', tEta.nodeValue, '处理中 42%（预计剩余 3 秒）');
  check('zh 批次15: 动态 Context', tCtx.nodeValue, '上下文：10/100（10%）');
  check('zh 批次15: 动态 Output', tOut.nodeValue, '输出：50/∞');
  check('zh 批次15: 动态 t/s', tSpd.nodeValue, '1.2 t/s');
}

  // 16) 分支/移除/占位/滚动/模型信息复制 批次
  const tFork = tx('Conversation forked');
  const tRemove = tx('Remove');
  const tType = tx('Type a message...');
  const tScroll = tx('Scroll to bottom');
  const tName = tx('Copy model name to clipboard');
  const tPath = tx('Copy model path to clipboard');
  const tTokens = tx('tokens');
  const root16 = el('html', {}, [tFork, tRemove, tType, tScroll, tName, tPath, tTokens]);
  const win16 = { addEventListener() {}, parent: null, location: { search: '?lang=zh-CN' } };
  const doc16 = { documentElement: root16, readyState: 'complete', addEventListener() {} };
  const ctx16 = vm.createContext({
    document: doc16, window: win16, navigator: { language: 'en-US' },
    localStorage: { getItem: () => null }, setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, console,
  });
  vm.runInContext(code, ctx16);
  check('批次16: Conversation forked->对话已分支', tFork.nodeValue, '对话已分支');
  check('批次16: Remove->移除', tRemove.nodeValue, '移除');
  check('批次16: Type a message...->输入消息…', tType.nodeValue, '输入消息…');
  check('批次16: Scroll to bottom->滚动到底部', tScroll.nodeValue, '滚动到底部');
  check('批次16: Copy model name->已复制模型名称到剪贴板', tName.nodeValue, '已复制模型名称到剪贴板');
  check('批次16: Copy model path->已复制模型路径到剪贴板', tPath.nodeValue, '已复制模型路径到剪贴板');
  check('批次16: tokens->tokens（保留英语）', tTokens.nodeValue, 'tokens');

// 17) ja / ko 冒烟测试：验证拆分后的日/韩语字典已正确合并到单文件并可翻译
function smokeLang(lang, cases) {
  const nodes = cases.map(([k]) => tx(k));
  const rootX = el('html', {}, nodes);
  const winX = { addEventListener() {}, parent: null, location: { search: '?lang=' + lang } };
  const docX = { documentElement: rootX, readyState: 'complete', addEventListener() {} };
  const ctxX = vm.createContext({
    document: docX, window: winX, navigator: { language: 'en-US' },
    localStorage: { getItem: () => null }, setInterval: () => 0, clearInterval: () => {},
    URLSearchParams, console,
  });
  vm.runInContext(code, ctxX);
  cases.forEach(([k, want], i) => check(lang + ' 冒烟: ' + k, nodes[i].nodeValue, want));
}
smokeLang('ja', [
  ['Send', '送信'],
  ['Stop', '停止'],
  ['Theme', 'テーマ'],
  ['Agentic', 'エージェント'],
  ['Load model', 'モデルを読み込む'],
  ['Generated tokens', '生成トークン数'],
  ['remaining', '残り'],
]);
smokeLang('ko', [
  ['Send', '보내기'],
  ['Stop', '중지'],
  ['Theme', '테마'],
  ['Agentic', '에이전틱'],
  ['Load model', '모델 로드'],
  ['Generated tokens', '생성된 토큰 수'],
  ['remaining', '남음'],
]);
smokeLang('zh-TW', [
  ['Send', '傳送'],
  ['Stop', '停止'],
  ['Theme', '主題'],
  ['Agentic', '代理'],
  ['Load model', '載入模型'],
  ['Generated tokens', '生成的 token 數'],
  ['remaining', '剩餘'],
]);
smokeLang('de', [
  ['Send', 'Senden'],
  ['Stop', 'Stopp'],
  ['Theme', 'Farbschema'],
  ['Agentic', 'Agentisch'],
  ['Load model', 'Modell laden'],
  ['Generated tokens', 'Erzeugte Tokens'],
  ['remaining', 'übrig'],
]);
smokeLang('fr', [
  ['Send', 'Envoyer'],
  ['Stop', 'Arrêter'],
  ['Theme', 'Thème'],
  ['Agentic', 'Agentique'],
  ['Load model', 'Charger le modèle'],
  ['Generated tokens', 'Tokens générés'],
  ['remaining', 'restants'],
]);
smokeLang('ru', [
  ['Send', 'Отправить'],
  ['Stop', 'Остановить'],
  ['Theme', 'Тема'],
  ['Agentic', 'Агентный режим'],
  ['Load model', 'Загрузить модель'],
  ['Generated tokens', 'Сгенерировано токенов'],
  ['remaining', 'осталось'],
]);
smokeLang('es', [
  ['Send', 'Enviar'],
  ['Stop', 'Detener'],
  ['Theme', 'Tema'],
  ['Agentic', 'Agéntico'],
  ['Load model', 'Cargar modelo'],
  ['Generated tokens', 'Tokens generados'],
  ['remaining', 'restantes'],
]);
smokeLang('pt', [
  ['Send', 'Enviar'],
  ['Stop', 'Parar'],
  ['Theme', 'Tema'],
  ['Agentic', 'Agente'],
  ['Load model', 'Carregar modelo'],
  ['Generated tokens', 'Tokens gerados'],
  ['remaining', 'restantes'],
]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
