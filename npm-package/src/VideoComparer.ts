/**
 * Video Compare WebAssembly Library
 *
 * 纯计算库，用于实时对比两帧图像的相似度
 * 输出SSIM、PSNR/MSE指标
 */

export interface CompareInput {
  /** 左帧RGB数据 (width × height × 3 bytes) */
  left: Uint8Array | ArrayBuffer;
  /** 右帧RGB数据 (width × height × 3 bytes) */
  right: Uint8Array | ArrayBuffer;
  /** 图像宽度 */
  width: number;
  /** 图像高度 */
  height: number;
}

export interface CompareMetrics {
  /** 结构相似度指数 (0-1) */
  ssim: number;
  /** 峰值信噪比 (dB) */
  psnr: number;
  /** 均方误差 */
  mse: number;
  /** 实际处理的宽度 */
  width: number;
  /** 实际处理的高度 */
  height: number;
  /** 是否进行了降采样 */
  downsampled: boolean;
}

export interface CompareConfig {
  /** 最大处理宽度 (默认: 1920) */
  maxWidth?: number;
  /** 最大处理高度 (默认: 1080) */
  maxHeight?: number;
  /** 分块大小 (默认: 16) */
  blockSize?: number;
}

/* ── Emscripten 模块类型 (minimal) ── */
interface WasmModule {
  compare_frames: (
    leftView: Uint8Array,
    rightView: Uint8Array,
    width: number,
    height: number
  ) => CompareMetrics;
  set_compare_config: (cfg: {
    max_width: number;
    max_height: number;
    block_size: number;
  }) => void;
  get_compare_config: () => {
    max_width: number;
    max_height: number;
    block_size: number;
  };
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  onRuntimeInitialized?: () => void;
}

/* ── 动态加载 Wasm loader (.js) ── */
async function loadWasmModule(): Promise<WasmModule> {
  // 1. 检查全局 (script 标签加载)
  // @ts-ignore
  if (typeof VideoCompareModule !== 'undefined') {
    // @ts-ignore
    const m = await VideoCompareModule();
    return m as WasmModule;
  }
  // @ts-ignore
  if (typeof Module !== 'undefined') {
    // @ts-ignore
    const m = await Module();
    return m as WasmModule;
  }

  // 2. 浏览器环境: fetch JS loader + eval (绕过 bundler exports 限制)
  if (typeof document !== 'undefined') {
    return new Promise<WasmModule>((resolve, reject) => {
      const script = document.createElement('script');
      // 尝试从同目录加载 (npm package dist/)
      script.src = new URL('video-compare.js', import.meta.url).href;
      script.onload = () => {
        // @ts-ignore
        const m = (typeof VideoCompareModule !== 'undefined')
          // @ts-ignore
          ? VideoCompareModule()
          // @ts-ignore
          : (typeof Module !== 'undefined' ? Module() : null);
        if (m) resolve(m);
        else reject(new Error('VideoCompareModule not registered after script load'));
      };
      script.onerror = () => reject(new Error(
        'Failed to load video-compare.js. Ensure the .js and .wasm files are in the same directory as index.mjs'
      ));
      document.head.appendChild(script);
    });
  }

  throw new Error('VideoCompareModule not found. Ensure video-compare.js is accessible.');
}

/* ── 工具函数 ── */
function copyToWasm(mod: WasmModule, data: Uint8Array): [number, Uint8Array] | null {
  const ptr = mod._malloc(data.length);
  if (!ptr) return null;
  mod.HEAPU8.set(data, ptr);
  return [ptr, mod.HEAPU8.subarray(ptr, ptr + data.length)];
}

function toUint8Array(buf: Uint8Array | ArrayBuffer): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  return new Uint8Array(buf);
}

/**
 * VideoComparer — WebAssembly 图片对比封装
 *
 * ```typescript
 * const comparer = await VideoComparer.create();
 * const metrics = await comparer.compare({ left, right, width, height });
 * comparer.dispose();
 * ```
 */
export class VideoComparer {
  private mod: WasmModule | null = null;
  private disposed = false;
  private config: Required<CompareConfig>;

  private constructor(cfg: Required<CompareConfig>) {
    this.config = cfg;
  }

  /** 创建实例 (异步加载 Wasm) */
  static async create(config?: CompareConfig): Promise<VideoComparer> {
    const merged: Required<CompareConfig> = {
      maxWidth: config?.maxWidth ?? 1920,
      maxHeight: config?.maxHeight ?? 1080,
      blockSize: config?.blockSize ?? 16,
    };
    const instance = new VideoComparer(merged);
    instance.mod = await loadWasmModule();
    instance.applyConfig();
    return instance;
  }

  /** 对比两帧 */
  async compare(input: CompareInput): Promise<CompareMetrics> {
    if (this.disposed || !this.mod)
      throw new Error('VideoComparer has been disposed');

    const left = toUint8Array(input.left);
    const right = toUint8Array(input.right);
    const expected = input.width * input.height * 3;
    if (left.length !== expected)
      throw new Error(`Left buffer size mismatch. Expected ${expected}, got ${left.length}`);
    if (right.length !== expected)
      throw new Error(`Right buffer size mismatch. Expected ${expected}, got ${right.length}`);

    const la = copyToWasm(this.mod, left);
    const ra = copyToWasm(this.mod, right);
    if (!la || !ra) throw new Error('_malloc failed — Wasm heap may be full');

    try {
      return this.mod.compare_frames(la[1], ra[1], input.width, input.height);
    } finally {
      this.mod._free(la[0]);
      this.mod._free(ra[0]);
    }
  }

  /** 更新配置 */
  setConfig(config: Partial<CompareConfig>): void {
    if (this.disposed || !this.mod) throw new Error('VideoComparer has been disposed');
    if (config.maxWidth !== undefined) this.config.maxWidth = config.maxWidth;
    if (config.maxHeight !== undefined) this.config.maxHeight = config.maxHeight;
    if (config.blockSize !== undefined) this.config.blockSize = config.blockSize;
    this.applyConfig();
  }

  /** 获取当前配置 */
  getConfig(): Readonly<Required<CompareConfig>> {
    return { ...this.config };
  }

  /** 释放资源 */
  dispose(): void {
    if (!this.disposed) {
      this.mod = null;
      this.disposed = true;
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private applyConfig(): void {
    if (!this.mod) return;
    this.mod.set_compare_config({
      max_width: this.config.maxWidth,
      max_height: this.config.maxHeight,
      block_size: this.config.blockSize,
    });
  }
}

export default VideoComparer;
