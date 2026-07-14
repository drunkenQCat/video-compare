# 性能优化最佳实践

> 基于 VideoFrame+copyTo 路线失败的 post-mortem 总结

## 原则 1：实验必须测真实场景

**规则：任何性能优化实验，必须在真实运行场景下测量，不能在孤立/暂停状态下测。**

### 为什么

VideoFrame+copyTo 在暂停视频上测出 51x 加速（0.1ms vs 5.1ms），但在持续播放时 copyTo 慢了 4.5 倍（24.9ms vs 5.5ms）。原因：播放时 GPU 解码管线在写入帧数据，`copyTo` 必须等解码完成才能拷贝；暂停时帧已稳定在内存中，直接拷贝。

### 怎么做

```javascript
// ❌ 错误：暂停视频上测
video.currentTime = 1.0;
await wait(500);
measure(() => new VideoFrame(video));

// ✅ 正确：持续播放下测
video.play();
await wait(1000); // 等播放稳定
measure(() => {
    const frame = new VideoFrame(video);
    // ... 完整操作
    frame.close();
});
```

### checklist

- [ ] 实验场景是否模拟了真实使用方式（持续播放，不是暂停/seek）？
- [ ] 是否用真实数据量（两路视频，不是一路）？
- [ ] 是否测量了连续 N 帧（不是单次操作）？
- [ ] 是否在实验和生产中使用相同的分辨率/参数？

---

## 原则 2：API 返回值不能假设相等

**规则：调用任何返回维度信息的 API 后，必须先检查实际值，不能假设与预期相等。**

### 为什么

`VideoFrame.codedHeight = 1090` 但 `video.videoHeight = 1080`。H.264 以 16×16 宏块为单位编码，1080 不能被 16 整除（1080÷16=67.5），编码器补到 1090（或 1088）。`copyTo` 按 `codedWidth × codedHeight` 分配内存，按 `videoWidth × videoHeight` 分配会少 56%。

### 怎么做

```javascript
// ❌ 错误：假设 codedDimensions == videoDimensions
const buf = new Uint8Array(video.videoWidth * video.videoHeight * 4);
frame.copyTo(buf);

// ✅ 正确：从 API 读取实际值
const fw = frame.codedWidth;
const fh = frame.codedHeight;
const buf = new Uint8Array(fw * fh * 4);
frame.copyTo(buf);

// ✅ 或者：打印出来确认
console.log('coded:', frame.codedWidth, frame.codedHeight);
console.log('display:', frame.displayWidth, frame.displayHeight);
console.log('video:', video.videoWidth, video.videoHeight);
```

### checklist

- [ ] 是否检查了 API 返回的实际维度（codedWidth/displayWidth/videoWidth）？
- [ ] 是否验证了 buffer 大小与 API 返回值匹配？
- [ ] 是否处理了 padding/对齐导致的维度差异？

---

## 原则 3：管线输出尺寸 ≠ 输入尺寸

**规则：当管线中有变换步骤（降采样、缩放、裁剪），输出数据的尺寸可能与输入不同，必须从输出数据本身推导尺寸。**

### 为什么

Worker 发送 1920×1080 的 RGBA 给 WASM，WASM 自动降采样到 1280×720，输出 rgba 只有 3.7MB。但 Worker 发回的 `width=1920, height=1080`（输入尺寸），主线程 `createImageData(1920, 1080)` 创建 8.3MB buffer，rgba 只能填 3.7MB → 行对齐错误 → 画面扭曲。

### 怎么做

```javascript
// ❌ 错误：用输入尺寸创建输出 buffer
const imgData = ctx.createImageData(inputWidth, inputHeight);
imgData.data.set(rgba); // 数据尺寸不匹配 → 扭曲

// ✅ 正确：从输出数据反算实际尺寸
const pixelCount = rgba.length / 4;
const aspectRatio = inputWidth / inputHeight;
const outH = Math.round(Math.sqrt(pixelCount / aspectRatio));
const outW = Math.round(pixelCount / outH);
ctx.canvas.width = outW;
ctx.canvas.height = outH;
const imgData = ctx.createImageData(outW, outH);
imgData.data.set(rgba);
```

### checklist

- [ ] 管线中是否有自动变换步骤（降采样、缩放、裁剪）？
- [ ] 输出 buffer 大小是否从实际数据推导，而非从输入参数假设？
- [ ] 是否验证了 `data.length === width * height * channels`？

