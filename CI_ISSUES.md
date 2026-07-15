# CI/CD 发布问题总结

## 仓库信息
- GitHub 仓库: `drunkenQCat/video-compare`
- 分支: `wasm`
- 最新 tag: `v2.2.0`

## 1. NPM 发布 (`@cfai/video-compare`)

### 工作流文件
`.github/workflows/publish-npm-rust.yml`

### 触发方式
推送 `v*` tag → 自动构建 WASM → 发布到 npm

### 当前状态
❌ 失败 — `npm error 404 Not Found`（三次尝试均失败）

### 尝试过的修复
| 尝试 | 结果 |
|---|---|
| 1. 加了 `NODE_AUTH_TOKEN` 和 `.npmrc` | 404 — token 被 `NPM_CONFIG_USERCONFIG` 覆盖 |
| 2. 去掉 token，改用 OIDC `--provenance` | OIDC 签名成功，仍 404 |
| 3. 加 `publishConfig.access: "public"` 到 package.json | publishConfig 生效，仍 404 |

### 失败日志（最新 v2.2.3）
```
"publishConfig": {"access": "public"}  ← 已生效
"repository.url": "git+https://github.com/drunkenQCat/video-compare.git"  ← 已修正
npm notice publish Signed provenance statement with source and build information from GitHub Actions
npm notice publish Provenance statement published to transparency log
npm error 404 Not Found - PUT https://registry.npmjs.org/@cfai%2fvideo-compare - Not found
```

### 问题分析
- OIDC provenance 签名已成功（写入透明日志，sigstore 可验证）
- `publishConfig.access: "public"` 已写入
- `repository.url` 已修正为 `git+https://github.com/drunkenQCat/video-compare.git`
- Node 22 / npm 版本满足要求
- npm registry 仍返回 404，说明 **`@cfai` 组织的 Trusted Publisher 配置不匹配**
- 文档特别指出：npm 保存 Trusted Publisher 时不做校验，只有发布时才会报错

### 需要解决
在 npm 配置 Trusted Publisher 时确认：
- 组织: `cfai`（不是 `drunkenQCat`）
- 仓库: `drunkenQCat/video-compare`
- 工作流: `publish-npm-rust.yml`
- 环境: 留空
- 权限: `publish`

## 2. PyPI 发布 (`video-compare-py`)

### 工作流文件
`.github/workflows/publish-pypi.yml`

### 触发方式
推送 `v*` tag → 自动构建多平台 wheel → 发布到 PyPI

### 当前状态
❌ 失败 — `400 File already exists`

### 失败日志
```
HTTPError: 400 Bad Request from https://upload.pypi.org/legacy/
File already exists ('video_compare_py-2.0.0-cp310-cp310-macosx_11_0_arm64.whl', ...)
```

### 问题分析
- 版本号 `v2.2.x` 对应 Python 包版本 `2.0.0`（Cargo.toml 中写死）
- 之前的 CI 运行已经成功上传了 `2.0.0` 版本的 wheel 到 PyPI
- PyPI 不允许同版本号覆盖上传
- 即使 tag 从 `v2.2.0` 变到 `v2.2.1`，Python 包版本还是 `2.0.0`，文件 hash 不变，仍被拒绝

### 需要解决
- 方案A：每次发布前手动更新 `video-compare-py/Cargo.toml` 和 `pyproject.toml` 中的版本号
- 方案B：在 CI 中自动从 tag 版本号提取版本，用 `sed` 写入 `Cargo.toml` 后再构建
- 方案C：删除 PyPI 上已上传的 `2.0.0` 版本文件，重新发布

## 3. NPM CI 无法运行

### 问题
`pkg/` 目录由 `wasm-pack build` 生成，只包含 `package.json`、`.wasm`、`.js`、`.d.ts`。**没有 `package-lock.json`**，`npm ci` 会报错退出。

### 原因
- `npm ci` 要求 `package-lock.json` 或 `npm-shrinkwrap.json` 存在
- wasm-pack 不生成 lock file
- 该包没有 npm 依赖（`package.json` 中 `"dependencies": {}` 为空）
- `npm run build --if-present` 也是多余的——WASM 已经在 `wasm-pack build` 步骤中构建完成

### 可选方案

**方案 A：去掉 `npm ci` 和 `npm run build`**
直接 `npm publish --provenance --access public` 即可，包没有依赖要装，没有构建要做。

**方案 B：先生成 lock file，再 `npm ci`**
在 `npm ci` 之前加一步：
```yaml
- name: Generate lock file
  working-directory: video-compare-wasm/pkg
  run: npm install --package-lock-only
```
这样 `npm ci` 就能找到 lock file，但实际不会安装任何东西（零依赖）。

**方案 C：改成 `npm install`**
`npm install` 不需要 lock file，但官方文档推荐 `npm ci` 用于 CI 环境。

| 位置 | 当前值 | 说明 |
|---|---|---|
| `video-compare-wasm/Cargo.toml` | `2.0.0` | NPM 包版本（CI 中通过 jq 用 tag 覆盖） |
| `video-compare-py/Cargo.toml` | `2.0.0` | PyPI 包版本（写死，不会自动更新） |
| `video-compare-py/pyproject.toml` | `2.0.0` | PyPI 包版本（写死，不会自动更新） |
| Git tag | `v2.2.0` | 触发 CI 的 tag |

NPM 发布已经在 CI 中用 `jq` 从 tag 提取版本号覆盖 `package.json`，但 Python 包的版本号是写死的，不会随 tag 变化。

## 4. 总结 & 建议

### 短期内修复
1. **NPM**：确认 `@cfai` 组织的 Trusted Publisher 配置是否正确
2. **PyPI**：删除已上传的 `2.0.0` 文件，或改版本号为 `2.2.0` 匹配 tag

### 长期优化
1. 让 Python 包版本号也自动从 tag 提取（CI 中通过 sed 修改 `Cargo.toml`）
2. 加 `skip_existing: true` 到 PyPI publish 步骤，避免重复上传报错
3. 考虑加 `publish-test.yml` workflow，先发到 TestPyPI 验证