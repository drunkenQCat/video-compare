"""Quick test: compare two videos with the video_compare Python package."""
from video_compare import compare_videos
from PIL import Image
import av
import numpy as np

print("Loading videos...")
report = compare_videos(
    left=r"C:\CreativeProjects\CFAI_MatchBoxTest\Original.mov",
    right=r"C:\CreativeProjects\CFAI_MatchBoxTest\Modify.mov",
    resolution="720p",
    fps=5,
    max_frames=50,
    output_video="diff_output.mp4",
)

print(report)
print(f"Frames: {report.frame_count}")
print(f"Avg SSIM: {report.avg_ssim:.4f}")
print(f"Avg PSNR: {report.avg_psnr:.2f} dB")
print(f"Avg MSE: {report.avg_mse:.2f}")
print(f"Min SSIM: {report.min_ssim:.4f}")
print(f"Max SSIM: {report.max_ssim:.4f}")
print(f"Elapsed: {report.elapsed:.1f}s")
print(f"FPS: {report.frame_count / report.elapsed:.1f}")

# Show frames with differences
print("\nFrames with SSIM < 1.0:")
for f in report.frames:
    if f.ssim < 1.0:
        print(f"  Frame {f.index}: SSIM={f.ssim:.4f} PSNR={f.psnr:.2f}dB MSE={f.mse:.2f}")

# Save a diff image from a frame with differences
diff_frames = [f for f in report.frames if f.ssim < 1.0]
if diff_frames:
    f = diff_frames[0]
    # Derive dimensions from rgba size
    pixel_count = len(f.diff_rgba) // 4
    aspect_ratio = 1920 / 1080
    out_h = round(np.sqrt(pixel_count / aspect_ratio))
    out_w = round(pixel_count / out_h)
    print(f"\nSaving diff image from frame {f.index} ({out_w}x{out_h})")
    img = Image.frombytes("RGBA", (out_w, out_h), f.diff_rgba)
    img.save("diff_test.png")
    print("Saved diff_test.png and diff_output.mp4")
