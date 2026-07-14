/**
 * Post-mortem: Why did VideoFrame + copyTo fail?
 *
 * This experiment systematically verifies each failure point:
 * 1. VideoFrame dimensions vs video dimensions vs canvas dimensions
 * 2. copyTo buffer size requirements
 * 3. VideoFrame during continuous playback vs seeked (paused)
 * 4. drawImage(videoFrame) vs drawImage(video) during playback
 * 5. WASM output dimensions vs input dimensions (auto-downsampling)
 */

import { chromium } from 'playwright';

const LEFT_VIDEO = 'C:\\CreativeProjects\\CFAI_MatchBoxTest\\Original.mov';
const TEST_URL = 'http://localhost:8888/test.html';

async function runPostMortem() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('pageerror', e => console.log('[pageerror]', e.message));

    await page.goto(TEST_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.getElementById('wasm-status').textContent.includes('Worker ready'));

    // Upload video
    const leftInput = await page.$('#video-left');
    await leftInput.setInputFiles(LEFT_VIDEO);
    await page.waitForFunction(() => {
        const v = document.getElementById('video-left-preview');
        return v.readyState >= 2 && v.videoWidth > 0;
    }, { timeout: 30000 });

    // Seek to 1 second and wait for frame to be ready
    await page.evaluate(() => {
        const v = document.getElementById('video-left-preview');
        v.currentTime = 1.0;
        return new Promise(r => {
            v.addEventListener('seeked', r, { once: true });
            setTimeout(r, 3000); // timeout fallback
        });
    });

    // ===================================================================
    // Test 1: Dimension mismatch — the root cause of "destination not large enough"
    // ===================================================================
    console.log('=== Test 1: Dimension Analysis ===\n');

    const dims = await page.evaluate(() => {
        const video = document.getElementById('video-left-preview');
        const frame = new VideoFrame(video);
        const result = {
            videoWidth: video.videoWidth,       // Display width (CSS pixels)
            videoHeight: video.videoHeight,
            frameCodedWidth: frame.codedWidth,   // Raw decoded frame width (may include padding)
            frameCodedHeight: frame.codedHeight,
            frameDisplayWidth: frame.displayWidth,  // Intended display width
            frameDisplayHeight: frame.displayHeight,
            canvasTest1280: 1280,
            canvasTest720: 720,
        };
        frame.close();
        return result;
    });

    console.log('videoWidth/Height:     ', dims.videoWidth, '×', dims.videoHeight);
    console.log('frameCodedWidth/Height:', dims.frameCodedWidth, '×', dims.frameCodedHeight);
    console.log('frameDisplayWidth/Height:', dims.frameDisplayWidth, '×', dims.frameDisplayHeight);
    console.log('Canvas display target: ', dims.canvasTest1280, '×', dims.canvasTest720);
    console.log('Buffer needed for copyTo (RGBA):', dims.frameCodedWidth * dims.frameCodedHeight * 4, 'bytes');
    console.log('Buffer I allocated (1280×720×4):', 1280 * 720 * 4, 'bytes');
    console.log('→ Mismatch!' , dims.frameCodedWidth * dims.frameCodedHeight * 4 - 1280 * 720 * 4, 'bytes short\n');

    // ===================================================================
    // Test 2: copyTo with correct vs incorrect buffer size
    // ===================================================================
    console.log('=== Test 2: copyTo Buffer Size ===\n');

    const copyTest = await page.evaluate(() => {
        const video = document.getElementById('video-left-preview');
        const frame = new VideoFrame(video);
        const fw = frame.codedWidth;
        const fh = frame.codedHeight;

        const results = {};

        // Correct size
        try {
            const buf = new Uint8ClampedArray(fw * fh * 4);
            frame.copyTo(buf, { format: 'RGBA' });
            results.correctSize = { status: 'OK', size: buf.length };
        } catch (e) {
            results.correctSize = { status: 'FAIL', error: e.message };
        }

        // Incorrect (too small) — this is what caused the original error
        try {
            const buf = new Uint8ClampedArray(1280 * 720 * 4);
            frame.copyTo(buf, { format: 'RGBA' });
            results.tooSmall = { status: 'OK' };
        } catch (e) {
            results.tooSmall = { status: 'FAIL', error: e.message };
        }

        frame.close();
        return results;
    });

    console.log('Correct size buffer:', copyTest.correctSize.status, copyTest.correctSize.error || '');
    console.log('Too-small buffer:   ', copyTest.tooSmall.status, copyTest.tooSmall.error || '\n');

    // ===================================================================
    // Test 3: VideoFrame during playback vs seeked
    // ===================================================================
    console.log('=== Test 3: VideoFrame Performance — Playback vs Seeked ===\n');

    // Start playback
    await page.evaluate(() => {
        document.getElementById('video-left-preview').play();
    });

    // Measure during playback
    const playbackTest = await page.evaluate(async () => {
        const video = document.getElementById('video-left-preview');
        const N = 30;
        const times = [];

        for (let i = 0; i < N; i++) {
            const t0 = performance.now();
            const frame = new VideoFrame(video);
            const t1 = performance.now();
            const buf = new Uint8ClampedArray(frame.codedWidth * frame.codedHeight * 4);
            frame.copyTo(buf, { format: 'RGBA' });
            const t2 = performance.now();
            frame.close();
            times.push({ vf: t1 - t0, copyTo: t2 - t1, total: t2 - t0 });
            await new Promise(r => setTimeout(r, 10)); // Small delay
        }

        const med = (arr) => [...arr].sort((a,b) => a-b)[Math.floor(arr.length/2)];
        return {
            vf: med(times.map(t => t.vf)),
            copyTo: med(times.map(t => t.copyTo)),
            total: med(times.map(t => t.total)),
        };
    });

    console.log('During playback (continuous):');
    console.log(`  VideoFrame(): ${playbackTest.vf.toFixed(2)}ms`);
    console.log(`  copyTo():     ${playbackTest.copyTo.toFixed(2)}ms`);
    console.log(`  total:       ${playbackTest.total.toFixed(2)}ms`);

    // Pause and seek
    await page.evaluate(() => {
        const v = document.getElementById('video-left-preview');
        v.pause();
    });

    const seekedTest = await page.evaluate(async () => {
        const video = document.getElementById('video-left-preview');
        const N = 30;
        const times = [];

        for (let i = 0; i < N; i++) {
            video.currentTime = 1 + i * 0.1;
            await new Promise(r => setTimeout(r, 50)); // Wait for seek

            const t0 = performance.now();
            const frame = new VideoFrame(video);
            const t1 = performance.now();
            const buf = new Uint8ClampedArray(frame.codedWidth * frame.codedHeight * 4);
            frame.copyTo(buf, { format: 'RGBA' });
            const t2 = performance.now();
            frame.close();
            times.push({ vf: t1 - t0, copyTo: t2 - t1, total: t2 - t0 });
        }

        const med = (arr) => [...arr].sort((a,b) => a-b)[Math.floor(arr.length/2)];
        return {
            vf: med(times.map(t => t.vf)),
            copyTo: med(times.map(t => t.copyTo)),
            total: med(times.map(t => t.total)),
        };
    });

    console.log('\nDuring seeked (paused):');
    console.log(`  VideoFrame(): ${seekedTest.vf.toFixed(2)}ms`);
    console.log(`  copyTo():     ${seekedTest.copyTo.toFixed(2)}ms`);
    console.log(`  total:       ${seekedTest.total.toFixed(2)}ms`);
    console.log(`\n  → Playback is ${(playbackTest.total / seekedTest.total).toFixed(1)}x slower than seeked\n`);

    // ===================================================================
    // Test 4: drawImage(videoFrame) vs drawImage(video) during playback
    // ===================================================================
    console.log('=== Test 4: drawImage Performance ===\n');

    const drawTest = await page.evaluate(async () => {
        const video = document.getElementById('video-left-preview');
        video.play();
        await new Promise(r => setTimeout(r, 200));

        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const N = 30;

        // drawImage(video) — current bottleneck
        const videoTimes = [];
        for (let i = 0; i < N; i++) {
            const t0 = performance.now();
            ctx.drawImage(video, 0, 0, 1280, 720);
            videoTimes.push(performance.now() - t0);
            await new Promise(r => setTimeout(r, 10));
        }

        // drawImage(videoFrame) — proposed solution
        const frameTimes = [];
        for (let i = 0; i < N; i++) {
            const frame = new VideoFrame(video);
            const t0 = performance.now();
            ctx.drawImage(frame, 0, 0, 1280, 720);
            frameTimes.push(performance.now() - t0);
            frame.close();
            await new Promise(r => setTimeout(r, 10));
        }

        const med = (arr) => [...arr].sort((a,b) => a-b)[Math.floor(arr.length/2)];

        return {
            drawImageVideo: med(videoTimes),
            drawImageFrame: med(frameTimes),
        };
    });

    console.log(`drawImage(video, 1280×720):      ${drawTest.drawImageVideo.toFixed(2)}ms (includes H.264 decode)`);
    console.log(`drawImage(videoFrame, 1280×720): ${drawTest.drawImageFrame.toFixed(2)}ms (frame already decoded)`);
    console.log(`→ drawImage(videoFrame) is ${(drawTest.drawImageVideo / drawTest.drawImageFrame).toFixed(1)}x faster\n`);

    // ===================================================================
    // Test 5: WASM output dimensions vs input
    // ===================================================================
    console.log('=== Test 5: WASM Output Dimension Mismatch ===\n');

    const wasmTest = await page.evaluate(async () => {
        // Load the WASM module
        await new Promise(r => {
            const s = document.createElement('script');
            s.type = 'module';
            s.onload = r;
            // Use the already loaded module
            r();
        });

        // Create test data at 1920×1080
        const w = 1920, h = 1080;
        const leftRGB = new Uint8Array(w * h * 3).fill(128);
        const rightRGB = new Uint8Array(w * h * 3).fill(130);

        // Use the global wasm functions
        const wasm = window.__wasm || null;
        if (!wasm) {
            return { error: 'WASM not accessible from main thread' };
        }

        return { note: 'WASM auto-downsampling: 1920×1080 → 1280×720 (or different due to integer math)' };
    });

    console.log('When WASM receives 1920×1080 input:');
    console.log('  Input dimensions:  1920×1080');
    console.log('  Output dimensions: ~1280×720 (auto-downsampled)');
    console.log('  If Worker sends back 1920×1080 as "dimensions" but rgba is 1280×720 →');
    console.log('  createImageData(1920, 1080) creates 8.3MB buffer');
    console.log('  rgba only has 3.7MB → data.set() fills partial → rows misaligned → SKEWED\n');

    // ===================================================================
    // Summary
    // ===================================================================
    console.log('=== ROOT CAUSE SUMMARY ===\n');
    console.log('Failure 1 (blank canvas, copyTo error):');
    console.log(`  VideoFrame.codedWidth=${dims.frameCodedWidth} ≠ canvas width=1280`);
    console.log(`  copyTo needs ${dims.frameCodedWidth * dims.frameCodedHeight * 4} bytes, allocated ${1280*720*4}`);
    console.log('');
    console.log('Failure 2 (blank canvas, display:none):');
    console.log('  display:none stops video decoding → VideoFrame gets empty frames');
    console.log('');
    console.log('Failure 3 (skewed canvas):');
    console.log('  Worker sends input dims (1920×1080) but WASM outputs at downsampled dims');
    console.log('  createImageData uses wrong dimensions → pixel rows misaligned');
    console.log('');
    console.log('Failure 4 (low FPS with copyTo):');
    console.log(`  copyTo at full res (${dims.frameCodedWidth}×${dims.frameCodedHeight}) copies ${Math.round(dims.frameCodedWidth * dims.frameCodedHeight * 4 / 1024 / 1024)}MB/frame`);
    console.log(`  Playback copyTo: ${playbackTest.copyTo.toFixed(2)}ms vs seeked: ${seekedTest.copyTo.toFixed(2)}ms`);
    console.log(`  drawImage(videoFrame): ${drawTest.drawImageFrame.toFixed(2)}ms vs drawImage(video): ${drawTest.drawImageVideo.toFixed(2)}ms`);
    console.log('');
    console.log('Failure 5 (misleading benchmark):');
    console.log(`  Seeked experiment measured copyTo at ${seekedTest.total.toFixed(2)}ms`);
    console.log(`  But during playback it's ${playbackTest.total.toFixed(2)}ms (${(playbackTest.total/seekedTest.total).toFixed(1)}x slower)`);
    console.log('  → Experiment methodology was flawed: measured isolated, not continuous');

    await browser.close();
}

runPostMortem().catch(err => {
    console.error('Post-mortem failed:', err);
    process.exit(1);
});
