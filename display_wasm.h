// Wasm版本的简化display.h
#pragma once

#ifdef WASM_BUILD

#include <SDL2/SDL.h>
#include <SDL2/SDL_ttf.h>
#include <array>
#include <string>
#include <vector>
#include "core_types.h"
#include "config.h"

// Wasm版本的VideoMetadata - 简化版
struct VideoMetadata {
  std::string file_name;
  int width;
  int height;
};

class Display {
 public:
  enum class Mode { Split, VStack, HStack };
  enum class Loop { Off, ForwardOnly, PingPong };
  enum class AspectLockMode { Off, Window, Content };
  enum class AspectViewMode { Stretch, Original, Preset16x9, Preset4x3, Preset1x1 };

  Display(const VideoCompareConfig& config);
  ~Display();

  bool is_valid() const { return window_ != nullptr && renderer_ != nullptr; }
  
  void handle_events();
  void render();
  
  void set_left_image(const uint8_t* data, int width, int height);
  void set_right_image(const uint8_t* data, int width, int height);

 private:
  SDL_Window* window_;
  SDL_Renderer* renderer_;
  SDL_Texture* left_texture_;
  SDL_Texture* right_texture_;
  TTF_Font* font_;
  
  int window_width_;
  int window_height_;
  Mode mode_;
  
  bool quit_;
  
  // 图像数据
  std::vector<uint8_t> left_image_data_;
  std::vector<uint8_t> right_image_data_;
  int left_width_, left_height_;
  int right_width_, right_height_;
  
  void render_split_mode();
  void render_text(const std::string& text, int x, int y);
};

#endif // WASM_BUILD
