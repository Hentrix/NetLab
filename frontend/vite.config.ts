import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: '/next/',
  plugins: [vue()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../web/next', emptyOutDir: true, target: 'es2022' },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/icons': 'http://127.0.0.1:8080',
      '/novnc': 'http://127.0.0.1:8080',
      '/vnc': {target:'http://127.0.0.1:8080',ws:true}
    }
  }
})
