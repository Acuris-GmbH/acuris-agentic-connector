import { AcurisClient, type FieldedAddressInput } from "@acuris-geo/av-sdk";
import { assessAddress, FIELD_LABELS } from "./core.js";
import { iso2ToIso3, iso3ToIso2 } from "./iso.js";
import { composeStreetLine } from "./ucp.js";
import type {
  AcpAddress,
  AcpAddressCheck,
  AcpMessage,
  AcpOptions,
  AddressField,
  Assessment,
} from "./types.js";

/**
 * Validate an ACP fulfillment address inside a merchant checkout-session
 * endpoint (POST /checkout_sessions and POST /checkout_sessions/{id}).
 *
 *   const check = await validateAcpAddress(session.fulfillment_address, { apiKey });
 *   session.messages.push(...check.messages);
 *   if (check.correctedAddress) session.fulfillment_address = check.correctedAddress;
 *
 * Only the codes `missing` and `invalid` are emitted — both exist in the
 * closed 2025-09-29 enum (ChatGPT Instant Checkout) and the 2026-04-17 enum,
 * so output is valid against either version. Targeting 2026-04-17 adds
 * `resolution: "recoverable"` so the agent knows it may retry via the API.
 */
export async function validateAcpAddress(
  address: AcpAddress,
  options: AcpOptions = {},
  clientOverride?: AcurisClient,
): Promise<AcpAddressCheck> {
  const version = options.version ?? "2026-04-17";
  const basePath =
    options.basePath ??
    (version === "2025-09-29" ? "$.fulfillment_address" : "$.fulfillment_details.address");

  const countryIso3 = parseAcpCountry(address.country);
  if (countryIso3 && isExcluded(countryIso3, options)) {
    return {
      verdict: "unsupported_country",
      messages: options.failClosed
        ? [message("invalid", basePath, "address", version)]
        : [],
    };
  }

  const input: FieldedAddressInput = {
    street: address.line_one,
    city: address.city,
    state: address.state,
    postcode: address.postal_code,
  };

  const assessment = await assessAddress(input, countryIso3, options, clientOverride);
  return {
    verdict: assessment.verdict,
    messages: toAcpMessages(assessment, basePath, version, options),
    correctedAddress: buildCorrectedAddress(assessment, address),
    result: assessment.result,
  };
}

/** Pure mapper: Assessment → ACP `messages[]` entries. Exported for custom flows. */
export function toAcpMessages(
  assessment: Assessment,
  basePath: string,
  version: AcpOptions["version"] = "2026-04-17",
  options: AcpOptions = {},
): AcpMessage[] {
  switch (assessment.verdict) {
    case "deliverable":
      return [];

    case "correctable":
      if (options.annotateCorrections === false) return [];
      return [
        {
          type: "info",
          param: basePath,
          content_type: "plain",
          content:
            assessment.corrections.length > 0
              ? `Shipping address was standardized: ${assessment.corrections.join("; ")}`
              : "Shipping address was standardized against postal reference data.",
        },
      ];

    case "missing_fields":
      return assessment.issues.map((issue) =>
        message("missing", basePath, issue.field, version,
          `Shipping address is missing the ${FIELD_LABELS[issue.field]}.`),
      );

    case "undeliverable":
      return [
        message("invalid", basePath, "street", version,
          "The house number was not found on this street — the address does not appear to be deliverable."),
      ];

    case "unverifiable":
      return assessment.issues.map((issue) => message("invalid", basePath, issue.field, version));

    case "unsupported_country":
      if (!options.failClosed) return [];
      return [
        message("missing", basePath, "country", version,
          "Shipping address country is missing or not supported."),
      ];

    case "unavailable":
      if (!options.failClosed) return [];
      return [message("invalid", basePath, "address", version)];
  }
}

function message(
  code: "missing" | "invalid",
  basePath: string,
  field: AddressField,
  version: AcpOptions["version"],
  content?: string,
): AcpMessage {
  const msg: AcpMessage = {
    type: "error",
    code,
    param: fieldParam(basePath, field),
    content_type: "plain",
    content:
      content ??
      (field === "address"
        ? "The shipping address could not be verified against postal reference data."
        : `The ${FIELD_LABELS[field]} could not be verified against postal reference data.`),
  };
  if (version === "2026-04-17") msg.resolution = "recoverable";
  return msg;
}

/** ACP keeps the whole street line (incl. house number) in line_one. */
function fieldParam(basePath: string, field: AddressField): string {
  const suffix: Record<AddressField, string> = {
    street: ".line_one",
    house_number: ".line_one",
    city: ".city",
    state: ".state",
    postcode: ".postal_code",
    country: ".country",
    address: "",
  };
  return `${basePath}${suffix[field]}`;
}

function buildCorrectedAddress(
  assessment: Assessment,
  original: AcpAddress,
): AcpAddress | undefined {
  const s = assessment.standardized;
  if (!s) return undefined;
  if (assessment.verdict !== "correctable" && assessment.verdict !== "deliverable") {
    return undefined;
  }
  // Prefer the locale-appropriate first line of formatted_address; otherwise
  // compose street + house number by country convention.
  const firstLine = s.formatted_address?.split("\n")[0]?.trim();
  const line_one =
    firstLine ||
    ([s.street, s.house_number].some(Boolean)
      ? composeStreetLine(s.street, s.house_number, s.country)
      : original.line_one);
  return {
    ...original,
    line_one,
    city: s.city ?? original.city,
    state: s.state ?? original.state,
    postal_code: s.postcode ?? original.postal_code,
    country: s.country ? iso3ToIso2(s.country) : original.country,
  };
}

/** ACP mandates ISO 3166-1 alpha-2. Returns Acuris ISO-3 lowercase. */
export function parseAcpCountry(country?: string): string | undefined {
  if (!country) return undefined;
  const c = country.trim();
  if (c.length !== 2) return undefined;
  const iso3 = iso2ToIso3(c);
  return iso3.length === 3 ? iso3 : undefined;
}

function isExcluded(countryIso3: string, options: AcpOptions): boolean {
  const skip = new Set(
    (options.unsupportedCountries ?? []).map((c) => iso2ToIso3(c.toUpperCase())),
  );
  return skip.has(countryIso3);
}
