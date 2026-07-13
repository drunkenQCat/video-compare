/**
 * WASM Benchmark Suite for video-compare-wasm
 *
 * Runs in Node.js headless — no browser needed.
 * Measures actual WASM execution time, not native Rust.
 *
 * Usage:
 *   node benches/wasm_bench.mjs
 *   node benches/wasm_bench.mjs --baseline    # save as baseline
 *   node benches/wasm_bench.mjs --compare      # compare against baseline
 */

import { performance } from 'node:perf_hooks';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = join(__dirname, 'wasm_bench_baseline.json');

// Load WASM module (wasm-pack --target nodejs generates CommonJS)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const wasm = require('../pkg/video_compare_wasm.js');

// ============================================================================
// Test data generators
// ============================================================================

function generateFrame(width, height, seed) {
  const data = new Uint8Array(width * height * 3);
  let state = seed >>> 0;
  for (let i = 0; i < width * height; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[i * 3] = (state >>> 16) & 0xff;
    data[i * 3 + 1] = (state >>> 8) & 0xff;
    data[i * 3 + 2] = state & 0xff;
  }
  return data;
}

function generateSimilarFrame(width, height, seed, noise) {
  const base = generateFrame(width, height, seed);
  let state = (seed + 1) >>> 0;
  for (let i = 0; i < width * height; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const n = (state & 0xff) % Math.max(noise, 1);
    base[i * 3] = Math.min(255, base[i * 3] + n);
    base[i * 3 + 1] = Math.max(0, base[i * 3 + 1] - n);
    base[i * 3 + 2] = Math.min(255, base[i * 3 + 2] + n);
  }
  return base;
}

// ============================================================================
// Benchmark harness
// ============================================================================

function bench(name, fn, iterations = 50, warmupIterations = 10) {
  // Warmup
  for (let i = 0; i < warmupIterations; i++) {
    fn();
  }

  const times = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    const t1 = performance.now();
    times.push(t1 - t0);
  }

  times.sort((a, b) => a - b);
  const min = times[0];
  const max = times[times.length - 1];
  const median = times[Math.floor(times.length / 2)];
  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)];

  const result = { name, min, median, mean, p95, max, iterations };

  const fmt = (ms) => {
    if (ms < 1) return `${(ms * 1000).toFixed(1)}µs`;
    if (ms < 1000) return `${ms.toFixed(3)}ms`;
    return `${(ms / 1000).toFixed(3)}s`;
  };

  console.log(`  ${name}`);
  console.log(`    median: ${fmt(median)}  mean: ${fmt(mean)}  min: ${fmt(min)}  p95: ${fmt(p95)}  max: ${fmt(max)}`);
  const fps = 1000 / median;
  const fpsStr = fps > 60 ? `${fps.toFixed(0)} fps` : `${fps.toFixed(1)} fps`;
  const budget = median <= 33.3 ? '✅ 30fps' : '❌ 30fps';
  console.log(`    → ${fpsStr}  ${budget} budget (33.3ms)`);

  return result;
}

// ============================================================================
// Benchmark suites
// ============================================================================

function runBenchmarks() {
  console.log('=== WASM Benchmark Suite (video-compare-wasm) ===\n');
  const results = {};

  // 1. compare() at various resolutions
  console.log('[compare]');
  for (const [w, h] of [[1920, 1080], [1280, 720], [640, 480], [256, 256]]) {
    const left = generateFrame(w, h, 42);
    const right = generateSimilarFrame(w, h, 42, 10);
    results[`compare_${w}x${h}`] = bench(
      `compare ${w}x${h}`,
      () => wasm.compare(left, right, w, h),
      w >= 1920 ? 30 : 50
    );
  }

  // 2. compare_with_diff() at various resolutions
  console.log('\n[compare_with_diff]');
  for (const [w, h] of [[1920, 1080], [1280, 720], [640, 480]]) {
    const left = generateFrame(w, h, 42);
    const right = generateSimilarFrame(w, h, 42, 10);
    results[`compare_with_diff_${w}x${h}`] = bench(
      `compare_with_diff ${w}x${h}`,
      () => wasm.compare_with_diff(left, right, w, h),
      w >= 1920 ? 30 : 50
    );
  }

  // 3. compute_pixel_diff() at various resolutions
  console.log('\n[compute_pixel_diff]');
  for (const [w, h] of [[1920, 1080], [1280, 720], [640, 480]]) {
    const left = generateFrame(w, h, 42);
    const right = generateSimilarFrame(w, h, 42, 10);
    results[`pixel_diff_${w}x${h}`] = bench(
      `compute_pixel_diff ${w}x${h}`,
      () => wasm.compute_pixel_diff(left, right, w, h),
      w >= 1920 ? 30 : 50
    );
  }

  // 4. Frame cache: init + cache + compare + get_diff_rgba
  console.log('\n[frame_cache full cycle]');
  for (const [w, h] of [[1920, 1080], [1280, 720], [640, 480]]) {
    const left = generateFrame(w, h, 42);
    const right = generateSimilarFrame(w, h, 42, 10);
    results[`frame_cache_${w}x${h}`] = bench(
      `frame_cache full ${w}x${h}`,
      () => {
        wasm.init_frame_cache(w, h);
        wasm.cache_frame(0, left, w, h);
        wasm.cache_frame(1, right, w, h);
        wasm.compare_cached_frames();
        wasm.get_diff_rgba();
      },
      w >= 1920 ? 20 : 40
    );
  }

  // 5. Frame cache: compare only (frames already cached)
  console.log('\n[frame_cache compare only (pre-cached)]');
  for (const [w, h] of [[1920, 1080], [1280, 720], [640, 480]]) {
    const left = generateFrame(w, h, 42);
    const right = generateSimilarFrame(w, h, 42, 10);
    wasm.init_frame_cache(w, h);
    wasm.cache_frame(0, left, w, h);
    wasm.cache_frame(1, right, w, h);

    results[`frame_cache_compare_only_${w}x${h}`] = bench(
      `frame_cache compare+rgba ${w}x${h}`,
      () => {
        wasm.compare_cached_frames();
        wasm.get_diff_rgba();
      },
      w >= 1920 ? 30 : 50
    );
  }

  return results;
}

// ============================================================================
// Main
// ============================================================================

const args = process.argv.slice(2);
const isBaseline = args.includes('--baseline');
const isCompare = args.includes('--compare');

console.log(`WASM target: wasm32-unknown-unknown (wasm-bindgen)\n`);

const results = runBenchmarks();

if (isBaseline) {
  writeFileSync(BASELINE_FILE, JSON.stringify(results, null, 2));
  console.log(`\n✅ Baseline saved to ${BASELINE_FILE}`);
}

if (isCompare && existsSync(BASELINE_FILE)) {
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  console.log('\n=== Comparison vs Baseline ===\n');
  for (const [name, current] of Object.entries(results)) {
    const base = baseline[name];
    if (!base) continue;
    const delta = current.median - base.median;
    const pct = (delta / base.median * 100).toFixed(1);
    const sign = delta > 0 ? '🔴' : delta < 0 ? '🟢' : '⚪';
    console.log(`  ${sign} ${name}: ${current.median.toFixed(3)}ms vs ${base.median.toFixed(3)}ms (${delta > 0 ? '+' : ''}${pct}%)`);
  }
}

console.log('\nDone.');
