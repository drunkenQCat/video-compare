# Performance Optimization Post-Mortem

## VideoFrame + copyTo 路线失败分析

### 背景

为突破 `drawImage(video)` 的 25ms 瓶颈（H.264 软解码），尝试用 WebCodecs `VideoFrame + copyTo` 替代 `drawImage + getImageData`。

### 实验数据

实验脚本：`benches/postmortem.mjs`

#### 维度不匹配

| 属性 | 值 | 说明 |
|---|---|---|
| `video.videoWidth` | 1920 | 显示宽度 |
| `video.videoHeight` | 1080 | 显示高度 |
| `frame.codedWidth` | 1920 | 编码宽度（=显示宽度） |
| `frame.codedHeight` | **1090** | 编码高度（≠ 显示高度！H.264 宏块对齐） |
| copyTo 所需 buffer | 8,371,200 bytes (1920×1090×4) | |
| 我分配的 buffer | 3,686,400 bytes (1280×720×4) | 少了 56% |

#### 播放 vs 暂停性能

| 操作 | 暂停时 | 播放时 | 倍数 |
|---|---|---|---|
| `copyTo` (1920×1090 RGBA) | 5.5ms | 24.9ms | 4.5× 慢 |
| `drawImage(video, 1280×720)` | — | 3.5ms | 基准 |
| `drawImage(videoFrame, 1280×720)` | — | 20.0ms | 5.7× 慢 |

### 五个失败点

1. **buffer 不足**: `codedHeight=1090 ≠ videoHeight=1080`（H.264 padding），copyTo 报错
2. **display:none 空帧**: 隐藏 video 元素导致浏览器停止解码，VideoFrame 拿到空帧
3. **输出尺寸不匹配**: WASM 自动降采样后输出 1280×720，但 Worker 发回 1920×1080 → 画面扭曲
4. **copyTo 播放时慢**: 持续播放时 copyTo 要同步 GPU 解码管线，24.9ms（vs 暂停时 5.5ms）
5. **drawImage(videoFrame) 反而更慢**: VideoFrame 构造/close 有 GPU 开销，20ms vs drawImage(video) 3.5ms

### 根本原因

**实验方法论错误**：在非代表性场景（暂停视频）上测量 `copyTo`，得到 0.1ms（51x加速）的数字后，直接在正式代码中实施，未在持续播放场景下验证。

### 最终方案

用 `VideoFrame` 做快速 `drawImage`（绕过 H.264 软解码），但用 `getImageData` 在目标分辨率提取像素（不用 `copyTo`）：

```
VideoFrame(video) → drawImage(frame, 1280×720) → getImageData(1280×720) → Worker
```

| 步骤 | 耗时 | 说明 |
|---|---|---|
| drawImage(videoFrame) | 0.4ms | 已解码帧，快速绘制 |
| getImageData | 7.0ms | 在 720p canvas 上提取 |
| WASM 计算 | 17.2ms | 瓶颈 |
| putImageData | 2.1ms | |
| 总计 | 27.5ms = 36.4 FPS | |

### 教训

1. **实验必须测真实场景**：暂停 vs 持续播放性能差 4.5 倍
2. **API 维度不能假设相等**：`codedWidth ≠ videoWidth`，`codedHeight ≠ videoHeight`
3. **输出尺寸 ≠ 输入尺寸**：有自动降采样时，输出维度由降采样决定
4. **端到端验证后再改代码**：先确认画面正确+性能确实提升，再改正式管线
5. **不要被单一数字蒙蔽**："51x加速"只在暂停场景成立
