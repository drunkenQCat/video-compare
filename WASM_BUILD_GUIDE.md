# WebAssembly Build Guide

This document explains how to build and use the WebAssembly version of video-compare.

## Overview

The WebAssembly build allows running video-compare in web browsers. It uses:
- **Emscripten** to compile C++ to WebAssembly
- **SDL2 ports** (built into Emscripten) for rendering
- **stb_image** for loading images (PNG, JPG, BMP, etc.)
- **No FFmpeg** to keep the binary size small (<2MB)

## Prerequisites

### Option 1: Use GitHub Actions (Recommended)

The easiest way to build is using the CI pipeline:

```bash
# Push to the wasm branch
git push origin wasm

# Wait for CI to complete (check at https://github.com/drunkenQCat/video-compare/actions)
# Download the artifacts from the "Wasm Build" workflow
```

### Option 2: Local Build

To build locally, you need Emscripten SDK:

#### Install Emscripten

```bash
# Clone emsdk
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk

# Install and activate latest
./emsdk install latest
./emsdk activate latest

# Activate PATH (or add to your shell profile)
./emsdk_env.bat  # Windows
source ./emsdk_env.sh  # Linux/macOS
```

#### Build

```bash
# Create build directory
mkdir build-wasm && cd build-wasm

# Configure with CMake
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release

# Build
emmake make -j$(nproc)
```

## Output Files

After building, you'll get these files in `build-wasm/`:

| File | Size | Purpose |
|------|------|---------|
| `video-compare.wasm` | ~1-2MB | The WebAssembly binary |
| `video-compare.js` | ~50-100KB | JavaScript loader and glue code |
| `video-compare.html` | ~5KB | Auto-generated test page (optional) |

## Using in Your Web Application

### 1. Simple Integration

Copy the build files to your web server:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Video Compare Wasm</title>
</head>
<body>
    <!-- Emscripten will create a canvas here -->
    <script src="video-compare.js"></script>
    <script>
        // Module loads automatically
        VideoCompareModule().then((module) => {
            console.log('Wasm module ready!');
        });
    </script>
</body>
</html>
```

### 2. Advanced Integration (Custom Canvas)

If you want to control the rendering:

```html
<canvas id="myCanvas" width="1280" height="720"></canvas>

<script src="video-compare.js"></script>
<script>
    const moduleConfig = {
        canvas: document.getElementById('myCanvas')
    };
    
    VideoCompareModule(moduleConfig).then((module) => {
        // Module is ready
        console.log('Canvas is set up!');
    });
</script>
```

### 3. Loading Images from Browser

To load images from the user's file system:

```javascript
// Initialize module
const Module = await VideoCompareModule();

// Load image files into Emscripten's virtual filesystem
const leftImageBytes = await fileToArrayBuffer(leftFileInput.files[0]);
const rightImageBytes = await fileToArrayBuffer(rightFileInput.files[0]);

Module.FS.writeFile('/left.png', new Uint8Array(leftImageBytes));
Module.FS.writeFile('/right.png', new Uint8Array(rightImageBytes));

// Call the C++ function to load images
const result = Module.ccall(
    'load_images',           // function name
    'number',                // return type (int)
    ['string', 'string'],    // argument types
    ['/left.png', '/right.png']
);

if (result === 0) {
    console.log('Images loaded successfully!');
}

// Helper function
function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}
```

## Browser Compatibility

| Browser | Version | Notes |
|---------|---------|-------|
| Chrome | 57+ | Full support |
| Firefox | 52+ | Full support |
| Safari | 11+ | Full support |
| Edge | 16+ | Full support |

### Required Features

- **WebAssembly** (enabled by default in modern browsers)
- **SharedArrayBuffer** (optional, for multi-threading)
  - Requires HTTPS
  - Requires HTTP headers:
    ```
    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp
    ```

## Testing

### Quick Test

Open the auto-generated HTML file:

```bash
# Serve with any HTTP server
python -m http.server 8080
# Open http://localhost:8080/build-wasm/video-compare.html
```

### Using Test Pages

We provide two test pages in the repository:

1. **test-wasm.html** - Basic test page with file upload
2. **wasm-integration-demo.html** - Advanced demo with integration guide

```bash
# Copy test pages to build directory
cp test-wasm.html build-wasm/
cp wasm-integration-demo.html build-wasm/

# Serve and test
python -m http.server 8080
# Open http://localhost:8080/test-wasm.html
```

### Verification Checklist

- [ ] Wasm file loads without errors
- [ ] Images can be uploaded
- [ ] Split-screen display works
- [ ] Canvas rendering is smooth
- [ ] No console errors
- [ ] Memory usage is reasonable (<100MB)

## Limitations

### What Works ✅

- Image loading (PNG, JPG, BMP, WebP, GIF)
- Split-screen comparison
- Zoom and pan
- Image similarity metrics (SSIM, PSNR)
- Histograms and scopes (if compiled with filter support)

### What Doesn't Work ❌

- **Video playback** (FFmpeg removed to reduce size)
- Hardware acceleration (not available in browsers)
- FFmpeg filters (would require ffmpeg.wasm)

### Workarounds

If you need video support:
1. Use **ffmpeg.wasm** separately to decode frames
2. Pass decoded frames to video-compare as images
3. See [ffmpeg.wasm documentation](https://github.com/ffmpegwasm/ffmpeg.wasm)

## Troubleshooting

### "Module not found" Error

Make sure you're serving files over HTTP (not file://):

```bash
# Wrong
file:///path/to/video-compare.html

# Correct
http://localhost:8080/video-compare.html
```

### "SharedArrayBuffer is not defined"

Add these headers to your server:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

For Python's http.server, create `server.py`:

```python
from http.server import HTTPServer, SimpleHTTPRequestHandler

class COOPHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

HTTPServer(('', 8080), COOPHandler).serve_forever()
```

### Wasm File Too Large

Optimize the build:

```bash
# Use release mode
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release

# Additional optimization flags (add to CMakeLists.txt)
set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} -O3 --closure 1")
```

### SDL Canvas Not Showing

Check:
1. Canvas element exists in HTML
2. No JavaScript errors in console
3. Module loaded successfully
4. SDL_Init() succeeded (check logs)

## CI/CD Integration

### GitHub Actions

The repository includes a workflow that builds on push to `wasm-*` branches:

```yaml
# .github/workflows/wasm-build.yml
on:
  push:
    branches:
      - "wasm-*"
      - "feature/wasm"
```

### Download Artifacts

```bash
# Using gh CLI
gh run download --repo drunkenQCat/video-compare

# Or manually from GitHub Actions page
# https://github.com/drunkenQCat/video-compare/actions
```

## Performance Tips

1. **Use requestAnimationFrame** for smooth rendering
2. **Minimize FS operations** - cache images in memory
3. **Use OffscreenCanvas** for background rendering (Chrome 69+)
4. **Web Workers** for heavy computations (if multi-threading enabled)
5. **Compress Wasm file** with gzip or brotli on the server

## Next Steps

- [ ] Add video support with ffmpeg.wasm
- [ ] Implement custom UI controls
- [ ] Add export functionality
- [ ] Support more image formats
- [ ] Add VMAF calculation

## Support

- Issues: https://github.com/drunkenQCat/video-compare/issues
- Discussions: https://github.com/drunkenQCat/video-compare/discussions
