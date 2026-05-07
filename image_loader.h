#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include "core_types.h"

#ifdef WASM_BUILD
// Wasm构建: 使用stb_image.h加载图片
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"
#else
// 原生构建: 使用FFmpeg
extern "C" {
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavutil/imgutils.h>
}
#endif

class ImageLoader {
 public:
  explicit ImageLoader(const std::string& file_path);
  ~ImageLoader();

  // 加载图片到内存
  bool load();
  
  // 获取图片信息
  unsigned width() const;
  unsigned height() const;
  int channels() const;
  
  // 获取原始像素数据 (RGB格式)
  const uint8_t* data() const;
  size_t data_size() const;
  
  // 转换为AVFrame格式 (用于与现有Display接口兼容)
#ifdef WASM_BUILD
  // Wasm版本: 返回简化的图像信息
  struct ImageInfo {
    uint8_t* data;
    int width;
    int height;
    int channels;
  };
  ImageInfo get_image_info() const;
#else
  // 原生版本: 转换为AVFrame
  bool convert_to_avframe(AVFrame* frame);
#endif

  // 获取文件路径
  const std::string& file_path() const;
  
  // 错误信息
  const std::string& error_message() const;

 private:
  std::string file_path_;
  std::string error_message_;
  
  // 图片数据
  uint8_t* image_data_;
  int width_;
  int height_;
  int channels_;
  size_t data_size_;
};
