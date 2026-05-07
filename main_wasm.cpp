// Wasm版本的main入口 - 简化版本,仅支持图片比较
#ifdef WASM_BUILD

#include <emscripten.h>
#include <emscripten/html5.h>
#include <iostream>
#include <string>
#include <vector>
#include "display_wasm.h"
#include "image_loader.h"
#include "config.h"

// 全局状态
static Display* g_display = nullptr;
static ImageLoader* g_left_image = nullptr;
static ImageLoader* g_right_image = nullptr;
static bool g_is_running = true;

// Emscripten主循环回调
void emscripten_main_loop() {
  if (!g_display || !g_is_running) {
    emscripten_cancel_main_loop();
    return;
  }
  
  // 处理SDL事件
  g_display->handle_events();
  
  // 渲染帧
  g_display->render();
}

// JavaScript可调用的函数:加载图片
extern "C" {

EMSCRIPTEN_KEEPALIVE
int load_images(const char* left_path, const char* right_path) {
  std::cout << "Loading images: " << left_path << " and " << right_path << std::endl;
  
  // 清理之前的图像
  if (g_left_image) {
    delete g_left_image;
    g_left_image = nullptr;
  }
  if (g_right_image) {
    delete g_right_image;
    g_right_image = nullptr;
  }
  
  // 加载左图
  g_left_image = new ImageLoader(left_path);
  if (!g_left_image->load()) {
    std::cerr << "Failed to load left image: " << g_left_image->error_message() << std::endl;
    delete g_left_image;
    g_left_image = nullptr;
    return -1;
  }
  
  // 加载右图
  g_right_image = new ImageLoader(right_path);
  if (!g_right_image->load()) {
    std::cerr << "Failed to load right image: " << g_right_image->error_message() << std::endl;
    delete g_right_image;
    g_right_image = nullptr;
    return -2;
  }
  
  std::cout << "Images loaded successfully" << std::endl;
  return 0;
}

EMSCRIPTEN_KEEPALIVE
void cleanup_images() {
  if (g_left_image) {
    delete g_left_image;
    g_left_image = nullptr;
  }
  if (g_right_image) {
    delete g_right_image;
    g_right_image = nullptr;
  }
}

EMSCRIPTEN_KEEPALIVE
void shutdown_app() {
  g_is_running = false;
}

} // extern "C"

// Wasm版本的main函数 - 简化初始化
int main(int argc, char** argv) {
  std::cout << "Video Compare (WebAssembly) starting..." << std::endl;
  
  // 初始化配置 (使用默认值)
  VideoCompareConfig config;
  config.window_width = 1280;
  config.window_height = 720;
  
  // 创建Display
  try {
    g_display = new Display(config);
    
    if (!g_display->is_valid()) {
      std::cerr << "Failed to initialize display" << std::endl;
      return -1;
    }
    
    std::cout << "Display initialized successfully" << std::endl;
    
    // 设置Emscripten主循环
    emscripten_set_main_loop(emscripten_main_loop, 0, 1);
    
  } catch (const std::exception& e) {
    std::cerr << "Error: " << e.what() << std::endl;
    return -1;
  }
  
  return 0;
}

#endif // WASM_BUILD
