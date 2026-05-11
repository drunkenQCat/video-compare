/**
 * test_bindings.cjs — Wasm 导出验证 & SSIM/PSNR/MSE 回归测试
 *
 * 用法: node test_bindings.cjs [build-wasm目录]
 * CI 用法: node tests/wasm/test_bindings.cjs ./build-wasm
 *
 * 测试:
 *   1. 导出符号完整性 (Module.compare_frames / get_compare_config / _malloc / _free)
 *   2. 全红=全红 → SSIM≈1.0  PSNR≈100  MSE≈0
 *   3. 全红 vs 全蓝 → SSIM≈0.6098  PSNR≈1.76  MSE≈43350
 *   4. 边缘块对齐 (20×20 非 block_size 整数倍)
 *   5. get_compare_config 默认值
 *   6. 降采样触发 (传入>1080p 超大图)
 *
 * 退出码: 0=全部通过, 1=有失败
 */

const path = require('path');
const fs = require('fs');

// ─── 配置 ───────────────────────────────────────────────────
const BUILD_DIR = process.argv[2] || path.join(__dirname, '..', '..', 'build-wasm');
const WASM_ENTRY = path.resolve(BUILD_DIR, 'video-compare.js');

const TOLERANCE = {
    SSIM: 5e-5,   // 与理论值的允许偏差
    PSNR: 0.005,
    MSE:  0.1,
};

let passCount = 0, failCount = 0;

// ─── 测试工具 ─────────────────────────────────────────────────
function assert(condition, name, detail) {
    if (condition) {
        passCount++;
        console.log(`  PASS: ${name}`);
    } else {
        failCount++;
        const extra = detail ? `  (${detail})` : '';
        console.error(`  FAIL: ${name}${extra}`);
    }
}

function assertEq(actual, expected, name, tolKey) {
    const tol = TOLERANCE[tolKey] || 1e-4;
    const ok = Math.abs(actual - expected) < tol;
    assert(ok, `${name}  expected=${expected}  actual=${actual}`,
           !ok ? `diff=${Math.abs(actual - expected)} tol=${tol}` : undefined);
}

function assertFloatEq(actual, expected, name, tolOverride) {
    const tol = tolOverride || 1e-4;
    const ok = Math.abs(actual - expected) < tol;
    assert(ok, `${name}  expected≈${expected}  actual=${actual}`,
           !ok ? `diff=${Math.abs(actual - expected)}` : undefined);
}

function summary() {
    const total = passCount + failCount;
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`结果: ${passCount}/${total} 通过, ${failCount}/${total} 失败`);
    if (failCount > 0) {
        console.error('❌ 存在失败 — CI 应阻断');
    }
    console.log(`${'═'.repeat(60)}`);
    return failCount === 0;
}

// ─── 色块生成 ────────────────────────────────────────────────
function makeSolid(w, h, r, g, b) {
    const buf = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
        buf[i * 3] = r;
        buf[i * 3 + 1] = g;
        buf[i * 3 + 2] = b;
    }
    return buf;
}

/** 把 JS Uint8Array 拷贝到 WASM heap, 返回 [ptr, subarray-view] */
function copyToWasm(Module, jsData) {
    const ptr = Module._malloc(jsData.length);
    if (!ptr) throw new Error('_malloc returned 0');
    Module.HEAPU8.set(jsData, ptr);
    // subarray 共享 WASM ArrayBuffer, byteOffset == ptr (即 C++ 中的有效指针)
    const view = Module.HEAPU8.subarray(ptr, ptr + jsData.length);
    return [ptr, view];
}

function freeAll(Module, ...ptrs) {
    for (const p of ptrs) if (p) Module._free(p);
}

