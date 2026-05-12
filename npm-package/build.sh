#!/usr/bin/env bash
set -e
rm -rf dist dist-cjs dist-esm

# 1. 生成声明文件
tsc -p tsconfig.json --emitDeclarationOnly --outDir dist

# 2. 编译 CJS
tsc -p tsconfig.cjs.json --outDir dist-cjs
mv dist-cjs/index.js dist/index.js
mv dist-cjs/index.js.map dist/index.js.map 2>/dev/null || true
mv dist-cjs/VideoComparer.js dist/VideoComparer.js
mv dist-cjs/VideoComparer.js.map dist/VideoComparer.js.map 2>/dev/null || true
rm -rf dist-cjs

# 3. 编译 ESM
tsc -p tsconfig.esm.json --outDir dist-esm
mv dist-esm/index.js dist/index.mjs
mv dist-esm/index.js.map dist/index.mjs.map 2>/dev/null || true
mv dist-esm/VideoComparer.js dist/VideoComparer.mjs
mv dist-esm/VideoComparer.js.map dist/VideoComparer.mjs.map 2>/dev/null || true
rm -rf dist-esm

# 修复 ESM 文件中的 import 路径：.js → .mjs
sed -i "s/from '\.\/\(.*\)\.js'/from '.\/\1.mjs'/g" dist/index.mjs
sed -i "s/from \"\.\/\(.*\)\.js\"/from \".\/\1.mjs\"/g" dist/index.mjs

echo "✅ Build complete. dist/ contents:"
ls -la dist/
