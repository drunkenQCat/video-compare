# Video Compare Wasm Library 设计文档

**日期**: 2026-05-07

## 产品定位

纯计算WebAssembly库，接收两帧RGB图像数据，输出对比指标和空间差异数据，供前端渲染使用。

**不负责**：
- 视频文件I/O
- 视频解码
- GUI渲染
- SDL/窗口管理

## 架构设计

### API设计 (C API)

```c
// 对比指标
typedef struct {
  float ssim;           // 结构相似度 0-1
  float psnr;           // 峰值信噪比 (dB)
  float mse;            // 均方误差
  int width;            // 实际处理宽度
  int height;           // 实际处理高度
  int downsampled;      // 是否降采样
} CompareMetrics;

// 分块差异数据 (16x16 block)
// 前端可选择性使用这个数据绘制热力图

// 主API: 对比两帧
COMPARE_API CompareMetrics compare_frames(
  const uint8_t* left_rgb,      // 左帧RGB数据
  const uint8_t* right_rgb,     // 右帧RGB数据
  int width,                     // 宽度
  int height,                    // 高度
  int stride,                    // 行步长(bytes)
  uint8_t* diff_buffer,          // 输出:分块差异buffer (可选,传NULL跳过)
  int diff_buffer_size           // diff_buffer大小
);

// 配置API (可选,用于控制降采样等)
COMPARE_API void set_max_resolution(int max_width, int max_height);
```

### 处理流程

1. **接收输入**: 两帧RGB buffer + 尺寸信息
2. **降采样** (如果超过1920x1080):
   - 双线性插值降到max_resolution
   - 记录实际处理尺寸
3. **分块计算** (16x16 block):
   - 每个block计算SSIM/PSNR/MSE
   - 聚合全局指标
   - 填充diff_buffer
4. **返回结果**: metrics + 可选diff数据

### 性能目标

- 1080p帧对比: < 50ms (现代CPU)
- 4K帧: 降采样后处理,保持< 100ms
- 内存占用: < 50MB (包含降采样buffer)

### CI配置

- 使用Emscripten编译
- 无SDL2/SDL_ttf依赖 (纯计算库)
- 输出: `.wasm` + `.js` loader
- 目标体积: < 500KB
