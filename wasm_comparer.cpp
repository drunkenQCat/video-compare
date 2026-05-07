#include "wasm_comparer.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <vector>

// 全局配置
static CompareConfig g_config = {1920, 1080, 16};

extern "C" {

COMPARE_API void set_compare_config(const CompareConfig* config) {
  if (config) {
    g_config = *config;
  }
}

COMPARE_API CompareConfig get_compare_config() {
  return g_config;
}

// 简单的双线性插值降采样
static void downsample_bilinear(
  const uint8_t* src,
  int src_w, int src_h,
  uint8_t* dst,
  int dst_w, int dst_h
) {
  float x_ratio = (float)src_w / dst_w;
  float y_ratio = (float)src_h / dst_h;

  for (int y = 0; y < dst_h; y++) {
    for (int x = 0; x < dst_w; x++) {
      int src_x = (int)(x * x_ratio);
      int src_y = (int)(y * y_ratio);

      dst[(y * dst_w + x) * 3 + 0] = src[(src_y * src_w + src_x) * 3 + 0];
      dst[(y * dst_w + x) * 3 + 1] = src[(src_y * src_w + src_x) * 3 + 1];
      dst[(y * dst_w + x) * 3 + 2] = src[(src_y * src_w + src_x) * 3 + 2];
    }
  }
}

// 计算单个block的SSIM
static float compute_block_ssim(
  const uint8_t* left,
  const uint8_t* right,
  int block_size,
  int stride
) {
  const float C1 = 6.5025;  // (K1*L)^2, K1=0.01, L=255
  const float C2 = 58.5225; // (K2*L)^2, K2=0.03

  double mean_x = 0, mean_y = 0;
  double var_x = 0, var_y = 0;
  double cov_xy = 0;

  int pixel_count = block_size * block_size;

  // 计算均值
  for (int y = 0; y < block_size; y++) {
    for (int x = 0; x < block_size; x++) {
      // 转换为灰度 (BT.709权重)
      int idx = (y * stride + x) * 3;
      float gray_l = 0.2126f * left[idx + 0] + 0.7152f * left[idx + 1] + 0.0722f * left[idx + 2];
      float gray_r = 0.2126f * right[idx + 0] + 0.7152f * right[idx + 1] + 0.0722f * right[idx + 2];

      mean_x += gray_l;
      mean_y += gray_r;
    }
  }

  mean_x /= pixel_count;
  mean_y /= pixel_count;

  // 计算方差和协方差
  for (int y = 0; y < block_size; y++) {
    for (int x = 0; x < block_size; x++) {
      int idx = (y * stride + x) * 3;
      float gray_l = 0.2126f * left[idx + 0] + 0.7152f * left[idx + 1] + 0.0722f * left[idx + 2];
      float gray_r = 0.2126f * right[idx + 0] + 0.7152f * right[idx + 1] + 0.0722f * right[idx + 2];

      var_x += (gray_l - mean_x) * (gray_l - mean_x);
      var_y += (gray_r - mean_y) * (gray_r - mean_y);
      cov_xy += (gray_l - mean_x) * (gray_r - mean_y);
    }
  }

  var_x /= pixel_count;
  var_y /= pixel_count;
  cov_xy /= pixel_count;

  // SSIM公式
  float numerator = (2 * mean_x * mean_y + C1) * (2 * cov_xy + C2);
  float denominator = (mean_x * mean_x + mean_y * mean_y + C1) * (var_x + var_y + C2);

  return numerator / denominator;
}

// 计算单个block的MSE
static float compute_block_mse(
  const uint8_t* left,
  const uint8_t* right,
  int block_size,
  int stride
) {
  double sum = 0;
  int pixel_count = block_size * block_size * 3;

  for (int y = 0; y < block_size; y++) {
    for (int x = 0; x < block_size; x++) {
      int idx = (y * stride + x) * 3;
      for (int c = 0; c < 3; c++) {
        int diff = left[idx + c] - right[idx + c];
        sum += diff * diff;
      }
    }
  }

  return (float)(sum / pixel_count);
}

COMPARE_API CompareMetrics compare_frames(
  const uint8_t* left_rgb,
  const uint8_t* right_rgb,
  int width,
  int height,
  uint8_t* diff_buffer,
  int diff_buffer_size
) {
  // 检查输入
  if (!left_rgb || !right_rgb || width <= 0 || height <= 0) {
    return {0, 0, 0, 0, 0, 0};
  }

  // 检查是否需要降采样
  bool downsampled = false;
  int process_w = width;
  int process_h = height;

  if (width > g_config.max_width || height > g_config.max_height) {
    float scale = std::min(
      (float)g_config.max_width / width,
      (float)g_config.max_height / height
    );
    process_w = (int)(width * scale);
    process_h = (int)(height * scale);
    downsampled = true;
  }

  // 降采样 (如果需要)
  std::vector<uint8_t> left_downsampled;
  std::vector<uint8_t> right_downsampled;

  const uint8_t* left_ptr = left_rgb;
  const uint8_t* right_ptr = right_rgb;
  int stride = process_w;

  if (downsampled) {
    left_downsampled.resize(process_w * process_h * 3);
    right_downsampled.resize(process_w * process_h * 3);

    downsample_bilinear(left_rgb, width, height,
                       left_downsampled.data(), process_w, process_h);
    downsample_bilinear(right_rgb, width, height,
                       right_downsampled.data(), process_w, process_h);

    left_ptr = left_downsampled.data();
    right_ptr = right_downsampled.data();
  }

  // 计算分块数量和布局
  int blocks_x = (process_w + g_config.block_size - 1) / g_config.block_size;
  int blocks_y = (process_h + g_config.block_size - 1) / g_config.block_size;
  int total_blocks = blocks_x * blocks_y;

  // 检查diff_buffer是否足够
  int required_diff_size = total_blocks * sizeof(float);
  if (diff_buffer && diff_buffer_size < required_diff_size) {
    diff_buffer = nullptr;  // buffer太小,跳过
  }

  // 分块计算
  float global_ssim = 0;
  double global_mse = 0;
  int block_count = 0;

  float* diff_output = (float*)diff_buffer;

  for (int by = 0; by < blocks_y; by++) {
    for (int bx = 0; bx < blocks_x; bx++) {
      int block_x = bx * g_config.block_size;
      int block_y = by * g_config.block_size;

      // 计算实际block尺寸 (边缘可能不足block_size)
      int actual_w = std::min(g_config.block_size, process_w - block_x);
      int actual_h = std::min(g_config.block_size, process_h - block_y);

      const uint8_t* left_block = left_ptr + (block_y * process_w + block_x) * 3;
      const uint8_t* right_block = right_ptr + (block_y * process_w + block_x) * 3;

      float block_ssim = compute_block_ssim(left_block, right_block,
                                            actual_w, process_w);
      float block_mse = compute_block_mse(left_block, right_block,
                                          actual_w, process_w);

      global_ssim += block_ssim;
      global_mse += block_mse;
      block_count++;

      // 写入diff_buffer
      if (diff_output) {
        diff_output[by * blocks_x + bx] = block_mse;
      }
    }
  }

  // 计算全局指标
  float avg_ssim = global_ssim / block_count;
  float avg_mse = (float)global_mse / block_count;
  float psnr = (avg_mse > 0) ? 10.0f * std::log10(255.0f * 255.0f / avg_mse) : 100.0f;

  return {
    avg_ssim,
    psnr,
    avg_mse,
    process_w,
    process_h,
    downsampled ? 1 : 0
  };
}

}  // extern "C"
