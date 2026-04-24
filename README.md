# SMP Code

<div align="center">

**基于 Electron + React + TypeScript 的 AI 辅助代码编辑器**

[![Electron](https://img.shields.io/badge/Electron-29.4.6-47848F?style=flat&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.2.0-61DAFB?style=flat&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4.3-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Monaco Editor](https://img.shields.io/badge/Monaco-0.55.1-007ACC?style=flat&logo=visual-studio-code&logoColor=white)](https://microsoft.github.io/monaco-editor/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>

---

## 📖 项目简介

SMP Code 是一款对标 VSCode 的现代化 AI 辅助代码编辑器，采用 Electron + React 技术栈构建。项目深度融合了 AI 对话、代码智能提示、文件管理、终端等核心功能，为开发者提供一站式编码体验。

### ✨ 核心特色

- 🎨 **VSCode 风格界面**：完整的 ActivityBar、Sidebar、Editor、StatusBar 布局
- 🤖 **AI 智能助手**：集成 Anthropic Claude 等大语言模型，支持 Agent 和 Chat 双模式
- 💻 **专业代码编辑**：基于 Monaco Editor，支持语法高亮、代码补全、多语言
- 🔍 **全局搜索**：文件内容搜索、替换、结果高亮、一键跳转
-  **文件资源管理器**：树形结构展示、拖拽操作、隐藏文件显示
- 🖥️ **集成终端**：原生 PTY 终端，支持 zsh/bash，自动切换项目目录
- ⌨️ **命令面板**：Ctrl+Shift+P 快速访问所有命令
- 🔀 **编辑器分屏**：支持水平和垂直分屏，可拖拽调整大小
- 🎯 **会话管理**：多会话支持，可创建、切换、重命名、删除

---

## 🛠️ 技术栈

### 核心技术

| 技术 | 版本 | 用途 |
|------|------|------|
| **Electron** | 29.4.6 | 跨平台桌面应用框架 |
| **React** | 18.2.0 | 前端 UI 框架 |
| **TypeScript** | 5.4.3 | 类型安全的 JavaScript |
| **Vite** | 5.2.6 | 现代化构建工具 |
| **electron-vite** | 2.1.0 | Electron + Vite 集成 |

### 代码编辑

| 技术 | 版本 | 用途 |
|------|------|------|
| **Monaco Editor** | 0.55.1 | VSCode 同款代码编辑器 |
| **@monaco-editor/react** | 4.7.0 | Monaco React 封装 |
| **Shiki** | 4.0.2 | 高性能语法高亮引擎 |
| **CodeMirror 6** | 6.x | 轻量级代码编辑器（备选） |

### AI 与 LLM

| 技术 | 版本 | 用途 |
|------|------|------|
| **@anthropic-ai/sdk** | 0.24.0 | Claude API 客户端 |
| **react-markdown** | 10.1.0 | Markdown 渲染 |
| **remark-gfm** | 4.0.1 | GitHub Flavored Markdown |
| **rehype-raw** | 7.0.0 | HTML 解析 |

### 终端与进程

| 技术 | 版本 | 用途 |
|------|------|------|
| **node-pty** | 1.1.0 | 原生伪终端 |
| **@xterm/xterm** | 6.0.0 | 终端模拟器 |
| **@xterm/addon-fit** | 0.11.0 | 终端自适应 |
| **@xterm/addon-web-links** | 0.12.0 | 终端链接识别 |

### 状态管理

| 技术 | 版本 | 用途 |
|------|------|------|
| **Zustand** | 4.5.2 | 轻量级状态管理 |
| **electron-store** | 8.2.0 | 持久化存储 |

### 其他关键依赖

| 技术 | 版本 | 用途 |
|------|------|------|
| **lucide-react** | 1.8.0 | 图标库 |
| **simple-git** | 3.36.0 | Git 操作 |
| **uuid** | 9.0.1 | UUID 生成 |
| **electron-log** | 5.1.2 | 日志记录 |
| **electron-updater** | 6.1.8 | 自动更新 |
| **express** | 4.18.2 | HTTP 服务器（API） |
| **glob** | 13.0.6 | 文件匹配 |

---

## 📁 项目结构

```
claw-code-web/
├── electron/                    # Electron 主进程代码
│   ├── main/
│   │   ├── index.ts            # 主进程入口
│   │   ├── api-server.ts       # HTTP API 服务器
│   │   ├── config-service.ts   # 配置管理
│   │   ├── cli/                # 命令行接口
│   │   ├── core/               # 核心模块（命令、工具、模型等）
│   │   └── services/           # 业务服务层
│   │       ├── anthropic-service.ts      # Claude API 服务
│   │       ├── code-intelligence-service.ts  # 代码智能服务
│   │       ├── files-service.ts          # 文件服务
│   │       ├── git-service.ts            # Git 服务
│   │       ├── llm-service.ts            # LLM 服务
│   │       ├── search-service.ts         # 搜索服务
│   │       ├── terminal-service.ts       # 终端服务
│   │       └── tools-*.ts                # 工具调用相关
│   └── preload/
│       └── index.ts            # 预加载脚本
│
├── src/renderer/               # React 渲染进程代码
│   ├── src/
│   │   ├── components/         # React 组件
│   │   │   ├── ActivityBar.tsx         # 活动栏
│   │   │   ├── ChatArea.tsx            # 聊天区域
│   │   │   ├── CommandPalette.tsx      # 命令面板
│   │   │   ├── FileExplorer.tsx        # 文件浏览器
│   │   │   ├── FileTabs.tsx            # 文件标签页
│   │   │   ├── FileViewer.tsx          # 文件查看器
│   │   │   ├── MonacoEditor.tsx        # Monaco 编辑器
│   │   │   ├── SearchPanel.tsx         # 搜索面板
│   │   │   ├── SessionBar.tsx          # 会话栏
│   │   │   ├── SessionSidebar.tsx      # 会话侧边栏
│   │   │   ├── StatusBar.tsx           # 状态栏
│   │   │   ├── Terminal.tsx            # 终端组件
│   │   │   └── ...
│   │   ├── hooks/              # 自定义 Hooks
│   │   │   ├── useAgentMode.ts         # Agent 模式 Hook
│   │   │   ├── useChatMode.ts          # Chat 模式 Hook
│   │   │   ├── useCodeCompletion.ts    # 代码补全 Hook
│   │   │   └── useCodeIntelligence.ts  # 代码智能 Hook
│   │   ├── prompts/            # AI 提示词模块
│   │   │   ├── agent-prompt.ts         # Agent 模式提示词
│   │   │   ├── chat-prompt.ts          # Chat 模式提示词
│   │   │   ├── copilot-prompts.ts      # Copilot 提示词
│   │   │   ├── shared.ts               # 共享提示词
│   │   │   └── types.ts                # 提示词类型
│   │   ├── store/              # 全局状态（Zustand）
│   │   │   └── index.ts
│   │   ├── stores/             # 其他 Store
│   │   │   └── searchStore.ts
│   │   ├── styles/             # CSS 样式
│   │   │   ├── index.css               # 主样式
│   │   │   ├── builder.css             # 构建器样式
│   │   │   ├── completion.css          # 代码补全样式
│   │   │   └── ...
│   │   ├── utils/              # 工具函数
│   │   │   ├── fileIconTheme.ts        # 文件图标主题
│   │   │   ├── languageMap.ts          # 语言映射
│   │   │   └── shikiHighlighter.ts     # Shiki 高亮
│   │   ├── i18n/               # 国际化
│   │   │   └── index.ts
│   │   ├── App.tsx             # 根组件
│   │   └── main.tsx            # React 入口
│   └── index.html
│
├── resources/                  # 静态资源
│   ├── icon.png                # 应用图标
│   └── reference_data/         # 参考数据
│
├── scripts/                    # 构建脚本
│   ├── afterPack.js            # 打包后处理
│   ├── run-unsigned.sh         # 运行未签名应用
│   └── sign-mac.sh             # macOS 签名
│
├── out/                        # 编译输出
│   ├── main/                   # 主进程
│   ├── preload/                # 预加载
│   └── renderer/               # 渲染进程
│
├── dist/                       # 打包输出
│   └── mac-arm64/              # macOS ARM64 版本
│
├── electron-builder.json       # Electron Builder 配置
├── electron.vite.config.ts     # Vite 配置
├── package.json                # 项目依赖
└── tsconfig.json               # TypeScript 配置
```

---

## 🚀 快速开始

### 环境要求

- **Node.js**: >= 18.0.0
- **npm**: >= 9.0.0
- **操作系统**: macOS 10.12+ / Windows 10+ / Linux

### 安装依赖

```bash
cd claw-code-web
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建项目

```bash
# 编译代码
npm run build

# 打包 macOS (ARM64)
npm run build:mac

# 打包 Windows
npm run build:win

# 打包 Linux
npm run build:linux

# 仅解包（不创建安装包）
npm run build:unpack
```

### 运行应用

```bash
# 开发模式
npm run dev

# 运行打包后的应用 (macOS)
open dist/mac-arm64/SMP\ Code.app
```

---

## ✅ 已完成功能

### 界面与布局

- ✅ **ActivityBar（活动栏）**：左侧图标导航，支持 Explorer、Search、Git、Extensions、AI Assistant
- ✅ **Sidebar（侧边栏）**：可切换的文件浏览器和搜索面板
- ✅ **FileTabs（文件标签页）**：支持拖拽排序、预览模式、多标签管理
- ✅ **StatusBar（状态栏）**：Git 分支、错误/警告、Token 使用、光标位置、语言模式
- ✅ **SessionBar（会话栏）**：顶部横向会话管理，支持创建、切换、重命名、删除
- ✅ **macOS 原生标题栏**：适配交通灯按钮

### 代码编辑

- ✅ **Monaco Editor**：VSCode 同款编辑器，支持 50+ 语言
- ✅ **语法高亮**：基于 Shiki，精准的语言高亮
- ✅ **代码补全**：智能提示、自动补全
- ✅ **光标追踪**：实时更新状态栏行号列号
- ✅ **文件保存**：自动保存、手动保存（Ctrl+S）
- ✅ **多标签编辑**：同时打开多个文件

### 文件管理

- ✅ **文件资源管理器**：树形结构展示项目文件
- ✅ **文件操作**：新建、重命名、删除、刷新
- ✅ **隐藏文件显示**：支持显示 .gitignore、.DS_Store 等隐藏文件
- ✅ **node_modules 显示**：完整显示所有目录
- ✅ **文件图标**：基于文件类型的图标主题

### 搜索功能

- ✅ **全局搜索**：文件内容搜索（grep 风格）
- ✅ **文件过滤**：支持 include/exclude patterns
- ✅ **替换功能**：搜索并替换文本
- ✅ **结果高亮**：匹配文本高亮显示
- ✅ **一键跳转**：点击结果跳转到对应行

### AI 助手

- ✅ **Chat Mode（智能问答）**：对话式 AI 助手
- ✅ **Agent Mode（智能体）**：自主执行任务的 AI 代理
- ✅ **多模型支持**：支持 Claude、OpenAI 等多种模型
- ✅ **上下文管理**：自动注入项目上下文
- ✅ **工具调用**：AI 可以调用文件操作、终端等工具
- ✅ **流式输出**：实时显示 AI 响应
- ✅ **图片支持**：支持上传和分析图片
- ✅ **会话管理**：多会话历史记录

### 终端

- ✅ **集成终端**：基于 node-pty 的原生终端
- ✅ **Shell 检测**：自动检测系统默认 Shell（zsh/bash）
- ✅ **Login Shell**：以 login shell 模式启动，加载完整配置
- ✅ **自动切换目录**：启动时自动 cd 到项目目录
- ✅ **终端管理**：支持多终端、重命名、关闭

### 命令系统

- ✅ **命令面板**：Ctrl+Shift+P 快速访问命令
- ✅ **快捷键系统**：全局快捷键支持
- ✅ **模糊搜索**：命令模糊匹配
- ✅ **键盘导航**：↑↓ 导航，Enter 执行，Esc 关闭

### 编辑器增强

- ✅ **分屏功能**：支持水平和垂直分屏
- ✅ **拖拽调整**：可拖拽调整分屏大小
- ✅ **Breadcrumbs**：文件路径面包屑导航
- ✅ **Diff Viewer**：文件差异对比查看器

### Git 集成

- ✅ **Git 状态**：状态栏显示当前分支
- ✅ **Git 操作**：支持基本的 Git 命令执行
- ✅ **状态监控**：实时监控文件变更状态

### 配置与设置

- ✅ **设置对话框**：可视化配置界面
- ✅ **模型配置**：添加、编辑、删除 API 模型
- ✅ **Provider 管理**：支持多 AI 提供商
- ✅ **持久化存储**：配置自动保存到本地

---

## 🎯 技术亮点

### 1. 模块化架构

项目采用清晰的三层架构：

```
┌─────────────────────────────────────┐
│         Renderer (React)            │
│  - UI 组件                           │
│  - 状态管理 (Zustand)                │
│  - 用户交互                          │
├─────────────────────────────────────┤
│         IPC Bridge                  │
│  - 主进程与渲染进程通信              │
│  - 类型安全的 API 调用               │
├─────────────────────────────────────┤
│         Main (Node.js)              │
│  - 文件系统操作                      │
│  - 终端管理                          │
│  - AI API 调用                       │
│  - Git 操作                          │
└─────────────────────────────────────┘
```

### 2. 提示词工程

采用模块化的提示词系统：

```typescript
prompts/
├── agent-prompt.ts    # Agent 模式提示词（工具调用、任务执行）
├── chat-prompt.ts     # Chat 模式提示词（问答、建议）
├── copilot-prompts.ts # Copilot 功能提示词
├── shared.ts          # 共享提示词（系统信息、规则）
└── types.ts           # 提示词类型定义
```

### 3. 类型安全

全项目采用 TypeScript，确保：

- ✅ 主进程与渲染进程通信类型安全
- ✅ API 调用参数校验
- ✅ 组件 Props 类型检查
- ✅ 状态管理类型推导

### 4. 性能优化

- ✅ **代码分割**：Vite 自动代码分割
- ✅ **懒加载**：Monaco Editor 按需加载语言包
- ✅ **虚拟滚动**：大列表优化（待实现）
- ✅ **防抖节流**：搜索、保存等操作防抖
- ✅ **透明滚动条**：不占用布局空间的滚动条

### 5. 跨平台支持

- ✅ **macOS**：原生标题栏、交通灯按钮、签名支持
- ✅ **Windows**：打包配置完整
- ✅ **Linux**：打包配置完整

---

## 📊 项目统计

### 代码量

| 类别 | 文件数 | 代码行数 |
|------|--------|----------|
| TypeScript/React | ~60 | ~8,000 |
| CSS | ~7 | ~8,000 |
| 总计 | ~67 | ~16,000 |

### 构建产物

| 文件 | 大小 |
|------|------|
| Main Process | 261 KB |
| Preload | 7.7 KB |
| Renderer JS | 1.75 MB |
| Renderer CSS | 199 KB |
| ASAR 包 | ~158 MB |
| 完整应用 | ~407 MB |

---

## 🔧 配置说明

### electron-builder.json

```json
{
  "appId": "com.smpcode.app",
  "productName": "SMP Code",
  "mac": {
    "category": "public.app-category.developer-tools",
    "target": ["dir"],
    "icon": "resources/icon.png"
  },
  "asar": true,
  "asarUnpack": ["**/*.node", "**/node-pty/**/*"]
}
```

### Vite 配置

```typescript
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['node-pty']  // 原生模块外部化
      }
    }
  },
  renderer: {
    plugins: [react()],
    optimizeDeps: {
      include: ['monaco-editor']  // Monaco 优化
    }
  }
})
```

---

## 🐛 故障排查

### 问题 1: node-pty 编译失败

**症状**: `npm install` 时报错  
**解决**:
```bash
# macOS
xcode-select --install

