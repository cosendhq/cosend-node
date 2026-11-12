import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CosendSignatureError,
  constructEvent,
  verifyForwardedDelivery,
  verifyWebhook,
} from "../dist/index.js";
import {
  EVENT_BODY,
  FORWARDED_BODY,
  FWD_SECRET,
  FWD_SIG,
  SECRET_NEW,
  SECRET_OLD,
  T,
  V1_NEW,
  V1_OLD,
} from "./fixtures.mjs";

const NOW = T * 1000;
const HEADER = `t=${T},v1=${V1_NEW}`;

test("1. a v1 computed by openssl verifies (string and raw bytes)", () => {
  assert.equal(verifyWebhook(EVENT_BODY, HEADER, SECRET_NEW, { now: NOW }), true);
  assert.equal(verifyWebhook(Buffer.from(EVENT_BODY, "utf8"), HEADER, SECRET_NEW, { now: NOW }), true);
  assert.equal(
    verifyWebhook(new TextEncoder().encode(EVENT_BODY), `t=${T},v1=${V1_OLD}`, SECRET_OLD, { now: NOW }),
    true,
  );
});

test("2. one byte of the body changed: false", () => {
  const changed = EVENT_BODY.replace("Is my order", "Is my ordes");
  assert.equal(changed.length, EVENT_BODY.length);
  assert.equal(verifyWebhook(changed, HEADER, SECRET_NEW, { now: NOW }), false);
  const bytes = Buffer.from(EVENT_BODY, "utf8");
  bytes[bytes.length - 2] ^= 0x01;
  assert.equal(verifyWebhook(bytes, HEADER, SECRET_NEW, { now: NOW }), false);
});

test("3. the body parsed and re-serialized with different whitespace: false (the raw-body rule)", () => {
  const reserialized = JSON.stringify(JSON.parse(EVENT_BODY), null, 2);
  assert.deepEqual(JSON.parse(reserialized), JSON.parse(EVENT_BODY));
  assert.equal(verifyWebhook(reserialized, HEADER, SECRET_NEW, { now: NOW }), false);
});

test("4. tolerance: 301 s old is false, 299 s is true, toleranceSeconds moves the boundary", () => {
  const at = (seconds) => ({ now: (T + seconds) * 1000 });
  assert.equal(verifyWebhook(EVENT_BODY, HEADER, SECRET_NEW, at(301)), false);
  assert.equal(verifyWebhook(EVENT_BODY, HEADER, SECRET_NEW, at(299)), true);
  assert.equal(verifyWebhook(EVENT_BODY, HEADER, SECRET_NEW, at(-301)), false, "301 s in the future");
  assert.equal(verifyWebhook(EVENT_BODY, HEADER, SECRET_NEW, { ...at(301), toleranceSeconds: 600 }), true);
  assert.equal(verifyWebhook(EVENT_BODY, HEADER, SECRET_NEW, { ...at(61), toleranceSeconds: 60 }), false);
  assert.equal(verifyWebhook(EVENT_BODY, HEADER, SECRET_NEW, { ...at(59), toleranceSeconds: 60 }), true);
  assert.equal(
    verifyWebhook(EVENT_BODY, HEADER, SECRET_NEW, { now: NOW, toleranceSeconds: Number.NaN }),
    false,
    "a NaN tolerance must not switch the age check off",
  );
});

test("5. two v1 values where only the second matches: true (rotation)", () => {
  const rotating = `t=${T},v1=${V1_OLD},v1=${V1_NEW}`;
  assert.equal(verifyWebhook(EVENT_BODY, rotating, SECRET_NEW, { now: NOW }), true);
  assert.equal(verifyWebhook(EVENT_BODY, rotating, SECRET_OLD, { now: NOW }), true);
  // Order and spacing of the pairs do not matter.
  assert.equal(verifyWebhook(EVENT_BODY, `v1=${V1_OLD}, v1=${V1_NEW}, t=${T}`, SECRET_NEW, { now: NOW }), true);
});

test("6. secret as an array where only the second secret matches: true", () => {
  assert.equal(verifyWebhook(EVENT_BODY, HEADER, [SECRET_OLD, SECRET_NEW], { now: NOW }), true);
  assert.equal(verifyWebhook(EVENT_BODY, HEADER, ["whsec_wrong", SECRET_OLD], { now: NOW }), false);
});

test("7. missing header, no t, no v1, non-numeric t, empty secret: all false, nothing throws", () => {
  const cases = [
    [EVENT_BODY, undefined, SECRET_NEW],
    [EVENT_BODY, "", SECRET_NEW],
    [EVENT_BODY, "garbage", SECRET_NEW],
    [EVENT_BODY, `v1=${V1_NEW}`, SECRET_NEW],
    [EVENT_BODY, `t=${T}`, SECRET_NEW],
    [EVENT_BODY, `t=${T},v1=`, SECRET_NEW],
    [EVENT_BODY, `t=abc,v1=${V1_NEW}`, SECRET_NEW],
    [EVENT_BODY, `t=${T}.5,v1=${V1_NEW}`, SECRET_NEW],
    [EVENT_BODY, `t=-${T},v1=${V1_NEW}`, SECRET_NEW],
    [EVENT_BODY, HEADER, ""],
    [EVENT_BODY, HEADER, []],
    [EVENT_BODY, HEADER, [""]],
    [EVENT_BODY, HEADER, undefined],
    [JSON.parse(EVENT_BODY), HEADER, SECRET_NEW], // a parsed object is not a raw body
  ];
  for (const [body, header, secret] of cases) {
    assert.doesNotThrow(() => verifyWebhook(body, header, secret, { now: NOW }));
    assert.equal(verifyWebhook(body, header, secret, { now: NOW }), false, `header ${String(header)}`);
  }
});

