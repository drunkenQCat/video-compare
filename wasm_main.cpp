// Wasm库入口 - 纯计算模块,无GUI依赖
#ifdef __EMSCRIPTEN__

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "wasm_comparer.h"

using namespace emscripten;

// 包装函数 - 接受Uint8Array,从HEAP中提取指针
CompareMetrics compare_frames_wrapper(
  val left_js,
  val right_js,
  int width,
  int height
) {
  // 从Uint8Array获取底层指针
  // JavaScript传的是Uint8Array,embind会自动处理
  uint8_t* left_rgb = reinterpret_cast<uint8_t*>(left_js["byteOffset"].as<long>());
  uint8_t* right_rgb = reinterpret_cast<uint8_t*>(right_js["byteOffset"].as<long>());

  return compare_frames(left_rgb, right_rgb, width, height, nullptr, 0);
}

void set_compare_config_wrapper(val config_js) {
  CompareConfig config;
  config.max_width = config_js["max_width"].as<int>();
  config.max_height = config_js["max_height"].as<int>();
  config.block_size = config_js["block_size"].as<int>();

  set_compare_config(&config);
}

// 使用EMSCRIPTEN_KEEPALIVE导出C函数(用于需要手动内存管理的场景)
extern "C" {

EMSCRIPTEN_KEEPALIVE
void* compare_frames_ptr(
  const uint8_t* left_ptr,
  const uint8_t* right_ptr,
  int width,
  int height,
  int* out_result_size
) {
  CompareMetrics result = compare_frames(left_ptr, right_ptr, width, height, nullptr, 0);
  
  // 将结果复制到堆内存,返回指针
  CompareMetrics* heap_result = new CompareMetrics(result);
  if (out_result_size) {
    *out_result_size = sizeof(CompareMetrics);
  }
  return heap_result;
}

EMSCRIPTEN_KEEPALIVE
void free_metrics_ptr(void* ptr) {
  delete static_cast<CompareMetrics*>(ptr);
}

}  // extern "C"

// 使用Emscripten Bindings导出
EMSCRIPTEN_BINDINGS(video_compare_module) {

  // 导出CompareMetrics结构体
  value_object<CompareMetrics>("CompareMetrics")
    .field("ssim", &CompareMetrics::ssim)
    .field("psnr", &CompareMetrics::psnr)
    .field("mse", &CompareMetrics::mse)
    .field("width", &CompareMetrics::width)
    .field("height", &CompareMetrics::height)
    .field("downsampled", &CompareMetrics::downsampled);

  // 导出CompareConfig结构体
  value_object<CompareConfig>("CompareConfig")
    .field("max_width", &CompareConfig::max_width)
    .field("max_height", &CompareConfig::max_height)
    .field("block_size", &CompareConfig::block_size);

  // 导出包装函数 - 直接使用Uint8Array
  function("compare_frames", &compare_frames_wrapper);
  function("get_compare_config", &get_compare_config);
}

#endif  // __EMSCRIPTEN__

