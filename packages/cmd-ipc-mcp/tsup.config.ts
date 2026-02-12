import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  dts: {
    entry: {
      index: 'src/index.ts',
    },
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  external: ['@coralstack/cmd-ipc', '@modelcontextprotocol/sdk', /^@modelcontextprotocol\/sdk\//],
})