test("8. constructEvent returns the envelope, or throws CosendSignatureError without body or secret", () => {
  const event = constructEvent(EVENT_BODY, HEADER, SECRET_NEW, { now: NOW });
  assert.deepEqual(event, JSON.parse(EVENT_BODY));
  assert.equal(event.type, "message.received");
  assert.equal(event.data.object.id, "msg_01K9Q3Z8M4X7C2N6V5B1T0RYHC");
  assert.deepEqual(constructEvent(Buffer.from(EVENT_BODY), HEADER, [SECRET_OLD, SECRET_NEW], { now: NOW }), event);

  for (const header of [undefined, `t=${T},v1=${V1_OLD}`]) {
    assert.throws(
      () => constructEvent(EVENT_BODY, header, SECRET_NEW, { now: NOW }),
      (err) => {
        assert.ok(err instanceof CosendSignatureError);
        assert.ok(err instanceof Error);
        assert.equal(err.name, "CosendSignatureError");
        assert.ok(!err.message.includes(SECRET_NEW), "message must not carry the secret");
        assert.ok(!err.message.includes(SECRET_NEW.slice(6)), "nor the secret without its prefix");
        assert.ok(!err.message.includes(EVENT_BODY), "message must not carry the body");
        assert.ok(!err.message.includes("Is my order on its way?"), "nor any part of it");
        return true;
      },
    );
  }
});

// Verbatim from https://cosend.app/webhooks, "node · verify a forwarded delivery", read 10 Nov 2026,
// wrapped in a function so the test can call it.
function siteSnippet(rawBody, header, SIGNING_SECRET) {
  // the raw request body, not the parsed object
  const expected = crypto
    .createHmac("sha256", SIGNING_SECRET)
    .update(rawBody)
    .digest("hex");

  // header: the x-cosend-signature-256 request header
  const got = header.slice("sha256=".length);
  return got.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

test("9. verifyForwardedDelivery matches the cosend.app/webhooks snippet; false without sha256=", () => {
  const header = `sha256=${FWD_SIG}`;
  const tampered = FORWARDED_BODY.replace("919876543210", "919876543211");
  const cases = [
    [FORWARDED_BODY, header, FWD_SECRET, true],
    [Buffer.from(FORWARDED_BODY), header, FWD_SECRET, true],
    [tampered, header, FWD_SECRET, false],
    [FORWARDED_BODY, header, "another-secret", false],
    [FORWARDED_BODY, `sha256=${"0".repeat(64)}`, FWD_SECRET, false],
  ];
  for (const [body, h, secret, expected] of cases) {
    assert.equal(siteSnippet(body, h, secret), expected, "the site's snippet");
    assert.equal(verifyForwardedDelivery(body, h, secret), expected, "verifyForwardedDelivery");
  }
  assert.equal(verifyForwardedDelivery(FORWARDED_BODY, header, ["old-secret", FWD_SECRET]), true);
  assert.equal(verifyForwardedDelivery(FORWARDED_BODY, FWD_SIG, FWD_SECRET), false, "no sha256= prefix");
  assert.equal(verifyForwardedDelivery(FORWARDED_BODY, undefined, FWD_SECRET), false);
  assert.equal(verifyForwardedDelivery(FORWARDED_BODY, header, ""), false);
});

// 17. A delivery recorded while both of an endpoint's secrets were signing, checked at run time and
// never committed: save the raw body to a file, then set COSEND_ROTATION_BODY_FILE to its path,
// COSEND_ROTATION_SIGNATURE to its Cosend-Signature header (two v1= values) and
// COSEND_ROTATION_SECRETS to the old and the new secret, comma-separated.
const ROTATION = ["COSEND_ROTATION_BODY_FILE", "COSEND_ROTATION_SIGNATURE", "COSEND_ROTATION_SECRETS"];

test(
  "17. a header recorded during a real rotation verifies with either secret",
  { skip: ROTATION.every((name) => process.env[name]) ? false : `set ${ROTATION.join(", ")} to check one` },
  () => {
    const body = readFileSync(process.env.COSEND_ROTATION_BODY_FILE);
    const header = process.env.COSEND_ROTATION_SIGNATURE;
    const secrets = process.env.COSEND_ROTATION_SECRETS.split(",").map((secret) => secret.trim());
    const v1 = header.split(",").filter((pair) => pair.trim().startsWith("v1="));
    assert.equal(v1.length, 2, "a header from a rotation carries two v1= values");
    assert.equal(secrets.length, 2, "the old and the new secret");
    // A recorded delivery is older than five minutes by the time it is checked: only the signatures are.
    for (const secret of secrets) {
      assert.equal(verifyWebhook(body, header, secret, { toleranceSeconds: Number.MAX_SAFE_INTEGER }), true);
    }
  },
);