// ─── 主测试 ──────────────────────────────────────────────────
function runTests(Module) {
    console.log('\n── 1. 导出符号 ──');
    assert(typeof Module.compare_frames === 'function', 'compare_frames (embind) 存在',
           `类型: ${typeof Module.compare_frames}`);
    assert(typeof Module.get_compare_config === 'function', 'get_compare_config (embind) 存在');
    assert(typeof Module._malloc === 'function', '_malloc 存在');
    assert(typeof Module._free === 'function', '_free 存在');
    assert(Module.HEAPU8 && Module.HEAPU8.length > 0, 'HEAPU8 可用', Module.HEAPU8 ? `长度=${Module.HEAPU8.length}` : 'HEAPU8=undefined');
    assert(Module.HEAPF32 && Module.HEAPF32.length > 0, 'HEAPF32 可用');

    console.log('\n── 2. 全同图 (全部红色) ──');
    {
        const w = 64, h = 64;
        const left = makeSolid(w, h, 255, 0, 0);
        const right = makeSolid(w, h, 255, 0, 0);
        const [lp, lv] = copyToWasm(Module, left);
        const [rp, rv] = copyToWasm(Module, right);
        const result = Module.compare_frames(lv, rv, w, h);
        assertFloatEq(result.ssim, 1.0, 'SSIM=1.0 (全同)');
        assertFloatEq(result.psnr, 100, 'PSNR≈100', 0.1);
        assertFloatEq(result.mse, 0, 'MSE≈0', 0.1);
        freeAll(Module, lp, rp);
    }

    console.log('\n── 3. 红 vs 蓝 (255,0,0 vs 0,0,255) ──');
    {
        const w = 64, h = 64;
        // 手动计算理论值:
        //   Red gray:  0.2126*255 = 54.213
        //   Blue gray: 0.0722*255 = 18.411
        //   var=0, cov=0 (纯色块内无变化)
        //   SSIM per block = (2*mx*my + C1) / (mx²+my² + C1)
        //   = (2*54.213*18.411 + 6.5025) / (54.213² + 18.411² + 6.5025) ≈ 0.60978
        //   MSE per pixel-channel = ((255-0)²+(0-0)²+(0-255)²)/3 = 43350
        //   PSNR = 10*log10(65025/43350) ≈ 1.7609
        const left = makeSolid(w, h, 255, 0, 0);
        const right = makeSolid(w, h, 0, 0, 255);
        const [lp, lv] = copyToWasm(Module, left);
        const [rp, rv] = copyToWasm(Module, right);
        const result = Module.compare_frames(lv, rv, w, h);
        assertFloatEq(result.ssim, 0.60978, 'SSIM≈0.6098 (红vs蓝)', 0.001);
        assertFloatEq(result.psnr, 1.7609, 'PSNR≈1.761 (红vs蓝)', 0.01);
        assertFloatEq(result.mse, 43350, 'MSE≈43350 (红vs蓝)', 1.0);
        freeAll(Module, lp, rp);
    }

    console.log('\n── 4. 边缘块对齐 (20×20, block_size=16) ──');
    {
        // 20×20 → blocks: ceil(20/16)=2 → 2×2=4 blocks
        //   blocks: (0,0)16×16, (16,0)4×16, (0,16)16×4, (16,16)4×4
        const w = 20, h = 20;
        const left = makeSolid(w, h, 100, 100, 100);
        const right = makeSolid(w, h, 200, 200, 200);
        const [lp, lv] = copyToWasm(Module, left);
        const [rp, rv] = copyToWasm(Module, right);
        const result = Module.compare_frames(lv, rv, w, h);
        assert(result.width > 0 && result.height > 0, '返回有效尺寸', `${result.width}x${result.height}`);
        assert(!isNaN(result.ssim) && result.ssim > 0, 'SSIM 非 NaN 且 > 0', `ssim=${result.ssim}`);
        assert(!isNaN(result.mse) && result.mse > 0, 'MSE 非 NaN 且 > 0', `mse=${result.mse}`);
        assertFloatEq(result.downsampled, 0, '未降采样(downsampled=0)', 0.1);
        freeAll(Module, lp, rp);
    }

    console.log('\n── 5. get_compare_config 默认值 ──');
    {
        const cfg = Module.get_compare_config();
        assert(cfg !== undefined && cfg !== null, 'get_compare_config 非空');
        if (cfg) {
            assertEq(cfg.max_width,  1920, '默认 max_width=1920');
            assertEq(cfg.max_height, 1080, '默认 max_height=1080');
            assertEq(cfg.block_size, 16,   '默认 block_size=16');
        }
    }

    console.log('\n── 6. 降采样触发 (>1080p → 降采样) ──');
    {
        // 2000×2000 超过 max_height=1080, scale = 1080/2000 = 0.54 → 1080×1080
        const w = 2000, h = 2000;
        const left = makeSolid(w, h, 128, 128, 128);
        const right = makeSolid(w, h, 128, 128, 128);
        const [lp, lv] = copyToWasm(Module, left);
        const [rp, rv] = copyToWasm(Module, right);
        const result = Module.compare_frames(lv, rv, w, h);
        assertEq(result.downsampled, 1, 'downsampled=1 (已降采样)');
        // 降采样后尺寸 ≤ 1080
        assert(result.width <= 1080 && result.height <= 1080, `降采样尺寸: ${result.width}×${result.height} (≤1080)`,
               `${result.width}×${result.height}`);
        // 两图相同 → SSIM≈1.0 (注意: 降采样用最近邻, 色块均匀无影响)
        assertFloatEq(result.ssim, 1.0, '降采样全同图 SSIM≈1.0');
        freeAll(Module, lp, rp);
    }

    console.log('\n── 7. 边界条件 ──');
    {
        // 最小图像 (16×16 = 正好一个block)
        const w = 16, h = 16;
        const left = makeSolid(w, h, 0, 255, 0);
        const right = makeSolid(w, h, 0, 255, 0);
        const [lp, lv] = copyToWasm(Module, left);
        const [rp, rv] = copyToWasm(Module, right);
        const result = Module.compare_frames(lv, rv, w, h);
        assertFloatEq(result.ssim, 1.0, 'min(16×16) 全同 SSIM=1.0');
        freeAll(Module, lp, rp);
    }
}

