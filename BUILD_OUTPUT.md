# SMP Code 应用打包说明

## 📦 打包结果

### macOS ARM64 版本
- **位置**: `dist/mac-arm64/SMP Code.app`
- **大小**: ~407 MB
- **架构**: Apple Silicon (ARM64)
- **Electron 版本**: 29.4.6

### 应用结构
```
SMP Code.app/
└── Contents/
    ├── Frameworks/          # Electron 框架
    ├── MacOS/               # 可执行文件
    ├── Resources/
    │   ├── app.asar         # 应用代码包 (158 MB)
    │   ├── app.asar.unpacked/
    │   │   └── node_modules/
    │   │       └── node-pty/  # 原生模块
    │   └── icon.icns        # 应用图标
    ├── Info.plist           # 应用信息
    └── PkgInfo
```

## 🔧 打包命令

### 基本打包
```bash
cd /Users/ggbound/data/new_version/AI/Clude-Code/claw-code-web
npm run build:mac
```

### 其他平台
```bash
# Windows
npm run build:win

# Linux
npm run build:linux

# 仅解包（不创建安装包）
npm run build:unpack
```

## ⚙️ 构建配置

配置文件: `electron-builder.json`

关键配置项:
```json
{
  "appId": "com.smpcode.app",
  "productName": "SMP Code",
  "mac": {
    "category": "public.app-category.developer-tools",
    "target": ["dir"],
    "icon": "resources/icon.png",
    "identity": null
  },
  "asar": true,
  "asarUnpack": [
    "**/*.node",
    "**/node-pty/**/*"
  ]
}
```

## 📝 打包流程

1. **编译阶段** (`electron-vite build`)
   - 主进程编译 → `out/main/index.js`
   - 预加载脚本 → `out/preload/index.js`
   - 渲染进程 → `out/renderer/`

2. **打包阶段** (`electron-builder --mac`)
   - 重建原生依赖 (node-pty)
   - 复制 Electron 运行时
   - 打包应用代码为 asar
   - 生成 .app 包

3. **优化**
   - ASAR 压缩减少体积
   - 原生模块 unpack 确保兼容性
   - AfterPack 脚本后处理

## ✅ 验证清单

- [x] 应用成功编译
- [x] 原生模块 (node-pty) 正确包含
- [x] ASAR 包完整 (158 MB)
- [x] 应用可以正常启动
- [x] 文件大小合理 (~407 MB)

## 🚀 运行应用

```bash
# 方法 1: 直接打开
open dist/mac-arm64/SMP\ Code.app

# 方法 2: 命令行运行
./dist/mac-arm64/SMP\ Code.app/Contents/MacOS/SMP\ Code
```

## 🔍 故障排查

### 问题 1: node-pty 缺失
**症状**: 终端功能无法使用  
**解决**: 检查 `app.asar.unpacked/node_modules/node-pty` 是否存在

### 问题 2: 应用无法启动
**症状**: 点击无反应  
**解决**: 
```bash
# 查看控制台日志
log stream --predicate 'process == "SMP Code"' --info
```

### 问题 3: 打包失败
**症状**: electron-builder 报错  
**解决**:
```bash
# 清理并重新安装
rm -rf node_modules dist out
npm install
npm run build:mac
```

## 📊 性能数据

| 指标 | 数值 |
|------|------|
| 编译时间 | ~17 秒 |
| 打包时间 | ~15 秒 |
| 总耗时 | ~32 秒 |
| 最终大小 | 407 MB |
| ASAR 大小 | 158 MB |

## 🎯 下一步优化

1. **代码分割**: 进一步减小 ASAR 体积
2. **Tree Shaking**: 移除未使用的依赖
3. **压缩优化**: 启用更高的压缩级别
4. **签名发布**: 添加 macOS 代码签名
5. **自动更新**: 配置 electron-updater

## 📌 注意事项

1. **代码签名**: 当前未签名，仅用于开发测试
2. **公证**: 发布到网络需要 Apple 公证
3. **权限**: 某些功能可能需要用户授权
4. **兼容性**: 仅支持 macOS 10.12+ (APFS)

---

**打包日期**: 2026-04-22  
**版本**: 0.1.0  
**状态**: ✅ 打包成功
