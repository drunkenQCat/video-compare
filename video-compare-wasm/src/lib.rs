//! Video/Image comparison WebAssembly module
//!
//! Provides SSIM, PSNR, MSE metrics for comparing RGB frames.
//! Built with Rust and wasm-bindgen for efficient browser usage.

use wasm_bindgen::prelude::*;

mod types;
mod config;
mod utils;
mod metrics;

// Re-export for internal use
use types::{CompareConfig, CompareMetrics};
use config::{get_config, set_config, init_default};
use utils::downsample_bilinear;
use metrics::{compute_block_ssim, compute_block_mse, calculate_psnr};

// ============================================================================
// wasm-bindgen exports
// ============================================================================

/// Comparison metrics result (wasm-bindgen wrapper)
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct WasmCompareMetrics {
    pub ssim: f32,
    pub psnr: f32,
    pub mse: f32,
    pub width: i32,
    pub height: i32,
    pub downsampled: i32,
}

/// Full comparison result with block-level diff data
#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct CompareResult {
    pub ssim: f32,
    pub psnr: f32,
    pub mse: f32,
    pub width: i32,
    pub height: i32,
    pub downsampled: i32,
    pub blocks_x: i32,
    pub blocks_y: i32,
    /// Internal diff data storage
    diff_data: Vec<f32>,
}

/// Get diff data as Float32Array (for JS visualization)
#[wasm_bindgen]
pub fn get_diff_data(result: &CompareResult) -> js_sys::Float32Array {
    let arr = js_sys::Float32Array::new_with_length(result.diff_data.len() as u32);
    arr.copy_from(&result.diff_data);
    arr
}

impl From<CompareMetrics> for WasmCompareMetrics {
    fn from(m: CompareMetrics) -> Self {
        Self {
            ssim: m.ssim,
            psnr: m.psnr,
            mse: m.mse,
            width: m.width,
            height: m.height,
            downsampled: m.downsampled,
        }
    }
}

/// Configuration for comparison (wasm-bindgen wrapper)
#[wasm_bindgen]
#[derive(Clone, Copy, Debug)]
pub struct WasmCompareConfig {
    pub max_width: i32,
    pub max_height: i32,
    pub block_size: i32,
}

#[wasm_bindgen]
impl WasmCompareConfig {
    /// Create a new config
    #[wasm_bindgen(constructor)]
    pub fn new(max_width: i32, max_height: i32, block_size: i32) -> WasmCompareConfig {
        WasmCompareConfig { max_width, max_height, block_size }
    }
}

impl From<WasmCompareConfig> for CompareConfig {
    fn from(c: WasmCompareConfig) -> Self {
        Self {
            max_width: c.max_width,
            max_height: c.max_height,
            block_size: c.block_size,
        }
    }
}

impl From<CompareConfig> for WasmCompareConfig {
    fn from(c: CompareConfig) -> Self {
        Self {
            max_width: c.max_width,
            max_height: c.max_height,
            block_size: c.block_size,
        }
    }
}

/// Set comparison configuration
#[wasm_bindgen]
pub fn set_compare_config(config: WasmCompareConfig) {
    set_config(config.into());
}

/// Get current configuration
#[wasm_bindgen]
pub fn get_compare_config() -> WasmCompareConfig {
    get_config().into()
}

