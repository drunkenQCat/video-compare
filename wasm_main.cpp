// Wasm库入口 - 纯计算模块,无GUI依赖
#ifdef __EMSCRIPTEN__

#include <emscripten/bind.h>
#include <emscripten/val.h>
#include "wasm_comparer.h"

using namespace emscripten;

// 包装函数,使用val::global("Uint8Array")替代原始指针
CompareMetrics compare_frames_wrapper(
  val left_js,
  val right_js,
  int width,
  int height,
  val diff_js
) {
  // 从JavaScript ArrayBuffer获取原生指针
  uint8_t* left_rgb = reinterpret_cast<uint8_t*>(left_js.as<long>());
  uint8_t* right_rgb = reinterpret_cast<uint8_t*>(right_js.as<long>());
  uint8_t* diff_buffer = diff_js.isUndefined() ? nullptr : reinterpret_cast<uint8_t*>(diff_js.as<long>());
  int diff_size = diff_js.isUndefined() ? 0 : diff_js["byteLength"].as<int>();
  
  return compare_frames(left_rgb, right_rgb, width, height, diff_buffer, diff_size);
}

void set_compare_config_wrapper(val config_js) {
  CompareConfig config;
  config.max_width = config_js["max_width"].as<int>();
  config.max_height = config_js["max_height"].as<int>();
  config.block_size = config_js["block_size"].as<int>();
  
  set_compare_config(&config);
}

// 使用EMSCRIPTEN_KEEPALIVE导出C函数
extern "C" {

EMSCRIPTEN_KEEPALIVE
CompareMetrics compare_frames_js(
  long left_ptr,
  long right_ptr,
  int width,
  int height,
  long diff_ptr,
  int diff_size
) {
  return compare_frames(
    reinterpret_cast<const uint8_t*>(left_ptr),
    reinterpret_cast<const uint8_t*>(right_ptr),
    width,
    height,
    diff_ptr ? reinterpret_cast<uint8_t*>(diff_ptr) : nullptr,
    diff_size
  );
}

EMSCRIPTEN_KEEPALIVE
void set_compare_config_js(long config_ptr) {
  set_compare_config(reinterpret_cast<const CompareConfig*>(config_ptr));
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

  // 导出包装函数 (使用val接收Uint8Array，避免原始指针问题)
  function("compare_frames", &compare_frames_wrapper);
  function("set_compare_config", &set_compare_config_wrapper);
  function("get_compare_config", &get_compare_config);
}

#endif  // __EMSCRIPTEN__

