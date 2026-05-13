use wasm_bindgen_test::*;

#[wasm_bindgen_test]
fn test_default_config() {
    let config = video_compare_wasm::get_compare_config();
    assert_eq!(config.max_width, 1920);
    assert_eq!(config.max_height, 1080);
    assert_eq!(config.block_size, 16);
}

#[wasm_bindgen_test]
fn test_set_config() {
    video_compare_wasm::set_compare_config(video_compare_wasm::CompareConfig {
        max_width: 3840,
        max_height: 2160,
        block_size: 8,
    });

    let config = video_compare_wasm::get_compare_config();
    assert_eq!(config.max_width, 3840);
    assert_eq!(config.max_height, 2160);
    assert_eq!(config.block_size, 8);
}

#[wasm_bindgen_test]
fn test_identical_frames() {
    // Create identical 16x16 RGB frames
    let frame: Vec<u8> = vec![128u8; 16 * 16 * 3];

    let metrics = video_compare_wasm::compare(&frame, &frame, 16, 16);

    // Identical frames should have SSIM = 1.0, MSE = 0, PSNR = 100
    assert!(metrics.ssim > 0.99);
    assert!(metrics.mse < 0.01);
    assert_eq!(metrics.psnr, 100.0);
}

#[wasm_bindgen_test]
fn test_different_frames() {
    // Create two different 16x16 RGB frames
    let left: Vec<u8> = vec![0u8; 16 * 16 * 3];
    let right: Vec<u8> = vec![255u8; 16 * 16 * 3];

    let metrics = video_compare_wasm::compare(&left, &right, 16, 16);

    // Completely different frames should have low SSIM
    assert!(metrics.ssim < 0.1);
    // MSE should be high (255^2 = 65025)
    assert!(metrics.mse > 50000.0);
}