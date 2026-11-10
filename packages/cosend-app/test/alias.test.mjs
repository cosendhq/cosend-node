import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import * as alias from "cosend-app";
import * as cosend from "cosend";

const require = createRequire(import.meta.url);

test("import from cosend-app gives the same exports as cosend", () => {
  assert.deepEqual(Object.keys(alias).sort(), Object.keys(cosend).sort());
  for (const name of Object.keys(cosend)) assert.equal(alias[name], cosend[name], name);
});

test("require('cosend-app') gives the same exports as require('cosend')", () => {
  const aliasCjs = require("cosend-app");
  const cosendCjs = require("cosend");
  assert.deepEqual(Object.keys(aliasCjs).sort(), Object.keys(cosendCjs).sort());
  for (const name of Object.keys(cosendCjs)) assert.equal(aliasCjs[name], cosendCjs[name], name);
});

test("package.json depends on cosend ^1.0.0 and nothing else", () => {
  const pkg = require("../package.json");
  assert.deepEqual(pkg.dependencies, { cosend: "^1.0.0" });
});
