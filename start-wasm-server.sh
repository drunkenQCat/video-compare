#!/bin/bash
# Video Compare Wasm - 快速启动脚本
echo "===================================="
echo " Video Compare Wasm - 验证服务器"
echo "===================================="
echo ""

cd "$(dirname "$0")/wasm-artifacts/video-compare-wasm/build-wasm"

echo "启动HTTP服务器..."
echo "访问地址: http://localhost:8080/test-verification.html"
echo ""
echo "按 Ctrl+C 停止服务器"
echo ""

python3 -m http.server 8080