# 重新安装
rm -rf node_modules
npm install
```

### 问题 2: 终端无法启动

**症状**: 终端显示空白  
**解决**: 检查 `electron/main/services/terminal-service.ts` 日志

### 问题 3: Monaco Editor 高亮异常

**症状**: 代码无高亮或高亮错误  
**解决**: 检查 Shiki 语言包是否正确加载

### 问题 4: 应用无法启动

**症状**: 点击无反应  
**解决**:
```bash
# 查看日志 (macOS)
log stream --predicate 'process == "SMP Code"' --info
```

---

## 📝 开发规范

### 代码风格

- 使用 ESLint + Prettier
- TypeScript 严格模式
- React 函数组件 + Hooks

### 提交规范

```
feat: 新功能
fix: 修复 bug
docs: 文档更新
style: 代码格式
refactor: 重构
test: 测试
chore: 构建/工具
```

### 分支管理

- `main`: 主分支，稳定版本
- `develop`: 开发分支
- `feature/*`: 功能分支
- `bugfix/*`: 修复分支

---

## 🗺️ 路线图

### 短期（1-2 周）

- [ ] Git 面板完整集成（暂存、提交、推送）
- [ ] 扩展管理系统
- [ ] 标签页预览模式完善
- [ ] 代码折叠功能

### 中期（1-2 月）

- [ ] 调试器集成（断点、变量监视）
- [ ] 多工作区支持
- [ ] 自定义主题系统
- [ ] 代码片段管理

### 长期（3-6 月）

- [ ] 插件系统（API + 沙箱）
- [ ] 远程开发（SSH、容器）
- [ ] 协作编辑（实时协同）
- [ ] AI 代码生成（Copilot 风格）

---

## 🤝 贡献指南

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 提交 Pull Request

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- [Electron](https://www.electronjs.org/) - 跨平台桌面应用框架
- [React](https://react.dev/) - 前端 UI 框架
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - VSCode 同款编辑器
- [VSCode](https://github.com/microsoft/vscode) - 设计参考
- [Trae](https://www.trae.ai/) - UI 风格参考
- [Shiki](https://shiki.style/) - 语法高亮引擎

---

<div align="center">

**Made with ❤️ by SMP Code Team**

⭐ 如果这个项目对你有帮助，请给个 Star 支持一下！

</div>
