import { randomUUID } from "node:crypto";
import { CosendError, errorFromResponse } from "./errors.js";
import type {
  Conversation,
  ListConversationsParams,
  Me,
  Message,
  Page,
  QueryValue,
  SendMessageBody,
} from "./types.js";
import { VERSION } from "./version.js";

const DEFAULT_BASE_URL = "https://api.cosend.app/v1";

export interface CosendOptions {
  /** `csk_live_…`, `cok_live_…`, `csk_test_…` or `cok_test_…`. Server side only. */
  apiKey: string;
  /** Default `https://api.cosend.app/v1`. Paths are joined onto it. */
  baseUrl?: string;
  /** Replaces the global `fetch`, for tests. */
  fetch?: typeof fetch;
  /** Appended to the default `User-Agent`, `cosend-node/<version>`. */
  userAgent?: string;
}

export interface RequestOptions {
  /** Arrays repeat the key; `undefined` is left out. */
  query?: Record<string, QueryValue>;
  /** Sent as JSON. */
  body?: unknown;
  /** Sent as `Idempotency-Key`. */
  idempotencyKey?: string;
}

export interface SendOptions {
  /** Defaults to a new `crypto.randomUUID()`. Pass the same key when you retry a send. */
  idempotencyKey?: string;
}

/** What a successful response said besides its body. */
export interface CosendResponse {
  status: number;
  /** Every response header, as received. */
  headers: Headers;
  /** `X-Request-Id`. */
  requestId: string | undefined;
  /** `X-RateLimit-Limit`: the limit that applied to this request. */
  rateLimitLimit: number | undefined;
  /** `X-RateLimit-Remaining`. */
  rateLimitRemaining: number | undefined;
  /** `X-RateLimit-Reset`, Unix seconds. */
  rateLimitReset: number | undefined;
  /** `Idempotency-Replayed`: this is the stored response to an earlier request with the same key. */
  idempotencyReplayed: boolean;
}

export interface WithResponse<T> {
  data: T;
  response: CosendResponse;
}

/** A call that resolves to the body, with a `withResponse` variant that also returns the headers. */
export interface ApiMethod<A extends unknown[], T> {
  (...args: A): Promise<T>;
  withResponse(...args: A): Promise<WithResponse<T>>;
}

export interface RequestMethod {
  <T = unknown>(method: string, path: string, options?: RequestOptions): Promise<T>;
  withResponse<T = unknown>(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<WithResponse<T>>;
}

/**
 * A thin client for the Cosend REST API (`/v1`). It never retries: a retried send with a fresh
 * idempotency key is a second message to a real person.
 */
export class Cosend {
  /**
   * Any `/v1` endpoint. `path` comes without the `/v1` prefix, which `baseUrl` carries:
   * `cosend.request("GET", "/webhook-endpoints")`. Resolves to the parsed JSON body (`null` for an
   * empty one) and throws `CosendError` on a non-2xx answer.
   */
  readonly request: RequestMethod;

  /** `GET /v1/me`: the calling credential, its workspace, plan and limits. Needs no scope. */
  readonly me: ApiMethod<[], Me>;

  readonly messages: {
    /** `POST /v1/messages`. Always sends an `Idempotency-Key`. */
    send: ApiMethod<[body: SendMessageBody, options?: SendOptions], Message>;
  };

  readonly conversations: {
    /** `GET /v1/conversations`, one page. Scope `messages:read`. */
    list: ApiMethod<[params?: ListConversationsParams], Page<Conversation>>;
    /** Every conversation, following `next_cursor` through `after` until `has_more` is `false`. */
    iterate(params?: ListConversationsParams): AsyncIterable<Conversation>;
  };

  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #userAgent: string;

  constructor(options: CosendOptions) {
    if (typeof options?.apiKey !== "string" || options.apiKey === "") {
      throw new TypeError("new Cosend({ apiKey }) needs an API key (csk_… or cok_…).");
    }
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#userAgent =
      options.userAgent === undefined || options.userAgent === ""
        ? `cosend-node/${VERSION}`
        : `cosend-node/${VERSION} ${options.userAgent}`;

    const withResponse = <T = unknown>(method: string, path: string, opts?: RequestOptions) =>
      this.#send<T>(method, path, opts);
    const request = async <T = unknown>(method: string, path: string, opts?: RequestOptions) =>
      (await withResponse<T>(method, path, opts)).data;
    this.request = Object.assign(request, { withResponse });

    this.me = apiMethod(() => this.request.withResponse<Me>("GET", "/me"));

    this.messages = {
      send: apiMethod((body: SendMessageBody, opts: SendOptions = {}) =>
        this.request.withResponse<Message>("POST", "/messages", {
          body,
          idempotencyKey: opts.idempotencyKey ?? randomUUID(),
        }),
      ),
    };

    const list = apiMethod((params: ListConversationsParams = {}) =>
      this.request.withResponse<Page<Conversation>>("GET", "/conversations", { query: params }),
    );
    this.conversations = {
      list,
      async *iterate(params: ListConversationsParams = {}) {
        let after = params.after;
        for (;;) {
          const page = await list({ ...params, after });
          yield* page.data;
          if (!page.has_more || page.next_cursor === null) return;
          after = page.next_cursor;
        }
      },
    };
  }

  async #send<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<WithResponse<T>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: "application/json",
      "User-Agent": this.#userAgent,
    };
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    if (options.idempotencyKey !== undefined) headers["Idempotency-Key"] = options.idempotencyKey;

    const fetchImpl = this.#fetch;
    const res = await fetchImpl(urlOf(this.#baseUrl, path, options.query), {
      method: method.toUpperCase(),
      headers,
      ...(body === undefined ? {} : { body }),
    });
    const text = await res.text();
    if (!res.ok) throw errorFromResponse(res.status, text, res.headers);

    const response = describe(res);
    return { data: parseBody<T>(text, response), response };
  }
}

function apiMethod<A extends unknown[], T>(
  call: (...args: A) => Promise<WithResponse<T>>,
): ApiMethod<A, T> {
  const direct = async (...args: A): Promise<T> => (await call(...args)).data;
  return Object.assign(direct, { withResponse: call });
}

function urlOf(baseUrl: string, path: string, query: Record<string, QueryValue> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) for (const item of value) search.append(key, String(item));
    else search.append(key, String(value));
  }
  const url = baseUrl + (path.startsWith("/") ? path : `/${path}`);
  const qs = search.toString();
  if (qs === "") return url;
  return url + (url.includes("?") ? "&" : "?") + qs;
}

function describe(res: Response): CosendResponse {
  const h = res.headers;
  return {
    status: res.status,
    headers: h,
    requestId: h.get("x-request-id") ?? undefined,
    rateLimitLimit: numberHeader(h, "x-ratelimit-limit"),
    rateLimitRemaining: numberHeader(h, "x-ratelimit-remaining"),
    rateLimitReset: numberHeader(h, "x-ratelimit-reset"),
    idempotencyReplayed: h.get("idempotency-replayed") === "true",
  };
}

function numberHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The one unchecked step on the way in: `T` is the caller's name for the body's shape
 * (`me()` names `Me`, `request<T>()` names whatever the caller passes).
 */
function parseBody<T>(text: string, response: CosendResponse): T {
  try {
    return JSON.parse(text === "" ? "null" : text);
  } catch {
    throw new CosendError({
      status: response.status,
      message: `The Cosend API answered ${response.status} with a body that is not JSON.`,
      requestId: response.requestId,
    });
  }
}
