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
- ✅ SIMD128 自动向量化：编译器自动向量化计算密集循环
- ✅ EMA 时间域滤波：可选的逐像素指数移动平均，抑制压缩散点噪声
- ✅ 原色混合显示：无差异区域显示原始画面，有差异区域叠加热力图
- ✅ Web Worker 友好：所有计算可在 Worker 中运行，不阻塞主线程

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

#### `set_diff_ema_alpha(alpha: number): void`

设置 EMA（指数移动平均）时间域滤波系数。用于抑制视频压缩产生的随机散点噪声。

| 参数 | 范围 | 默认值 | 说明 |
|---|---|---|---|
| `alpha` | 0.01–1.0 | 1.0 | 滤波强度。1.0=关闭滤波（最快），0.3=中等滤波，0.05=强滤波 |

```typescript
// 启用中等噪声滤波
set_diff_ema_alpha(0.3);

// 关闭滤波（默认，最快）
set_diff_ema_alpha(1.0);
```

> **性能提示：** EMA 开启时（alpha < 1.0），WASM 需要读写逐像素状态缓冲区，每帧增加约 10ms（720p）。默认关闭，需要时通过滑块动态启用。
> **原色显示：** 即使关闭 EMA，差异画面仍通过阈值机制显示原色——低于阈值的像素直接显示原始颜色，高于阈值才显示热力图。

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

## 帧提取：从 video 元素获取像素数据

WASM 帧缓存 API 接受 RGB 数据（3 字节/像素）。从 `<video>` 提取帧有两种方案：

### 方案 A（推荐）：VideoFrame + copyTo

使用 WebCodecs `VideoFrame` API，直接从已解码视频帧拷贝像素数据。**比 canvas 路径快 50 倍**（0.1ms vs 5ms/帧）。

```typescript
function extractRGBA(video: HTMLVideoElement, w: number, h: number): Uint8ClampedArray {
  const frame = new VideoFrame(video);
  const buf = new Uint8ClampedArray(w * h * 4); // RGBA
  frame.copyTo(buf, { format: 'RGBA' });
  frame.close(); // 必须调用，释放 GPU 内存
  return buf;
}
```

> **要求：** Chrome/Edge 94+。Safari 和 Firefox 暂不支持 `VideoFrame`，需 fallback。
> **注意：** `VideoFrame` 返回 RGBA 数据（4 字节/像素），Worker 中会做 RGBA→RGB 转换。

### 方案 B（Fallback）：drawImage + getImageData

不支持的浏览器走 canvas 路径。慢但兼容性广。

```typescript
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

function extractRGBA(video: HTMLVideoElement, w: number, h: number): Uint8ClampedArray {
  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data; // Uint8ClampedArray (RGBA)
}
```

### 运行时自动选择

```typescript
const useVideoFrame = typeof VideoFrame !== 'undefined';

function extractRGBA(video: HTMLVideoElement, w: number, h: number): Uint8ClampedArray {
  if (useVideoFrame) {
    const frame = new VideoFrame(video);
    const buf = new Uint8ClampedArray(w * h * 4);
    frame.copyTo(buf, { format: 'RGBA' });
    frame.close();
    return buf;
  } else {
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  }
}
```

---

## 架构建议：Web Worker 隔离计算

**关键设计原则：WASM 计算必须在 Web Worker 中运行，不能在主线程上。**

如果 WASM 计算跑在主线程上，每帧 17ms 的同步计算会阻塞 UI 事件循环，导致页面无法滚动、无法交互。Web Worker 隔离后，主线程只负责视频播放和 canvas 渲染。

**推荐架构：**

```
主线程                          Worker
──────                          ──────
requestVideoFrameCallback       WASM 模块
  → VideoFrame(video)             ↓
  → copyTo → RGBA buffer         init_frame_cache()
  → postMessage(RGBA) ──────→    cache_frame(0, left)
                                 cache_frame(1, right)
                                 compare_cached_frames()
                                 get_diff_rgba()
  ← postMessage(diffRGBA) ←─────
  → putImageData(diffCanvas)
```

