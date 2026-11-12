# Changelog

## 1.0.0

First release of `cosend-app`, the Cosend Node SDK.

- `verifyWebhook(rawBody, header, secret, options?)`: verifies `Cosend-Signature: t=…,v1=…`
  (HMAC-SHA256 over `"{t}.{raw body}"`), five-minute default tolerance, every `v1` and one or
  several secrets for rotations, constant-time comparison. Returns `false`, never throws.
- `constructEvent(...)`: verifies, then parses the event envelope; throws `CosendSignatureError`.
- `verifyForwardedDelivery(rawBody, header, secret)`: verifies `X-Cosend-Signature-256: sha256=…`
  on Meta changes forwarded from a Stored mode number.
- `Cosend` client for `/v1`: `me()`, `messages.send()` (always sends an `Idempotency-Key`),
  `conversations.list()`, `conversations.iterate()` and a public `request()` for every other
  endpoint. Each has a `withResponse()` variant exposing `X-Request-Id`, the `X-RateLimit-*`
  headers and `Idempotency-Replayed`.
- `CosendError` from the `/v1` error envelope: `status`, `type`, `code`, `message`, `param`,
  `requestId`, `docs`, `retryAfter`, `retryAfterMs` and `extra`.
- No automatic retries. No runtime dependencies. Node 20 or later, ESM and CommonJS, types included.
