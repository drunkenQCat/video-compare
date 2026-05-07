// Wasm版本的Display实现 - 简化版
#ifdef WASM_BUILD

#include "display_wasm.h"
#include <iostream>
#include <algorithm>

Display::Display(const VideoCompareConfig& config)
    : window_(nullptr),
      renderer_(nullptr),
      left_texture_(nullptr),
      right_texture_(nullptr),
      font_(nullptr),
      window_width_(config.window_width),
      window_height_(config.window_height),
      mode_(Mode::Split),
      quit_(false),
      left_width_(0),
      left_height_(0),
      right_width_(0),
      right_height_(0) {
  
  // 初始化SDL
  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER) < 0) {
    std::cerr << "SDL initialization failed: " << SDL_GetError() << std::endl;
    return;
  }
  
  // 初始化SDL_ttf
  if (TTF_Init() < 0) {
    std::cerr << "SDL_ttf initialization failed: " << TTF_GetError() << std::endl;
    SDL_Quit();
    return;
  }
  
  // 创建窗口
  window_ = SDL_CreateWindow(
    "Video Compare (WebAssembly)",
    SDL_WINDOWPOS_CENTERED,
    SDL_WINDOWPOS_CENTERED,
    window_width_,
    window_height_,
    SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE
  );
  
  if (!window_) {
    std::cerr << "Window creation failed: " << SDL_GetError() << std::endl;
    return;
  }
  
  // 创建渲染器
  renderer_ = SDL_CreateRenderer(window_, -1, SDL_RENDERER_ACCELERATED | SDL_RENDERER_PRESENTVSYNC);
  if (!renderer_) {
    std::cerr << "Renderer creation failed: " << SDL_GetError() << std::endl;
    SDL_DestroyWindow(window_);
    window_ = nullptr;
    return;
  }
  
  // 加载字体 (使用内置字体)
  font_ = TTF_OpenFont("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16);
  if (!font_) {
    std::cerr << "Warning: Font loading failed, text rendering disabled" << std::endl;
  }
  
  std::cout << "Display initialized: " << window_width_ << "x" << window_height_ << std::endl;
}

Display::~Display() {
  if (left_texture_) SDL_DestroyTexture(left_texture_);
  if (right_texture_) SDL_DestroyTexture(right_texture_);
  if (font_) TTF_CloseFont(font_);
  if (renderer_) SDL_DestroyRenderer(renderer_);
  if (window_) SDL_DestroyWindow(window_);
  
  TTF_Quit();
  SDL_Quit();
}

void Display::handle_events() {
  SDL_Event event;
  while (SDL_PollEvent(&event)) {
    if (event.type == SDL_QUIT) {
      quit_ = true;
    } else if (event.type == SDL_KEYDOWN) {
      if (event.key.keysym.sym == SDLK_ESCAPE) {
        quit_ = true;
      }
    } else if (event.type == SDL_WINDOWEVENT) {
      if (event.window.event == SDL_WINDOWEVENT_RESIZED) {
        window_width_ = event.window.data1;
        window_height_ = event.window.data2;
      }
    }
  }
}

void Display::set_left_image(const uint8_t* data, int width, int height) {
  left_width_ = width;
  left_height_ = height;
  left_image_data_.assign(data, data + width * height * 3);
  
  if (left_texture_) {
    SDL_DestroyTexture(left_texture_);
  }
  
  left_texture_ = SDL_CreateTexture(
    renderer_,
    SDL_PIXELFORMAT_RGB24,
    SDL_TEXTUREACCESS_STATIC,
    width,
    height
  );
  
  SDL_UpdateTexture(left_texture_, nullptr, data, width * 3);
}

void Display::set_right_image(const uint8_t* data, int width, int height) {
  right_width_ = width;
  right_height_ = height;
  right_image_data_.assign(data, data + width * height * 3);
  
  if (right_texture_) {
    SDL_DestroyTexture(right_texture_);
  }
  
  right_texture_ = SDL_CreateTexture(
    renderer_,
    SDL_PIXELFORMAT_RGB24,
    SDL_TEXTUREACCESS_STATIC,
    width,
    height
  );
  
  SDL_UpdateTexture(right_texture_, nullptr, data, width * 3);
}

void Display::render_split_mode() {
  SDL_SetRenderDrawColor(renderer_, 0, 0, 0, 255);
  SDL_RenderClear(renderer_);
  
  int half_width = window_width_ / 2;
  
  // 渲染左图
  if (left_texture_) {
    SDL_Rect dst = {0, 0, half_width, window_height_};
    SDL_RenderCopy(renderer_, left_texture_, nullptr, &dst);
  }
  
  // 渲染右图
  if (right_texture_) {
    SDL_Rect dst = {half_width, 0, half_width, window_height_};
    SDL_RenderCopy(renderer_, right_texture_, nullptr, &dst);
  }
  
  // 绘制分隔线
  SDL_SetRenderDrawColor(renderer_, 255, 255, 255, 255);
  SDL_RenderDrawLine(renderer_, half_width, 0, half_width, window_height_);
  
  SDL_RenderPresent(renderer_);
}

void Display::render() {
  if (!renderer_) return;
  
  render_split_mode();
}

void Display::render_text(const std::string& text, int x, int y) {
  if (!font_ || !renderer_) return;
  
  SDL_Color color = {255, 255, 255, 255};
  SDL_Surface* surface = TTF_RenderText_Solid(font_, text.c_str(), color);
  if (!surface) return;
  
  SDL_Texture* texture = SDL_CreateTextureFromSurface(renderer_, surface);
  if (texture) {
    SDL_Rect dst = {x, y, surface->w, surface->h};
    SDL_RenderCopy(renderer_, texture, nullptr, &dst);
    SDL_DestroyTexture(texture);
  }
  
  SDL_FreeSurface(surface);
}

#endif // WASM_BUILD
