# @cfai/video-compare 前端集成文档

> v2.0.0 | Rust + wasm-bindgen | 实时视频/图像对比 WASM 库

## 目录

- [概览](#概览)
- [安装](#安装)
- [快速开始](#快速开始)
- [API 完整参考](#api-完整参考)
  - [核心比较函数](#核心比较函数)
  - [帧缓存 API（推荐用于视频）](#帧缓存-ap推荐用于视频)
  - [配置管理](#配置管理)
  - [类型定义](#类型定义)
- [帧提取：从 video 元素获取 RGB 数据](#帧提取从-video-元素获取-rgb-数据)
- [完整示例：实时视频对比](#完整示例实时视频对比)
- [自动降采样机制](#自动降采样机制)
- [性能基线（WASM Benchmark）](#性能基线wasm-benchmark)
- [构建产物说明](#构建产物说明)
- [从源码构建](#从源码构建)
- [常见问题](#常见问题)

---

## 概览

`@cfai/video-compare` 是一个 WebAssembly 计算库，用于实时对比两帧 RGB 图像的相似度。输出 SSIM、PSNR、MSE 三项标准指标，并提供像素级差异热力图数据。

**核心特性：**

- ✅ 纯计算，零浏览器依赖（不依赖 Canvas、WebGL）
- ✅ 自动降采样：≥1080p 的输入自动降到 720p 处理，确保 30fps 预算
- ✅ 帧缓存 API：WASM 内部缓存帧数据，减少 JS↔WASM 数据传输
- ✅ 零拷贝输出：差异热力图直接生成 RGBA Uint8Array，可直接写入 Canvas
- ✅ TypeScript 类型定义完整

---

## 安装

```bash
npm install @cfai/video-compare
```

---

## 快速开始

### 基本用法（图片对比）

```typescript
import init, { compare } from '@cfai/video-compare';

// 1. 初始化 WASM（异步，只需一次）
await init();

// 2. 准备 RGB 数据（width × height × 3 字节）
const leftRGB = new Uint8Array(1920 * 1080 * 3);   // 左帧
const rightRGB = new Uint8Array(1920 * 1080 * 3);  // 右帧
// ... 填充数据 ...

// 3. 对比
const result = compare(leftRGB, rightRGB, 1920, 1080);
console.log(`SSIM: ${result.ssim}`);   // 0-1, 越高越相似
console.log(`PSNR: ${result.psnr}dB`); // 越高越好
console.log(`MSE:  ${result.mse}`);    // 越低越相似
```

### 帧缓存用法（视频对比，推荐）

```typescript
import init, {
  init_frame_cache, cache_frame, compare_cached_frames, get_diff_rgba
} from '@cfai/video-compare';

await init();

// 每帧调用：
init_frame_cache(1280, 720);
cache_frame(0, leftRGB, 1280, 720);   // slot 0 = 左
cache_frame(1, rightRGB, 1280, 720);  // slot 1 = 右
const [ssim, psnr, mse, maxDiff] = compare_cached_frames();
const rgbaDiff = get_diff_rgba();      // Uint8Array, 直接写入 ImageData
```

---

## API 完整参考

### 核心比较函数

#### `compare(left, right, width, height): WasmCompareMetrics`

最简单的对比函数，仅返回指标。

| 参数 | 类型 | 说明 |
|---|---|---|
| `left` | `Uint8Array` | 左帧 RGB 数据（`width × height × 3` 字节） |
| `right` | `Uint8Array` | 右帧 RGB 数据 |
| `width` | `number` | 图像宽度 |
| `height` | `number` | 图像高度 |

**返回值：** `WasmCompareMetrics`

```typescript
interface WasmCompareMetrics {
  ssim: number;        // 结构相似度 (0-1)
  psnr: number;        // 峰值信噪比 (dB)
  mse: number;         // 均方误差
  width: number;       // 实际处理宽度（降采样后可能不同）
  height: number;      // 实际处理高度
  downsampled: number; // 1=已降采样, 0=原始分辨率
}
```

#### `compare_with_diff(left, right, width, height): CompareResult`

对比并返回块级差异数据（用于热力图）。

**返回值：** `CompareResult`

```typescript
interface CompareResult {
  ssim: number;
  psnr: number;
  mse: number;
  width: number;
  height: number;
  downsampled: number;
  blocks_x: number;    // 水平方向块数
  blocks_y: number;    // 垂直方向块数
}
```

配合 `get_diff_data(result)` 获取每个块的 MSE 值（`Float32Array`）。

#### `compute_pixel_diff(left, right, width, height): PixelDiffResult`

逐像素差异计算，返回每个像素的平方差（R²+G²+B²）。

**返回值：** `PixelDiffResult`

```typescript
interface PixelDiffResult {
  width: number;
  height: number;
  max_diff: number;   // 最大像素差异值
  avg_diff: number;    // 平均像素差异（≈ MSE × 3）
}
```

配合 `get_pixel_diff_data(result)` 获取 `Float32Array`（每个像素一个值）。

#### `compare_frames(left, right, width, height, diff_buffer): WasmCompareMetrics`

带可选 diff 输出缓冲区的对比。`diff_buffer` 传入空数组可跳过 diff 计算。

---

### 帧缓存 API（推荐用于视频）

帧缓存 API 在 WASM 内存中缓存两帧数据，避免每帧重复传输。适用于 `requestAnimationFrame` 循环中的实时视频对比。

#### `init_frame_cache(width, height): void`

初始化帧缓存。传入预期帧尺寸。

```typescript
init_frame_cache(1280, 720);
```

#### `cache_frame(slot, rgb, width, height): void`

将帧数据缓存到指定槽位。

| 参数 | 说明 |
|---|---|
| `slot` | `0` = 左帧, `1` = 右帧 |
| `rgb` | `Uint8Array`，RGB 数据 |
| `width` / `height` | 帧尺寸 |

```typescript
cache_frame(0, leftRGB, 1280, 720);
cache_frame(1, rightRGB, 1280, 720);
```

#### `compare_cached_frames(): Float32Array`

对比已缓存的两帧。

**返回值：** `[ssim, psnr, mse, max_diff]`（`Float32Array`，4 个元素）

#### `get_diff_rgba(): Uint8Array`

获取预计算的 RGBA 差异热力图。返回 `Uint8Array`（`width × height × 4` 字节），可直接写入 `ImageData.data`。

```typescript
const rgba = get_diff_rgba();
const imageData = ctx.createImageData(width, height);
imageData.data.set(rgba);
ctx.putImageData(imageData, 0, 0);
```

#### `clear_frame_cache(): void`

清空帧缓存。

---

### 配置管理

#### `WasmCompareConfig`

```typescript
const config = new WasmCompareConfig(maxWidth, maxHeight, blockSize);
```

| 参数 | 默认值 | 说明 |
|---|---|---|
| `maxWidth` | `1280` | 超过此宽度自动降采样 |
| `maxHeight` | `720` | 超过此高度自动降采样 |
| `blockSize` | `16` | SSIM/MSE 分块大小 |

#### `set_compare_config(config): void`

```typescript
import { set_compare_config, WasmCompareConfig } from '@cfai/video-compare';

set_compare_config(new WasmCompareConfig(1280, 720, 16));
```

#### `get_compare_config(): WasmCompareConfig`

获取当前配置。

#### `get_block_layout(width, height): Int32Array`

返回 `[blocks_x, blocks_y]`。

#### `get_block_count(width, height, block_size): number`

返回总块数。

---

### 类型定义

```typescript
// 指标结果
class WasmCompareMetrics {
  ssim: number;
  psnr: number;
  mse: number;
  width: number;
  height: number;
  downsampled: number;
}

// 完整对比结果（含块级差异）
class CompareResult {
  ssim: number;
  psnr: number;
  mse: number;
  width: number;
  height: number;
  downsampled: number;
  blocks_x: number;
  blocks_y: number;
  free(): void;  // 手动释放 WASM 内存
}

// 像素级差异结果
class PixelDiffResult {
  width: number;
  height: number;
  max_diff: number;
  avg_diff: number;
  free(): void;
}

// 配置
class WasmCompareConfig {
  max_width: number;
  max_height: number;
  block_size: number;
  constructor(max_width: number, max_height: number, block_size: number);
}
```

> **注意：** `CompareResult` 和 `PixelDiffResult` 会持有 WASM 内存。在视频循环中如果每帧创建，请调用 `.free()` 释放，或依赖 GC（WASM-bindgen 已注册 FinalizationRegistry）。

---

## 帧提取：从 video 元素获取 RGB 数据

WASM 需要纯 RGB 数据（不带 Alpha）。从 `<video>` 提取帧的标准方法：

```typescript
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

function extractFrame(video: HTMLVideoElement): { rgb: Uint8Array; width: number; height: number } | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w === 0 || h === 0) return null;

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const rgba = imageData.data;

  // RGBA → RGB
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    rgb[i * 3]     = rgba[j];
    rgb[i * 3 + 1] = rgba[j + 1];
    rgb[i * 3 + 2] = rgba[j + 2];
  }

  return { rgb, width: w, height: h };
}
```

---

## 完整示例：实时视频对比

```typescript
import init, {
  init_frame_cache, cache_frame, compare_cached_frames, get_diff_rgba
} from '@cfai/video-compare';

await init();

const leftVideo = document.getElementById('leftVideo') as HTMLVideoElement;
const rightVideo = document.getElementById('rightVideo') as HTMLVideoElement;
const diffCanvas = document.getElementById('diffCanvas') as HTMLCanvasElement;
const diffCtx = diffCanvas.getContext('2d')!;

const frameCanvas = document.createElement('canvas');
const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true })!;

function extractRGB(video: HTMLVideoElement): Uint8Array | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w === 0 || h === 0) return null;
  frameCanvas.width = w;
  frameCanvas.height = h;
  frameCtx.drawImage(video, 0, 0, w, h);
  const data = frameCtx.getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3]     = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  return rgb;
}

let running = false;

function syncLoop() {
  if (!running) return;

  const w = leftVideo.videoWidth;
  const h = leftVideo.videoHeight;
  const leftRGB = extractRGB(leftVideo);
  const rightRGB = extractRGB(rightVideo);

  if (leftRGB && rightRGB) {
    // 缓存帧 + 对比
    init_frame_cache(w, h);
    cache_frame(0, leftRGB, w, h);
    cache_frame(1, rightRGB, w, h);
    const [ssim, psnr, mse, maxDiff] = compare_cached_frames();

    // 获取热力图 RGBA，零拷贝写入 canvas
    const rgba = get_diff_rgba();
    diffCanvas.width = w;
    diffCanvas.height = h;
    const imageData = diffCtx.createImageData(w, h);
    imageData.data.set(rgba);
    diffCtx.putImageData(imageData, 0, 0);

    console.log(`SSIM: ${ssim.toFixed(4)}  PSNR: ${psnr.toFixed(2)}dB  MSE: ${mse.toFixed(2)}`);
  }

  requestAnimationFrame(syncLoop);
}

// 启动
await Promise.all([leftVideo.play(), rightVideo.play()]);
running = true;
syncLoop();
```

---

## 自动降采样机制

当输入分辨率超过 `maxWidth × maxHeight`（默认 1280×720）时，WASM 自动将两帧降采样到 720p 再处理。

```
输入: 1920×1080 → 降采样到 1280×720 → SSIM/MSE 计算在 720p 上进行
```

**为什么默认 720p：** WASM Benchmark 显示 720p 下单帧对比耗时 ~12ms，1080p 下 ~18.6ms。设为 720p 可确保所有分辨率输入都在 30fps 预算（33.3ms）内。

**如需处理更高分辨率**（以性能为代价）：

```typescript
set_compare_config(new WasmCompareConfig(1920, 1080, 16));
```

**降采样检测：** 返回值中的 `downsampled` 字段为 `1` 表示已降采样，`0` 表示原始分辨率处理。

---

## 性能基线（WASM Benchmark）

在 Node.js 中使用 `--target nodejs` 构建测量，代表真实 WASM 执行性能。

| 函数 | 输入分辨率 | 中位耗时 | 帧率 | 30fps 预算 |
|---|---|---|---|---|
| `compare` | 1920×1080 (→720p) | 18.6ms | 53.8 fps | ✅ |
| `compare` | 1280×720 | 12.0ms | 83 fps | ✅ |
| `compare` | 640×480 | 4.0ms | 251 fps | ✅ |
| `compare_with_diff` | 1920×1080 (→720p) | 18.7ms | 53.6 fps | ✅ |
| `frame_cache full cycle` | 1920×1080 (→720p) | 21.1ms | 47.4 fps | ✅ |
| `frame_cache compare only` | 1280×720 | 12.2ms | 82 fps | ✅ |
| `compute_pixel_diff` | 1920×1080 (→720p) | 12.7ms | 78 fps | ✅ |

> Benchmark 工具：`benches/wasm_bench.mjs`，运行 `node benches/wasm_bench.mjs --baseline` 保存基线，`--compare` 对比基线。

---

## 构建产物说明

WASM 构建产出三个文件，缺一不可：

| 文件 | 说明 |
|---|---|
| `video_compare_wasm.js` | JS 胶水代码（ES Module），由 wasm-bindgen 生成 |
| `video_compare_wasm_bg.wasm` | WASM 二进制（纯计算核心，~35KB） |
| `video_compare_wasm.d.ts` | TypeScript 类型定义 |

**两种构建目标：**

| 目标 | 命令 | 用途 |
|---|---|---|
| `--target web` | `wasm-pack build --target web --out-dir pkg-web` | 浏览器（ES Module，需 HTTP 服务器） |
| `--target nodejs` | `wasm-pack build --target nodejs --out-dir pkg` | Node.js（CommonJS，用于 benchmark） |

> ⚠️ `--target nodejs` 生成的 JS 使用 `require('fs')`，**不能在浏览器中加载**。前端集成必须使用 `--target web`。

---

## 从源码构建

### 前置条件

- Rust 工具链（`rustup`）
- `wasm32-unknown-unknown` target：`rustup target add wasm32-unknown-unknown`
- `wasm-pack`：`cargo install wasm-pack`

### 构建步骤

```bash
cd video-compare-wasm

# 浏览器构建
wasm-pack build --target web --out-dir pkg-web

# Node.js 构建（用于 benchmark）
wasm-pack build --target nodejs --out-dir pkg
```

### 运行 Benchmark

```bash
cd video-compare-wasm

# 保存基线
node benches/wasm_bench.mjs --baseline

# 对比基线（优化后使用）
node benches/wasm_bench.mjs --compare
```

---

## 常见问题

### Q: 浏览器报 "require is not defined" 或 "fs is not available"

使用了 `--target nodejs` 构建的产物。前端必须使用 `--target web` 构建。

### Q: `init()` 是默认导出还是命名导出？

`init` 是**默认导出**（default export）。使用方式：

```typescript
import init, { compare, compare_with_diff } from '@cfai/video-compare';
await init(); // 异步加载 WASM，只需调用一次
```

### Q: 如何释放 WASM 内存？

`CompareResult` 和 `PixelDiffResult` 对象持有 WASM 内存引用。可调用 `.free()` 手动释放，或依赖自动 GC（FinalizationRegistry）。在视频循环中，使用帧缓存 API（`cache_frame` + `compare_cached_frames`）可避免每帧创建对象。

### Q: 两帧的分辨率必须相同吗？

是的。`compare`、`compare_with_diff` 要求左右帧的 `width` 和 `height` 相同。帧缓存 API 要求两帧缓存到同一尺寸。

### Q: 输入数据格式是什么？

纯 RGB `Uint8Array`，每像素 3 字节（R, G, B），不含 Alpha 通道。从 `<canvas>` 的 `ImageData`（RGBA）转换时需去掉 Alpha。

### Q: 支持 SharedArrayBuffer / Web Worker 吗？

当前不支持。WASM 模块使用 `thread_local!` 全局状态（单线程安全），不适合在多线程 Worker 中并发调用同一实例。如需 Worker 隔离，每个 Worker 加载独立的 WASM 实例。

### Q: SSIM 值偏低，是否正常？

SSIM 的分块计算（block-based）比全图 SSIM 更敏感。`blockSize=16` 时，SSIM 通常在 0.85-0.99 之间。如果两帧有微小平移或压缩差异，SSIM 可能降到 0.7-0.8。这是正常行为。
