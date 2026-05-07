#pragma once

#include <cstdint>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define COMPARE_API EMSCRIPTEN_KEEPALIVE
#else
#define COMPARE_API
#endif

// 对比指标结构
struct CompareMetrics {
  float ssim;           // 结构相似度 0-1
  float psnr;           // 峰值信噪比 (dB)
  float mse;            // 均方误差
  int width;            // 实际处理宽度
  int height;           // 实际处理高度
  int downsampled;      // 是否降采样 (1=是, 0=否)
};

// 配置参数
struct CompareConfig {
  int max_width;        // 最大处理宽度 (默认1920)
  int max_height;       // 最大处理高度 (默认1080)
  int block_size;       // 分块大小 (默认16)
};

extern "C" {

// 主API: 对比两帧RGB图像
COMPARE_API CompareMetrics compare_frames(
  const uint8_t* left_rgb,       // 左帧RGB数据 (width*height*3 bytes)
  const uint8_t* right_rgb,      // 右帧RGB数据 (width*height*3 bytes)
  int width,                      // 图像宽度
  int height,                     // 图像高度
  uint8_t* diff_buffer,           // 输出: 分块差异buffer (可选, 传NULL跳过)
  int diff_buffer_size            // diff_buffer大小 (bytes)
);

// 配置API
COMPARE_API void set_compare_config(const CompareConfig* config);

// 获取当前配置
COMPARE_API CompareConfig get_compare_config();

}  // extern "C"
