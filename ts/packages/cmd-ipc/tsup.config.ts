import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'testing/index': 'src/testing/index.ts',
    'cli/index': 'src/cli/index.ts',
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  dts: {
    entry: {
      index: 'src/index.ts',
      'testing/index': 'src/testing/index.ts',
    },
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  external: ['@valibot/to-json-schema', 'reflect-metadata', 'valibot'],
})
