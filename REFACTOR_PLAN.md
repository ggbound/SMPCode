# VSCode 功能对齐重构方案

## 📊 当前状态 vs VSCode 目标对比

### 已完成 ✅
- [x] Monaco Editor 集成
- [x] 文件树（FileExplorer）
- [x] 标签页系统（FileTabs）
- [x] 终端面板（Terminal）
- [x] AI 聊天面板（ChatArea）
- [x] Git 状态显示
- [x] 面包屑导航（Breadcrumbs）
- [x] 文件拖放移动
- [x] 右键菜单（复制/粘贴/删除/重命名）

### 待实现 ❌

#### 1. ActivityBar（活动栏）- 优先级：高
**位置**：最左侧图标导航栏
**功能**：
- Explorer（文件管理器）
- Search（全局搜索）
- Git/SCM（源代码管理）
- Extensions（扩展管理）
- AI Assistant（AI 助手）
- Settings（设置）

**实现要点**：
- 图标样式需与 VSCode 一致
- 点击切换不同面板
- 选中状态高亮显示
- 宽度：48px（固定）

#### 2. StatusBar（状态栏）- 优先级：高
**位置**：应用最底部
**功能**：
- 左侧：分支信息（Git branch）、错误/警告数量
- 中间：空格/缩进、编码格式、行尾格式
- 右侧：行号:列号、语言模式、通知图标

**实现要点**：
- 高度：22px
- 深色背景（#007ACC 主题色）
- 实时更新行号列号
- Git 分支信息集成
- 点击项弹出菜单（如切换分支）

#### 3. 标签页拖拽排序 - 优先级：中
**功能**：
- 拖拽标签页调整顺序
- 拖拽到其他标签页实现分屏
- 拖拽视觉反馈（指示线）

**实现要点**：
- HTML5 Drag & Drop API
- 拖拽时显示插入位置指示器
- 更新 tabs 数组顺序

#### 4. 标签页预览模式 - 优先级：中
**功能**：
- 单击文件 = 预览模式（标签斜体显示）
- 双击文件 = 固定标签
- 新预览标签会替换旧预览标签
- 修改内容后自动固定

**实现要点**：
- Tab 接口添加 `isPreview` 和 `isPinned` 字段
- 斜体样式：`font-style: italic`
- 标签页标题使用斜体字体

#### 5. 编辑器分屏 - 优先级：中
**功能**：
- 左右分屏（垂直分割）
- 上下分屏（水平分割）
- 支持多分屏（最多 3-4 个）
- 拖拽标签页到其他分屏区域

**实现要点**：
- SplitLayout 组件管理分屏状态
- 每个分屏独立管理 tabs 和 activeTab
- 分屏边界可拖拽调整大小
- 分屏关闭按钮

#### 6. 全局搜索面板 - 优先级：中
**功能**：
- 搜索文件内容（grep 风格）
- 搜索文件名（quick open）
- 替换功能
- 搜索结果分组显示

**实现要点**：
- SearchPanel 组件
- 后端 API：搜索文件内容
- 结果高亮显示
- 点击跳转到对应行

#### 7. 命令面板 - 优先级：低
**功能**：
- Ctrl+Shift+P 触发
- 模糊搜索命令
- 执行命令（如格式化、保存、切换主题）
- 类似 VSCode Command Palette

**实现要点**：
- CommandPalette 组件
- 命令注册表
- 模糊搜索算法
- 键盘导航

---

## 🎯 实施顺序

### 第一阶段：核心布局完善（1-2天）
1. **创建 ActivityBar 组件**
   - 文件：`src/renderer/src/components/ActivityBar.tsx`
   - 集成到 App.tsx 左侧
   - 切换不同侧边栏面板

2. **增强 StatusBar 组件**
   - 文件：`src/renderer/src/components/StatusBar.tsx`
   - 集成到 App.tsx 底部
   - 实时显示编辑器状态

3. **重构 App.tsx 主布局**
   - 新的布局结构：
     ```
     ├── ActivityBar (48px)
     ├── AppContainer
     │   ├── Sidebar (250px) - 根据 ActivityBar 切换
     │   ├── EditorArea (flex)
     │   │   ├── FileTabs
     │   │   ├── EditorContent
     │   │   └── Terminal
     │   └── ChatArea (400px)
     └── StatusBar (22px)
     ```

