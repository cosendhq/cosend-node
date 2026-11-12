import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The request body exactly as it arrived: a string or the raw bytes (a Node `Buffer` is a
 * `Uint8Array`). Never a parsed object: parsing and serializing again changes whitespace and key
 * order, and the signature covers the exact bytes Cosend sent. A body parsed and re-serialized is
 * the usual reason a correct-looking verifier fails.
 */
export type RawBody = string | Uint8Array;

export interface VerifyWebhookOptions {
  /** Oldest delivery accepted, in seconds either side of `now`. Default 300 (five minutes). */
  toleranceSeconds?: number;
  /** The current time in milliseconds. Defaults to `Date.now()`; exists for tests. */
  now?: number;
}

/**
 * The envelope every Cosend event uses (cosend.app/docs/webhooks).
 *
 * `previous_attributes` sits at the top level of the envelope, beside `data`, and only on
 * `*.updated` events: it lists the fields that changed, with their earlier values.
 */
export interface CosendEvent<T = unknown> {
  /** `evt_…`, stable across retries: make your handler idempotent on it. */
  id: string;
  object: "event";
  /** For example `message.received`, `message.echo`, `conversation.updated`. */
  type: string;
  api_version: "v1";
  /** ISO 8601. Deliveries are unordered, so sort on this. */
  created_at: string;
  organization_id: string;
  /** The number the event is about, or `null` for a workspace-level event. */
  connection_id: string | null;
  /** `object` is the full resource, in the shape `GET` returns it. */
  data: { object: T };
  previous_attributes?: Partial<T>;
}

/** Thrown by `constructEvent` when a delivery does not verify. Answer 401. */
export class CosendSignatureError extends Error {
  override readonly name = "CosendSignatureError";
}

const DEFAULT_TOLERANCE_SECONDS = 300;
const FORWARDED_PREFIX = "sha256=";

/**
 * Verifies a Cosend event delivery's `Cosend-Signature: t=<unix seconds>,v1=<hex>` header, where
 * `v1` is HMAC-SHA256(secret, `"{t}.{raw body}"`).
 *
 * Pass the raw request body, before any JSON parsing. Returns `false`, and never throws, for a
 * missing or malformed header, a missing or non-numeric `t`, no `v1`, an empty secret, or a `t`
 * further than `toleranceSeconds` from now. During a secret rotation the header carries one `v1`
 * per secret; any match is enough. `secret` may be an array, so you can hold the old and the new
 * secret while you deploy.
 */
export function verifyWebhook(
  rawBody: RawBody,
  signatureHeader: string | undefined,
  secret: string | string[],
  options: VerifyWebhookOptions = {},
): boolean {
  if (!isRawBody(rawBody) || typeof signatureHeader !== "string") return false;
  const secrets = secretsOf(secret);
  if (secrets.length === 0) return false;

  const header = parseSignatureHeader(signatureHeader);
  if (header === undefined) return false;

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.now ?? Date.now();
  // `!(x >= 0)` also refuses NaN, which would otherwise make the age check pass for any `t`.
  if (!(tolerance >= 0) || !Number.isFinite(now)) return false;
  if (Math.abs(now / 1000 - header.timestamp) > tolerance) return false;

  return secrets.some((key) => {
    const expected = hmacHex(key, `${header.t}.`, rawBody);
    return header.signatures.some((candidate) => safeEqual(expected, candidate));
  });
}

/**
 * Verifies a delivery with `verifyWebhook`, then parses it. Throws `CosendSignatureError` when it
 * does not verify; the error message carries neither the body nor the secret.
 */
export function constructEvent<T = unknown>(
  rawBody: RawBody,
  signatureHeader: string | undefined,
  secret: string | string[],
  options: VerifyWebhookOptions = {},
): CosendEvent<T> {
  if (!verifyWebhook(rawBody, signatureHeader, secret, options)) {
    throw new CosendSignatureError(
      "The Cosend-Signature header does not verify. Pass the raw request body (not a parsed object), " +
        "this endpoint's signing secret, and check that the delivery is within the tolerance.",
    );
  }
  const text = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
  return parseEvent<T>(text);
}

/**
 * Verifies a Meta change that Cosend forwarded to your number's webhook URL (a Stored mode number
 * with a URL on its Developer tab), signed `X-Cosend-Signature-256: sha256=<hex HMAC-SHA256 of the
 * raw body>` with the number's signing secret.
 *
 * Returns `false` when the `sha256=` prefix is missing. The scheme carries no timestamp, so
 * de-duplicate on Meta's message ids. Matches the Node snippet on cosend.app/webhooks.
 *
 * Direct mode deliveries come from Meta, signed `X-Hub-Signature-256` with Cosend's own app secret,
 * which stays with Cosend, so there is no function for them: check that `object` is
 * `whatsapp_business_account`, `entry[].id` is your WABA and `value.metadata.phone_number_id` is
 * your number, use a long random path over HTTPS, and answer 200 quickly.
 */
export function verifyForwardedDelivery(
  rawBody: RawBody,
  signatureHeader: string | undefined,
  secret: string | string[],
): boolean {
  if (!isRawBody(rawBody) || typeof signatureHeader !== "string") return false;
  if (!signatureHeader.startsWith(FORWARDED_PREFIX)) return false;
  const got = signatureHeader.slice(FORWARDED_PREFIX.length);
  return secretsOf(secret).some((key) => safeEqual(hmacHex(key, rawBody), got));
}

function isRawBody(value: unknown): value is RawBody {
  return typeof value === "string" || value instanceof Uint8Array;
}

/** The non-empty secrets given, whatever a JavaScript caller passed. */
function secretsOf(secret: unknown): string[] {
  const list: unknown[] = Array.isArray(secret) ? secret : [secret];
  return list.filter((s): s is string => typeof s === "string" && s !== "");
}

/** `t` (kept as sent, since it is part of the signed string) and every `v1`, in any order. */
function parseSignatureHeader(
  header: string,
): { t: string; timestamp: number; signatures: string[] } | undefined {
  let t: string | undefined;
  const signatures: string[] = [];
  for (const pair of header.split(",")) {
    const at = pair.indexOf("=");
    if (at === -1) continue;
    const key = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (key === "t" && t === undefined) t = value;
    else if (key === "v1" && value !== "") signatures.push(value);
  }
  if (t === undefined || !/^\d+$/.test(t) || signatures.length === 0) return undefined;
  return { t, timestamp: Number(t), signatures };
}

function hmacHex(secret: string, ...parts: RawBody[]): string {
  const hmac = createHmac("sha256", secret);
  for (const part of parts) hmac.update(part);
  return hmac.digest("hex");
}

/** Constant-time comparison; unequal lengths are `false` without calling `timingSafeEqual`. */
function safeEqual(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The one unchecked step: the body verified, so it is Cosend's envelope, and `T` is the caller's
 * name for `data.object`.
 */
function parseEvent<T>(text: string): CosendEvent<T> {
  return JSON.parse(text);
}
