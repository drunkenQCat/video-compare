/**
 * Experiment: VideoFrame.copyTo vs drawImage+getImageData
 *
 * Loads real video frames in headless Chrome and compares two approaches:
 * A) drawImage(video, canvas) + getImageData(canvas)  — current approach
 * B) new VideoFrame(video) + copyTo(buffer)            — bypass canvas
 */

import { chromium } from 'playwright';

const LEFT_VIDEO = 'C:\\CreativeProjects\\CFAI_MatchBoxTest\\Original.mov';
const TEST_URL = 'http://localhost:8888/test.html';

async function runExperiment() {
    console.log('=== VideoFrame vs drawImage Experiment ===\n');

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();

    page.on('console', msg => {
        if (msg.type() === 'error') console.error('[browser]', msg.text());
    });

    await page.goto(TEST_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.getElementById('wasm-status').textContent.includes('Worker ready'));

    // Upload left video
    const leftInput = await page.$('#video-left');
    await leftInput.setInputFiles(LEFT_VIDEO);
    await page.waitForFunction(() => {
        const v = document.getElementById('video-left-preview');
        return v.readyState >= 2 && v.videoWidth > 0;
    }, { timeout: 30000 });

    const result = await page.evaluate(async () => {
        const video = document.getElementById('video-left-preview');
        const w = 1280, h = 720;

        // Warm up: play a bit
        video.currentTime = 1.0;
        await new Promise(r => setTimeout(r, 500));

        const N = 30; // iterations
        const times = { drawA: [], getImageA: [], totalA: [], frameB: [], copyB: [], totalB: [] };

        // Check VideoFrame support
        let videoFrameSupported = false;
        try {
            const vf = new VideoFrame(video);
            videoFrameSupported = true;
            vf.close();
        } catch (e) {
            console.log('VideoFrame not supported:', e.message);
        }

        // Approach A: drawImage + getImageData
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        for (let i = 0; i < N; i++) {
            // Slight seek to get different frames
            video.currentTime = 1 + i * 0.5;
            await new Promise(r => setTimeout(r, 50));

            const t0 = performance.now();
            ctx.drawImage(video, 0, 0, w, h);
            const t1 = performance.now();
            const imgData = ctx.getImageData(0, 0, w, h);
            const t2 = performance.now();

            times.drawA.push(t1 - t0);
            times.getImageA.push(t2 - t1);
            times.totalA.push(t2 - t0);
        }

        // Approach B: VideoFrame + copyTo (if supported)
        if (videoFrameSupported) {
            const bufSize = w * h * 4; // RGBA
            for (let i = 0; i < N; i++) {
                video.currentTime = 1 + i * 0.5;
                await new Promise(r => setTimeout(r, 50));

                const t0 = performance.now();
                const vf = new VideoFrame(video, { timestamp: video.currentTime * 1000000 });
                const t1 = performance.now();

                const buf = new ArrayBuffer(bufSize);
                vf.copyTo(buf, { format: 'RGBA' });
                const t2 = performance.now();

                vf.close();
                times.frameB.push(t1 - t0);
                times.copyB.push(t2 - t1);
                times.totalB.push(t2 - t0);
            }
        }

        // Compute stats
        function stats(arr) {
            const s = [...arr].sort((a, b) => a - b);
            return {
                median: +s[Math.floor(s.length / 2)].toFixed(2),
                mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2),
            };
        }

        return {
            videoFrameSupported,
            approachA: {
                draw: stats(times.drawA),
                getImage: stats(times.getImageA),
                total: stats(times.totalA),
            },
            approachB: videoFrameSupported ? {
                frame: stats(times.frameB),
                copy: stats(times.copyB),
                total: stats(times.totalB),
            } : null,
        };
    });

    const fmt = (ms) => ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;

    console.log(`VideoFrame supported: ${result.videoFrameSupported}\n`);
    console.log('Approach A: drawImage + getImageData (current)');
    console.log(`  drawImage:    median=${fmt(result.approachA.draw.median)}  mean=${fmt(result.approachA.draw.mean)}`);
    console.log(`  getImageData: median=${fmt(result.approachA.getImage.median)}  mean=${fmt(result.approachA.getImage.mean)}`);
    console.log(`  total:        median=${fmt(result.approachA.total.median)}  mean=${fmt(result.approachA.total.mean)}`);

    if (result.approachB) {
        console.log('\nApproach B: VideoFrame + copyTo');
        console.log(`  VideoFrame:   median=${fmt(result.approachB.frame.median)}  mean=${fmt(result.approachB.frame.mean)}`);
        console.log(`  copyTo:       median=${fmt(result.approachB.copy.median)}  mean=${fmt(result.approachB.copy.mean)}`);
        console.log(`  total:        median=${fmt(result.approachB.total.median)}  mean=${fmt(result.approachB.total.mean)}`);

        const speedup = (result.approachA.total.median / result.approachB.total.median).toFixed(2);
        console.log(`\n  Speedup: ${speedup}x (A: ${fmt(result.approachA.total.median)} → B: ${fmt(result.approachB.total.median)})`);
    } else {
        console.log('\n  Approach B not available (VideoFrame not supported)');
    }

    await browser.close();
}

runExperiment().catch(err => {
    console.error('Experiment failed:', err);
    process.exit(1);
});
