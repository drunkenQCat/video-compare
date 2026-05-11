# @video-compare/wasm

> WebAssembly library for real-time image frame comparison (SSIM/PSNR/MSE)

[![npm version](https://badge.fury.io/js/@video-compare%2Fwasm.svg)](https://badge.fury.io/js/@video-compare%2Fwasm)

## Installation

```bash
npm install @video-compare/wasm
```

## Usage

### Node.js

```js
const { VideoComparer } = require('@video-compare/wasm');

async function main() {
  const comparer = await VideoComparer.create();

  const metrics = await comparer.compare({
    left: leftRGBBuffer,   // Uint8Array, width × height × 3 bytes
    right: rightRGBBuffer,
    width: 1920,
    height: 1080,
  });

  console.log(`SSIM: ${metrics.ssim.toFixed(4)}`);
  console.log(`PSNR: ${metrics.psnr.toFixed(2)} dB`);
  console.log(`MSE:  ${metrics.mse.toFixed(2)}`);

  comparer.dispose();
}

main();
```

### Browser

Load the Wasm loader **before** using the package:

```html
<script src="node_modules/@video-compare/wasm/dist/video-compare.js"></script>
<script type="module">
  import { VideoComparer } from '@video-compare/wasm';

  const comparer = await VideoComparer.create();
  const result = await comparer.compare({ left, right, width, height });
  console.log(result);
</script>
```

## API

### `VideoComparer.create(config?)`

Create a new instance. `config` is optional:

| Option | Default | Description |
|--------|---------|-------------|
| `maxWidth` | 1920 | Max width before downsampling |
| `maxHeight` | 1080 | Max height before downsampling |
| `blockSize` | 16 | Block size for SSIM/MSE computation |

### `comparer.compare(input)`

Compare two frames. Returns `{ ssim, psnr, mse, width, height, downsampled }`.

### `comparer.dispose()`

Free Wasm resources. Instance cannot be reused after this call.

## Output Format

| Metric | Range | Interpretation |
|--------|-------|----------------|
| SSIM | 0–1 | ≥0.95 = identical, <0.80 = very different |
| PSNR | dB | ≥40 = excellent, <30 = poor |
| MSE | 0–65025 | Lower = more similar |

## License

MIT