**Worker 模板 (`compare-worker.js`)：**

```javascript
import init, {
  init_frame_cache, cache_frame, compare_cached_frames, get_diff_rgba,
  set_compare_config, WasmCompareConfig, set_diff_ema_alpha,
} from './video_compare_wasm.js';

let wasmReady = false;
async function ensureWasm() {
  if (!wasmReady) { await init(); wasmReady = true; }
}

self.onmessage = async (e) => {
  await ensureWasm();
  const { type, leftRGBA, rightRGBA, width, height } = e.data;

  if (type === 'compare') {
    // RGBA → RGB 转换（视频无 Alpha，strip 掉）
    const rgb = rgbaToRgb(leftRGBA, width, height);
    // ... 同理处理 rightRGBA

    init_frame_cache(width, height);
    cache_frame(0, leftRGB, width, height);
    cache_frame(1, rightRGB, width, height);
    const [ssim, psnr, mse, maxDiff] = compare_cached_frames();
    const rgba = get_diff_rgba();

    // Transferable 零拷贝传回
    self.postMessage(
      { type: 'result', ssim, psnr, mse, maxDiff, rgba, width, height },
      [rgba.buffer]
    );
  }
};

function rgbaToRgb(rgba, w, h) {
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return rgb;
}
```

---

## 完整示例：实时视频对比

```typescript
// === 主线程代码 ===

import init from '@cfai/video-compare';
await init(); // 主线程初始化（用于图片对比）

// 创建 Worker（用于视频对比）
const worker = new Worker('./compare-worker.js', { type: 'module' });
let workerReady = false;
worker.onmessage = (e) => {
  if (e.data.type === 'ready') workerReady = true;
  if (e.data.type === 'result') handleResult(e.data);
};

const leftVideo = document.getElementById('leftVideo') as HTMLVideoElement;
const rightVideo = document.getElementById('rightVideo') as HTMLVideoElement;
const diffCanvas = document.getElementById('diffCanvas') as HTMLCanvasElement;
const diffCtx = diffCanvas.getContext('2d')!;

const displayCanvas = document.createElement('canvas');
const displayCtx = displayCanvas.getContext('2d', { willReadFrequently: true })!;
const useVideoFrame = typeof VideoFrame !== 'undefined';
let waiting = false;

function extractRGBA(video: HTMLVideoElement, w: number, h: number): Uint8ClampedArray {
  if (useVideoFrame) {
    const frame = new VideoFrame(video);
    const buf = new Uint8ClampedArray(w * h * 4);
    frame.copyTo(buf, { format: 'RGBA' });
    // 同时画到显示 canvas
    displayCtx.drawImage(frame, 0, 0, w, h);
    frame.close();
    return buf;
  } else {
    displayCtx.drawImage(video, 0, 0, w, h);
    return displayCtx.getImageData(0, 0, w, h).data;
  }
}

function frameLoop() {
  if (!waiting) {
    const w = leftVideo.videoWidth;
    const h = leftVideo.videoHeight;
    const leftRGBA = extractRGBA(leftVideo, w, h);
    const rightRGBA = extractRGBA(rightVideo, w, h);

    waiting = true;
    // Transferable 零拷贝传输
    worker.postMessage(
      { type: 'compare', leftRGBA, rightRGBA, width: w, height: h },
      [leftRGBA.buffer, rightRGBA.buffer]
    );
  }
  // 使用 requestVideoFrameCallback（只在有新帧时触发）
  if (leftVideo.requestVideoFrameCallback) {
    leftVideo.requestVideoFrameCallback(frameLoop);
  } else {
    requestAnimationFrame(frameLoop);
  }
}

function handleResult(data: { ssim: number; psnr: number; mse: number; rgba: Uint8Array; width: number; height: number }) {
  waiting = false;
  const { ssim, psnr, mse, rgba, width, height } = data;

  // 渲染差异画面
  diffCanvas.width = width;
  diffCanvas.height = height;
  const imgData = diffCtx.createImageData(width, height);
  imgData.data.set(rgba);
  diffCtx.putImageData(imgData, 0, 0);

  console.log(`SSIM: ${ssim.toFixed(4)}  PSNR: ${psnr.toFixed(2)}dB  MSE: ${mse.toFixed(2)}`);
}

// 启动
await Promise.all([leftVideo.play(), rightVideo.play()]);
frameLoop();
```

