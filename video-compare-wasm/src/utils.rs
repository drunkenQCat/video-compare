//! Utility functions for image processing

/// Convert RGB pixel to grayscale using BT.709 weights
///
/// Standard formula: Y = 0.2126*R + 0.7152*G + 0.0722*B
#[inline]
pub fn rgb_to_gray(r: u8, g: u8, b: u8) -> f32 {
    0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32
}

/// Simple bilinear downsampling
///
/// Takes nearest neighbor for simplicity (not true bilinear interpolation).
/// This is fast and sufficient for SSIM/MSE comparison purposes.
pub fn downsample_bilinear(
    src: &[u8],
    src_w: i32,
    src_h: i32,
    dst: &mut [u8],
    dst_w: i32,
    dst_h: i32,
) {
    let x_ratio = src_w as f32 / dst_w as f32;
    let y_ratio = src_h as f32 / dst_h as f32;

    for y in 0..dst_h {
        for x in 0..dst_w {
            let src_x = (x as f32 * x_ratio) as i32;
            let src_y = (y as f32 * y_ratio) as i32;

            let dst_idx = ((y * dst_w + x) * 3) as usize;
            let src_idx = ((src_y * src_w + src_x) * 3) as usize;

            dst[dst_idx] = src[src_idx];
            dst[dst_idx + 1] = src[src_idx + 1];
            dst[dst_idx + 2] = src[src_idx + 2];
        }
    }
}