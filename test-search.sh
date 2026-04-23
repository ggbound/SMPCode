#!/bin/bash

# 测试 ripgrep 搜索功能

echo "测试 ripgrep 是否安装..."
which rg
if [ $? -eq 0 ]; then
    echo "✓ ripgrep 已安装: $(rg --version | head -1)"
else
    echo "✗ ripgrep 未安装"
    exit 1
fi

echo ""
echo "测试搜索功能..."
echo "在当前目录搜索 'el' (大小写不敏感):"
rg --json --line-number --column --ignore-case --fixed-strings --max-count 10 "el" /Users/ggbound/data/new_version/AI/Clude-Code/claw-code-web 2>/dev/null | head -20

echo ""
echo "统计结果数量:"
rg --count --ignore-case --fixed-strings "el" /Users/ggbound/data/new_version/AI/Clude-Code/claw-code-web 2>/dev/null | head -10
