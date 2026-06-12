import { AcurisClient, type FieldedAddressInput } from "@acuris-geo/av-sdk";
import { assessAddress, FIELD_LABELS } from "./core.js";
import { iso2ToIso3, iso3ToIso2 } from "./iso.js";
import type {
  AddressField,
  Assessment,
  UcpDestinationCheck,
  UcpMessage,
  UcpOptions,
  UcpShippingDestination,
} from "./types.js";

/**
 * Validate a UCP shipping destination inside a merchant checkout-session
 * endpoint (POST /checkout-sessions and PUT /checkout-sessions/{id}).
 *
 *   const check = await validateUcpDestination(destination, { apiKey });
 *   checkout.messages.push(...check.messages);
 *   if (check.correctedDestination) {
 *     // echo the standardized form back as the authoritative destination
 *   }
 *
 * Codes follow Google's UCP error-code registry: `missing_fulfillment_info`
 * for absent fields, `address_undeliverable` (core-spec standard error) when
 * the house number does not exist, `address_unverifiable` when no confident
 * match is found. All address errors use severity `recoverable` so the agent
 * platform can correct the input and retry, per the spec's standard-error
 * guidance.
 */
export async function validateUcpDestination(
  destination: UcpShippingDestination,
  options: UcpOptions = {},
  clientOverride?: AcurisClient,
): Promise<UcpDestinationCheck> {
  const basePath =
    options.basePath ??
    `$.fulfillment.methods[${options.methodIndex ?? 0}].destinations[${options.destinationIndex ?? 0}]`;

  const countryIso3 = parseUcpCountry(destination.address_country);
  if (countryIso3 && isExcluded(countryIso3, options)) {
    return {
      verdict: "unsupported_country",
      messages: options.failClosed
        ? [unverifiableMessage(basePath, "address", options)]
        : [],
    };
  }

  const input: FieldedAddressInput = {
    street: destination.street_address,
    city: destination.address_locality,
    state: destination.address_region,
    postcode: destination.postal_code,
  };

  const assessment = await assessAddress(input, countryIso3, options, clientOverride);
  return {
    verdict: assessment.verdict,
    messages: toUcpMessages(assessment, basePath, options),
    correctedDestination: buildCorrectedDestination(assessment, destination),
    result: assessment.result,
  };
}

/** Pure mapper: Assessment → UCP `messages[]` entries. Exported for custom flows. */
export function toUcpMessages(
  assessment: Assessment,
  basePath: string,
  options: UcpOptions = {},
): UcpMessage[] {
  switch (assessment.verdict) {
    case "deliverable":
      return [];

    case "correctable":
      if (options.annotateCorrections === false) return [];
      return [
        {
          type: "warning",
          code: "address_standardized",
          path: basePath,
          content:
            assessment.corrections.length > 0
              ? `Shipping address was standardized: ${assessment.corrections.join("; ")}`
              : "Shipping address was standardized against postal reference data.",
          content_type: "plain",
        },
      ];

    case "missing_fields":
      return assessment.issues.map((issue) => ({
        type: "error" as const,
        code: "missing_fulfillment_info",
        path: fieldPath(basePath, issue.field),
        content: `Shipping address is missing the ${FIELD_LABELS[issue.field]}.`,
        content_type: "plain" as const,
        severity: "recoverable" as const,
      }));

    case "undeliverable":
      return [
        {
          type: "error",
          code: "address_undeliverable",
          path: fieldPath(basePath, "street"),
          content:
            "The house number was not found on this street — the address does not appear to be deliverable.",
          content_type: "plain",
          severity: "recoverable",
        },
      ];

    case "unverifiable":
      return assessment.issues.map((issue) =>
        unverifiableMessage(basePath, issue.field, options),
      );

    case "unsupported_country":
      if (!options.failClosed) return [];
      // Country missing vs. excluded both surface as missing info on the field.
      return [
        {
          type: "error",
          code: "missing_fulfillment_info",
          path: fieldPath(basePath, "country"),
          content: "Shipping address country is missing or not supported.",
          content_type: "plain",
          severity: "recoverable",
        },
      ];

    case "unavailable":
      if (!options.failClosed) return [];
      return [unverifiableMessage(basePath, "address", options)];
  }
}

function unverifiableMessage(
  basePath: string,
  field: AddressField,
  _options: UcpOptions,
): UcpMessage {
  return {
    type: "error",
    code: "address_unverifiable",
    path: fieldPath(basePath, field),
    content:
      field === "address"
        ? "The shipping address could not be verified against postal reference data."
        : `The ${FIELD_LABELS[field]} could not be verified against postal reference data.`,
    content_type: "plain",
    severity: "recoverable",
  };
}

/**
 * UCP destination fields carry no separate house-number slot — the street
 * line holds both — so street and house_number issues both point at
 * `street_address`.
 */
function fieldPath(basePath: string, field: AddressField): string {
  const suffix: Record<AddressField, string> = {
    street: ".street_address",
    house_number: ".street_address",
    city: ".address_locality",
    state: ".address_region",
    postcode: ".postal_code",
    country: ".address_country",
    address: "",
  };
  return `${basePath}${suffix[field]}`;
}

function buildCorrectedDestination(
  assessment: Assessment,
  original: UcpShippingDestination,
): UcpShippingDestination | undefined {
  const s = assessment.standardized;
  if (!s) return undefined;
  if (assessment.verdict !== "correctable" && assessment.verdict !== "deliverable") {
    return undefined;
  }
  const street = [s.street, s.house_number].some(Boolean)
    ? composeStreetLine(s.street, s.house_number, s.country)
    : original.street_address;
  return {
    ...original,
    street_address: street,
    address_locality: s.city ?? original.address_locality,
    address_region: s.state ?? original.address_region,
    postal_code: s.postcode ?? original.postal_code,
    address_country: s.country ? iso3ToIso2(s.country) : original.address_country,
  };
}

/** Countries that write the house number before the street name. */
const NUMBER_FIRST = new Set([
  "usa", "can", "gbr", "irl", "fra", "aus", "nzl", "zaf", "sgp", "hkg", "ind", "phl", "mys",
]);

export function composeStreetLine(
  street?: string,
  houseNumber?: string,
  countryIso3?: string,
): string {
  if (!street) return houseNumber ?? "";
  if (!houseNumber) return street;
  return NUMBER_FIRST.has((countryIso3 ?? "").toLowerCase())
    ? `${houseNumber} ${street}`
    : `${street} ${houseNumber}`;
}

/**
 * UCP spec: alpha-2 recommended; alpha-3 and full country names tolerated.
 * Returns Acuris ISO-3 lowercase, or undefined when unparseable.
 */
export function parseUcpCountry(country?: string): string | undefined {
  if (!country) return undefined;
  const c = country.trim();
  if (c.length === 2) {
    const iso3 = iso2ToIso3(c);
    return iso3.length === 3 ? iso3 : undefined;
  }
  if (c.length === 3) {
    // Round-trip guards against junk: a real alpha-3 maps back to an alpha-2.
    const iso2 = iso3ToIso2(c);
    return iso2.length === 2 ? c.toLowerCase() : undefined;
  }
  return undefined;
}

function isExcluded(countryIso3: string, options: UcpOptions): boolean {
  const skip = new Set(
    (options.unsupportedCountries ?? []).map((c) => iso2ToIso3(c.toUpperCase())),
  );
  return skip.has(countryIso3);
}
