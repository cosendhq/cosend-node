import { defineConfig } from "tsup";

// The alias is one line, `export * from "cosend"`, built as ESM and CommonJS with types.
// `cosend` is a dependency, so tsup leaves it external: nothing of it is copied in.
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
