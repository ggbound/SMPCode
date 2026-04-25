#!/bin/bash

# 工具调用诊断脚本
# 用法: ./diagnose-tool-calls.sh

echo "=========================================="
echo "Claw Code Web - 工具调用诊断"
echo "=========================================="
echo ""

# 检查 API 服务器是否运行
echo "1. 检查 API 服务器状态..."
if curl -s http://localhost:3847/api/health > /dev/null 2>&1; then
    echo "   ✅ API 服务器正在运行"
    HEALTH=$(curl -s http://localhost:3847/api/health)
    echo "   健康检查响应: $HEALTH"
else
    echo "   ❌ API 服务器未运行"
    echo "   请先启动应用: npm run dev 或 npm start"
    exit 1
fi
echo ""

# 测试 write_file 工具
echo "2. 测试 write_file 工具..."
TEST_DIR="/tmp/claw-test-$$"
mkdir -p "$TEST_DIR"

TEST_FILE="$TEST_DIR/test-write.txt"
curl -s -X POST http://localhost:3847/api/tools/execute-direct \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"write_file\",
    \"arguments\": {
      \"path\": \"$TEST_FILE\",
      \"content\": \"This is a test file created at $(date)\"
    },
    \"cwd\": \"$TEST_DIR\"
  }" | jq '.'

if [ -f "$TEST_FILE" ]; then
    echo "   ✅ 文件创建成功"
    echo "   文件内容:"
    cat "$TEST_FILE"
else
    echo "   ❌ 文件创建失败"
fi
echo ""

# 测试 FileWriteTool（大驼峰命名）
echo "3. 测试 FileWriteTool（大驼峰命名）..."
TEST_FILE2="$TEST_DIR/test-write2.txt"
curl -s -X POST http://localhost:3847/api/tools/execute-direct \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"FileWriteTool\",
    \"arguments\": {
      \"file_path\": \"$TEST_FILE2\",
      \"content\": \"Test with camelCase naming\"
    },
    \"cwd\": \"$TEST_DIR\"
  }" | jq '.'

if [ -f "$TEST_FILE2" ]; then
    echo "   ✅ 文件创建成功（名称映射正常工作）"
    echo "   文件内容:"
    cat "$TEST_FILE2"
else
    echo "   ❌ 文件创建失败（名称映射可能有问题）"
fi
echo ""

# 测试 edit_file 工具
echo "4. 测试 edit_file 工具..."
EDIT_TEST_FILE="$TEST_DIR/test-edit.txt"
echo "Original content line 1
Original content line 2
Original content line 3" > "$EDIT_TEST_FILE"

curl -s -X POST http://localhost:3847/api/tools/execute-direct \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"edit_file\",
    \"arguments\": {
      \"path\": \"$EDIT_TEST_FILE\",
      \"old_string\": \"Original content line 2\",
      \"new_string\": \"Modified content line 2\"
    },
    \"cwd\": \"$TEST_DIR\"
  }" | jq '.'

if [ -f "$EDIT_TEST_FILE" ]; then
    echo "   ✅ 文件编辑成功"
    echo "   文件内容:"
    cat "$EDIT_TEST_FILE"
else
    echo "   ❌ 文件编辑失败"
fi
echo ""

# 测试 append_file 工具
echo "5. 测试 append_file 工具..."
APPEND_TEST_FILE="$TEST_DIR/test-append.txt"
echo "Initial content" > "$APPEND_TEST_FILE"

curl -s -X POST http://localhost:3847/api/tools/execute-direct \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"append_file\",
    \"arguments\": {
      \"path\": \"$APPEND_TEST_FILE\",
      \"content\": \"\\nAppended content\"
    },
    \"cwd\": \"$TEST_DIR\"
  }" | jq '.'

if [ -f "$APPEND_TEST_FILE" ]; then
    echo "   ✅ 文件追加成功"
    echo "   文件内容:"
    cat "$APPEND_TEST_FILE"
else
    echo "   ❌ 文件追加失败"
fi
echo ""

# 测试 read_file 工具
echo "6. 测试 read_file 工具..."
curl -s -X POST http://localhost:3847/api/tools/execute-direct \
  -H "Content-Type: application/json" \
  -d "{
    \"tool\": \"read_file\",
    \"arguments\": {
      \"path\": \"$TEST_FILE\"
    },
    \"cwd\": \"$TEST_DIR\"
  }" | jq '.result.output' | head -c 200
echo ""
echo ""

# 清理测试文件
echo "7. 清理测试文件..."
rm -rf "$TEST_DIR"
echo "   ✅ 测试目录已删除"
echo ""

echo "=========================================="
echo "诊断完成！"
echo "=========================================="
echo ""
echo "如果所有测试都通过，说明工具调用系统工作正常。"
echo "如果仍有问题，请检查："
echo "  1. 浏览器开发者工具的 Network 标签页"
echo "  2. Electron 主进程的日志输出"
echo "  3. DEBUG_TOOL_CALLS.md 中的详细调试指南"
echo ""
