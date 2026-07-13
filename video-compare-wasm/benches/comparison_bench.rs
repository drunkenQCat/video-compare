//! Headless benchmark suite for video-compare-wasm
//!
//! Run with: cargo bench
//! Results saved to: target/criterion/
//! Compare against baseline: cargo bench -- --baseline <name>

use criterion::{criterion_group, criterion_main, Criterion, BenchmarkId, BatchSize};
use video_compare_wasm::{config, metrics, utils, frame_cache, do_compare_full};

// ============================================================================
// Test data generators
// ============================================================================

fn generate_frame(width: usize, height: usize, seed: u32) -> Vec<u8> {
    let mut data = vec![0u8; width * height * 3];
    let mut state = seed;
    for i in 0..(width * height) {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        data[i * 3] = ((state >> 16) & 0xFF) as u8;
        data[i * 3 + 1] = ((state >> 8) & 0xFF) as u8;
        data[i * 3 + 2] = (state & 0xFF) as u8;
    }
    data
}

fn generate_similar_frame(width: usize, height: usize, seed: u32, noise: u8) -> Vec<u8> {
    let base = generate_frame(width, height, seed);
    let mut modified = base.clone();
    let mut state = seed.wrapping_add(1);
    for i in 0..(width * height) {
        state = state.wrapping_mul(1664525).wrapping_add(1013904223);
        let n = (state & 0xFF) as u8 % noise.max(1);
        modified[i * 3] = modified[i * 3].saturating_add(n);
        modified[i * 3 + 1] = modified[i * 3 + 1].saturating_sub(n);
        modified[i * 3 + 2] = modified[i * 3 + 2].saturating_add(n);
    }
    modified
}

// ============================================================================
// Benchmark: compute_block_ssim
// ============================================================================

fn bench_block_ssim(c: &mut Criterion) {
    let mut group = c.benchmark_group("compute_block_ssim");

    for &bs in &[8, 16, 32, 64] {
        let size = bs as usize;
        let left = generate_frame(size, size, 42);
        let right = generate_similar_frame(size, size, 42, 10);

        group.bench_with_input(
            BenchmarkId::new("block_size", bs),
            &(left, right),
            |b, (l, r)| {
                b.iter(|| {
                    metrics::compute_block_ssim(l, r, bs, bs, bs)
                })
            },
        );
    }

    group.finish();
}

// ============================================================================
// Benchmark: compute_block_mse
// ============================================================================

fn bench_block_mse(c: &mut Criterion) {
    let mut group = c.benchmark_group("compute_block_mse");

    for &bs in &[8, 16, 32, 64] {
        let size = bs as usize;
        let left = generate_frame(size, size, 42);
        let right = generate_similar_frame(size, size, 42, 10);

        group.bench_with_input(
            BenchmarkId::new("block_size", bs),
            &(left, right),
            |b, (l, r)| {
                b.iter(|| {
                    metrics::compute_block_mse(l, r, bs, bs, bs)
                })
            },
        );
    }

    group.finish();
}

// ============================================================================
// Benchmark: downsample_bilinear
// ============================================================================

fn bench_downsample(c: &mut Criterion) {
    let mut group = c.benchmark_group("downsample_bilinear");

    let cases = [
        (1920, 1080, 960, 540),
        (1920, 1080, 480, 270),
        (1280, 720, 640, 360),
        (640, 480, 320, 240),
    ];

    for &(src_w, src_h, dst_w, dst_h) in &cases {
        let src = generate_frame(src_w as usize, src_h as usize, 42);
        let label = format!("{}x{}->{}x{}", src_w, src_h, dst_w, dst_h);

        group.bench_with_input(
            BenchmarkId::new("scale", label),
            &src,
            |b, s| {
                let dst_size = (dst_w * dst_h * 3) as usize;
                let mut dst = vec![0u8; dst_size];
                b.iter(|| {
                    utils::downsample_bilinear(s, src_w, src_h, &mut dst, dst_w, dst_h);
                })
            },
        );
    }

    group.finish();
}

// ============================================================================
// Benchmark: do_compare_full (complete SSIM+MSE+diff pipeline)
// ============================================================================

fn bench_do_compare_full(c: &mut Criterion) {
    config::init_default();

    let mut group = c.benchmark_group("do_compare_full");

    for &(w, h) in &[(1920, 1080), (1280, 720), (640, 480), (256, 256)] {
        let left = generate_frame(w as usize, h as usize, 42);
        let right = generate_similar_frame(w as usize, h as usize, 42, 10);

        group.bench_with_input(
            BenchmarkId::new("resolution", format!("{}x{}", w, h)),
            &(left, right),
            |b, (l, r)| {
                b.iter(|| {
                    do_compare_full(l, r, w, h)
                })
            },
        );
    }

    group.finish();
}

// ============================================================================
// Benchmark: frame_cache compute_diff_rgba
// ============================================================================

fn bench_frame_cache_diff(c: &mut Criterion) {
    let mut group = c.benchmark_group("frame_cache_compute_diff_rgba");

    for &(w, h) in &[(1920, 1080), (1280, 720), (640, 480)] {
        let left = generate_frame(w as usize, h as usize, 42);
        let right = generate_similar_frame(w as usize, h as usize, 42, 10);

        group.bench_with_input(
            BenchmarkId::new("resolution", format!("{}x{}", w, h)),
            &(left, right),
            |b, (l, r)| {
                b.iter_batched(
                    || {
                        frame_cache::init_cache(w, h);
                        frame_cache::cache_frame_slot(0, l, w, h);
                        frame_cache::cache_frame_slot(1, r, w, h);
                    },
                    |_| {
                        frame_cache::compare_cached();
                    },
                    BatchSize::SmallInput,
                )
            },
        );
    }

    group.finish();
}

// ============================================================================
// Benchmark: rgb_to_gray (micro-benchmark for hot inner function)
// ============================================================================

fn bench_rgb_to_gray(c: &mut Criterion) {
    c.bench_function("rgb_to_gray", |b| {
        b.iter(|| {
            let mut sum = 0.0f32;
            for r in 0..255u8 {
                for g in 0..255u8 {
                    for bl in 0..255u8 {
                        sum += utils::rgb_to_gray(r, g, bl);
                    }
                }
            }
            sum
        })
    });
}

// ============================================================================

criterion_group!(
    benches,
    bench_block_ssim,
    bench_block_mse,
    bench_downsample,
    bench_do_compare_full,
    bench_frame_cache_diff,
    bench_rgb_to_gray,
);
criterion_main!(benches);
