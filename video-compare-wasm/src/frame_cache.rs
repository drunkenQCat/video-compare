/// Frame cache system for efficient video comparison
///
/// Reduces data transfer by caching frames in WASM memory
/// and outputting pre-computed RGBA diff images.

use std::cell::RefCell;

/// Cached frame data
struct CachedFrame {
    rgb: Vec<u8>,
    width: i32,
    height: i32,
}

impl CachedFrame {
    fn new() -> Self {
        Self {
            rgb: Vec::new(),
            width: 0,
            height: 0,
        }
    }

    fn set(&mut self, rgb: &[u8], width: i32, height: i32) {
        self.width = width;
        self.height = height;
        self.rgb.resize(rgb.len(), 0);
        self.rgb.copy_from_slice(rgb);
    }

    fn clear(&mut self) {
        self.rgb.clear();
        self.width = 0;
        self.height = 0;
    }
}

/// Global frame cache with 2 slots (left/right)
pub struct FrameCache {
    frames: [CachedFrame; 2],
    /// Pre-computed RGBA diff image (ready for canvas)
    diff_rgba: Vec<u8>,
    width: i32,
    height: i32,
    max_diff: f32,
}

impl FrameCache {
    fn new() -> Self {
        Self {
            frames: [CachedFrame::new(), CachedFrame::new()],
            diff_rgba: Vec::new(),
            width: 0,
            height: 0,
            max_diff: 0.0,
        }
    }

    /// Initialize cache with expected dimensions
    pub fn init(&mut self, width: i32, height: i32) {
        self.width = width;
        self.height = height;
        let pixel_count = (width * height) as usize;
        self.diff_rgba.resize(pixel_count * 4, 0);
    }

    /// Cache a frame to specified slot (0 or 1)
    pub fn cache_frame(&mut self, slot: usize, rgb: &[u8], width: i32, height: i32) {
        if slot < 2 {
            self.frames[slot].set(rgb, width, height);
        }
    }

    /// Clear a specific slot
    pub fn clear_slot(&mut self, slot: usize) {
        if slot < 2 {
            self.frames[slot].clear();
        }
    }

    /// Clear all cached data
    pub fn clear(&mut self) {
        self.frames[0].clear();
        self.frames[1].clear();
        self.diff_rgba.clear();
        self.width = 0;
        self.height = 0;
        self.max_diff = 0.0;
    }

    /// Check if both slots have valid frames
    pub fn is_ready(&self) -> bool {
        self.frames[0].width > 0 && self.frames[1].width > 0 &&
        self.frames[0].width == self.frames[1].width &&
        self.frames[0].height == self.frames[1].height
    }

    /// Get cached frame dimensions
    pub fn dimensions(&self) -> (i32, i32) {
        (self.frames[0].width, self.frames[0].height)
    }

