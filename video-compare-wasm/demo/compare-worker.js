/**
 * Web Worker for video-compare WASM computation
 *
 * Offloads ALL computation from the main thread:
 * - RGBA→RGB conversion (strips alpha, video has no alpha)
 * - WASM frame cache + comparison
 * - Diff RGBA generation
 */

import init, {
  init_frame_cache,
  cache_frame,
  compare_cached_frames,
  get_diff_rgba,
  clear_frame_cache,
  set_compare_config,
  WasmCompareConfig,
  set_diff_ema_alpha,
} from './video_compare_wasm.js';

let wasmReady = false;
let pendingInit = null;

async function ensureWasm() {
  if (wasmReady) return;
  if (pendingInit) await pendingInit;
  pendingInit = init();
  await pendingInit;
  wasmReady = true;
  pendingInit = null;
}

/** Convert RGBA (4 bytes/pixel) to RGB (3 bytes/pixel) */
function rgbaToRgb(rgba, width, height) {
  const pixelCount = width * height;
  const rgb = new Uint8Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    rgb[i * 3]     = rgba[i * 4];
    rgb[i * 3 + 1] = rgba[i * 4 + 1];
    rgb[i * 3 + 2] = rgba[i * 4 + 2];
  }
  return rgb;
}

self.onmessage = async (e) => {
  const { type } = e.data;

  try {
    switch (type) {
      case 'init': {
        await ensureWasm();
        self.postMessage({ type: 'ready' });
        break;
      }

      case 'config': {
        await ensureWasm();
        const { maxWidth, maxHeight, blockSize, emaAlpha } = e.data;
        if (maxWidth && maxHeight && blockSize) {
          set_compare_config(new WasmCompareConfig(maxWidth, maxHeight, blockSize));
        }
        if (emaAlpha !== undefined) {
          set_diff_ema_alpha(emaAlpha);
        }
        self.postMessage({ type: 'configured' });
        break;
      }

      case 'compare': {
        await ensureWasm();
        const { leftRGBA, rightRGBA, width, height } = e.data;

        // Convert RGBA→RGB in worker (video has no alpha, strip it)
        const leftRGB = rgbaToRgb(leftRGBA, width, height);
        const rightRGB = rgbaToRgb(rightRGBA, width, height);

        init_frame_cache(width, height);
        cache_frame(0, leftRGB, width, height);
        cache_frame(1, rightRGB, width, height);
        const [ssim, psnr, mse, maxDiff] = compare_cached_frames();
        const rgba = get_diff_rgba();

        self.postMessage(
          { type: 'result', ssim, psnr, mse, maxDiff, rgba, width, height },
          [rgba.buffer]
        );
        break;
      }

      case 'clear': {
        if (wasmReady) clear_frame_cache();
        self.postMessage({ type: 'cleared' });
        break;
      }

      default:
        self.postMessage({ type: 'error', error: `Unknown message type: ${type}` });
    }
  } catch (err) {
    self.postMessage({ type: 'error', error: String(err) });
  }
};
