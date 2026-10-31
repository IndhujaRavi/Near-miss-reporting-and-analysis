import { defineConfig } from 'vitest/config';

// This proxy only connects to a fixed loopback Ollama service, never a user URL.
const proxy = { '/ollama': { target: 'http://127.0.0.1:11434', changeOrigin: true, rewrite: (path: string): string => path.replace(/^\/ollama/, '') } };
export default defineConfig({
  optimizeDeps: { include: ['@huggingface/transformers'] },
  worker: { format: 'es' },
  server: { proxy },
  preview: { proxy },
  test: { include: ['tests/**/*.test.ts'] },
});
