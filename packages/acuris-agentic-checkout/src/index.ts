/**
 * @acuris-geo/agentic-checkout
 *
 * Address validation for agentic commerce. AI agents fill checkout sessions
 * from wallet-stored data with no human watching the form — the merchant's
 * checkout-session endpoint is the only place left to catch a bad address.
 * This package runs Acuris /validate inside that endpoint and emits the
 * protocol-native message shapes:
 *
 *   UCP  (Universal Commerce Protocol, Google et al., v2026-04-08)
 *        → validateUcpDestination / toUcpMessages
 *   ACP  (Agentic Commerce Protocol, OpenAI/Stripe, 2025-09-29 + 2026-04-17)
 *        → validateAcpAddress / toAcpMessages
 */

export { assessAddress, classify, refineWithInput, FIELD_LABELS } from "./core.js";
export {
  validateUcpDestination,
  toUcpMessages,
  parseUcpCountry,
  composeStreetLine,
} from "./ucp.js";
export { validateAcpAddress, toAcpMessages, parseAcpCountry } from "./acp.js";
export { iso2ToIso3, iso3ToIso2 } from "./iso.js";
export type {
  AddressField,
  AgenticCheckoutConfig,
  Assessment,
  FieldIssue,
  Verdict,
  ValidateFn,
  UcpPostalAddress,
  UcpShippingDestination,
  UcpMessage,
  UcpSeverity,
  UcpDestinationCheck,
  UcpOptions,
  AcpVersion,
  AcpAddress,
  AcpMessage,
  AcpAddressCheck,
  AcpOptions,
} from "./types.js";