### 第二阶段：编辑器增强（2-3天）
4. **标签页拖拽排序**
   - 修改 FileTabs 组件
   - 添加拖拽逻辑

5. **标签页预览模式**
   - 修改 FileTabs 和 App.tsx
   - 实现预览/固定逻辑

6. **编辑器分屏**
   - 创建 SplitLayout 组件
   - 支持多编辑器实例

### 第三阶段：高级功能（2-3天）
7. **全局搜索面板**
   - 创建 SearchPanel 组件
   - 后端搜索 API

8. **命令面板**
   - 创建 CommandPalette 组件
   - 命令系统

### 第四阶段：测试与优化（1-2天）
9. **测试所有功能**
10. **性能优化**
11. **样式调整**

---

## 📁 需要创建的文件

### 组件文件
- `src/renderer/src/components/ActivityBar.tsx`
- `src/renderer/src/components/SearchPanel.tsx`
- `src/renderer/src/components/CommandPalette.tsx`
- `src/renderer/src/components/SplitLayout.tsx`

### Hooks
- `src/renderer/src/hooks/useEditorSplit.ts`
- `src/renderer/src/hooks/useTabManagement.ts`

### 样式
- `src/renderer/src/styles/activity-bar.css`
- `src/renderer/src/styles/status-bar.css`
- `src/renderer/src/styles/split-layout.css`

---

## 🔧 需要修改的文件

1. **App.tsx**
   - 集成 ActivityBar
   - 集成 StatusBar
   - 重构主布局结构
   - 添加状态管理

2. **FileTabs.tsx**
   - 添加拖拽排序
   - 添加预览模式样式
   - 支持分屏拖拽

3. **FileExplorer.tsx**
   - 支持预览模式打开
   - 双击固定标签

4. **StatusBar.tsx**
   - 添加 Git 分支显示
   - 添加行号列号
   - 添加语言模式
   - 添加通知图标

5. **index.css**
   - 添加 ActivityBar 样式
   - 添加 StatusBar 样式
   - 调整主布局样式

---

## 🎨 设计要点

### 1. 颜色主题
遵循现有 TRAE Dark Theme：
```css
--bg-primary: #0d1117;
--bg-secondary: #161b22;
--bg-tertiary: #21262d;
--accent-color: #2f81f7;
--status-bar-bg: #007ACC; /* VSCode 经典蓝色 */
```

### 2. 尺寸规范
```
ActivityBar: 48px × 100%
Sidebar: 250px (可调整)
EditorArea: flex (占据剩余空间)
ChatArea: 400px (可调整)
StatusBar: 100% × 22px
FileTabs: 100% × 35px
```

### 3. 交互规范
- 单击 = 预览（斜体标签）
- 双击 = 固定
- 中键点击标签 = 关闭
- 拖拽标签 = 排序/分屏
- Ctrl+Shift+P = 命令面板
- Ctrl+P = 快速打开文件
- Ctrl+Shift+F = 全局搜索

---

## 🚀 预期效果

完成后，应用将具备：
- ✅ VSCode 风格的完整布局
- ✅ 专业的 ActivityBar 导航
- ✅ 信息丰富的 StatusBar
- ✅ 灵活的标签页管理
- ✅ 强大的编辑器分屏
- ✅ 高效的搜索和命令系统
- ✅ 100% 对标 VSCode 的用户体验

---

## ⚠️ 注意事项

1. **性能考虑**
   - 分屏时每个编辑器独立实例
   - 搜索面板需要后端优化
   - 大量标签页时虚拟滚动

2. **兼容性**
   - 保持现有功能不破坏
   - 渐进式重构
   - 充分测试

3. **用户体验**
   - 所有快捷键保持一致
   - 拖拽操作有视觉反馈
   - 状态变化有提示

---

## 📝 进度跟踪

- [x] 第一阶段：核心布局完善
  - [x] ActivityBar 组件
  - [x] StatusBar 增强
  - [x] App.tsx 重构
  
- [x] 第二阶段：编辑器增强
  - [x] 标签页拖拽
  - [x] 预览模式
  - [x] 编辑器分屏
  
- [x] 第三阶段：高级功能
  - [x] 全局搜索
  - [x] 命令面板
  
- [x] 第四阶段：测试优化
  - [x] 功能测试
  - [x] 性能优化
  - [x] 样式调整

**状态**: ✅ 全部完成 (2026-04-22)

---

生成时间：2026-04-22
版本：v1.0
