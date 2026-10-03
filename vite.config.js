import { defineConfig } from 'vite'

export default defineConfig({
  base: '/sawt-alahzan-app/',
  build: {
    // hls.js (~500 kB) is its own chunk, loaded only for the rare streamed track
    chunkSizeWarningLimit: 600,
  },
})
