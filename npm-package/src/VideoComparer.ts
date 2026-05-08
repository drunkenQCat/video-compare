/**
 * Video Compare WebAssembly Library
 * 
 * 纯计算库，用于实时对比两帧图像的相似度
 * 输出SSIM、PSNR、MSE指标及分块差异数据
 */

// 动态导入Emscripten生成的loader
// @ts-ignore
import VideoCompareModule from './video-compare.js';

export interface CompareInput {
  /** 左帧RGB数据 (width × height × 3 bytes) */
  left: ArrayBuffer | Uint8Array;
  /** 右帧RGB数据 (width × height × 3 bytes) */
  right: ArrayBuffer | Uint8Array;
  /** 图像宽度 */
  width: number;
  /** 图像高度 */
  height: number;
}

export interface CompareMetrics {
  /** 
   * 结构相似度指数 (0-1)
   * 1 = 完全相同, 0 = 完全不同
   * > 0.95 表示极好, < 0.70 表示较差
   */
  ssim: number;
  
  /** 
   * 峰值信噪比 (dB)
   * 越高表示质量越好
   * > 40dB 表示极好, < 25dB 表示较差
   */
  psnr: number;
  
  /** 
   * 均方误差
   * 越低表示差异越小
   * < 10 表示极好, > 200 表示较差
   */
  mse: number;
  
  /** 实际处理的宽度（可能因降采样而缩小） */
  width: number;
  
  /** 实际处理的高度（可能因降采样而缩小） */
  height: number;
  
  /** 是否进行了降采样处理 */
  downsampled: boolean;
  
  /** 
   * 可选：分块差异数据
   * 仅当compare()的includeDiff=true时返回
   * 每个元素代表一个16×16块的MSE值
   */
  diff?: Float32Array;
}

export interface CompareConfig {
  /** 最大处理宽度，超过此尺寸自动降采样 (默认: 1920) */
  maxWidth?: number;
  /** 最大处理高度，超过此尺寸自动降采样 (默认: 1080) */
  maxHeight?: number;
  /** 分块大小，用于差异计算 (默认: 16) */
  blockSize?: number;
}

/**
 * VideoComparer - WebAssembly视频帧对比库
 * 
 * 使用示例:
 * ```typescript
 * const comparer = await VideoComparer.create();
 * const metrics = await comparer.compare({
 *   left: leftFrameRGB,
 *   right: rightFrameRGB,
 *   width: 1920,
 *   height: 1080
 * });
 * console.log(metrics.ssim, metrics.psnr, metrics.mse);
 * comparer.dispose();
 * ```
 */
export class VideoComparer {
  private module: any;
  private disposed = false;
  private config: Required<CompareConfig>;

  private constructor(module: any, config: Required<CompareConfig>) {
    this.module = module;
    this.config = config;
  }

