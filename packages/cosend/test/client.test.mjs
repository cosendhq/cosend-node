import assert from "node:assert/strict";
import { test } from "node:test";
import { Cosend, CosendError, VERSION } from "../dist/index.js";

const API_KEY = "csk_test_0123456789abcdefghijklmnopqrstuv"; // made-up test key, gitleaks:allow
const REQUEST_ID = "req_01K9Q3Z8M4X7C2N6V5B1T0RYHD";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** An injected fetch that records each request and answers from a queue of canned responses. */
function mockFetch(...responses) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({
      url: new URL(String(url)),
      method: init.method,
      headers: new Headers(init.headers),
      body: init.body,
    });
    const next = responses.shift();
    if (next === undefined) throw new Error(`unexpected request ${init.method} ${url}`);
    return next;
  };
  return { fetch, calls };
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": REQUEST_ID, ...headers },
  });
}

const ME = {
  user: null,
  organization: { id: "org_1", name: "Acme Bakery", slug: "acme", timezone: "Asia/Kolkata", country: "IN", erasure_scheduled_for: null },
  credential: { kind: "organization", id: "key_1", name: "Server", is_live: false, scopes: ["messages:write"], connection_id: null, connection_ids: [] },
  connections: [{ id: "conn_1", display_phone_number: "+91 98765 43210", verified_name: "Acme Bakery", mode: "coexistence", status: "active" }],
  subscription: { plan: "free", status: "active" },
  limits: {},
  entitlements: {},
};

const conversation = (id) => ({ id, object: "conversation", connection_id: "conn_1", contact_id: "ct_1" });

test("10. me() calls GET https://api.cosend.app/v1/me with the bearer header and no body", async () => {
  const { fetch, calls } = mockFetch(json(200, ME));
  const cosend = new Cosend({ apiKey: API_KEY, fetch });
  const me = await cosend.me();

  assert.deepEqual(me, ME);
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.url.href, "https://api.cosend.app/v1/me");
  assert.equal(call.method, "GET");
  assert.equal(call.headers.get("authorization"), `Bearer ${API_KEY}`);
  assert.equal(call.headers.get("accept"), "application/json");
  assert.equal(call.headers.get("user-agent"), `cosend-node/${VERSION}`);
  assert.equal(call.body, undefined);
  assert.equal(call.headers.get("content-type"), null);
  assert.equal(call.headers.get("idempotency-key"), null);
});

test("11. messages.send() POSTs /v1/messages with JSON and always an Idempotency-Key", async () => {
  const sent = { id: "msg_1", object: "message", status: "queued" };
  const { fetch, calls } = mockFetch(json(201, sent), json(201, sent), json(201, sent));
  const cosend = new Cosend({ apiKey: API_KEY, fetch });
  const body = { to: "+919876543210", type: "text", text: { body: "On our way." }, metadata: { order_id: "4821" } };

  assert.deepEqual(await cosend.messages.send(body), sent);
  await cosend.messages.send(body, { idempotencyKey: "order-4821-on-our-way" });
  await cosend.messages.send(body);

  const [first, second, third] = calls;
  for (const call of calls) {
    assert.equal(call.url.href, "https://api.cosend.app/v1/messages");
    assert.equal(call.method, "POST");
    assert.equal(call.headers.get("content-type"), "application/json");
    assert.equal(call.headers.get("authorization"), `Bearer ${API_KEY}`);
    assert.deepEqual(JSON.parse(call.body), body);
  }
  assert.match(first.headers.get("idempotency-key"), UUID);
  assert.equal(second.headers.get("idempotency-key"), "order-4821-on-our-way");
  assert.match(third.headers.get("idempotency-key"), UUID);
  assert.notEqual(third.headers.get("idempotency-key"), first.headers.get("idempotency-key"));
});

test("12. conversations.list() repeats connection_id and sends the scalars", async () => {
  const page = { data: [conversation("cnv_1")], has_more: false, next_cursor: null };
  const { fetch, calls } = mockFetch(json(200, page));
  const cosend = new Cosend({ apiKey: API_KEY, fetch });

  const result = await cosend.conversations.list({ connection_id: ["a", "b"], window_state: "expiring", limit: 50 });

  assert.deepEqual(result, page);
  const [call] = calls;
  assert.equal(call.method, "GET");
  assert.equal(call.url.origin + call.url.pathname, "https://api.cosend.app/v1/conversations");
  assert.equal(call.url.search, "?connection_id=a&connection_id=b&window_state=expiring&limit=50");
  assert.deepEqual(call.url.searchParams.getAll("connection_id"), ["a", "b"]);
  assert.equal(call.body, undefined);
});

