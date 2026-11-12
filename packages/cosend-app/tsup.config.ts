import { defineConfig } from "tsup";

// ESM (dist/index.js) and CommonJS (dist/index.cjs), each with its own declaration file
// (index.d.ts, index.d.cts). Node 20 is the floor in package.json `engines`.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: false,
  splitting: false,
});
