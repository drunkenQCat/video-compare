/// Data types for comparison results and configuration

/// Comparison metrics result
#[derive(Clone, Copy, Debug, Default)]
pub struct CompareMetrics {
    /// Structural similarity index (0-1)
    pub ssim: f32,
    /// Peak signal-to-noise ratio (dB)
    pub psnr: f32,
    /// Mean squared error
    pub mse: f32,
    /// Actual processed width
    pub width: i32,
    /// Actual processed height
    pub height: i32,
    /// Whether downsampling was applied (1=yes, 0=no)
    pub downsampled: i32,
}

/// Configuration for comparison
#[derive(Clone, Copy, Debug)]
pub struct CompareConfig {
    /// Maximum processing width (default 1920)
    pub max_width: i32,
    /// Maximum processing height (default 1080)
    pub max_height: i32,
    /// Block size for SSIM calculation (default 16)
    pub block_size: i32,
}

impl Default for CompareConfig {
    fn default() -> Self {
        Self {
            max_width: 1280,
            max_height: 720,
            block_size: 16,
        }
    }
}