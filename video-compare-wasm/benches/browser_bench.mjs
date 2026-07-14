/**
 * Playwright headless browser benchmark
 *
 * Loads test.html in headless Chrome, uploads real video files,
 * starts comparison, and collects per-frame timing breakdown.
 *
 * Measures the FULL browser pipeline:
 *   drawImage → getImageData → postMessage → WASM → putImageData → DOM
 *
 * Usage:
 *   node benches/browser_bench.mjs
 *   node benches/browser_bench.mjs --headed   # show browser window
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const LEFT_VIDEO = 'C:\\CreativeProjects\\CFAI_MatchBoxTest\\Original.mov';
const RIGHT_VIDEO = 'C:\\CreativeProjects\\CFAI_MatchBoxTest\\Modify.mov';
const TEST_URL = 'http://localhost:8888/test.html';
const HEADED = process.argv.includes('--headed');
const DURATION_SEC = 10; // Collect data for 10 seconds

async function runBenchmark() {
    console.log('=== Playwright Headless Browser Benchmark ===\n');
    console.log(`Browser: Chromium (${HEADED ? 'headed' : 'headless'})`);
    console.log(`Left:  ${LEFT_VIDEO}`);
    console.log(`Right: ${RIGHT_VIDEO}`);
    console.log(`Duration: ${DURATION_SEC}s\n`);

    const browser = await chromium.launch({
        headless: !HEADED,
        args: [
            '--use-gl=angle',       // Use GPU acceleration
            '--enable-features=VaapiVideoDecoder',
            '--disable-gpu-sandbox',
        ],
    });

    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    // Collect console messages for debugging
    page.on('console', msg => {
        if (msg.type() === 'error') console.error('[browser error]', msg.text());
    });

    console.log('[1] Loading test page...');
    await page.goto(TEST_URL, { waitUntil: 'networkidle' });

    // Wait for WASM worker to be ready
    await page.waitForFunction(() => {
        const status = document.getElementById('wasm-status');
        return status && status.textContent.includes('Worker ready');
    }, { timeout: 15000 });
    console.log('  WASM Worker ready\n');

    // Set resolution - support --res flag
    const resFlag = process.argv.indexOf('--res');
    const resValue = resFlag >= 0 ? process.argv[resFlag + 1] : '720';
    await page.selectOption('#video-res', resValue);

    console.log('[2] Uploading video files...');
    const leftInput = await page.$('#video-left');
    const rightInput = await page.$('#video-right');
    await leftInput.setInputFiles(LEFT_VIDEO);
    await rightInput.setInputFiles(RIGHT_VIDEO);

    // Wait for videos to be ready
    await page.waitForFunction(() => {
        const left = document.getElementById('video-left-preview');
        const right = document.getElementById('video-right-preview');
        return left.readyState >= 2 && right.readyState >= 2
            && left.videoWidth > 0 && right.videoWidth > 0;
    }, { timeout: 30000 });
    console.log('  Videos loaded\n');

    // Clear previous perf data
    await page.evaluate(() => {
        window.__perf__.frames = [];
        window.__perf__.summary = null;
    });

    console.log('[3] Starting comparison...');
    await page.click('#start-btn');

    // Collect data for DURATION_SEC seconds
    console.log(`[4] Collecting timing data for ${DURATION_SEC}s...`);
    await page.waitForTimeout(DURATION_SEC * 1000);

    // Stop comparison
    await page.evaluate(() => window.stopVideoCompare());

    // Collect results
    console.log('[5] Analyzing results...\n');
    const result = await page.evaluate(() => {
        const frames = window.__perf__.frames;
        if (frames.length === 0) return { error: 'No frames collected' };

        const fps = document.getElementById('fps-info').textContent;
        const frameCount = frames.length;

        // Compute statistics for each metric
        const metrics = ['draw', 'getImage', 'postMsg', 'worker', 'putImage', 'dom', 'total'];
        const stats = {};

        for (const m of metrics) {
            const values = frames.map(f => f[m]).sort((a, b) => a - b);
            const n = values.length;
            stats[m] = {
                median: +values[Math.floor(n / 2)].toFixed(2),
                mean: +(values.reduce((s, v) => s + v, 0) / n).toFixed(2),
                min: +values[0].toFixed(2),
                max: +values[n - 1].toFixed(2),
                p95: +values[Math.floor(n * 0.95)].toFixed(2),
            };
        }

        return { fps, frameCount, stats };
    });

    await browser.close();

    if (result.error) {
        console.error('Error:', result.error);
        process.exit(1);
    }

    // Print report
    console.log(`=== Browser Pipeline Breakdown (${result.frameCount} frames, ${DURATION_SEC}s, ${resValue}p) ===\n`);
    console.log(`Page FPS: ${result.fps}\n`);

    const fmt = (ms) => ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;

    const columns = ['median', 'mean', 'min', 'p95', 'max'];
    console.log('Step              median     mean       min        p95        max');
    console.log('─'.repeat(75));

    for (const m of ['draw', 'getImage', 'postMsg', 'worker', 'putImage', 'dom']) {
        const s = result.stats[m];
        const label = m.padEnd(18);
        console.log(`${label} ${fmt(s.median).padStart(8)}  ${fmt(s.mean).padStart(8)}  ${fmt(s.min).padStart(8)}  ${fmt(s.p95).padStart(8)}  ${fmt(s.max).padStart(8)}`);
    }
    console.log('─'.repeat(75));

    const s = result.stats.total;
    console.log(`${'total'.padEnd(18)} ${fmt(s.median).padStart(8)}  ${fmt(s.mean).padStart(8)}  ${fmt(s.min).padStart(8)}  ${fmt(s.p95).padStart(8)}  ${fmt(s.max).padStart(8)}`);

    const browserFPS = (1000 / s.median).toFixed(1);
    console.log(`\nBrowser effective FPS: ${browserFPS} (based on median total time)`);
    console.log(`Node.js WASM-only FPS: ${(1000 / result.stats.worker.median).toFixed(1)} (pure WASM computation)`);
    console.log(`Overhead: ${(s.median - result.stats.worker.median).toFixed(2)}ms (${((s.median - result.stats.worker.median) / s.median * 100).toFixed(0)}% of total)\n`);

    // Bottleneck analysis
    const steps = [
        { name: 'drawImage', key: 'draw' },
        { name: 'getImageData', key: 'getImage' },
        { name: 'postMessage', key: 'postMsg' },
        { name: 'WASM compute', key: 'worker' },
        { name: 'putImageData', key: 'putImage' },
        { name: 'DOM update', key: 'dom' },
    ].sort((a, b) => result.stats[b.key].median - result.stats[a.key].median);

    console.log('Bottleneck ranking:');
    for (const step of steps) {
        const pct = (result.stats[step.key].median / s.median * 100).toFixed(0);
        const bar = '█'.repeat(Math.round(pct / 5));
        console.log(`  ${step.name.padEnd(16)} ${bar} ${pct}% (${fmt(result.stats[step.key].median)})`);
    }

    // Save detailed report
    const reportPath = join(__dirname, 'browser_bench_report.json');
    writeFileSync(reportPath, JSON.stringify({
        config: { browser: 'chromium', headed: HEADED, duration: DURATION_SEC, leftVideo: LEFT_VIDEO, rightVideo: RIGHT_VIDEO },
        pageFPS: result.fps,
        frameCount: result.frameCount,
        stats: result.stats,
        browserFPS: parseFloat(browserFPS),
        wasmOnlyFPS: parseFloat((1000 / result.stats.worker.median).toFixed(1)),
    }, null, 2));
    console.log(`\nDetailed report: ${reportPath}`);

    await browser.close();
}

runBenchmark().catch(err => {
    console.error('Benchmark failed:', err);
    process.exit(1);
});
