import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // A stdio bin, not a library — ESM only, no .d.ts needed.
  format: ['esm'],
  clean: true,
  target: 'node18',
  sourcemap: true,
});
