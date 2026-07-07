import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests only — pure TS modules and .svelte.ts runes state modules. The
// Svelte plugin compiles the runes syntax; under the node environment that is
// the server transform, so $state stores are plain objects (no reactivity),
// which is all the reducer tests need. No DOM, no .svelte component rendering.
export default defineConfig({
  plugins: [svelte()],
  resolve: {
    // Stand-in for SvelteKit's $lib alias, which only its own plugin provides.
    alias: { $lib: fileURLToPath(new URL("./src/lib", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
