//! Frame cache for video comparison
//!
//! Caches two video frames in WASM memory and provides fast comparison
//! with pre-computed RGBA diff output (ready for canvas).

use crate::utils::{diff_to_color};

/// A cached video frame in RGB format (3 bytes per pixel)
struct CachedFrame {
    rgb: Vec<u8>,
    width: i32,
    height: i32,
}

impl CachedFrame {
    fn new() -> Self {
        Self { rgb: Vec::new(), width: 0, height: 0 }
    }

    fn set_data(&mut self, data: &[u8], width: i32, height: i32) {
        self.rgb.clear();
        self.rgb.extend_from_slice(data);
        self.width = width;
        self.height = height;
    }

    fn clear(&mut self) {
        self.rgb.clear();
        self.width = 0;
        self.height = 0;
    }

    fn is_ready(&self) -> bool {
        self.width > 0 && self.height > 0 && !self.rgb.is_empty()
    }
}

pub struct FrameCache {
    frames: [CachedFrame; 2],
    diff_rgba: Vec<u8>,
    width: i32,
    height: i32,
    max_diff: f32,
    diff_ema: Vec<f32>,
    ema_alpha: f32,
    ema_initialized: bool,
}

impl FrameCache {
    fn new() -> Self {
        Self {
            frames: [CachedFrame::new(), CachedFrame::new()],
            diff_rgba: Vec::new(),
            width: 0, height: 0, max_diff: 0.0,
            diff_ema: Vec::new(), ema_alpha: 1.0, ema_initialized: false,
        }
    }

    pub fn init(&mut self, width: i32, height: i32) {
        self.width = width;
        self.height = height;
        let pixel_count = (width * height) as usize;
        self.diff_rgba.resize(pixel_count * 4, 0);
        self.diff_ema.resize(pixel_count, 0.0);
        self.ema_initialized = false;
    }

    pub fn cache_frame(&mut self, slot: usize, rgb: &[u8], width: i32, height: i32) {
        if slot < 2 { self.frames[slot].set_data(rgb, width, height); }
    }

    pub fn is_ready(&self) -> bool {
        self.frames[0].is_ready() && self.frames[1].is_ready()
    }

    pub fn get_diff_rgba(&self) -> &[u8] { &self.diff_rgba }

    pub fn clear(&mut self) {
        self.frames[0].clear();
        self.frames[1].clear();
        self.diff_rgba.clear();
        self.diff_ema.clear();
        self.width = 0; self.height = 0; self.max_diff = 0.0;
        self.ema_initialized = false;
    }

    pub fn compute_diff_rgba(&mut self) -> (f32, f32, f32, f32) {
        if !self.is_ready() { return (0.0, 0.0, 0.0, 0.0); }

        let src_w = self.frames[0].width;
        let src_h = self.frames[0].height;

        let max_w: i32 = 1280;
        let max_h: i32 = 720;

        if src_w > max_w || src_h > max_h {
            let scale = (max_w as f32 / src_w as f32).min(max_h as f32 / src_h as f32);
            let dw = (src_w as f32 * scale) as i32;
            let dh = (src_h as f32 * scale) as i32;
            let buf_size = (dw * dh * 3) as usize;
            let mut left_buf = vec![0u8; buf_size];
            let mut right_buf = vec![0u8; buf_size];
            crate::utils::downsample_bilinear(&self.frames[0].rgb, src_w, src_h, &mut left_buf, dw, dh);
            crate::utils::downsample_bilinear(&self.frames[1].rgb, src_w, src_h, &mut right_buf, dw, dh);
            self.compute_diff_impl(&left_buf, &right_buf, dw, dh)
        } else {
            // mem::take avoids cloning (zero-copy move out and back)
            let left = std::mem::take(&mut self.frames[0].rgb);
            let right = std::mem::take(&mut self.frames[1].rgb);
            let result = self.compute_diff_impl(&left, &right, src_w, src_h);
            self.frames[0].rgb = left;
            self.frames[1].rgb = right;
            result
        }
    }

    /// Single-pass: diff + metrics + coloring. EMA optional.
    fn compute_diff_impl(&mut self, left: &[u8], right: &[u8], width: i32, height: i32) -> (f32, f32, f32, f32) {
        if self.ema_alpha < 1.0 {
            self.compute_diff_ema(left, right, width, height)
        } else {
            self.compute_diff_fast(left, right, width, height)
        }
    }

