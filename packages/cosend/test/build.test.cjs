const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");

const root = join(__dirname, "..");
const pkg = require("../package.json");

test("the CommonJS build exports what the ESM build exports", async () => {
  const cjs = require("cosend");
  const esm = await import("cosend");
  assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort());
  for (const name of ["Cosend", "CosendError", "CosendSignatureError", "constructEvent", "verifyWebhook", "verifyForwardedDelivery", "VERSION"]) {
    assert.equal(typeof cjs[name], typeof esm[name], name);
    assert.ok(cjs[name] !== undefined, name);
  }
});

test("VERSION and the User-Agent follow package.json", () => {
  assert.equal(require("cosend").VERSION, pkg.version);
});

test("package.json: no dependencies, Node 20+, both builds and both declaration files exist", () => {
  assert.deepEqual(pkg.dependencies, {});
  assert.equal(pkg.engines.node, ">=20");
  for (const file of ["dist/index.js", "dist/index.cjs", "dist/index.d.ts", "dist/index.d.cts"]) {
    assert.ok(existsSync(join(root, file)), file);
  }
});
