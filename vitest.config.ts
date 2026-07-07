import { defineConfig } from "vitest/config";

// Unit tests only — pure TS modules (npy parser, IPC zod schemas). No Svelte or
// Tauri plugin: those targets need no DOM, so the suite stays fast and simple.
// Runes/component tests, when added, get their own Svelte-plugin config.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
