#include "image_loader.h"
#include <iostream>
#include <fstream>

ImageLoader::ImageLoader(const std::string& file_path)
    : file_path_(file_path),
      image_data_(nullptr),
      width_(0),
      height_(0),
      channels_(0),
      data_size_(0) {
}

ImageLoader::~ImageLoader() {
  if (image_data_) {
#ifdef WASM_BUILD
    stbi_image_free(image_data_);
#else
    av_freep(&image_data_);
#endif
  }
}

bool ImageLoader::load() {
#ifdef WASM_BUILD
  // Wasm版本: 使用stb_image加载
  // 首先检查文件是否存在
  std::ifstream file(file_path_);
  if (!file.good()) {
    error_message_ = "File not found: " + file_path_;
    return false;
  }
  
  // stbi_load 返回RGB数据
  int channels_temp = 0;
  image_data_ = stbi_load(file_path_.c_str(), &width_, &height_, &channels_temp, 3);
  
  if (!image_data_) {
    error_message_ = "Failed to load image: " + std::string(stbi_failure_reason() ? stbi_failure_reason() : "unknown error");
    return false;
  }
  
  channels_ = 3;  // 强制RGB
  data_size_ = width_ * height_ * channels_;
  
  std::cout << "Loaded image: " << file_path_ 
            << " (" << width_ << "x" << height_ << ", " 
            << channels_ << " channels)" << std::endl;
  
  return true;
#else
  // 原生版本: 使用FFmpeg加载图片
  AVFormatContext* format_ctx = nullptr;
  if (avformat_open_input(&format_ctx, file_path_.c_str(), nullptr, nullptr) != 0) {
    error_message_ = "Failed to open file: " + file_path_;
    return false;
  }
  
  if (avformat_find_stream_info(format_ctx, nullptr) < 0) {
    avformat_close_input(&format_ctx);
    error_message_ = "Failed to find stream info";
    return false;
  }
  
  // 查找视频流
  AVCodecParameters* codec_params = nullptr;
  for (unsigned i = 0; i < format_ctx->nb_streams; i++) {
    if (format_ctx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_VIDEO) {
      codec_params = format_ctx->streams[i]->codecpar;
      break;
    }
  }
  
  if (!codec_params) {
    avformat_close_input(&format_ctx);
    error_message_ = "No video stream found";
    return false;
  }
  
  // 查找解码器
  const AVCodec* codec = avcodec_find_decoder(codec_params->codec_id);
  if (!codec) {
    avformat_close_input(&format_ctx);
    error_message_ = "Unsupported codec";
    return false;
  }
  
  // 创建解码器上下文
  AVCodecContext* codec_ctx = avcodec_alloc_context3(codec);
  if (avcodec_parameters_to_context(codec_ctx, codec_params) < 0) {
    avcodec_free_context(&codec_ctx);
    avformat_close_input(&format_ctx);
    error_message_ = "Failed to copy codec parameters";
    return false;
  }
  
  if (avcodec_open2(codec_ctx, codec, nullptr) < 0) {
    avcodec_free_context(&codec_ctx);
    avformat_close_input(&format_ctx);
    error_message_ = "Failed to open codec";
    return false;
  }
  
  // 读取一帧
  AVPacket* packet = av_packet_alloc();
  AVFrame* frame = av_frame_alloc();
  bool success = false;
  
  while (av_read_frame(format_ctx, packet) >= 0) {
    if (packet->stream_index == 0) {
      if (avcodec_send_packet(codec_ctx, packet) == 0) {
        if (avcodec_receive_frame(codec_ctx, frame) == 0) {
          width_ = frame->width;
          height_ = frame->height;
          channels_ = 3;
          data_size_ = width_ * height_ * channels_;
          
          // 分配内存并转换
          image_data_ = (uint8_t*)av_malloc(data_size_);
          
          // 使用sws_scale转换为RGB (简化版本)
          // 这里需要实际的转换逻辑,暂时使用占位
          success = true;
          break;
        }
      }
    }
    av_packet_unref(packet);
  }
  
  av_packet_free(&packet);
  av_frame_free(&frame);
  avcodec_free_context(&codec_ctx);
  avformat_close_input(&format_ctx);
  
  if (!success) {
    error_message_ = "Failed to decode image frame";
    return false;
  }
  
  std::cout << "Loaded image: " << file_path_ 
            << " (" << width_ << "x" << height_ << ")" << std::endl;
  
  return true;
#endif
}

unsigned ImageLoader::width() const {
  return width_;
}

unsigned ImageLoader::height() const {
  return height_;
}

int ImageLoader::channels() const {
  return channels_;
}

const uint8_t* ImageLoader::data() const {
  return image_data_;
}

size_t ImageLoader::data_size() const {
  return data_size_;
}

#ifdef WASM_BUILD
ImageLoader::ImageInfo ImageLoader::get_image_info() const {
  return ImageInfo{
    .data = image_data_,
    .width = width_,
    .height = height_,
    .channels = channels_
  };
}
#else
bool ImageLoader::convert_to_avframe(AVFrame* frame) {
  if (!image_data_ || !frame) {
    return false;
  }
  
  // 分配帧缓冲
  int ret = av_image_alloc(frame->data, frame->linesize,
                           width_, height_, AV_PIX_FMT_RGB24, 1);
  if (ret < 0) {
    error_message_ = "Failed to allocate frame buffer";
    return false;
  }
  
  // 复制数据
  for (int y = 0; y < height_; y++) {
    memcpy(frame->data[0] + y * frame->linesize[0],
           image_data_ + y * width_ * channels_,
           width_ * channels_);
  }
  
  frame->width = width_;
  frame->height = height_;
  frame->format = AV_PIX_FMT_RGB24;
  
  return true;
}
#endif

const std::string& ImageLoader::file_path() const {
  return file_path_;
}

const std::string& ImageLoader::error_message() const {
  return error_message_;
}