test("13. conversations.iterate() follows next_cursor through after until has_more is false", async () => {
  const { fetch, calls } = mockFetch(
    json(200, { data: [conversation("cnv_1"), conversation("cnv_2")], has_more: true, next_cursor: "h1.opaque/cursor+2" }),
    json(200, { data: [conversation("cnv_3")], has_more: false, next_cursor: null }),
  );
  const cosend = new Cosend({ apiKey: API_KEY, fetch });

  const ids = [];
  for await (const c of cosend.conversations.iterate({ window_state: "expiring" })) ids.push(c.id);

  assert.deepEqual(ids, ["cnv_1", "cnv_2", "cnv_3"]);
  assert.equal(calls.length, 2, "stops after the page with has_more: false");
  assert.equal(calls[0].url.searchParams.get("after"), null);
  assert.equal(calls[1].url.searchParams.get("after"), "h1.opaque/cursor+2");
  for (const call of calls) assert.equal(call.url.searchParams.get("window_state"), "expiring");
});

test("14. a 409 envelope and a 429 throw CosendError with every member populated", async () => {
  const conflict = {
    error: {
      type: "conflict",
      code: "service_window_closed",
      message: "The 24-hour customer service window is closed. Send an approved template.",
      request_id: REQUEST_ID,
      docs: "https://cosend.app/docs/errors#service_window_closed",
    },
  };
  const limited = {
    error: {
      type: "rate_limit",
      code: "rate_limited",
      message: "Rate limit reached.",
      request_id: "req_01K9Q3Z8M4X7C2N6V5B1T0RYHF",
      docs: "https://cosend.app/docs/errors#rate_limited",
      retry_after_ms: 1500,
    },
  };
  const { fetch } = mockFetch(json(409, conflict), json(429, limited, { "retry-after": "2" }));
  const cosend = new Cosend({ apiKey: API_KEY, fetch });
  const body = { to: "+919876543210", type: "text", text: { body: "On our way." } };

  await assert.rejects(cosend.messages.send(body), (err) => {
    assert.ok(err instanceof CosendError);
    assert.ok(err instanceof Error);
    assert.equal(err.name, "CosendError");
    assert.equal(err.status, 409);
    assert.equal(err.type, "conflict");
    assert.equal(err.code, "service_window_closed");
    assert.equal(err.message, conflict.error.message);
    assert.equal(err.requestId, REQUEST_ID);
    assert.equal(err.docs, "https://cosend.app/docs/errors#service_window_closed");
    assert.equal(err.param, undefined);
    assert.equal(err.retryAfter, undefined);
    assert.equal(err.retryAfterMs, undefined);
    assert.deepEqual(err.extra, {});
    return true;
  });

  await assert.rejects(cosend.messages.send(body), (err) => {
    assert.ok(err instanceof CosendError);
    assert.equal(err.status, 429);
    assert.equal(err.type, "rate_limit");
    assert.equal(err.code, "rate_limited");
    assert.equal(err.retryAfter, "2");
    assert.equal(err.retryAfterMs, 1500);
    assert.equal(err.requestId, "req_01K9Q3Z8M4X7C2N6V5B1T0RYHF", "the body's request_id wins over the header");
    return true;
  });
});

test("15. a non-JSON 502 throws CosendError with status 502 and the X-Request-Id header", async () => {
  const { fetch } = mockFetch(
    new Response("<html><body>502 Bad Gateway</body></html>", {
      status: 502,
      headers: { "content-type": "text/html", "x-request-id": REQUEST_ID },
    }),
  );
  const cosend = new Cosend({ apiKey: API_KEY, fetch });

  await assert.rejects(cosend.me(), (err) => {
    assert.ok(err instanceof CosendError);
    assert.equal(err.status, 502);
    assert.equal(err.requestId, REQUEST_ID);
    assert.equal(err.type, undefined);
    assert.equal(err.code, undefined);
    return true;
  });
});

test("16. baseUrl override is honored", async () => {
  const { fetch, calls } = mockFetch(json(200, ME), json(200, { data: [], has_more: false, next_cursor: null }));
  const cosend = new Cosend({ apiKey: API_KEY, fetch, baseUrl: "http://localhost:8787/v1/" });

  await cosend.me();
  await cosend.request("GET", "/webhook-endpoints");

  assert.equal(calls[0].url.href, "http://localhost:8787/v1/me");
  assert.equal(calls[1].url.href, "http://localhost:8787/v1/webhook-endpoints");
});