  /**
   * 创建VideoComparer实例（异步加载Wasm模块）
   * @param config 可选配置参数
   * @returns VideoComparer实例
   */
  static async create(config?: CompareConfig): Promise<VideoComparer> {
    const defaultConfig: Required<CompareConfig> = {
      maxWidth: config?.maxWidth ?? 1920,
      maxHeight: config?.maxHeight ?? 1080,
      blockSize: config?.blockSize ?? 16
    };

    try {
      // 加载Wasm模块
      const module = await VideoCompareModule();

      // 创建实例
      const comparer = new VideoComparer(module, defaultConfig);

      // 应用配置
      comparer.applyConfig();

      return comparer;
    } catch (error) {
      throw new Error(`Failed to load VideoCompare Wasm: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * 对比两帧图像
   * @param input 输入参数（左右帧数据及尺寸）
   * @param includeDiff 是否返回分块差异数据（默认false，性能更好）
   * @returns 对比指标
   * @throws 如果输入无效或实例已释放
   */
  async compare(input: CompareInput, includeDiff = false): Promise<CompareMetrics> {
    // 检查实例状态
    if (this.disposed) {
      throw new Error('VideoComparer has been disposed. Create a new instance.');
    }

    // 验证输入
    this.validateInput(input);

    // 转换为Uint8Array
    const leftData = this.toUint8Array(input.left);
    const rightData = this.toUint8Array(input.right);

    // 计算diff buffer大小（如果需要）
    let diffBufferPtr = 0;
    let diffBufferSize = 0;
    let blocksX = 0;
    let blocksY = 0;

    if (includeDiff) {
      blocksX = Math.ceil(input.width / this.config.blockSize);
      blocksY = Math.ceil(input.height / this.config.blockSize);
      diffBufferSize = blocksX * blocksY * 4; // float = 4 bytes
      diffBufferPtr = this.module._malloc(diffBufferSize);

      if (diffBufferPtr === 0) {
        throw new Error('Failed to allocate memory for diff buffer');
      }
    }

    try {
      // 调用Wasm对比函数
      const metrics = this.module.compare_frames(
        leftData.byteOffset,
        rightData.byteOffset,
        input.width,
        input.height,
        diffBufferPtr,
        diffBufferSize
      );

      // 构建结果对象
      const result: CompareMetrics = {
        ssim: metrics.ssim,
        psnr: metrics.psnr,
        mse: metrics.mse,
        width: metrics.width,
        height: metrics.height,
        downsampled: Boolean(metrics.downsampled)
      };

      // 读取diff数据（如果需要）
      if (includeDiff && diffBufferPtr > 0) {
        const diffData = new Float32Array(
          this.module.HEAPF32.buffer,
          diffBufferPtr,
          blocksX * blocksY
        );

        // 复制数据（避免后续_free后内存失效）
        result.diff = new Float32Array(diffData);
      }

      return result;
    } finally {
      // 释放diff buffer内存
      if (diffBufferPtr > 0) {
        this.module._free(diffBufferPtr);
      }
    }
  }

  /**
   * 更新配置参数
   * @param config 新配置参数
   */
  setConfig(config: Partial<CompareConfig>): void {
    if (this.disposed) {
      throw new Error('VideoComparer has been disposed');
    }

    if (config.maxWidth !== undefined) this.config.maxWidth = config.maxWidth;
    if (config.maxHeight !== undefined) this.config.maxHeight = config.maxHeight;
    if (config.blockSize !== undefined) this.config.blockSize = config.blockSize;

    this.applyConfig();
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<Required<CompareConfig>> {
    return { ...this.config };
  }

  /**
   * 释放Wasm资源
   * 调用后实例不可再使用
   */
  dispose(): void {
    if (!this.disposed) {
      this.module = null;
      this.disposed = true;
    }
  }

  /**
   * 检查实例是否已释放
   */
  get isDisposed(): boolean {
    return this.disposed;
  }

  // ========== 私有方法 ==========

  /**
   * 验证输入参数
   */
  private validateInput(input: CompareInput): void {
    if (!input.left || !input.right) {
      throw new Error('left and right buffers are required');
    }

    if (input.width <= 0 || input.height <= 0) {
      throw new Error(`Invalid dimensions: ${input.width}×${input.height}. Width and height must be positive.`);
    }

    const expectedSize = input.width * input.height * 3; // RGB = 3 bytes per pixel

    if (input.left.byteLength !== expectedSize) {
      throw new Error(
        `Left buffer size mismatch. Expected: ${expectedSize}, Got: ${input.left.byteLength}`
      );
    }

    if (input.right.byteLength !== expectedSize) {
      throw new Error(
        `Right buffer size mismatch. Expected: ${expectedSize}, Got: ${input.right.byteLength}`
      );
    }
  }

  /**
   * 转换为Uint8Array
   */
  private toUint8Array(buffer: ArrayBuffer | Uint8Array): Uint8Array {
    if (buffer instanceof Uint8Array) {
      return buffer;
    }
    return new Uint8Array(buffer);
  }

  /**
   * 应用配置到Wasm模块
   */
  private applyConfig(): void {
    this.module.set_compare_config({
      max_width: this.config.maxWidth,
      max_height: this.config.maxHeight,
      block_size: this.config.blockSize
    });
  }
}

// 默认导出
export default VideoComparer;