> **关键优化点：**
> 1. `VideoFrame + copyTo` 替代 `drawImage + getImageData` — 快 50 倍
> 2. Web Worker 隔离 WASM 计算 — 主线程不卡顿
> 3. `requestVideoFrameCallback` 替代 `requestAnimationFrame` — 只在有新帧时处理
> 4. Transferable `ArrayBuffer` — Worker 间零拷贝传输

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

## 性能基线

### WASM 纯计算（Node.js benchmark）

在 Node.js 中使用 `--target nodejs` 构建测量，代表 WASM 计算引擎的纯性能。

| 函数 | 输入分辨率 | 中位耗时 | 帧率 | 30fps 预算 |
|---|---|---|---|---|
| `compare` | 1280×720 | 12.0ms | 83 fps | ✅ |
| `compare` | 640×480 | 4.0ms | 251 fps | ✅ |
| `frame_cache full cycle` | 1280×720 | **9.2ms** | **109 fps** | ✅ |
| `frame_cache full cycle` | 1920×1080 (→720p) | **16.5ms** | **61 fps** | ✅ |
| `frame_cache compare only` | 1280×720 | 15.9ms | 63 fps | ✅ |

> Benchmark 工具：`benches/wasm_bench.mjs`，运行 `node benches/wasm_bench.mjs --baseline` 保存基线，`--compare` 对比基线。

### 浏览器全链路（Playwright headless Chrome benchmark）

测量真实的浏览器管线：帧提取 + WASM 计算 + canvas 渲染。使用真实视频文件（1920×1080 H.264）。

**VideoFrame 路径（推荐）：**

| 步骤 | 720p 中位耗时 | 占比 |
|---|---|---|
| VideoFrame + drawImage | 0.4ms | 2% |
| copyTo (像素提取) | 0.1ms | 0% |
| postMessage → Worker | ~0ms | 0% |
| **WASM 计算** | **17.8ms** | **87%** |
| putImageData | 1.7ms | 8% |
| DOM 更新 | 0.4ms | 2% |
| **总计** | **20.4ms** | **100%** |
| **浏览器有效 FPS** | **49.0 fps** | |

**Canvas 路径（fallback，无 VideoFrame 支持）：**

| 步骤 | 720p 中位耗时 | 占比 |
|---|---|---|
| drawImage (video→canvas) | 25.3ms | 52% |
| getImageData | 4.3ms | 9% |
| postMessage → Worker | ~0ms | 0% |
| WASM 计算 | 16.8ms | 34% |
| putImageData | 1.9ms | 4% |
| DOM 更新 | 0.4ms | 1% |
| **总计** | **48.8ms** | **100%** |
| **浏览器有效 FPS** | **20.5 fps** | |

> Benchmark 工具：`benches/browser_bench.mjs`
> 运行：`node benches/browser_bench.mjs --res 720`（可选 `--res 480`）
> 依赖：Playwright + Chromium，视频文件位于 `C:\CreativeProjects\CFAI_MatchBoxTest\`

**关键结论：**

1. VideoFrame 路径下，瓶颈已转移到 WASM 计算（87%），浏览器开销仅 13%
2. Canvas 路径下，`drawImage` 占 52%（H.264 软解码），浏览器开销 66%
3. **必须使用 VideoFrame API** 才能实现 30fps+ 的实时对比
4. `requestVideoFrameCallback` 替代 `requestAnimationFrame`，只在有新视频帧时触发处理

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
