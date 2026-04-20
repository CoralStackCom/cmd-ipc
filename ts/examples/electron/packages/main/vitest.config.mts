import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true, // Allows using `describe`, `it`, etc. without importing
    environment: 'node', // Use Node.js environment
    coverage: {
      reporter: ['text', 'lcov'],
    },
  },
})
