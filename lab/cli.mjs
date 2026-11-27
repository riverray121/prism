// Lab entry: loads lab/main.ts through Vite's module loader so the lab's
// TypeScript resolves `$lib` exactly as the app does, with no separate
// TypeScript runner.
//   pnpm lab generate | report | render ...
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  configFile: false,
  root,
  logLevel: "error",
  appType: "custom",
  resolve: {
    alias: { $lib: fileURLToPath(new URL("../src/lib", import.meta.url)) },
  },
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
let code = 0;
try {
  const mod = await server.ssrLoadModule("/lab/main.ts");
  await mod.main(process.argv.slice(2));
} catch (err) {
  console.error(err);
  code = 1;
} finally {
  await server.close();
}
process.exit(code);