---

## 原则 4：端到端验证后再改正式代码

**规则：先用 headless 浏览器验证完整管线（画面正确 + 性确实提升），再改正式代码。**

### 为什么

`copyTo` 的 0.1ms 数字太诱人，直接跳到了改正式代码，结果：
- copyTo 在播放时 24.9ms（不是 0.1ms）
- drawImage(videoFrame) 在播放时 20ms（比 drawImage(video) 的 3.5ms 更慢）
- 画面全黑（display:none 停止解码）
- 画面扭曲（输出尺寸不匹配）

### 怎么做

```javascript
// 第一步：headless 验证完整管线
// 1. 上传视频 → 播放 → VideoFrame → copyTo → WASM → 输出
// 2. 检查输出画面有内容（nonZero > 0）
// 3. 检查画面尺寸正确（width × height = pixelCount）
// 4. 检查持续 N 帧的性能稳定

const result = await page.evaluate(() => {
    const canvas = document.getElementById('canvas-diff');
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let nonZero = 0;
    for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] > 0 || img.data[i+1] > 0 || img.data[i+2] > 0) nonZero++;
    }
    return {
        width: canvas.width,
        height: canvas.height,
        nonZero: nonZero,
        total: img.data.length / 4,
        hasContent: nonZero > 0,
        dimensionMatch: canvas.width * canvas.height === img.data.length / 4,
    };
});

// 确认画面正确后再继续
if (!result.hasContent) throw new Error('Diff canvas is blank!');
if (!result.dimensionMatch) throw new Error('Dimension mismatch!');
```

### checklist

- [ ] 是否在 headless 浏览器中验证了完整管线（不只是单步操作）？
- [ ] 输出画面是否有内容（非全黑/全零）？
- [ ] 输出尺寸是否与数据匹配？
- [ ] 是否在连续播放下测量了 N 帧的中位性能？
- [ ] 是否对比了优化前后的性能（用 `--compare` 模式）？

---

## 原则 5：不要被单一数字蒙蔽

**规则：一个孤立的性能数字（如"51x加速"）不能作为决策依据，必须看它在真实管线中的实际效果。**

### 为什么

| 测量场景 | copyTo 耗时 | 结论 |
|---|---|---|
| 暂停视频（实验） | 0.1ms | "51x加速！" |
| 持续播放（真实） | 24.9ms | "实际比原方案更慢" |
| 真实管线总效果 | 画面全黑 + 扭曲 | "彻底失败" |

### 怎么做

1. 看到惊人数字时，先问：**"这个数字在什么条件下成立？"**
2. 再问：**"真实场景下这些条件是否满足？"**
3. 最后问：**"完整管线端到端的效果如何？"**

只有三个问题都有正面答案，才能开始改正式代码。

### checklist

- [ ] 这个加速数字在什么条件下成立？
- [ ] 真实运行场景是否满足这些条件？
- [ ] 完整管线端到端验证结果如何（画面 + 性能）？

---

## 工具清单

| 工具 | 路径 | 用途 |
|---|---|---|
| `wasm_bench.mjs` | benches/ | WASM 纯计算性能（Node.js） |
| `browser_bench.mjs` | benches/ | 浏览器全链路性能（Playwright headless） |
| `video_bench.mjs` | benches/ | 真实视频帧对比（ffmpeg 提取） |
| `videoframe_experiment.mjs` | benches/ | VideoFrame vs drawImage 对比 |
| `postmortem.mjs` | benches/ | 失败原因诊断脚本 |
| `comparison_bench.rs` | benches/ | Rust 原生 criterion benchmark |

### 标准验证流程

```bash
# 1. WASM 纯计算基线
node benches/wasm_bench.mjs --baseline

# 2. 浏览器全链路基线
node benches/browser_bench.mjs --res 720

# 3. 修改代码后，重新构建
wasm-pack build --target web --out-dir pkg-web
wasm-pack build --target nodejs --out-dir pkg

# 4. WASM 纯计算对比
node benches/wasm_bench.mjs --compare

# 5. 浏览器全链路对比（必须通过！）
node benches/browser_bench.mjs --res 720

# 6. 真实视频帧对比
node benches/video_bench.mjs --left <video1> --right <video2>
```