// ─── 入口 ────────────────────────────────────────────────────

console.log(`加载 Wasm 模块: ${WASM_ENTRY}`);
if (!fs.existsSync(WASM_ENTRY)) {
    console.error(`❌ 文件不存在: ${WASM_ENTRY}`);
    console.error('   用法: node tests/wasm/test_bindings.cjs [build-wasm目录]');
    process.exit(1);
}

// 删除缓存, 重新加载
delete require.cache[require.resolve(WASM_ENTRY)];

// Emscripten 使用 PROMISE 或无 MODULARIZE 的同步加载
// 策略: 如果 require 返回 Promise, 则 await; 否则直接用

async function loadModule() {
    let raw;
    try {
        raw = require(WASM_ENTRY);
    } catch (e) {
        console.error(`❌ require 失败: ${e.message}`);
        process.exit(1);
    }

    let Module = raw;

    // Emscripten 3.x 无 MODULARIZE 时, require 返回 Promise
    if (raw && typeof raw.then === 'function') {
        console.log('Emscripten 返回 Promise, 等待初始化...');
        Module = await raw;
    }

    // 如果设置了 EXPORT_NAME (CMakeLists.txt: VideoCompareModule)
    if (Module.VideoCompareModule) {
        Module = Module.VideoCompareModule;
    }

    // 可能还需要一层 .default (ESM interop)
    if (Module.default && typeof Module.default === 'object') {
        Module = Module.default;
    }

    return Module;
}

(async function main() {
    let Module = await loadModule();

    console.log(`Module 类型: ${typeof Module}`);
    console.log(`compare_frames: ${typeof Module.compare_frames}`);
    console.log(`_malloc:         ${typeof Module._malloc}`);
    console.log(`HEAPU8:          ${Module.HEAPU8 ? 'OK' : 'MISSING'}`);
    console.log(`HEAPF32:         ${Module.HEAPF32 ? 'OK' : 'MISSING'}`);

    if (!Module.HEAPU8) {
        console.error('❌ HEAPU8 不可用 — Wasm 未完成初始化');
        process.exit(1);
    }

    console.log('✅ Wasm 就绪, 开始测试...');
    runTests(Module);
    const ok = summary();
    process.exit(ok ? 0 : 1);
})();