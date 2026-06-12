import type {
  AcurisClient,
  FieldedAddressInput,
  ValidationResult,
} from "@acuris-geo/av-sdk";

/** Derived rather than imported — not a named export in av-sdk ≤0.2.0. */
export type StandardizedAddress = NonNullable<ValidationResult["standardized"]>;

/* ------------------------------------------------------------------ */
/* Shared assessment model                                             */
/* ------------------------------------------------------------------ */

/**
 * Protocol-independent verdict for one submitted address.
 *
 *   deliverable          — verified at address level; nothing to report.
 *   correctable          — verified, but Acuris standardized/corrected fields;
 *                          the corrected form is available for echoing back.
 *   undeliverable        — street verified but the house number does not
 *                          exist on it (maps to UCP `address_undeliverable`).
 *   unverifiable         — no confident match; per-field issues when known.
 *   missing_fields       — required input fields absent (pre-validation).
 *   unsupported_country  — country missing/unparseable or excluded by config.
 *   unavailable          — Acuris API unreachable; callers fail open.
 */
export type Verdict =
  | "deliverable"
  | "correctable"
  | "undeliverable"
  | "unverifiable"
  | "missing_fields"
  | "unsupported_country"
  | "unavailable";

/** Canonical field keys, mapped per protocol to paths/params. */
export type AddressField =
  | "street"
  | "house_number"
  | "city"
  | "state"
  | "postcode"
  | "country"
  | "address";

export interface FieldIssue {
  field: AddressField;
  kind: "missing" | "unmatched" | "not_found";
}

export interface Assessment {
  verdict: Verdict;
  issues: FieldIssue[];
  /** Raw Acuris result, when the API was reached. */
  result?: ValidationResult;
  standardized?: StandardizedAddress;
  /** Human-readable list of corrections Acuris applied. */
  corrections: string[];
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Test seam / advanced override: same signature as av-sdk's
 * `validateAddress(client, input, { country })`.
 */
export type ValidateFn = (
  client: AcurisClient,
  input: FieldedAddressInput,
  options: { country: string },
) => Promise<ValidationResult>;

export interface AgenticCheckoutConfig {
  /** Defaults to process.env.ACURIS_API_KEY. */
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  /**
   * Confidence at/above which an address-level match with unchanged input is
   * accepted silently. Default 0.95 (same as the SCAYLE gateway).
   */
  exactConfidence?: number;
  /**
   * Confidence at/above which an address-level match still counts as
   * verified (possibly `correctable`). Below it → `unverifiable`. Default 0.7.
   */
  minConfidence?: number;
  /** ISO-2 codes to skip entirely (verdict `unsupported_country`). */
  unsupportedCountries?: string[];
  /**
   * When true, `unsupported_country` and `unavailable` produce a blocking
   * error message instead of passing silently. Default false: agentic
   * checkouts should not break on countries Acuris does not cover or
   * transient upstream trouble — surface nothing and let the order proceed.
   */
  failClosed?: boolean;
  /**
   * When true (default), a `correctable` verdict adds a non-blocking
   * standardization note (UCP: warning message; ACP: info message) alongside
   * the corrected address.
   */
  annotateCorrections?: boolean;
  /** Test seam — replaces av-sdk's validateAddress. */
  validateFn?: ValidateFn;
}

/* ------------------------------------------------------------------ */
/* UCP wire types (Universal Commerce Protocol, v2026-04-08)           */
/* ------------------------------------------------------------------ */

/** schema.org-derived postal address, source/schemas/shopping/types/postal_address.json */
export interface UcpPostalAddress {
  street_address?: string;
  /** Apartment number, C/O or alternative name. */
  extended_address?: string;
  address_locality?: string;
  /** State / province, required for applicable countries. */
  address_region?: string;
  /** ISO 3166-1 alpha-2 preferred; alpha-3 and full names tolerated by spec. */
  address_country?: string;
  postal_code?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
}

/** shipping_destination.json = postal_address + merchant-assigned id. */
export interface UcpShippingDestination extends UcpPostalAddress {
  id?: string;
}

export type UcpSeverity =
  | "recoverable"
  | "requires_buyer_input"
  | "requires_buyer_review"
  | "unrecoverable";

/** One entry of the checkout response's top-level `messages` array. */
export interface UcpMessage {
  type: "error" | "warning" | "info";
  code?: string;
  /** RFC 9535 JSONPath rooted at the checkout object. */
  path?: string;
  content: string;
  content_type?: "plain" | "markdown";
  /** Required on type:"error" per message_error.json. */
  severity?: UcpSeverity;
}

export interface UcpDestinationCheck {
  verdict: Verdict;
  /** Append to the checkout response's `messages` array. */
  messages: UcpMessage[];
  /**
   * Standardized destination to echo back in `destinations[]` (id and
   * person/contact fields preserved). Present when verdict is `correctable`,
   * and on `deliverable` when Acuris returned a standardized form.
   */
  correctedDestination?: UcpShippingDestination;
  result?: ValidationResult;
}

export interface UcpOptions extends AgenticCheckoutConfig {
  /** Index into fulfillment.methods[] for path building. Default 0. */
  methodIndex?: number;
  /** Index into methods[].destinations[] for path building. Default 0. */
  destinationIndex?: number;
  /** Full override of the destination base path, e.g. from your own routing. */
  basePath?: string;
}

/* ------------------------------------------------------------------ */
/* ACP wire types (Agentic Commerce Protocol)                          */
/* ------------------------------------------------------------------ */

/**
 * ACP spec versions with distinct address shapes:
 *   2025-09-29 — flat `fulfillment_address`, 6-code error enum
 *                (what OpenAI ChatGPT Instant Checkout runs in production).
 *   2026-04-17 — `fulfillment_details.address`, 21-code enum + `resolution`.
 */
export type AcpVersion = "2025-09-29" | "2026-04-17";

export interface AcpAddress {
  name?: string;
  line_one?: string;
  line_two?: string;
  city?: string;
  /** ISO 3166-2 subdivision code where applicable, e.g. "CA". */
  state?: string;
  /** ISO 3166-1 alpha-2. */
  country?: string;
  postal_code?: string;
  /** E.164; OpenAI doc extension on 2025-09-29, schema field on 2026-04-17. */
  phone_number?: string;
  /** 2026-04-17 only. */
  company?: string;
}

/** In-session message (returned with HTTP 200/201 inside the checkout session). */
export interface AcpMessage {
  type: "error" | "info";
  /** 2025-09-29 enum: missing | invalid | ... — both codes used here exist in all versions. */
  code?: string;
  /** RFC 9535 JSONPath, e.g. $.fulfillment_address.postal_code */
  param?: string;
  content_type: "plain" | "markdown";
  content: string;
  /** 2026-04-17 only; omitted when targeting 2025-09-29. */
  resolution?: "recoverable" | "requires_buyer_input" | "requires_buyer_review";
}

export interface AcpAddressCheck {
  verdict: Verdict;
  /** Append to the checkout session's `messages` array. */
  messages: AcpMessage[];
  /** Standardized address to return as the authoritative fulfillment address. */
  correctedAddress?: AcpAddress;
  result?: ValidationResult;
}

export interface AcpOptions extends AgenticCheckoutConfig {
  /** Default "2026-04-17". Use "2025-09-29" for ChatGPT Instant Checkout as deployed. */
  version?: AcpVersion;
  /** Override the address base path (e.g. when validating a billing address). */
  basePath?: string;
}
