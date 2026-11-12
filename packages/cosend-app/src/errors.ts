import type { Open } from "./types.js";

/**
 * The ten error types on `/v1`. The list is stable, so base retry and error handling on `type`
 * and log `code`, which names the specific reason and gains new values over time
 * (cosend.app/docs/errors).
 */
export type CosendErrorType =
  | "invalid_request"
  | "authentication"
  | "permission"
  | "not_entitled"
  | "not_found"
  | "conflict"
  | "quota"
  | "rate_limit"
  | "upstream"
  | "internal";

export interface CosendErrorInit {
  status: number;
  message: string;
  type?: string | undefined;
  code?: string | undefined;
  param?: string | undefined;
  requestId?: string | undefined;
  docs?: string | undefined;
  retryAfter?: string | undefined;
  retryAfterMs?: number | undefined;
  extra?: Record<string, unknown> | undefined;
}

/** A non-2xx answer from the Cosend API, read from the `/v1` error envelope. */
export class CosendError extends Error {
  override readonly name = "CosendError";
  /** The HTTP status. */
  readonly status: number;
  /** `error.type`; `undefined` when the body is not the `/v1` envelope. */
  readonly type: Open<CosendErrorType> | undefined;
  /** `error.code`, for example `service_window_closed`. Log it. */
  readonly code: string | undefined;
  /** `error.param`: the field the error is about, when there is one. */
  readonly param: string | undefined;
  /** `error.request_id`, else the `X-Request-Id` header. Include it when you contact support. */
  readonly requestId: string | undefined;
  /** `error.docs`: the error reference entry for this code. */
  readonly docs: string | undefined;
  /** The raw `Retry-After` header, set on 429 and 503. */
  readonly retryAfter: string | undefined;
  /** `error.retry_after_ms`, on `rate_limited`. */
  readonly retryAfterMs: number | undefined;
  /**
   * Every other member of `error`, as sent: the fields a code adds, such as `details[]`,
   * `upgrade_url`, `paused_until`, `held_by` or `upstream_error`.
   */
  readonly extra: Readonly<Record<string, unknown>>;

  constructor(init: CosendErrorInit) {
    super(init.message);
    this.status = init.status;
    this.type = init.type;
    this.code = init.code;
    this.param = init.param;
    this.requestId = init.requestId;
    this.docs = init.docs;
    this.retryAfter = init.retryAfter;
    this.retryAfterMs = init.retryAfterMs;
    this.extra = init.extra ?? {};
  }
}

/** Builds the `CosendError` for a non-2xx response from its status, body text and headers. */
export function errorFromResponse(status: number, text: string, headers: Headers): CosendError {
  const headerRequestId = headers.get("x-request-id") ?? undefined;
  const retryAfter = headers.get("retry-after") ?? undefined;
  const parsed = parseJsonOrUndefined(text);
  const envelope = isRecord(parsed) && isRecord(parsed.error) ? parsed.error : undefined;

  if (envelope === undefined) {
    return new CosendError({
      status,
      message: `The Cosend API answered ${status} without a /v1 error body.`,
      requestId: headerRequestId,
      retryAfter,
    });
  }

  const { type, code, message, param, request_id, docs, ...extra } = envelope;
  const retryAfterMs = extra.retry_after_ms;
  return new CosendError({
    status,
    message: stringOf(message) ?? `The Cosend API answered ${status}.`,
    type: stringOf(type),
    code: stringOf(code),
    param: stringOf(param),
    requestId: stringOf(request_id) ?? headerRequestId,
    docs: stringOf(docs),
    retryAfter,
    retryAfterMs: typeof retryAfterMs === "number" ? retryAfterMs : undefined,
    extra,
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseJsonOrUndefined(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}
