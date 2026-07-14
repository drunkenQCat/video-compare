//! Python bindings for video-compare
//!
//! Reuses the same computation modules as the WASM build (metrics, utils, frame_cache).
//! No browser dependencies — pure native Rust compiled as a Python extension module.

use pyo3::prelude::*;
use pyo3::types::PyBytes;

// Reuse computation modules from video-compare-wasm (no wasm_bindgen deps)
mod types;
#[path = "../../video-compare-wasm/src/utils.rs"]
mod utils;
#[path = "../../video-compare-wasm/src/metrics.rs"]
mod metrics;
#[path = "../../video-compare-wasm/src/config.rs"]
mod config;
#[path = "../../video-compare-wasm/src/frame_cache.rs"]
mod frame_cache;

use frame_cache::{
    init_cache, cache_frame_slot, clear_cache, compare_cached, get_cached_diff_rgba,
    set_ema_alpha as set_ema_alpha_impl,
};

/// Compare two RGB frames, returns (ssim, psnr, mse, max_diff)
#[pyfunction]
fn compare(left: &[u8], right: &[u8], width: i32, height: i32) -> (f32, f32, f32, f32) {
    init_cache(width, height);
    cache_frame_slot(0, left, width, height);
    cache_frame_slot(1, right, width, height);
    compare_cached()
}

/// Initialize frame cache with expected dimensions
#[pyfunction]
fn init_frame_cache(width: i32, height: i32) {
    init_cache(width, height);
}

/// Cache a frame to slot (0=left, 1=right)
/// RGB data should be width * height * 3 bytes
#[pyfunction]
fn cache_frame(slot: i32, rgb: &[u8], width: i32, height: i32) {
    cache_frame_slot(slot as usize, rgb, width, height);
}

/// Compare cached frames, returns (ssim, psnr, mse, max_diff)
#[pyfunction]
fn compare_cached_frames() -> (f32, f32, f32, f32) {
    compare_cached()
}

/// Get diff RGBA data as bytes (width * height * 4 bytes, ready for PIL.Image)
#[pyfunction]
fn get_diff_rgba<'py>(py: Python<'py>) -> PyResult<Bound<'py, PyBytes>> {
    let rgba = get_cached_diff_rgba();
    Ok(PyBytes::new_bound(py, &rgba))
}

/// Clear frame cache
#[pyfunction]
fn clear_frame_cache() {
    clear_cache();
}

/// Set comparison config
#[pyfunction]
fn set_config(max_width: i32, max_height: i32, block_size: i32) {
    config::set_config(types::CompareConfig {
        max_width,
        max_height,
        block_size,
    });
}

/// Set EMA smoothing factor (1.0 = off, 0.3 = moderate filtering)
#[pyfunction]
fn set_ema_alpha(alpha: f32) {
    set_ema_alpha_impl(alpha);
}

/// Python module definition
#[pymodule]
fn _core(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(compare, m)?)?;
    m.add_function(wrap_pyfunction!(init_frame_cache, m)?)?;
    m.add_function(wrap_pyfunction!(cache_frame, m)?)?;
    m.add_function(wrap_pyfunction!(compare_cached_frames, m)?)?;
    m.add_function(wrap_pyfunction!(get_diff_rgba, m)?)?;
    m.add_function(wrap_pyfunction!(clear_frame_cache, m)?)?;
    m.add_function(wrap_pyfunction!(set_config, m)?)?;
    m.add_function(wrap_pyfunction!(set_ema_alpha, m)?)?;
    Ok(())
}
