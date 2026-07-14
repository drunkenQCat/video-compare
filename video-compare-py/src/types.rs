//! Types for video-compare (no wasm_bindgen dependencies)

#[derive(Clone)]
pub struct CompareConfig {
    pub max_width: i32,
    pub max_height: i32,
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
