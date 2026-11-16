import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The shared copy (VITE_STATIC=1) is served from a sub-folder with no server behind it, so every path
// the code names from the site root (textures, the intro picture) is made relative to the page.
const relativePaths = {
  name: 'relative-paths-for-the-shared-copy',
  transform(code: string, id: string) {
    if (process.env.VITE_STATIC !== '1' || !/[\\/]src[\\/].*\.(ts|tsx)$/.test(id)) return null
    return code.replace(/(['"`(])\/(textures|intro)\//g, '$1./$2/')
  },
}

export default defineConfig({
  plugins: [relativePaths, react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5174, proxy: { '/api': 'http://127.0.0.1:8100' } },
})
