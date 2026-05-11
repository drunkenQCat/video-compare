import typescript from 'rollup-plugin-typescript2';
import resolve from '@rollup/plugin-node-resolve';

export default [
  // CommonJS bundle
  {
    input: 'src/VideoComparer.ts',
    output: {
      file: 'dist/index.js',
      format: 'cjs',
      sourcemap: true
    },
    plugins: [
      resolve(),
      typescript({
        tsconfig: './tsconfig.json',
        useTsconfigDeclarationDir: true
      })
    ],
    // 不打包 .wasm / .js (Emscripten loader)，让用户自行加载
    external: [/\.wasm$/, /video-compare\.js$/]
  },
  // ES Modules bundle
  {
    input: 'src/VideoComparer.ts',
    output: {
      file: 'dist/index.mjs',
      format: 'esm',
      sourcemap: true
    },
    plugins: [
      resolve(),
      typescript({
        tsconfig: './tsconfig.json',
        useTsconfigDeclarationDir: true
      })
    ],
    external: [/\.wasm$/, /video-compare\.js$/]
  }
];
