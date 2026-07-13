/**
 * Headless WASM comparison test using real video files
 *
 * Uses ffmpeg to extract frames from two video files,
 * feeds them to the WASM comparison module, and reports metrics.
 *
 * Usage:
 *   node benches/video_bench.mjs --left <video> --right <video> [--frames 100] [--fps 24]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wasm = require('../pkg/video_compare_wasm.js');

// ============================================================================
// Argument parsing
// ============================================================================

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const LEFT_VIDEO = getArg('left', 'C:\\CreativeProjects\\CFAI_MatchBoxTest\\Original.mov');
const RIGHT_VIDEO = getArg('right', 'C:\\CreativeProjects\\CFAI_MatchBoxTest\\Modify.mov');
const MAX_FRAMES = parseInt(getArg('frames', '50'));
const FPS = parseFloat(getArg('fps', '5')); // Extract at 5fps to speed up testing

// ============================================================================
// Frame extraction via ffmpeg
// ============================================================================

const TEMP_DIR = join(import.meta.dirname, 'tmp_frames');

function extractFrames(videoPath, prefix, count) {
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });

  // Clean old files
  const rawPath = join(TEMP_DIR, `${prefix}.raw`);
  if (existsSync(rawPath)) unlinkSync(rawPath);

  // Extract frames as raw RGB video stream (all frames in one file)
  // ffmpeg -i input.mov -vf scale=1280:720,format=rgb24 -frames:v N -r FPS -pix_fmt rgb24 -f rawvideo output.raw
  const scale = '1280:720';
  const cmd = 'ffmpeg';
  const cmdArgs = [
    '-y',
    '-i', videoPath,
    '-vf', `scale=${scale},format=rgb24`,
    '-frames:v', String(count),
    '-r', String(FPS),
    '-pix_fmt', 'rgb24',
    '-f', 'rawvideo',
    rawPath,
  ];

  console.log(`  Extracting ${count} frames from ${videoPath}...`);
  execFileSync(cmd, cmdArgs, { stdio: 'pipe' });

  // Read the raw file and split into individual frames
  const w = 1280;
  const h = 720;
  const frameSize = w * h * 3;
  const rawData = readFileSync(rawPath);
  const totalFrames = Math.floor(rawData.length / frameSize);
  const frames = [];

  for (let i = 0; i < totalFrames; i++) {
    const start = i * frameSize;
    const buf = new Uint8Array(rawData.buffer, rawData.byteOffset + start, frameSize);
    frames.push(new Uint8Array(buf)); // copy to ensure aligned
  }

  // Clean up raw file
  if (existsSync(rawPath)) unlinkSync(rawPath);

  console.log(`  Extracted ${frames.length} frames (${rawData.length} bytes total)`);
  return frames;
}

// ============================================================================
// Run comparison
// ============================================================================

function runBenchmark() {
  console.log('=== Headless Video Comparison Benchmark ===\n');
  console.log(`Left:  ${LEFT_VIDEO}`);
  console.log(`Right: ${RIGHT_VIDEO}`);
  console.log(`Frames: ${MAX_FRAMES} at ${FPS}fps extraction\n`);

  // Extract frames
  console.log('[1] Extracting frames via ffmpeg...');
  const leftFrames = extractFrames(LEFT_VIDEO, 'left', MAX_FRAMES);
  const rightFrames = extractFrames(RIGHT_VIDEO, 'right', MAX_FRAMES);
  const minFrames = Math.min(leftFrames.length, rightFrames.length);
  console.log(`  Left: ${leftFrames.length} frames, Right: ${rightFrames.length} frames`);
  console.log(`  Comparing ${minFrames} frames\n`);

  if (minFrames === 0) {
    console.error('No frames extracted!');
    process.exit(1);
  }

  const W = 1280;
  const H = 720;

  // Initialize WASM
  console.log('[2] Running WASM comparison...');
  wasm.init_frame_cache(W, H);

  const results = [];
  const times = [];

  for (let i = 0; i < minFrames; i++) {
    const t0 = performance.now();

    wasm.cache_frame(0, leftFrames[i], W, H);
    wasm.cache_frame(1, rightFrames[i], W, H);
    const [ssim, psnr, mse, maxDiff] = wasm.compare_cached_frames();
    const rgba = wasm.get_diff_rgba();

    const t1 = performance.now();
    const elapsed = t1 - t0;
    times.push(elapsed);

    results.push({
      frame: i,
      ssim: parseFloat(ssim.toFixed(4)),
      psnr: parseFloat(psnr.toFixed(2)),
      mse: parseFloat(mse.toFixed(2)),
      maxDiff: parseFloat(maxDiff.toFixed(2)),
      elapsedMs: parseFloat(elapsed.toFixed(3)),
    });

    if (i % 10 === 0 || i === minFrames - 1) {
      process.stdout.write(`  Frame ${i + 1}/${minFrames}: SSIM=${ssim.toFixed(4)} PSNR=${psnr.toFixed(2)}dB MSE=${mse.toFixed(2)} ${elapsed.toFixed(1)}ms\r`);
    }
  }

  console.log('\n');

  // Statistics
  times.sort((a, b) => a - b);
  const min = times[0];
  const max = times[times.length - 1];
  const median = times[Math.floor(times.length / 2)];
  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)];

  console.log('[3] Performance Summary:');
  console.log(`  Median: ${median.toFixed(3)}ms  Mean: ${mean.toFixed(3)}ms  Min: ${min.toFixed(3)}ms  Max: ${max.toFixed(3)}ms  P95: ${p95.toFixed(3)}ms`);
  const fps = 1000 / median;
  console.log(`  Effective FPS: ${fps.toFixed(1)}  30fps budget: ${median <= 33.3 ? '✅' : '❌'}`);

  // Metrics summary
  const ssims = results.map(r => r.ssim);
  const psnrs = results.map(r => r.psnr);
  const mses = results.map(r => r.mse);

  const avgSsim = ssims.reduce((s, v) => s + v, 0) / ssims.length;
  const minSsim = Math.min(...ssims);
  const maxSsim = Math.max(...ssims);
  const avgPsnr = psnrs.reduce((s, v) => s + v, 0) / psnrs.length;
  const avgMse = mses.reduce((s, v) => s + v, 0) / mses.length;

  console.log('\n[4] Metrics Summary:');
  console.log(`  SSIM: avg=${avgSsim.toFixed(4)}  min=${minSsim.toFixed(4)}  max=${maxSsim.toFixed(4)}`);
  console.log(`  PSNR: avg=${avgPsnr.toFixed(2)}dB  min=${Math.min(...psnrs).toFixed(2)}dB  max=${Math.max(...psnrs).toFixed(2)}dB`);
  console.log(`  MSE:  avg=${avgMse.toFixed(2)}`);

  // Save detailed results
  const reportPath = join(import.meta.dirname, 'video_bench_report.json');
  writeFileSync(reportPath, JSON.stringify({
    config: { leftVideo: LEFT_VIDEO, rightVideo: RIGHT_VIDEO, frames: minFrames, extractionFps: FPS, resolution: '1280x720' },
    performance: { min, median, mean, p95, max, fps },
    metrics: { avgSsim, minSsim, maxSsim, avgPsnr, avgMse },
    frameData: results,
  }, null, 2));
  console.log(`\n  Detailed report: ${reportPath}`);

  // Cleanup
  console.log('\n[5] Cleaning up...');
  for (const prefix of ['left', 'right']) {
    const p = join(TEMP_DIR, `${prefix}.raw`);
    if (existsSync(p)) unlinkSync(p);
  }

  console.log('\nDone.');
}

runBenchmark();