/// Internal comparison logic with full diff data output
fn do_compare_full(
    left_rgb: &[u8],
    right_rgb: &[u8],
    width: i32,
    height: i32,
) -> (CompareMetrics, i32, i32, Vec<f32>) {
    let config = get_config();

    // Determine if downsampling is needed
    let (process_w, process_h, downsampled) = if width > config.max_width || height > config.max_height {
        let scale = (config.max_width as f32 / width as f32)
            .min(config.max_height as f32 / height as f32);
        ((width as f32 * scale) as i32, (height as f32 * scale) as i32, true)
    } else {
        (width, height, false)
    };

    // Downsample if needed (keep vectors alive for the whole function)
    let left_downsampled: Vec<u8>;
    let right_downsampled: Vec<u8>;
    let left_ptr: &[u8];
    let right_ptr: &[u8];

    if downsampled {
        let buf_size = (process_w * process_h * 3) as usize;
        let mut left_buf = vec![0u8; buf_size];
        let mut right_buf = vec![0u8; buf_size];

        downsample_bilinear(left_rgb, width, height, &mut left_buf, process_w, process_h);
        downsample_bilinear(right_rgb, width, height, &mut right_buf, process_w, process_h);

        left_downsampled = left_buf;
        right_downsampled = right_buf;
        left_ptr = &left_downsampled;
        right_ptr = &right_downsampled;
    } else {
        left_ptr = left_rgb;
        right_ptr = right_rgb;
    }

    // Calculate block layout
    let blocks_x = (process_w + config.block_size - 1) / config.block_size;
    let blocks_y = (process_h + config.block_size - 1) / config.block_size;
    let total_blocks = (blocks_x * blocks_y) as usize;

    // Allocate diff buffer
    let mut diff_data = vec![0.0f32; total_blocks];

    // Process blocks
    let mut global_ssim: f32 = 0.0;
    let mut global_mse: f64 = 0.0;

    for by in 0..blocks_y {
        for bx in 0..blocks_x {
            let block_x = bx * config.block_size;
            let block_y = by * config.block_size;

            let actual_w = config.block_size.min(process_w - block_x);
            let actual_h = config.block_size.min(process_h - block_y);

            let offset = ((block_y * process_w + block_x) * 3) as usize;
            let left_block = &left_ptr[offset..];
            let right_block = &right_ptr[offset..];

            let block_ssim = compute_block_ssim(left_block, right_block, actual_w, actual_h, process_w);
            let block_mse = compute_block_mse(left_block, right_block, actual_w, actual_h, process_w);

            global_ssim += block_ssim;
            global_mse += block_mse as f64;

            // Store per-block MSE
            let idx = (by * blocks_x + bx) as usize;
            diff_data[idx] = block_mse;
        }
    }

    // Calculate final metrics
    let avg_ssim = global_ssim / total_blocks as f32;
    let avg_mse = global_mse / total_blocks as f64;

    let metrics = CompareMetrics {
        ssim: avg_ssim,
        psnr: calculate_psnr(avg_mse),
        mse: avg_mse as f32,
        width: process_w,
        height: process_h,
        downsampled: if downsampled { 1 } else { 0 },
    };

    (metrics, blocks_x, blocks_y, diff_data)
}

/// Internal comparison logic (legacy, for compare_frames)
fn do_compare(
    left_rgb: &[u8],
    right_rgb: &[u8],
    width: i32,
    height: i32,
    diff_buffer: &mut [f32],
) -> CompareMetrics {
    let (metrics, _blocks_x, _blocks_y, diff_data) = do_compare_full(left_rgb, right_rgb, width, height);

    // Copy diff data to provided buffer if available
    if !diff_buffer.is_empty() {
        let copy_len = diff_buffer.len().min(diff_data.len());
        diff_buffer[..copy_len].copy_from_slice(&diff_data[..copy_len]);
    }

    metrics
}

/// Compare two RGB frames with optional diff buffer output
///
/// # Arguments
/// * `left_rgb` - Left frame RGB data (width * height * 3 bytes)
/// * `right_rgb` - Right frame RGB data (width * height * 3 bytes)
/// * `width` - Image width
/// * `height` - Image height
/// * `diff_buffer` - Output buffer for per-block MSE values (pass empty array to skip)
#[wasm_bindgen]
pub fn compare_frames(
    left_rgb: &[u8],
    right_rgb: &[u8],
    width: i32,
    height: i32,
    diff_buffer: &mut [f32],
) -> WasmCompareMetrics {
    // Validate inputs
    if left_rgb.is_empty() || right_rgb.is_empty() || width <= 0 || height <= 0 {
        return WasmCompareMetrics::from(CompareMetrics::default());
    }

    WasmCompareMetrics::from(do_compare(left_rgb, right_rgb, width, height, diff_buffer))
}

/// Convenience function - compare without diff buffer
#[wasm_bindgen]
pub fn compare(
    left_rgb: &[u8],
    right_rgb: &[u8],
    width: i32,
    height: i32,
) -> WasmCompareMetrics {
    compare_frames(left_rgb, right_rgb, width, height, &mut [])
}

/// Compare with full diff data output
///
/// Returns per-block MSE values for visualization.
/// Each block's MSE can be mapped to a color to show difference heatmap.
#[wasm_bindgen]
pub fn compare_with_diff(
    left_rgb: &[u8],
    right_rgb: &[u8],
    width: i32,
    height: i32,
) -> CompareResult {
    // Validate inputs
    if left_rgb.is_empty() || right_rgb.is_empty() || width <= 0 || height <= 0 {
        return CompareResult {
            ssim: 0.0,
            psnr: 0.0,
            mse: 0.0,
            width: 0,
            height: 0,
            downsampled: 0,
            blocks_x: 0,
            blocks_y: 0,
            diff_data: vec![],
        };
    }

    let (metrics, blocks_x, blocks_y, diff_data) = do_compare_full(left_rgb, right_rgb, width, height);

    CompareResult {
        ssim: metrics.ssim,
        psnr: metrics.psnr,
        mse: metrics.mse,
        width: metrics.width,
        height: metrics.height,
        downsampled: metrics.downsampled,
        blocks_x,
        blocks_y,
        diff_data,
    }
}

