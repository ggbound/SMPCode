#!/bin/bash
# 运行未签名的 SMP Code 应用

APP_PATH="/Users/ggbound/data/new_version/AI/Clude-Code/claw-code-web/dist/mac-arm64/SMP Code.app"

echo "正在准备运行 SMP Code..."
echo ""

# 移除隔离属性
echo "1. 移除隔离属性..."
xattr -cr "$APP_PATH"

# 使用临时签名
echo "2. 应用临时签名..."
codesign --force --deep --sign - "$APP_PATH"

echo ""
echo "准备完成！"
echo ""
echo "现在可以通过以下方式运行应用："
echo ""
echo "方法1: 在终端中运行："
echo "  open \"$APP_PATH\""
echo ""
echo "方法2: 在 Finder 中双击应用图标"
echo ""
echo "注意：首次运行时可能会显示安全警告，请前往："
echo "  系统设置 > 隐私与安全性 > 安全性"
echo "然后点击 \"仍要打开\""
echo ""
