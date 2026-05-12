import { VideoComparer } from '@cfai/video-compare';

/* ── 全局状态 ── */
let comparer: VideoComparer | null = null;
let leftVideo: HTMLVideoElement;
let rightVideo: HTMLVideoElement;
let leftStream: MediaStream | null = null;
let rightStream: MediaStream | null = null;
let running = false;
let animFrame = 0;

/* ── metrics 历史 ── */
const ssimHistory: number[] = [];
const MAX_HISTORY = 120;

/* ── canvas 工具 ── */
const diffCanvas = document.getElementById('diffCanvas') as HTMLCanvasElement;
const heatCanvas = document.getElementById('heatCanvas') as HTMLCanvasElement;
const chartCanvas = document.getElementById('chartCanvas') as HTMLCanvasElement;
const diffCtx = diffCanvas.getContext('2d')!;
const heatCtx = heatCanvas.getContext('2d')!;
const chartCtx = chartCanvas.getContext('2d')!;

/* ── 初始化 Wasm ── */
async function initWasm() {
  console.log('Loading @cfai/video-compare...');
  comparer = await VideoComparer.create();
  console.log('✅ Wasm ready');
}

/* ── 文件处理 ── */
function setupFileInput(input: HTMLInputElement, box: HTMLElement, hint: HTMLElement, isLeft: boolean) {
  input.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const video = isLeft ? leftVideo : rightVideo;
    video.src = url;

    hint.textContent = `${file.name}`;
    box.classList.add('has');

    video.addEventListener('loadedmetadata', () => {
      hint.textContent = `${file.name} (${video.videoWidth}×${video.videoHeight}, ${formatTime(video.duration)})`;
      checkReady();
    }, { once: true });
  });
}

function checkReady() {
  if (leftVideo.src && rightVideo.src) {
    document.getElementById('controls')!.style.display = 'flex';
    document.getElementById('videoSection')!.style.display = 'grid';
    document.getElementById('compareSection')!.style.display = 'block';
    document.getElementById('metricsSection')!.style.display = 'block';

    const maxDur = Math.max(leftVideo.duration, rightVideo.duration);
    const seekBar = document.getElementById('seekBar') as HTMLInputElement;
    seekBar.max = String(maxDur);
    updateTimeDisplay();
  }
}

/* ── 播放控制 ── */
function setupControls() {
  const playBtn = document.getElementById('playBtn') as HTMLButtonElement;
  const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
  const seekBar = document.getElementById('seekBar') as HTMLInputElement;

  playBtn.addEventListener('click', async () => {
    await Promise.all([leftVideo.play(), rightVideo.play()]);
    running = true;
    playBtn.disabled = true;
    pauseBtn.disabled = false;
    syncLoop();
  });

  pauseBtn.addEventListener('click', () => {
    leftVideo.pause();
    rightVideo.pause();
    running = false;
    playBtn.disabled = false;
    pauseBtn.disabled = true;
    cancelAnimationFrame(animFrame);
  });

  seekBar.addEventListener('input', () => {
    const t = parseFloat(seekBar.value);
    leftVideo.currentTime = t;
    rightVideo.currentTime = t;
    updateTimeDisplay();
  });
}

/* ── 同步播放循环 ── */
async function syncLoop() {
  if (!running) return;

  // 同步: 以较慢的为准
  const dt = Math.abs(leftVideo.currentTime - rightVideo.currentTime);
  if (dt > 0.05) {
    if (leftVideo.currentTime > rightVideo.currentTime) {
      leftVideo.currentTime = rightVideo.currentTime;
    } else {
      rightVideo.currentTime = leftVideo.currentTime;
    }
  }

  // 提取帧
  const t0 = performance.now();
  const leftRGB = await extractFrame(leftVideo);
  const rightRGB = await extractFrame(rightVideo);

  // DEBUG: 检查帧提取
  if (!leftRGB || !rightRGB) {
    console.log('⏳ 等待帧...', {
      leftReady: leftVideo.readyState,
      rightReady: rightVideo.readyState,
      leftRGB: !!leftRGB,
      rightRGB: !!rightRGB
    });
    animFrame = requestAnimationFrame(syncLoop);
    return;
  }

  const w = leftVideo.videoWidth;
  const h = leftVideo.videoHeight;

  // 对比 (仅当 Wasm 可用时)
  if (comparer) {
    try {
      console.log('🔍 开始对比...', { w, h, leftSize: leftRGB.length, rightSize: rightRGB.length });
      const metrics = await comparer.compare({
        left: leftRGB,
        right: rightRGB,
        width: w,
        height: h,
      });
      console.log('✅ 对比结果:', metrics);

      updateMetrics(metrics);
      drawDiff(leftRGB, rightRGB, w, h, diffCtx, diffCanvas);
      drawChart();

      // FPS
      const dt = (performance.now() - t0) / 1000;
      const fps = dt > 0 ? (1 / dt).toFixed(1) : '-';
      document.getElementById('fpsV')!.textContent = fps;
    } catch (e) {
      console.error('❌ compare failed:', e);
    }
  } else {
    console.warn('⚠️ comparer 未初始化');
  }

  // 更新进度条
  const seekBar = document.getElementById('seekBar') as HTMLInputElement;
  seekBar.value = String(leftVideo.currentTime);
  updateTimeDisplay();

  // 检查结束
  if (leftVideo.ended || rightVideo.ended) {
    running = false;
    (document.getElementById('playBtn') as HTMLButtonElement).disabled = false;
    (document.getElementById('pauseBtn') as HTMLButtonElement).disabled = true;
    return;
  }

  animFrame = requestAnimationFrame(syncLoop);
}

