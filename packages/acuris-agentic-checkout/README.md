# @acuris-geo/agentic-checkout

Address validation for **agentic commerce**. When an AI agent drives checkout
— Google's [Universal Commerce Protocol (UCP)](https://ucp.dev) or
OpenAI/Stripe's [Agentic Commerce Protocol (ACP)](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol)
— there is no human watching an address form, and no widget to catch typos.
Both protocols make address validation **the merchant's job** inside the
checkout-session endpoint, with structured messages as the only feedback
channel to the agent.

This package runs [Acuris Address Validation](https://acuris-geo.com) inside
that endpoint and emits each protocol's native message shapes, so a bad
address is caught **before** payment instead of after a failed delivery.

```bash
npm install @acuris-geo/agentic-checkout
```

## UCP (v2026-04-08)

Inside your `POST /checkout-sessions` / `PUT /checkout-sessions/{id}` handler:

```ts
import { validateUcpDestination } from "@acuris-geo/agentic-checkout";

const destination = checkout.fulfillment.methods[0].destinations[0];
const check = await validateUcpDestination(destination, {
  apiKey: process.env.ACURIS_API_KEY,
});

checkout.messages.push(...check.messages);
if (check.correctedDestination) {
  // Echo the standardized form back as the authoritative destination.
  checkout.fulfillment.methods[0].destinations[0] = {
    ...check.correctedDestination,
    id: destination.id ?? "dest_validated",
  };
}
```

Emitted codes follow the UCP core spec and Google's UCP error-code registry:

| Outcome | Message |
| --- | --- |
| Verified at address level | *(no message)* |
| Verified after standardization | `warning` `address_standardized` + `correctedDestination` |
| House number not on street | `error` `address_undeliverable` (core standard error) |
| No confident match | `error` `address_unverifiable`, per-field RFC 9535 `path` |
| Required field absent | `error` `missing_fulfillment_info`, per-field `path` |

All errors use `severity: "recoverable"` per the spec's standard-error
guidance — the agent platform can fix the input via API and retry. Paths
default to `$.fulfillment.methods[0].destinations[0].<field>` and are
configurable via `methodIndex` / `destinationIndex` / `basePath`.

## ACP (2026-04-17 and 2025-09-29)

Inside your `POST /checkout_sessions` / `POST /checkout_sessions/{id}` handler:

```ts
import { validateAcpAddress } from "@acuris-geo/agentic-checkout";

const check = await validateAcpAddress(session.fulfillment_address, {
  apiKey: process.env.ACURIS_API_KEY,
  version: "2025-09-29", // ChatGPT Instant Checkout as deployed; default 2026-04-17
});

session.messages.push(...check.messages);
if (check.correctedAddress) session.fulfillment_address = check.correctedAddress;
```

Only the codes `missing` and `invalid` are emitted — both exist in the closed
2025-09-29 enum and the 2026-04-17 enum, so the output validates against
either version. Targeting 2026-04-17 adds `resolution: "recoverable"` and the
`$.fulfillment_details.address.*` param base.

## Behaviour notes

- **Fail-open by default.** Countries Acuris does not cover and transient
  upstream errors produce *no* messages (verdicts `unsupported_country` /
  `unavailable`) — an agentic checkout should not break because validation is
  unavailable. Set `failClosed: true` to block instead.
- **Verdicts** (`deliverable`, `correctable`, `undeliverable`, `unverifiable`,
  `missing_fields`, `unsupported_country`, `unavailable`) are returned
  alongside the messages so you can implement your own policy (e.g. block
  `undeliverable` but allow `unverifiable`).
- Pure mappers `toUcpMessages` / `toAcpMessages` and the protocol wire types
  are exported for custom flows (billing addresses, batch re-checks).
- ISO-2 ⇄ ISO-3 country conversion is handled internally (Acuris uses ISO-3).

## License

MIT © Acuris GmbH
