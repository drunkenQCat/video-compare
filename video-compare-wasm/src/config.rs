//! Global configuration management
//!
//! Thread-safe configuration storage using atomic pointer.

use std::sync::atomic::{AtomicPtr, Ordering};
use crate::types::CompareConfig;

/// Global config stored as static atomic pointer
static CONFIG: AtomicPtr<CompareConfig> = AtomicPtr::new(std::ptr::null_mut());

/// Get current configuration (thread-safe)
pub fn get_config() -> CompareConfig {
    let ptr = CONFIG.load(Ordering::Relaxed);
    if ptr.is_null() {
        CompareConfig::default()
    } else {
        unsafe { (*ptr).clone() }
    }
}

/// Set comparison configuration (thread-safe)
///
/// Replaces the current config and properly deallocates the old one.
pub fn set_config(config: CompareConfig) {
    let boxed = Box::new(config);
    let ptr = Box::into_raw(boxed);

    let old_ptr = CONFIG.swap(ptr, Ordering::Relaxed);
    if !old_ptr.is_null() {
        unsafe { drop(Box::from_raw(old_ptr)); }
    }
}

/// Initialize default configuration
pub fn init_default() {
    set_config(CompareConfig::default());
}