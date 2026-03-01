import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts', 'src/cli.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    // Add shims for __dirname and __filename in ESM
    shims: true,
});
