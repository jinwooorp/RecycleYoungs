import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const demoApiProxy = process.env.RECYCLEYOUNGS_DEMO_API_PROXY
if (demoApiProxy && !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(demoApiProxy)) {
  throw new Error('Demo API proxy must be an explicit loopback HTTP endpoint')
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: {
      '/api': demoApiProxy ?? 'http://localhost:8080',
    },
  },
})
