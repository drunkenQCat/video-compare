# @cfai/video-compare

> **WebAssembly video/image comparison library - Built with 🦀 Rust**

[![npm version](https://img.shields.io/npm/v/@cfai/video-compare.svg)](https://www.npmjs.com/package/@cfai/video-compare)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## 🎉 Version 2.0 - Rust 重构

我们自豪地宣布：**告别 C++，拥抱 Rust！**

### 为什么选择 Rust？

| 特性 | C++ (v1.x) | Rust (v2.0) |
|------|-----------|-------------|
| WASM 大小 | ~95KB | **~53KB** (-44%) |
| 内存安全 | 手动管理 | **编译器保证** |
| 构建工具 | cmake + emscripten | **cargo + wasm-pack** |
| 代码质量 | 需谨慎 | **所有权系统** |

## 安装

```bash
npm install @cfai/video-compare
```

## API

```typescript
import init, {
  compare,
  compare_with_diff,
  compute_pixel_diff,
  get_diff_data,
  get_pixel_diff_data,
  set_compare_config,
  WasmCompareConfig
} from '@cfai/video-compare';

await init();

// 基本对比
const metrics = compare(leftRGB, rightRGB, width, height);
console.log(`SSIM: ${metrics.ssim}, PSNR: ${metrics.psnr}dB`);

// 像素级差异 (精细)
const pixelResult = compute_pixel_diff(leftRGB, rightRGB, width, height);
const pixelData = get_pixel_diff_data(pixelResult);

// 分块级差异 (快速)
const blockResult = compare_with_diff(leftRGB, rightRGB, width, height);
const diffData = get_diff_data(blockResult);

// 配置
set_compare_config(new WasmCompareConfig(1920, 1080, 16));
```

## 功能

- **SSIM** - 结构相似度指数 (0-1)
- **PSNR** - 峰值信噪比 (dB)
- **MSE** - 均方误差
- **像素级差异** - 精细的热力图可视化
- **分块级差异** - 快速的块状可视化
- **自动降采样** - 大图自动缩放处理

## 使用场景

- 视频编码质量评估
- 图片压缩效果对比
- 视频帧实时对比
- 图像处理算法验证

## 示例

详见 [test.html](./pkg/test.html) 包含：

- 🎥 **实时视频对比** - 两路视频实时 SSIM/PSNR 监控
- 🖼️ **图片对比** - 上传图片查看差异热力图
- 📈 **SSIM趋势图** - 实时折线图追踪质量变化

## 构建

```bash
cargo install wasm-pack
wasm-pack build --target web --out-dir pkg
```

## Comparison with C++ Version

| Feature | C++ (Emscripten) | Rust (wasm-bindgen) |
|---------|------------------|---------------------|
| Build tool | cmake + emscripten | cargo + wasm-pack |
| Package size | ~95KB | **~53KB** |
| Memory mgmt | Manual _malloc/_free | Automatic |
| JS API | ccall/cwrap | Native typed arrays |
| Safety | Manual | **Rust guarantees** |

## 许可证

MIT License

---

**Made with 🦀 Rust | 告别 C++ 的复杂性，享受 Rust 的安全性**