test("withResponse() exposes the rate-limit, request-id and Idempotency-Replayed headers", async () => {
  const headers = {
    "x-ratelimit-limit": "100",
    "x-ratelimit-remaining": "99",
    "x-ratelimit-reset": "1794312060",
    "idempotency-replayed": "true",
  };
  const page = { data: [], has_more: false, next_cursor: null };
  const { fetch } = mockFetch(
    json(201, { id: "msg_1" }, headers),
    json(200, ME),
    json(200, page),
    json(200, page),
  );
  const cosend = new Cosend({ apiKey: API_KEY, fetch });

  const sent = await cosend.messages.send.withResponse(
    { to: "+919876543210", type: "text", text: { body: "On our way." } },
    { idempotencyKey: "k1" },
  );
  assert.deepEqual(sent.data, { id: "msg_1" });
  assert.equal(sent.response.status, 201);
  assert.equal(sent.response.requestId, REQUEST_ID);
  assert.equal(sent.response.rateLimitLimit, 100);
  assert.equal(sent.response.rateLimitRemaining, 99);
  assert.equal(sent.response.rateLimitReset, 1794312060);
  assert.equal(sent.response.idempotencyReplayed, true);
  assert.equal(sent.response.headers.get("x-ratelimit-limit"), "100");

  const me = await cosend.me.withResponse();
  assert.deepEqual(me.data, ME);
  assert.equal(me.response.idempotencyReplayed, false);
  assert.equal(me.response.rateLimitLimit, undefined);

  assert.deepEqual((await cosend.conversations.list.withResponse({ limit: 1 })).data, page);
  assert.deepEqual((await cosend.request.withResponse("GET", "/conversations")).data, page);
});

test("request() drops undefined, serializes booleans, appends userAgent; a 204 resolves to null", async () => {
  const { fetch, calls } = mockFetch(new Response(null, { status: 204, headers: { "x-request-id": REQUEST_ID } }));
  const cosend = new Cosend({ apiKey: API_KEY, fetch, userAgent: "acme-orders/2.3" });

  const result = await cosend.request("delete", "/webhook-endpoints/we_1", {
    query: { purge: true, unread: false, label: undefined, kind: ["a", "b"], limit: 10 },
  });

  assert.equal(result, null);
  const [call] = calls;
  assert.equal(call.method, "DELETE");
  assert.equal(call.url.search, "?purge=true&unread=false&kind=a&kind=b&limit=10");
  assert.equal(call.headers.get("user-agent"), `cosend-node/${VERSION} acme-orders/2.3`);
});

test("CosendError.extra carries the fields a code adds", async () => {
  const locked = {
    error: {
      type: "conflict",
      code: "conversation_locked",
      message: "Another team member holds this conversation.",
      param: "conversation_id",
      request_id: REQUEST_ID,
      docs: "https://cosend.app/docs/errors#conversation_locked",
      held_by: { user_id: "usr_1", name: "Priya" },
      details: [{ pointer: "/conversation_id", message: "held" }],
    },
  };
  const { fetch } = mockFetch(json(409, locked));
  const cosend = new Cosend({ apiKey: API_KEY, fetch });

  await assert.rejects(cosend.messages.send({ conversation_id: "cnv_1", type: "text", text: { body: "Hi" } }), (err) => {
    assert.equal(err.param, "conversation_id");
    assert.deepEqual(err.extra, { held_by: locked.error.held_by, details: locked.error.details });
    return true;
  });
});

test("no automatic retries: a 503 calls fetch once", async () => {
  const unavailable = {
    error: { type: "upstream", code: "upstream_unavailable", message: "Meta did not answer.", request_id: REQUEST_ID, docs: "https://cosend.app/docs/errors#upstream_unavailable" },
  };
  const { fetch, calls } = mockFetch(json(503, unavailable, { "retry-after": "1" }));
  const cosend = new Cosend({ apiKey: API_KEY, fetch });

  await assert.rejects(cosend.messages.send({ to: "+919876543210", type: "text", text: { body: "Hi" } }), CosendError);
  assert.equal(calls.length, 1);
});

test("new Cosend() refuses a missing apiKey", () => {
  assert.throws(() => new Cosend({ apiKey: "" }), TypeError);
  assert.throws(() => new Cosend({}), TypeError);
});
