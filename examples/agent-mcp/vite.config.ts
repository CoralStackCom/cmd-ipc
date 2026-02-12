import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'

import { mcpProxyMiddleware, spaFallbackMiddleware } from './src/middleware'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mcp-cors-proxy',
      configureServer(server) {
        // Add the MCP proxy middleware before other middlewares
        // Not returning a function ensures this runs before Vite's internal middleware
        server.middlewares.use(mcpProxyMiddleware())
        // Add SPA fallback for OAuth callbacks and other routes
        server.middlewares.use(spaFallbackMiddleware())
      },
    },
  ],
  resolve: {
    alias: {
      // Force ESM resolution for workspace packages (fixes worker bundling)
      '@coralstack/cmd-ipc': `${__dirname}../../packages/cmd-ipc/dist/index.mjs`,
      '@coralstack/cmd-ipc-mcp': `${__dirname}../../packages/cmd-ipc-mcp/dist/index.mjs`,
    },
  },
  optimizeDeps: {
    include: ['reflect-metadata'],
  },
})