/* ── 帧提取 (VideoFrame → canvas → RGB) ── */
const frameCanvas = document.createElement('canvas');
const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true })!;

async function extractFrame(video: HTMLVideoElement): Promise<Uint8Array | null> {
  if (video.readyState < 2) return null;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w === 0 || h === 0) return null;

  frameCanvas.width = w;
  frameCanvas.height = h;
  frameCtx.drawImage(video, 0, 0, w, h);
  const imageData = frameCtx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // RGBA → RGB
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    rgb[i * 3] = data[j];
    rgb[i * 3 + 1] = data[j + 1];
    rgb[i * 3 + 2] = data[j + 2];
  }
  return rgb;
}

/* ── 可视化 ── */
function updateMetrics(m: { ssim: number; psnr: number; mse: number }) {
  const ssimV = document.getElementById('ssimV')!;
  const psnrV = document.getElementById('psnrV')!;
  const mseV = document.getElementById('mseV')!;

  ssimV.textContent = m.ssim.toFixed(4);
  ssimV.className = 'mv ' + (m.ssim >= 0.95 ? 'good' : m.ssim >= 0.8 ? 'mid' : 'bad');
  psnrV.textContent = m.psnr.toFixed(2);
  psnrV.className = 'mv ' + (m.psnr >= 40 ? 'good' : m.psnr >= 30 ? 'mid' : 'bad');
  mseV.textContent = m.mse.toFixed(2);

  ssimHistory.push(m.ssim);
  if (ssimHistory.length > MAX_HISTORY) ssimHistory.shift();
}

function drawChart() {
  const ctx = chartCtx;
  const W = chartCanvas.width;
  const H = chartCanvas.height;
  ctx.clearRect(0, 0, W, H);

  if (ssimHistory.length < 2) return;

  ctx.strokeStyle = '#58a6ff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  const step = W / (MAX_HISTORY - 1);
  const offset = (MAX_HISTORY - ssimHistory.length) * step;

  for (let i = 0; i < ssimHistory.length; i++) {
    const x = offset + i * step;
    const y = H - ssimHistory[i] * H;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // 0.95 阈值线
  ctx.strokeStyle = '#f0883e';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, H - 0.95 * H);
  ctx.lineTo(W, H - 0.95 * H);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawDiff(
  leftRGB: Uint8Array, rightRGB: Uint8Array, w: number, h: number,
  ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement
) {
  canvas.width = w;
  canvas.height = h;
  const imgData = ctx.createImageData(w, h);
  const d = imgData.data;
  for (let i = 0; i < w * h; i++) {
    const j = i * 4, k = i * 3;
    d[j]   = Math.min(Math.abs(leftRGB[k] - rightRGB[k]) * 5, 255);
    d[j+1] = Math.min(Math.abs(leftRGB[k+1] - rightRGB[k+1]) * 5, 255);
    d[j+2] = Math.min(Math.abs(leftRGB[k+2] - rightRGB[k+2]) * 5, 255);
    d[j+3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
}

/* ── 工具函数 ── */
function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function updateTimeDisplay() {
  const cur = formatTime(leftVideo?.currentTime || 0);
  const dur = formatTime(leftVideo?.duration || 0);
  document.getElementById('timeDisplay')!.textContent = `${cur} / ${dur}`;
}

/* ── 入口 ── */
async function main() {
  leftVideo = document.getElementById('leftVideo') as HTMLVideoElement;
  rightVideo = document.getElementById('rightVideo') as HTMLVideoElement;

  // 先注册文件选择事件(不依赖 Wasm)
  setupFileInput(
    document.getElementById('leftInput') as HTMLInputElement,
    document.getElementById('leftBox')!,
    document.getElementById('leftHint')!,
    true
  );
  setupFileInput(
    document.getElementById('rightInput') as HTMLInputElement,
    document.getElementById('rightBox')!,
    document.getElementById('rightHint')!,
    false
  );

  setupControls();

  // Wasm 异步初始化,失败不阻塞 UI
  try {
    await initWasm();
  } catch (e) {
    console.warn('⚠️ Wasm 初始化失败,对比功能不可用:', e);
  }
}

main();