    /// Fast path: no EMA, simple threshold coloring
    fn compute_diff_fast(&mut self, left: &[u8], right: &[u8], width: i32, height: i32) -> (f32, f32, f32, f32) {
        let pixel_count = (width * height) as usize;
        self.diff_rgba.resize(pixel_count * 4, 0);

        let normalize_max = self.max_diff.max(1.0);
        let inv_normalize = 1.0 / normalize_max;
        let inv_255 = 1.0 / 255.0;
        let threshold_sq = 0.12 * 0.12 * 3.0 * 255.0 * 255.0; // threshold in diff_sq units

        let mut current_max: f32 = 0.0;
        let mut ssim_sum: f32 = 0.0;
        let mut mse_sum: f32 = 0.0;

        for i in 0..pixel_count {
            let idx = i * 3;
            let ri = i * 4;
            let dr = (left[idx] as i32 - right[idx] as i32).abs();
            let dg = (left[idx + 1] as i32 - right[idx + 1] as i32).abs();
            let db = (left[idx + 2] as i32 - right[idx + 2] as i32).abs();
            let diff_sq = (dr * dr + dg * dg + db * db) as f32;

            mse_sum += diff_sq;
            current_max = current_max.max(diff_sq);

            let l1 = 0.2126 * left[idx] as f32 + 0.7152 * left[idx + 1] as f32 + 0.0722 * left[idx + 2] as f32;
            let l2 = 0.2126 * right[idx] as f32 + 0.7152 * right[idx + 1] as f32 + 0.0722 * right[idx + 2] as f32;
            ssim_sum += 1.0 - (l1 - l2).abs() * inv_255;

            // Simple threshold: below = original, above = heatmap
            if diff_sq < threshold_sq {
                self.diff_rgba[ri]     = left[idx];
                self.diff_rgba[ri + 1] = left[idx + 1];
                self.diff_rgba[ri + 2] = left[idx + 2];
            } else {
                let normalized = (diff_sq * inv_normalize).sqrt().min(1.0);
                let n2 = normalized * 2.0;
                self.diff_rgba[ri]     = ((n2 - 1.0).max(0.0) * 255.0) as u8;
                self.diff_rgba[ri + 1] = ((1.0 - (n2 - 1.0).abs()) * 255.0) as u8;
                self.diff_rgba[ri + 2] = (((1.0 - n2).max(0.0)) * 255.0) as u8;
            }
            self.diff_rgba[ri + 3] = 255;
        }

        self.max_diff = current_max;
        let avg_ssim = ssim_sum / pixel_count as f32;
        let avg_mse = mse_sum / pixel_count as f32;
        let psnr = if avg_mse > 0.0 { 10.0 * (65025.0 / avg_mse).log10() } else { 100.0 };
        (avg_ssim, psnr, avg_mse, current_max)
    }

