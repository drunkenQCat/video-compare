//! Image comparison metrics calculation
//!
//! Implements SSIM (Structural Similarity Index) and MSE (Mean Squared Error)
//! using block-based approach for quality assessment.

use crate::utils::rgb_to_gray;

/// SSIM constants: C1 = (K1*L)^2, C2 = (K2*L)^2
/// K1=0.01, K2=0.03, L=255 (dynamic range for 8-bit images)
const SSIM_C1: f32 = 6.5025;
const SSIM_C2: f32 = 58.5225;

/// Compute SSIM for a single block
///
/// Uses the Wang-Bovik-Sheikh-Simoncelli SSIM formula:
/// SSIM = (2*μx*μy + C1)(2*σxy + C2) / (μx² + μy² + C1)(σx² + σy² + C2)
///
/// Works on RGB data by converting to grayscale using BT.709 weights.
pub fn compute_block_ssim(
    left: &[u8],
    right: &[u8],
    block_width: i32,
    block_height: i32,
    stride: i32,
) -> f32 {
    let pixel_count = (block_width * block_height) as f32;
    let mut mean_x: f32 = 0.0;
    let mut mean_y: f32 = 0.0;

    // First pass: compute means
    for y in 0..block_height {
        for x in 0..block_width {
            let idx = ((y * stride + x) * 3) as usize;
            let gray_l = rgb_to_gray(left[idx], left[idx + 1], left[idx + 2]);
            let gray_r = rgb_to_gray(right[idx], right[idx + 1], right[idx + 2]);

            mean_x += gray_l;
            mean_y += gray_r;
        }
    }

    mean_x /= pixel_count;
    mean_y /= pixel_count;

    // Second pass: compute variance and covariance
    let mut var_x: f32 = 0.0;
    let mut var_y: f32 = 0.0;
    let mut cov_xy: f32 = 0.0;

    for y in 0..block_height {
        for x in 0..block_width {
            let idx = ((y * stride + x) * 3) as usize;
            let gray_l = rgb_to_gray(left[idx], left[idx + 1], left[idx + 2]);
            let gray_r = rgb_to_gray(right[idx], right[idx + 1], right[idx + 2]);

            let dx = gray_l - mean_x;
            let dy = gray_r - mean_y;

            var_x += dx * dx;
            var_y += dy * dy;
            cov_xy += dx * dy;
        }
    }

    var_x /= pixel_count;
    var_y /= pixel_count;
    cov_xy /= pixel_count;

    // SSIM formula
    let numerator = (2.0 * mean_x * mean_y + SSIM_C1) * (2.0 * cov_xy + SSIM_C2);
    let denominator = (mean_x * mean_x + mean_y * mean_y + SSIM_C1) * (var_x + var_y + SSIM_C2);

    numerator / denominator
}

/// Compute MSE (Mean Squared Error) for a single block
///
/// Calculates average squared difference per pixel across all RGB channels.
/// MSE = Σ(left[i] - right[i])² / N
pub fn compute_block_mse(
    left: &[u8],
    right: &[u8],
    block_width: i32,
    block_height: i32,
    stride: i32,
) -> f32 {
    let pixel_count = (block_width * block_height * 3) as f64;
    let mut sum: f64 = 0.0;

    for y in 0..block_height {
        for x in 0..block_width {
            let idx = ((y * stride + x) * 3) as usize;
            for c in 0..3 {
                let diff = left[idx + c] as i32 - right[idx + c] as i32;
                sum += (diff * diff) as f64;
            }
        }
    }

    (sum / pixel_count) as f32
}

/// Calculate PSNR from MSE
///
/// PSNR = 10 * log10(MAX² / MSE) where MAX=255 for 8-bit images
/// Returns 100.0 dB for identical images (MSE=0)
pub fn calculate_psnr(mse: f64) -> f32 {
    if mse > 0.0 {
        10.0 * (255.0 * 255.0 / mse).log10() as f32
    } else {
        100.0
    }
}