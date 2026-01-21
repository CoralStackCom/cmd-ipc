import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Force ESM resolution for workspace package (fixes worker bundling)
      '@coralstack/cmd-ipc': `${__dirname}../../dist/index.mjs`,
    },
  },
  optimizeDeps: {
    include: ['reflect-metadata'],
  },
})
