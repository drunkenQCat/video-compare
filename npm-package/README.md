# @video-compare/wasm

> WebAssembly library for real-time video frame comparison (SSIM/PSNR/MSE)

[![npm version](https://badge.fury.io/js/@video-compare%2Fwasm.svg)](https://badge.fury.io/js/@video-compare%2Fwasm)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

## 特性

- ⚡ **超快**: 1080p帧对比 < 50ms
- 📦 **轻量**: ~95KB (gzip后 ~24KB)
- 🎯 **纯计算**: 无GUI依赖，专注算法性能
- 🔒 **类型安全**: 完整的TypeScript支持
- 🌐 **浏览器原生**: 无需后端服务

## 安装

```bash
npm install @video-compare/wasm
```

## 快速开始

### 基础使用

```typescript
import { VideoComparer } from '@video-compare/wasm';

// 1. 创建实例（自动加载Wasm）
const comparer = await VideoComparer.create();

// 2. 准备两帧图像的RGB数据
// 从canvas获取
const canvas = document.getElementById('myCanvas');
const ctx = canvas.getContext('2d');
const imageData = ctx.getImageData(0, 0, 1920, 1080);

// 或者从文件加载
const leftBuffer = await loadImageAsRGB('left.jpg');
const rightBuffer = await loadImageAsRGB('right.jpg');

// 3. 对比
const metrics = await comparer.compare({
  left: leftBuffer,
  right: rightBuffer,
  width: 1920,
  height: 1080
});

// 4. 查看结果
console.log(`SSIM: ${metrics.ssim.toFixed(4)}`);  // 0.95
console.log(`PSNR: ${metrics.psnr.toFixed(2)} dB`); // 42.3
console.log(`MSE: ${metrics.mse.toFixed(2)}`);     // 15.2

// 5. 释放资源
comparer.dispose();
```

### React集成

```tsx
import { useState, useEffect } from 'react';
import { VideoComparer, CompareMetrics } from '@video-compare/wasm';

function VideoComparison({ leftSrc, rightSrc }) {
  const [metrics, setMetrics] = useState<CompareMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let comparer: VideoComparer | null = null;

    async function compare() {
      try {
        comparer = await VideoComparer.create();
        
        const [leftData, rightData] = await Promise.all([
          loadImageAsRGB(leftSrc),
          loadImageAsRGB(rightSrc)
        ]);

        const result = await comparer.compare({
          left: leftData,
          right: rightData,
          width: 1920,
          height: 1080
        });

        if (!disposed) {
          setMetrics(result);
        }
      } catch (error) {
        console.error('Comparison failed:', error);
      } finally {
        setLoading(false);
      }
    }

    compare();

    return () => {
      disposed = true;
      comparer?.dispose();
    };
  }, [leftSrc, rightSrc]);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Comparison Results</h2>
      <p>SSIM: {metrics?.ssim.toFixed(4)}</p>
      <p>PSNR: {metrics?.psnr.toFixed(2)} dB</p>
      <p>MSE: {metrics?.mse.toFixed(2)}</p>
    </div>
  );
}
```

## API文档

### VideoComparer.create(config?)

创建VideoComparer实例。

**参数**:
- `config` (可选): CompareConfig 配置对象

**返回**: `Promise<VideoComparer>`

**示例**:
```typescript
const comparer = await VideoComparer.create({
  maxWidth: 1920,    // 超过此尺寸自动降采样
  maxHeight: 1080,
  blockSize: 16      // 分块大小
});
```

### comparer.compare(input, includeDiff?)

对比两帧图像。

**参数**:
- `input`: CompareInput 输入数据
  - `left`: ArrayBuffer | Uint8Array - 左帧RGB数据
  - `right`: ArrayBuffer | Uint8Array - 右帧RGB数据
  - `width`: number - 图像宽度
  - `height`: number - 图像高度
- `includeDiff` (可选): boolean - 是否返回分块差异数据

**返回**: `Promise<CompareMetrics>`

**示例**:
```typescript
const metrics = await comparer.compare({
  left: leftRGBData,
  right: rightRGBData,
  width: 1920,
  height: 1080
}, true); // includeDiff = true

// 访问差异数据
console.log(metrics.diff); // Float32Array
```

### comparer.setConfig(config)

更新配置参数。

**参数**:
- `config`: Partial<CompareConfig>

**示例**:
```typescript
comparer.setConfig({
  maxWidth: 1280,
  blockSize: 32
});
```

### comparer.getConfig()

获取当前配置。

**返回**: `Required<CompareConfig>`

### comparer.dispose()

释放Wasm资源。调用后实例不可再使用。

**示例**:
```typescript
comparer.dispose();
```

## 类型定义

### CompareMetrics

```typescript
interface CompareMetrics {
  /** 结构相似度指数 (0-1) */
  ssim: number;
  
  /** 峰值信噪比 (dB) */
  psnr: number;
  
  /** 均方误差 */
  mse: number;
  
  /** 实际处理的宽度 */
  width: number;
  
  /** 实际处理的高度 */
  height: number;
  
  /** 是否进行了降采样 */
  downsampled: boolean;
  
  /** 分块差异数据 (可选) */
  diff?: Float32Array;
}
```

### CompareConfig

```typescript
interface CompareConfig {
  /** 最大处理宽度 (默认: 1920) */
  maxWidth?: number;
  
  /** 最大处理高度 (默认: 1080) */
  maxHeight?: number;
  
  /** 分块大小 (默认: 16) */
  blockSize?: number;
}
```

## 指标解读

### SSIM (Structural Similarity Index)

| 范围 | 质量 |
|------|------|
| > 0.95 | 极好 (几乎无差异) |
| 0.90 - 0.95 | 良好 (轻微差异) |
| 0.70 - 0.90 | 一般 (明显差异) |
| < 0.70 | 较差 (差异显著) |

### PSNR (Peak Signal-to-Noise Ratio)

| 范围 (dB) | 质量 |
|-----------|------|
| > 40 | 极好 |
| 30 - 40 | 良好 |
| 25 - 30 | 一般 |
| < 25 | 较差 |

### MSE (Mean Squared Error)

| 范围 | 质量 |
|------|------|
| < 10 | 极好 |
| 10 - 50 | 良好 |
| 50 - 200 | 一般 |
| > 200 | 较差 |

## 性能

| 分辨率 | 处理时间 | 内存峰值 |
|--------|---------|---------|
| 640×360 | ~5ms | ~2MB |
| 1280×720 | ~15ms | ~8MB |
| 1920×1080 | ~40ms | ~18MB |
| 4K (降采样) | ~50ms | ~25MB |

## 从图像文件获取RGB数据

```typescript
function loadImageAsRGB(src: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      
      const ctx = canvas.getContext('2d');
      const imageData = ctx!.getImageData(0, 0, img.width, img.height);
      
      // 提取RGB数据 (跳过Alpha通道)
      const rgb = new Uint8Array(img.width * img.height * 3);
      for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
        rgb[j] = imageData.data[i];     // R
        rgb[j + 1] = imageData.data[i + 1]; // G
        rgb[j + 2] = imageData.data[i + 2]; // B
      }
      
      resolve(rgb);
    };
    img.onerror = reject;
    img.src = src;
  });
}
```

## 绘制差异热力图

```typescript
function drawHeatmap(diff: Float32Array, width: number, height: number) {
  const canvas = document.getElementById('heatmap');
  const ctx = canvas.getContext('2d');
  
  const blockSize = 16;
  const blocksX = Math.ceil(width / blockSize);
  const blocksY = Math.ceil(height / blockSize);
  
  // 找到最大MSE值
  let maxMse = 0;
  for (let i = 0; i < diff.length; i++) {
    maxMse = Math.max(maxMse, diff[i]);
  }
  
  // 绘制
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const idx = by * blocksX + bx;
      const mse = diff[idx];
      const normalized = maxMse > 0 ? mse / maxMse : 0;
      
      // 颜色映射: 绿(相似) → 红(差异)
      const r = Math.floor(normalized * 255);
      const g = Math.floor((1 - normalized) * 255);
      
      ctx.fillStyle = `rgb(${r}, ${g}, 0)`;
      ctx.fillRect(
        bx * blockSize,
        by * blockSize,
        blockSize,
        blockSize
      );
    }
  }
}
```

## 故障排除

### Wasm加载失败

**问题**: `Failed to load VideoCompare Wasm`

**原因**: 
- 未正确打包.wasm文件
- 使用了file://协议而非HTTP服务器

**解决**:
```bash
# 确保.wasm文件在dist目录中
ls dist/video-compare.wasm

# 使用HTTP服务器测试
npx serve .
```

### 内存泄漏

**问题**: 长时间运行后内存增长

**原因**: 未调用`dispose()`

**解决**:
```typescript
// 始终在finally块或useEffect清理函数中调用dispose
try {
  const comparer = await VideoComparer.create();
  // ... 使用
} finally {
  comparer.dispose();
}
```

### 缓冲区大小不匹配

**问题**: `Left buffer size mismatch`

**原因**: RGB数据尺寸计算错误

**解决**:
```typescript
// 正确计算: width × height × 3 (RGB = 3 bytes/pixel)
const expectedSize = width * height * 3;
console.assert(buffer.byteLength === expectedSize);
```

## 许可证

MIT License

## 贡献

欢迎提交Issue和Pull Request！

仓库地址: https://github.com/drunkenQCat/video-compare
