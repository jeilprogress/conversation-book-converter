import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative paths make the same build work on GitHub Pages under any repository name.
  base: './',
})
