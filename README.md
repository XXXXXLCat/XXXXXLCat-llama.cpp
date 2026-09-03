# XXXXXLCat-llama.cpp

基于 **Tauri 2 + React 19 + Vite + shadcn/ui（Base UI）** 的 **llama.cpp 桌面启动器**。在 Windows 上以图形界面可视化配置 `llama-server` 参数、一键启动 / 停止本地推理服务、查看运行日志并打开内置 Web UI，免去记忆命令行参数的负担。

## 功能特性

- **自绘标题栏**：整条为窗口拖拽区，右侧含最小化 / 最大化(还原) / 关闭按钮；标题栏状态徽标实时显示 llama.cpp 运行状态，**点击徽标跳转「控制台」页**。
- **三态状态指示**：
  - `llama.cpp 未启动` —— 红色（destructive），无前置图标
  - `模型加载中` —— 次要色，转圈图标
  - `llama.cpp 运行中` —— 主色，转圈图标
- **四大页面**（左侧导航）：
  - **控制台**：一键启动 / 停止服务，状态总览，「打开 Web UI」按钮（监听地址为 `0.0.0.0` 时本机自动改用 `127.0.0.1`；关闭内置 Web UI 后按钮自动禁用）。
  - **模型**：选择主模型与视觉投影 `mmproj`，模型根目录可配置，支持自动匹配置信度提示。
  - **运行日志**：实时滚动显示 `llama-server` 标准输出 / 错误。
  - **设置**：服务监听（host / port）、GPU 层数、上下文长度、采样参数（top-k / temperature / top-p / repeat-penalty / repeat-last-n / seed 等）、Flash Attention、内置 Web UI 开关等，每个参数均附说明文字。
- **浏览器预览降级**：`vite dev` 下前端自动切换为 mock 实现（配置存 localStorage），无需 Rust 编译即可查看与调试全部 UI。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端构建 | Vite + TypeScript |
| UI 框架 | React 19 |
| 组件库 | Tailwind CSS 4 + shadcn/ui（Base UI primitives） |
| 状态 / 路由 | TanStack Query + React Router |
| 桌面壳 | Tauri 2（Rust） |
| 推理引擎 | `llama-server`（llama.cpp，外部二进制） |

## 环境要求（本机已验证）

| 工具 | 用途 |
| --- | --- |
| Node.js | JS/TS 运行时（开发服务器 / 前端构建） |
| Rust / Cargo | Tauri 后端编译 |
| VS Build Tools（C++ workload） | Windows 上编译 Rust/Tauri 必需 |
| WebView2 | Tauri 渲染内核 |

> 桌面端运行需本机已放置 `llama-server.exe`（llama.cpp 官方二进制），并在设置中指定其路径与模型目录。

## 开发与构建

```bash
npm install            # 安装依赖（首次）
npm run dev            # 前端开发服务器（HMR，mock 模式，无需 Rust 编译）
npm run build          # 类型检查 + 生产构建（tsc -b && vite build）
npm run lint           # ESLint
npm run preview        # 预览生产构建

npm run tauri dev      # 桌面应用开发模式（首次自动编译 Rust，约 2–3 分钟）
npm run tauri build    # 发布打包：生成 Windows 安装包 / 便携 exe
```

## 目录结构

```
src/
  App.tsx              # 应用入口与路由（/ 控制台, /models 模型, /logs 日志, /settings 设置）
  components/
    title-bar.tsx      # 自绘标题栏（拖拽区 + 窗口控制 + 状态徽标）
    app-sidebar.tsx    # 左侧导航
    status-pill.tsx    # 三态状态徽标
    ui/                # shadcn/ui 组件库
  hooks/use-launcher.tsx   # 启动 / 停止 / 状态轮询
  lib/
    tauri-api.ts       # 命令封装（Tauri 运行时 / 浏览器 mock 自动分派）
    tauri-mock.ts      # 纯浏览器模拟层（配置存 localStorage）
  pages/               # 控制台 / 模型 / 运行日志 / 设置 四个页面
src-tauri/
  src/
    lib.rs             # Tauri 命令注册
    server.rs          # 启动 / 停止 llama-server、参数拼装、端点探测
    commands.rs        # 命令实现（open_in_shell 等）
    types.rs           # LaunchConfig 等配置结构（serde）
  capabilities/default.json  # 权限清单
  tauri.conf.json      # 窗口配置（decorations: false，自绘标题栏）
```

## 说明

- **配置生效**：设置页所有参数经 `build_args` 拼装为 `llama-server` 启动参数，预览与真实启动共用同一套拼装逻辑，所见即所得。
- **运行环境自适应**：`isTauriRuntime()` 守卫使浏览器 mock 与 Tauri 桌面两条路径安全共存；新增命令请同步 Rust `types.rs` 默认值与 `tauri-mock.ts` 模拟实现。