/// Get number of blocks for given dimensions
#[wasm_bindgen]
pub fn get_block_count(width: i32, height: i32, block_size: i32) -> i32 {
    let blocks_x = (width + block_size - 1) / block_size;
    let blocks_y = (height + block_size - 1) / block_size;
    blocks_x * blocks_y
}

/// Get block layout (blocks_x, blocks_y) for given dimensions using current config
#[wasm_bindgen]
pub fn get_block_layout(width: i32, height: i32) -> Vec<i32> {
    let config = get_config();
    let blocks_x = (width + config.block_size - 1) / config.block_size;
    let blocks_y = (height + config.block_size - 1) / config.block_size;
    vec![blocks_x, blocks_y]
}

// ============================================================================
// Pixel-level difference (for fine-grained visualization)
// ============================================================================

/// Pixel-level difference result
#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct PixelDiffResult {
    pub width: i32,
    pub height: i32,
    /// Per-pixel squared difference (R²+G²+B²) for each pixel
    pixel_diff: Vec<f32>,
    /// Maximum pixel diff value
    pub max_diff: f32,
    /// Average pixel diff (equals MSE * 3)
    pub avg_diff: f32,
}

/// Get pixel diff data as Float32Array
#[wasm_bindgen]
pub fn get_pixel_diff_data(result: &PixelDiffResult) -> js_sys::Float32Array {
    let arr = js_sys::Float32Array::new_with_length(result.pixel_diff.len() as u32);
    arr.copy_from(&result.pixel_diff);
    arr
}

/// Compute pixel-level differences (for fine visualization)
///
/// Returns per-pixel squared difference (R²+G²+B²) for each pixel.
/// This is ~3x the per-channel MSE, useful for heat map visualization.
#[wasm_bindgen]
pub fn compute_pixel_diff(
    left_rgb: &[u8],
    right_rgb: &[u8],
    width: i32,
    height: i32,
) -> PixelDiffResult {
    if left_rgb.is_empty() || right_rgb.is_empty() || width <= 0 || height <= 0 {
        return PixelDiffResult {
            width: 0,
            height: 0,
            pixel_diff: vec![],
            max_diff: 0.0,
            avg_diff: 0.0,
        };
    }

    let config = get_config();

    // Determine if downsampling is needed
    let (process_w, process_h, downsampled) = if width > config.max_width || height > config.max_height {
        let scale = (config.max_width as f32 / width as f32)
            .min(config.max_height as f32 / height as f32);
        ((width as f32 * scale) as i32, (height as f32 * scale) as i32, true)
    } else {
        (width, height, false)
    };

    // Downsample if needed
    let left_downsampled: Vec<u8>;
    let right_downsampled: Vec<u8>;
    let left_ptr: &[u8];
    let right_ptr: &[u8];

    if downsampled {
        let buf_size = (process_w * process_h * 3) as usize;
        let mut left_buf = vec![0u8; buf_size];
        let mut right_buf = vec![0u8; buf_size];

        downsample_bilinear(left_rgb, width, height, &mut left_buf, process_w, process_h);
        downsample_bilinear(right_rgb, width, height, &mut right_buf, process_w, process_h);

        left_downsampled = left_buf;
        right_downsampled = right_buf;
        left_ptr = &left_downsampled;
        right_ptr = &right_downsampled;
    } else {
        left_ptr = left_rgb;
        right_ptr = right_rgb;
    }

    // Compute per-pixel squared difference
    let pixel_count = (process_w * process_h) as usize;
    let mut pixel_diff = vec![0.0f32; pixel_count];

    let mut max_diff: f32 = 0.0;
    let mut total_diff: f64 = 0.0;

    for i in 0..pixel_count {
        let idx = i * 3;
        let dr = (left_ptr[idx] as i32 - right_ptr[idx] as i32).abs();
        let dg = (left_ptr[idx + 1] as i32 - right_ptr[idx + 1] as i32).abs();
        let db = (left_ptr[idx + 2] as i32 - right_ptr[idx + 2] as i32).abs();

        // Use squared difference for heat map intensity
        let diff_sq = (dr * dr + dg * dg + db * db) as f32;
        pixel_diff[i] = diff_sq;

        if diff_sq > max_diff {
            max_diff = diff_sq;
        }
        total_diff += diff_sq as f64;
    }

    let avg_diff = (total_diff / pixel_count as f64) as f32;

    PixelDiffResult {
        width: process_w,
        height: process_h,
        pixel_diff,
        max_diff,
        avg_diff,
    }
}

// Initialize default config on module load
#[wasm_bindgen(start)]
pub fn wasm_init() {
    init_default();
}