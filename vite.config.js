import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [tailwindcss(), sveltekit()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      // Files outside the module graph trigger a FULL PAGE RELOAD on change
      // (Vite's fallback for unimported files), which restarts the app
      // mid-use. Everything the frontend never imports must be ignored:
      // docs edits, the sidecar's Python, the library the sidecar writes
      // into (profile/mapping/rig saves would otherwise reload the app),
      // and test files (vitest runs them; the app doesn't import them).
      ignored: [
        "**/src-tauri/**",
        "**/docs/**",
        "**/library/**",
        "**/sidecar/**",
        "**/tests/**",
        "**/*.test.ts",
      ],
    },
  },
}));
