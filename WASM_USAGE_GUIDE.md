# Video Compare Wasm - 正确使用指南

**版本**: 1.0.0  
**更新日期**: 2026-05-08

---

## 快速开始（3步验证）

### 第1步：获取Wasm文件

从GitHub Actions下载编译产物：

```bash
# 方法1: 使用GitHub CLI
gh run download --repo drunkenQCat/video-compare --dir wasm-files

# 方法2: 网页下载
# 访问 https://github.com/drunkenQCat/video-compare/actions
# 点击最新的"Wasm Build" → 下载"video-compare-wasm"
```

你应该获得：
- `video-compare.wasm` (17KB)
- `video-compare.js` (76KB)

### 第2步：创建HTML文件

创建一个`test.html`文件，**与wasm文件放在同一目录**：

```html
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Wasm Test</title>
</head>
<body>
    <h1>Wasm Test</h1>
    <pre id="output"></pre>

    <!-- 关键：在加载JS之前定义Module -->
    <script>
        var Module = {
            onRuntimeInitialized: function() {
                document.getElementById('output').textContent = '✅ Wasm loaded!';
                console.log('Wasm is ready');
            }
        };
    </script>
    <script src="video-compare.js"></script>
</body>
</html>
```

### 第3步：启动HTTP服务器并测试

```bash
# 使用Python启动服务器
python -m http.server 8080

# 打开浏览器
# http://localhost:8080/test.html

# 按F12打开控制台，应该看到：
# "Wasm is ready"
```

---

## 完整使用指南

### 1. 理解API

Wasm库导出以下C API（通过Emscripten）：

| 函数 | 说明 |
|------|------|
| `_compare_frames(leftPtr, rightPtr, w, h, diffPtr, diffSize)` | 对比两帧 |
| `_malloc(size)` | 分配Wasm内存 |
| `_free(ptr)` | 释放Wasm内存 |
| `_set_compare_config(configPtr)` | 设置配置 |
| `_get_compare_config()` | 获取配置 |

内存视图：
- `Module.HEAPU8` - Uint8Array视图（用于RGB数据）
- `Module.HEAPF32` - Float32Array视图（用于差异数据）

### 2. 基本使用流程

```javascript
// 步骤1: 等待Wasm加载
var Module = {
    onRuntimeInitialized: function() {
        console.log('Wasm ready!');
        runComparison();
    }
};

function runComparison() {
    // 步骤2: 准备图像数据 (RGB格式)
    const width = 100;
    const height = 100;
    const size = width * height * 3;  // RGB = 3 bytes/pixel

    // 创建RGB数据
    const leftRGB = new Uint8Array(size);
    const rightRGB = new Uint8Array(size);

    // 填充数据（示例：灰色）
    for (let i = 0; i < size; i++) {
        leftRGB[i] = 128;
        rightRGB[i] = 128;
    }

    // 步骤3: 分配Wasm内存
    const leftPtr = Module._malloc(size);
    const rightPtr = Module._malloc(size);

    // 步骤4: 复制数据到Wasm内存
    Module.HEAPU8.set(leftRGB, leftPtr);
    Module.HEAPU8.set(rightRGB, rightPtr);

    // 步骤5: 调用对比函数
    const result = Module._compare_frames(
        leftPtr,    // 左帧指针
        rightPtr,   // 右帧指针
        width,      // 宽度
        height,     // 高度
        0,          // 差异buffer (null)
        0           // 差异buffer大小
    );

    console.log('对比结果:', result);

    // 步骤6: 释放内存
    Module._free(leftPtr);
    Module._free(rightPtr);
}
```

### 3. 从Canvas获取图像数据

```javascript
function getImageDataFromCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Canvas返回RGBA，需要转换为RGB
    const rgb = new Uint8Array(canvas.width * canvas.height * 3);
    for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
        rgb[j] = imageData.data[i];     // R
        rgb[j+1] = imageData.data[i+1]; // G
        rgb[j+2] = imageData.data[i+2]; // B
    }
    return rgb;
}

// 使用示例
const canvas1 = document.getElementById('canvas1');
const canvas2 = document.getElementById('canvas2');

const leftRGB = getImageDataFromCanvas(canvas1);
const rightRGB = getImageDataFromCanvas(canvas2);

// 然后调用_compare_frames...
```

### 4. 获取差异热力图数据

```javascript
function compareWithHeatmap(leftRGB, rightRGB, width, height) {
    const size = width * height * 3;
    const blockSize = 16;
    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    const diffSize = blocksX * blocksY * 4;  // float = 4 bytes

    const leftPtr = Module._malloc(size);
    const rightPtr = Module._malloc(size);
    const diffPtr = Module._malloc(diffSize);

    try {
        Module.HEAPU8.set(leftRGB, leftPtr);
        Module.HEAPU8.set(rightRGB, rightPtr);

        const result = Module._compare_frames(
            leftPtr, rightPtr, width, height,
            diffPtr, diffSize
        );

        // 读取差异数据
        const diffData = new Float32Array(
            Module.HEAPF32.buffer,
            diffPtr,
            blocksX * blocksY
        );

        // 复制数据（避免_free后失效）
        const heatMap = new Float32Array(diffData);

        return {
            result: result,
            heatmap: heatMap,
            blocksX: blocksX,
            blocksY: blocksY
        };
    } finally {
        Module._free(leftPtr);
        Module._free(rightPtr);
        Module._free(diffPtr);
    }
}
```

### 5. 绘制差异热力图

```javascript
function drawHeatmap(heatmap, blocksX, blocksY, width, height) {
    const canvas = document.getElementById('heatmap');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const blockW = width / blocksX;
    const blockH = height / blocksY;

    // 找最大值
    let maxVal = 0;
    for (let i = 0; i < heatmap.length; i++) {
        maxVal = Math.max(maxVal, heatmap[i]);
    }

    // 绘制
    for (let y = 0; y < blocksY; y++) {
        for (let x = 0; x < blocksX; x++) {
            const idx = y * blocksX + x;
            const val = maxVal > 0 ? heatmap[idx] / maxVal : 0;

            // 颜色映射：绿→红
            const r = Math.floor(val * 255);
            const g = Math.floor((1 - val) * 255);
            ctx.fillStyle = `rgb(${r},${g},0)`;
            ctx.fillRect(x * blockW, y * blockH, blockW, blockH);
        }
    }
}
```

---

## 常见问题

### Q: onRuntimeInitialized不触发？

**A**: 确保：
1. 使用HTTP服务器（不能file://）
2. 在加载JS**之前**定义Module
3. .wasm文件与.js在同一目录

```html
<!-- ✅ 正确顺序 -->
<script>
    var Module = { onRuntimeInitialized: ... };
</script>
<script src="video-compare.js"></script>

<!-- ❌ 错误顺序 -->
<script src="video-compare.js"></script>
<script>
    var Module = { ... };  // 太晚了！
</script>
```

### Q: compare_frames返回0或异常值？

**A**: 检查：
1. RGB数据尺寸 = width × height × 3
2. 指针正确分配（使用_malloc）
3. 数据已复制到HEAPU8

### Q: 内存泄漏？

**A**: 确保每个`_malloc`都有对应的`_free`：

```javascript
const ptr = Module._malloc(size);
try {
    // 使用ptr
} finally {
    Module._free(ptr);  // 必须释放
}
```

---

## 完整示例文件

参见仓库中的：
- `test-simple-final.html` - 最简单的测试页面
- `test-debug.html` - 带调试信息的页面

---

**许可证**: MIT  
**仓库**: https://github.com/drunkenQCat/video-compare
