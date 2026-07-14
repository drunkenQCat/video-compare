"""Video compare: high-level API for headless server-side video comparison.

Install: pip install video-compare-py
Import:  from video_compare import compare_videos
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

import av
import numpy as np
from PIL import Image

from ._core import (
    cache_frame,
    clear_frame_cache,
    compare_cached_frames,
    get_diff_rgba,
    init_frame_cache,
    set_config,
    set_ema_alpha,
)

# Resolution presets
_RES_PRESETS = {
    "480p": (854, 480),
    "720p": (1280, 720),
    "1080p": (1280, 720),  # auto-downsampled to 720p
    "native": None,       # use video's native resolution
}


@dataclass
class FrameResult:
    """Per-frame comparison result."""
    index: int
    timestamp: float
    ssim: float
    psnr: float
    mse: float
    max_diff: float
    diff_rgba: bytes  # RGBA bytes, can be loaded with PIL.Image.frombytes


@dataclass
class CompareReport:
    """Full comparison report."""
    frames: list[FrameResult] = field(default_factory=list)
    avg_ssim: float = 0.0
    avg_psnr: float = 0.0
    avg_mse: float = 0.0
    min_ssim: float = 0.0
    max_ssim: float = 0.0
    frame_count: int = 0
    elapsed: float = 0.0
    resolution: str = ""

    def __repr__(self) -> str:
        return (
            f"CompareReport(frames={self.frame_count}, "
            f"avg_ssim={self.avg_ssim:.4f}, avg_psnr={self.avg_psnr:.2f}dB, "
            f"elapsed={self.elapsed:.1f}s)"
        )


def _decode_frame_to_rgb(frame: av.VideoFrame) -> tuple[bytes, int, int]:
    """Convert PyAV VideoFrame to RGB bytes at native resolution.
    
    WASM will auto-downsample if resolution exceeds 1280×720.
    Returns (rgb_bytes, width, height).
    """
    arr = frame.to_ndarray(format="rgb24")
    h, w = arr.shape[:2]
    return arr.tobytes(), w, h


def compare_videos(
    left: str | Path,
    right: str | Path,
    resolution: str = "720p",
    ema_alpha: float = 1.0,
    max_frames: int | None = None,
    fps: float | None = None,
    output_video: str | Path | None = None,
    progress_callback=None,
) -> CompareReport:
    """Compare two video files frame by frame.

    Args:
        left: Path to reference video file.
        right: Path to comparison video file.
        resolution: Processing resolution preset ("480p", "720p", "1080p", "native").
        ema_alpha: EMA smoothing factor (1.0=off, 0.3=moderate, 0.05=strong).
        max_frames: Maximum frames to process (None = all).
        fps: Frame extraction rate (None = native fps, 5.0 = 5fps sampling).
        output_video: Path to write diff video (None = no video output).
        progress_callback: Optional callback(frame_index, total_frames) called every 10 frames.

    Returns:
        CompareReport with per-frame metrics and diff data.

    Example:
        >>> report = compare_videos("Original.mov", "Modify.mov",
        ...                         fps=5, max_frames=50, output_video="diff.mp4")
        >>> print(report)
        CompareReport(frames=50, avg_ssim=0.9898, avg_psnr=69.26dB, elapsed=4.2s)
        >>> # Access individual frames
        >>> frame = report.frames[35]
        >>> print(f"Frame 35: SSIM={frame.ssim:.4f}")
        >>> # Save diff image
        >>> from PIL import Image
        >>> img = Image.frombytes("RGBA", (1280, 720), frame.diff_rgba)
        >>> img.save("diff_35.png")
    """
    left_path = str(left)
    right_path = str(right)

    # Determine processing resolution
    target = _RES_PRESETS.get(resolution)
    if target is None:
        # Use native resolution (will auto-downsample in WASM if > 1280×720)
        target = _RES_PRESETS["720p"]  # fallback, actual size determined from video

    # Configure WASM module
    set_config(target[0], target[1], 16)
    set_ema_alpha(ema_alpha)

    # Open both videos
    container_left = av.open(left_path)
    container_right = av.open(right_path)

    stream_left = container_left.streams.video[0]
    stream_right = container_right.streams.video[0]

    # Get native resolution
    native_w = stream_left.width
    native_h = stream_left.height

    # Determine actual processing resolution
    if resolution == "native":
        proc_w, proc_h = native_w, native_h
    else:
        proc_w, proc_h = target

    # Calculate frame skip for fps sampling
    native_fps = float(stream_left.average_rate) if stream_left.average_rate else 24.0
    skip = 1
    if fps is not None and fps < native_fps:
        skip = max(1, round(native_fps / fps))

    # Get total frames (approximate)
    total_frames = stream_left.frames or 0
    if max_frames:
        total_frames = min(total_frames, max_frames)

    # Setup diff video output
    output_container = None
    output_stream = None
    if output_video:
        output_container = av.open(str(output_video), mode="w")
        output_stream = output_container.add_stream("libx264", rate=24)
        # Output at processing resolution (after auto-downsample)
        out_w = min(proc_w, 1280)
        out_h = min(proc_h, 720)
        if proc_w > 1280 or proc_h > 720:
            scale = min(1280 / proc_w, 720 / proc_h)
            out_w = round(proc_w * scale)
            out_h = round(proc_h * scale)
        output_stream.width = out_w
        output_stream.height = out_h
        output_stream.pix_fmt = "yuv420p"

    report = CompareReport(resolution=f"{proc_w}x{proc_h}")
    ssim_values: list[float] = []

    start_time = time.perf_counter()

    try:
        # Iterate through frames in sync
        frame_idx = 0  # decoded frame counter
        processed_idx = 0  # processed frame counter
        iterator_left = container_left.decode(stream_left)
        iterator_right = container_right.decode(stream_right)

        for left_frame, right_frame in zip(iterator_left, iterator_right):
            # Skip frames for fps sampling
            if processed_idx > 0 and frame_idx % skip != 0:
                frame_idx += 1
                continue

            if max_frames and processed_idx >= max_frames:
                break

            # Decode frames to RGB bytes at native resolution (WASM auto-downsamples)
            left_rgb, proc_w, proc_h = _decode_frame_to_rgb(left_frame)
            right_rgb, _, _ = _decode_frame_to_rgb(right_frame)

            # Cache frames and compare
            init_frame_cache(proc_w, proc_h)
            cache_frame(0, left_rgb, proc_w, proc_h)
            cache_frame(1, right_rgb, proc_w, proc_h)
            ssim, psnr, mse, max_diff = compare_cached_frames()
            diff_rgba = get_diff_rgba()

            # Calculate timestamp
            timestamp = left_frame.pts * stream_left.time_base if left_frame.pts else 0.0

            # Write to diff video
            if output_stream:
                # Derive actual output dimensions from rgba data
                pixel_count = len(diff_rgba) // 4
                aspect_ratio = proc_w / proc_h
                out_h = round(np.sqrt(pixel_count / aspect_ratio))
                out_w = round(pixel_count / out_h)
                # Create VideoFrame from RGBA data
                diff_arr = np.frombuffer(diff_rgba, dtype=np.uint8).reshape(out_h, out_w, 4)
                # Convert RGBA → RGB for encoding
                diff_rgb = diff_arr[:, :, :3]
                out_frame = av.VideoFrame.from_ndarray(diff_rgb, format="rgb24")
                out_frame = out_frame.reformat(format="yuv420p", width=out_w, height=out_h)
                for packet in output_stream.encode(out_frame):
                    output_container.mux(packet)

            result = FrameResult(
                index=processed_idx,
                timestamp=timestamp,
                ssim=ssim,
                psnr=psnr,
                mse=mse,
                max_diff=max_diff,
                diff_rgba=diff_rgba,
            )
            report.frames.append(result)
            ssim_values.append(ssim)

            # Progress callback
            if progress_callback and processed_idx % 10 == 0:
                progress_callback(processed_idx, total_frames)

            processed_idx += 1
            frame_idx += 1

        # Flush encoder
        if output_stream:
            for packet in output_stream.encode():
                output_container.mux(packet)
    finally:
        container_left.close()
        container_right.close()
        if output_container:
            output_container.close()
        clear_frame_cache()

    # Compute summary statistics
    elapsed = time.perf_counter() - start_time
    report.frame_count = len(report.frames)
    report.elapsed = elapsed

    if ssim_values:
        report.avg_ssim = sum(ssim_values) / len(ssim_values)
        report.min_ssim = min(ssim_values)
        report.max_ssim = max(ssim_values)
        report.avg_psnr = sum(f.psnr for f in report.frames) / len(report.frames)
        report.avg_mse = sum(f.mse for f in report.frames) / len(report.frames)

    return report


def compare_images(
    left: str | Path,
    right: str | Path,
) -> FrameResult:
    """Compare two image files.

    Args:
        left: Path to left image.
        right: Path to right image.

    Returns:
        FrameResult with metrics and diff data.

    Example:
        >>> result = compare_images("a.png", "b.png")
        >>> print(f"SSIM: {result.ssim:.4f}")
    """
    img_left = Image.open(left).convert("RGB")
    img_right = Image.open(right).convert("RGB")

    if img_left.size != img_right.size:
        raise ValueError(
            f"Image dimensions must match: {img_left.size} vs {img_right.size}"
        )

    w, h = img_left.size
    left_rgb = np.array(img_left).tobytes()
    right_rgb = np.array(img_right).tobytes()

    init_frame_cache(w, h)
    cache_frame(0, left_rgb, w, h)
    cache_frame(1, right_rgb, w, h)
    ssim, psnr, mse, max_diff = compare_cached_frames()
    diff_rgba = get_diff_rgba()
    clear_frame_cache()

    return FrameResult(
        index=0,
        timestamp=0.0,
        ssim=ssim,
        psnr=psnr,
        mse=mse,
        max_diff=max_diff,
        diff_rgba=diff_rgba,
    )
