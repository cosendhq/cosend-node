# cosend

Node SDK for Cosend (cosend.app): verify Cosend's signed WhatsApp webhooks and call the Cosend REST API, with zero dependencies. Cosend connects your existing WhatsApp Business number through Meta's coexistence feature and the official WhatsApp Cloud API, so the number keeps working in the app on the phone while your code sends and receives on it.

```sh
npm install cosend
```

Node.js 20 or later. ESM and CommonJS. Types included. MIT.

## Verify a webhook

Cosend signs every delivery with a `Cosend-Signature` header in the form `t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.rawBody">`. Verify over the **raw** request body, before any JSON parsing.

```js
import { constructEvent, CosendSignatureError } from "cosend";

// Express: capture the raw body on this route
app.post("/hooks/cosend", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = constructEvent(req.body, req.get("Cosend-Signature"), process.env.COSEND_WEBHOOK_SECRET);
  } catch (err) {
    if (err instanceof CosendSignatureError) return res.status(401).end();
    throw err;
  }

  res.status(200).end(); // acknowledge first, work afterwards

  if (event.type === "message.received") {
    // event.data.object is the message, in the same shape GET /v1/messages/{id} returns
  }
  if (event.type === "message.echo") {
    // the owner answered from the WhatsApp Business app on the phone
  }
});
```

`constructEvent` rejects deliveries older than five minutes (`toleranceSeconds` changes it) and takes a single secret or an array, so you hold both secrets across a rotation. Use `verifyWebhook(rawBody, header, secret)` for a boolean instead of an exception.

The signing secret comes back once, in the response to `POST /v1/webhook-endpoints`. Store it then.

Deliveries are at-least-once and unordered. `event.id` is stable across retries, so make your handler idempotent on it, and return a 2xx within 10 seconds.

If your number is in **Stored** mode with a webhook URL on its Developer tab, relayed Meta payloads arrive with an `X-Cosend-Signature-256: sha256=…` header; verify those with `verifyForwardedDelivery(rawBody, header, secret)` using the signing secret from the number's Developer tab. That header carries no timestamp, so de-duplicate on Meta's message ids.

In **Direct** mode, Meta sends its payloads to your endpoint itself and signs them with `X-Hub-Signature-256` and Cosend's Meta app secret, which stays with Cosend, so this package has no function for them. Check instead that `object` is `whatsapp_business_account`, that `entry[].id` is your WhatsApp Business Account ID and, where a change carries it, that `value.metadata.phone_number_id` is your number; use a long random path over HTTPS, and answer 200 quickly.

## Call the API

```js
import { Cosend, CosendError } from "cosend";

const cosend = new Cosend({ apiKey: process.env.COSEND_API_KEY }); // csk_live_… or cok_live_…

const me = await cosend.me();
console.log(me.organization.name, me.connections.map((c) => c.display_phone_number));

try {
  const message = await cosend.messages.send({
    to: "+919876543210",
    type: "text",
    text: { body: "On our way." },
    metadata: { order_id: "4821" }
  });
  console.log(message.id, message.status);
} catch (err) {
  if (err instanceof CosendError) {
    switch (err.type) {
      case "conflict":    // e.g. service_window_closed: send an approved template instead
        break;
      case "rate_limit":  // wait err.retryAfter, then retry with the same idempotency key
        break;
      default:
        console.error(err.code, err.requestId);
    }
  }
}

for await (const conversation of cosend.conversations.iterate({ window_state: "expiring" })) {
  console.log(conversation.id);
}
```

Every send carries an `Idempotency-Key`. The SDK generates one per call; when you retry a send yourself, pass the same key (`{ idempotencyKey }`) so the API returns the stored response instead of sending twice.

Any endpoint in the [API reference](https://cosend.app/docs/reference) is reachable with `cosend.request(method, path, { query, body, idempotencyKey })`, for example `cosend.request("GET", "/webhook-endpoints")`.

Use a `csk_test_` or `cok_test_` key while building. The key is the mode, and test traffic stays out of your usage.

## Where things live on a coexistence number

Free-form messages go inside Meta's 24-hour customer service window; outside it you send an approved template, and the API answers `service_window_closed` when a free-form send arrives late. Groups and calls stay in the WhatsApp Business app on the phone. Throughput on a coexistence number is 20 messages a second.

## Plans

The API, webhooks, the MCP server and the n8n node are on every Cosend plan, including Free ($0: 1 person, up to 5 numbers, 1,000 messages a month). Team plans with the shared inbox, Campaigns and Reports: Starter $14.95/month, Growth $59.95/month, Scale $149.95/month, and $5/month for each extra person. Meta bills WhatsApp message fees to your WhatsApp Business Account at Meta's own rates, with no markup from Cosend.

## Links

- API conventions: https://cosend.app/docs/api
- Webhooks and signing: https://cosend.app/docs/webhooks
- Error reference: https://cosend.app/docs/errors
- Move existing Graph API code in two lines: https://cosend.app/docs/runtime-api/migrating
- MCP server for Claude, ChatGPT, Cursor and any MCP client: https://cosend.app/mcp
- n8n community node: https://www.npmjs.com/package/n8n-nodes-cosend
- Starter repo: https://github.com/cosendhq/cosend-whatsapp-starter

## License

MIT. Cosend is a product of True North Tech Group LLC.
