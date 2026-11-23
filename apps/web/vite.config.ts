/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The repo-root .env, shared with the api and pipeline scripts.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Hostnames `vite preview` accepts, from PREVIEW_ALLOWED_HOSTS in the
 * repo-root .env (or the shell): comma-separated, a leading dot allows
 * a domain and all its subdomains. Unset keeps Vite's default
 * (localhost and IP addresses only).
 */
function previewAllowedHosts(mode: string): string[] | undefined {
  // Only PREVIEW_* variables are read, and only into this config; none
  // of them reach the client bundle (that takes a VITE_ prefix).
  const value = loadEnv(mode, REPO_ROOT, 'PREVIEW_').PREVIEW_ALLOWED_HOSTS;
  const hosts = value
    ?.split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  return hosts && hosts.length > 0 ? hosts : undefined;
}

export default defineConfig(({ mode }) => {
  const allowedHosts = previewAllowedHosts(mode);
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    // proxy is inherited from server.proxy.
    preview: allowedHosts ? { allowedHosts } : {},
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      css: true,
    },
  };
});
