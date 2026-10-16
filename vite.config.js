import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// This release's number and what is new in it (src/version.json), also
// published as version.json beside the page: an open app reads it to offer
// a newer release, as the phone app does
const version = JSON.parse(readFileSync(new URL('./src/version.json', import.meta.url), 'utf8'))

export default defineConfig({
  base: '/sawt-alahzan-app/',
  build: {
    // hls.js (~500 kB) is its own chunk, loaded only for the rare streamed track
    chunkSizeWarningLimit: 600,
  },
  plugins: [{
    name: 'version-json',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify(version, null, 1)}\n` })
    },
  }],
})
