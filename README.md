# Acuris Agentic Commerce Connector

Address validation for agent-driven checkout. This repo ships
[`@acuris-geo/agentic-checkout`](packages/acuris-agentic-checkout) — a server
package that runs [Acuris Address Validation](https://acuris-geo.com) inside
merchant checkout-session endpoints for:

- **UCP** — Universal Commerce Protocol (Google, Shopify, Etsy, Walmart et al.)
- **ACP** — Agentic Commerce Protocol (OpenAI/Stripe — ChatGPT Instant Checkout)

In agentic checkout the agent fills the session from wallet-stored data; both
protocols put address validation on the merchant's checkout-session endpoint
and use structured per-field messages as the only feedback channel to the
agent surface. This package maps Acuris `/validate` results into exactly those
shapes.

See the [package README](packages/acuris-agentic-checkout/README.md) for usage.

## Development

```bash
npm install
npm run build
npm run test
```

## License

MIT © Acuris GmbH