    /// Compute pixel diff and generate RGBA output
    /// Returns (ssim, psnr, mse, max_diff)
    pub fn compute_diff_rgba(&mut self) -> (f32, f32, f32, f32) {
        if !self.is_ready() {
            return (0.0, 0.0, 0.0, 0.0);
        }

        let left = &self.frames[0];
        let right = &self.frames[1];
        let width = left.width;
        let height = left.height;
        let pixel_count = (width * height) as usize;

        // Ensure RGBA buffer is sized correctly
        self.diff_rgba.resize(pixel_count * 4, 0);

        let mut max_diff: f32 = 0.0;
        let mut total_diff: f64 = 0.0;
        let mut ssim_sum: f32 = 0.0;
        let mut mse_sum: f64 = 0.0;

        // Compute per-pixel diff and convert to RGBA with heatmap coloring
        for i in 0..pixel_count {
            let idx = i * 3;
            let dr = (left.rgb[idx] as i32 - right.rgb[idx] as i32).abs();
            let dg = (left.rgb[idx + 1] as i32 - right.rgb[idx + 1] as i32).abs();
            let db = (left.rgb[idx + 2] as i32 - right.rgb[idx + 2] as i32).abs();

            let diff_sq = (dr * dr + dg * dg + db * db) as f32;

            total_diff += diff_sq as f64;
            mse_sum += diff_sq as f64;
            if diff_sq > max_diff {
                max_diff = diff_sq;
            }

            // SSIM contribution (simplified per-pixel luminance similarity)
            let l1 = 0.2126 * left.rgb[idx] as f32 + 0.7152 * left.rgb[idx + 1] as f32 + 0.0722 * left.rgb[idx + 2] as f32;
            let l2 = 0.2126 * right.rgb[idx] as f32 + 0.7152 * right.rgb[idx + 1] as f32 + 0.0722 * right.rgb[idx + 2] as f32;
            let luminance_sim = 1.0 - (l1 - l2).abs() / 255.0;
            ssim_sum += luminance_sim;

            // Convert diff to heatmap color (blue-green-yellow-red)
            let rgba_idx = i * 4;
            let normalized = if max_diff > 0.0 { 
                (diff_sq / max_diff).sqrt() 
            } else { 
                0.0 
            };

            let (r, g, b) = diff_to_color(normalized);
            self.diff_rgba[rgba_idx] = r;
            self.diff_rgba[rgba_idx + 1] = g;
            self.diff_rgba[rgba_idx + 2] = b;
            self.diff_rgba[rgba_idx + 3] = 255;
        }

        self.max_diff = max_diff;

        let avg_ssim = ssim_sum / pixel_count as f32;
        let avg_mse = mse_sum / pixel_count as f64;

        // Calculate PSNR
        let psnr = if avg_mse > 0.0 {
            10.0 * (255.0 * 255.0 / avg_mse).log10()
        } else {
            100.0 // Perfect match
        };

        (avg_ssim, psnr as f32, avg_mse as f32, max_diff)
    }

    /// Get the RGBA diff data
    pub fn get_diff_rgba(&self) -> &[u8] {
        &self.diff_rgba
    }

    /// Get max diff value
    pub fn max_diff(&self) -> f32 {
        self.max_diff
    }
}

/// Convert normalized diff (0-1) to heatmap RGB color
fn diff_to_color(n: f32) -> (u8, u8, u8) {
    if n < 0.25 {
        let t = n / 0.25;
        (0, (255.0 * t) as u8, 255)
    } else if n < 0.5 {
        let t = (n - 0.25) / 0.25;
        (0, 255, (255.0 * (1.0 - t)) as u8)
    } else if n < 0.75 {
        let t = (n - 0.5) / 0.25;
        ((255.0 * t) as u8, 255, 0)
    } else {
        let t = (n - 0.75) / 0.25;
        (255, (255.0 * (1.0 - t)) as u8, 0)
    }
}

// Thread-local frame cache (WASM friendly)
thread_local! {
    pub static FRAME_CACHE: RefCell<FrameCache> = RefCell::new(FrameCache::new());
}

/// Initialize the frame cache with expected dimensions
pub fn init_cache(width: i32, height: i32) {
    FRAME_CACHE.with(|c| {
        c.borrow_mut().init(width, height);
    });
}

/// Cache a frame to slot 0 or 1
pub fn cache_frame_slot(slot: usize, rgb: &[u8], width: i32, height: i32) {
    FRAME_CACHE.with(|c| {
        c.borrow_mut().cache_frame(slot, rgb, width, height);
    });
}

/// Clear the frame cache
pub fn clear_cache() {
    FRAME_CACHE.with(|c| {
        c.borrow_mut().clear();
    });
}

/// Compare cached frames and return metrics
pub fn compare_cached() -> (f32, f32, f32, f32) {
    FRAME_CACHE.with(|c| {
        c.borrow_mut().compute_diff_rgba()
    })
}

/// Get cached diff RGBA data as Vec
pub fn get_cached_diff_rgba() -> Vec<u8> {
    FRAME_CACHE.with(|c| {
        c.borrow().get_diff_rgba().to_vec()
    })
}