    /// EMA path: per-pixel temporal filtering
    fn compute_diff_ema(&mut self, left: &[u8], right: &[u8], width: i32, height: i32) -> (f32, f32, f32, f32) {
        let pixel_count = (width * height) as usize;
        self.diff_rgba.resize(pixel_count * 4, 0);
        if self.diff_ema.len() != pixel_count {
            self.diff_ema = vec![0.0; pixel_count];
            self.ema_initialized = false;
        }

        let alpha = self.ema_alpha;
        let normalize_max = self.max_diff.max(1.0);
        let inv_normalize = 1.0 / normalize_max;
        let inv_255 = 1.0 / 255.0;
        let threshold_sq = 0.12 * 0.12 * 3.0 * 255.0 * 255.0;

        let mut current_max: f32 = 0.0;
        let mut ssim_sum: f32 = 0.0;
        let mut mse_sum: f32 = 0.0;

        if self.ema_initialized {
            for i in 0..pixel_count {
                let idx = i * 3;
                let ri = i * 4;
                let dr = (left[idx] as i32 - right[idx] as i32).abs();
                let dg = (left[idx + 1] as i32 - right[idx + 1] as i32).abs();
                let db = (left[idx + 2] as i32 - right[idx + 2] as i32).abs();
                let diff_sq = (dr * dr + dg * dg + db * db) as f32;

                let prev = self.diff_ema[i];
                let ema_val = alpha * diff_sq + (1.0 - alpha) * prev;
                self.diff_ema[i] = ema_val;

                mse_sum += diff_sq;
                current_max = current_max.max(ema_val);

                let l1 = 0.2126 * left[idx] as f32 + 0.7152 * left[idx + 1] as f32 + 0.0722 * left[idx + 2] as f32;
                let l2 = 0.2126 * right[idx] as f32 + 0.7152 * right[idx + 1] as f32 + 0.0722 * right[idx + 2] as f32;
                ssim_sum += 1.0 - (l1 - l2).abs() * inv_255;

                if ema_val < threshold_sq {
                    self.diff_rgba[ri]     = left[idx];
                    self.diff_rgba[ri + 1] = left[idx + 1];
                    self.diff_rgba[ri + 2] = left[idx + 2];
                } else {
                    let normalized = (ema_val * inv_normalize).sqrt().min(1.0);
                    let n2 = normalized * 2.0;
                    self.diff_rgba[ri]     = ((n2 - 1.0).max(0.0) * 255.0) as u8;
                    self.diff_rgba[ri + 1] = ((1.0 - (n2 - 1.0).abs()) * 255.0) as u8;
                    self.diff_rgba[ri + 2] = (((1.0 - n2).max(0.0)) * 255.0) as u8;
                }
                self.diff_rgba[ri + 3] = 255;
            }
        } else {
            for i in 0..pixel_count {
                let idx = i * 3;
                let ri = i * 4;
                let dr = (left[idx] as i32 - right[idx] as i32).abs();
                let dg = (left[idx + 1] as i32 - right[idx + 1] as i32).abs();
                let db = (left[idx + 2] as i32 - right[idx + 2] as i32).abs();
                let diff_sq = (dr * dr + dg * dg + db * db) as f32;

                self.diff_ema[i] = diff_sq;
                mse_sum += diff_sq;
                current_max = current_max.max(diff_sq);

                let l1 = 0.2126 * left[idx] as f32 + 0.7152 * left[idx + 1] as f32 + 0.0722 * left[idx + 2] as f32;
                let l2 = 0.2126 * right[idx] as f32 + 0.7152 * right[idx + 1] as f32 + 0.0722 * right[idx + 2] as f32;
                ssim_sum += 1.0 - (l1 - l2).abs() * inv_255;

                if diff_sq < threshold_sq {
                    self.diff_rgba[ri]     = left[idx];
                    self.diff_rgba[ri + 1] = left[idx + 1];
                    self.diff_rgba[ri + 2] = left[idx + 2];
                } else {
                    let normalized = (diff_sq * inv_normalize).sqrt().min(1.0);
                    let n2 = normalized * 2.0;
                    self.diff_rgba[ri]     = ((n2 - 1.0).max(0.0) * 255.0) as u8;
                    self.diff_rgba[ri + 1] = ((1.0 - (n2 - 1.0).abs()) * 255.0) as u8;
                    self.diff_rgba[ri + 2] = (((1.0 - n2).max(0.0)) * 255.0) as u8;
                }
                self.diff_rgba[ri + 3] = 255;
            }
            self.ema_initialized = true;
        }

        self.max_diff = current_max;
        let avg_ssim = ssim_sum / pixel_count as f32;
        let avg_mse = mse_sum / pixel_count as f32;
        let psnr = if avg_mse > 0.0 { 10.0 * (65025.0 / avg_mse).log10() } else { 100.0 };
        (avg_ssim, psnr, avg_mse, current_max)
    }
}

// ============================================================================
// Module-level functions using thread_local
// ============================================================================

thread_local! {
    static FRAME_CACHE: std::cell::RefCell<FrameCache> = std::cell::RefCell::new(FrameCache::new());
}

pub fn init_cache(width: i32, height: i32) {
    FRAME_CACHE.with(|c| { c.borrow_mut().init(width, height); });
}

pub fn cache_frame_slot(slot: usize, rgb: &[u8], width: i32, height: i32) {
    FRAME_CACHE.with(|c| { c.borrow_mut().cache_frame(slot, rgb, width, height); });
}

pub fn clear_cache() {
    FRAME_CACHE.with(|c| { c.borrow_mut().clear(); });
}

pub fn compare_cached() -> (f32, f32, f32, f32) {
    FRAME_CACHE.with(|c| { c.borrow_mut().compute_diff_rgba() })
}

pub fn get_cached_diff_rgba() -> Vec<u8> {
    FRAME_CACHE.with(|c| { c.borrow().get_diff_rgba().to_vec() })
}

pub fn set_ema_alpha(alpha: f32) {
    FRAME_CACHE.with(|c| { c.borrow_mut().ema_alpha = alpha.clamp(0.01, 1.0); });
}
