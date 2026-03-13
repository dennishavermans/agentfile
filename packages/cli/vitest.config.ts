import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@agentfile/core': resolve(__dirname, '../core/src/index.ts')
    }
  },
  test: {
    environment: 'node'
  }
})
