import {
  AcurisClient,
  AcurisError,
  AcurisNotFoundError,
  validateAddress,
  type FieldedAddressInput,
  type ValidationResult,
} from "@acuris-geo/av-sdk";

type MatchComponents = ValidationResult["match_components"];
import type {
  AgenticCheckoutConfig,
  Assessment,
  FieldIssue,
} from "./types.js";

const DEFAULT_EXACT = 0.95;
const DEFAULT_MIN = 0.7;

/** Accuracy tiers that pin an individual address (vs. area centroids). */
const ADDRESS_LEVEL = new Set(["rooftop", "parcel", "street_interpolated"]);

/**
 * Protocol-independent core: validate one fielded address against Acuris and
 * classify the outcome. The UCP/ACP mappers turn the resulting Assessment
 * into their wire formats; nothing in here knows about either protocol.
 */
export async function assessAddress(
  input: FieldedAddressInput,
  countryIso3: string | undefined,
  config: AgenticCheckoutConfig = {},
  clientOverride?: AcurisClient,
): Promise<Assessment> {
  if (!countryIso3) {
    return { verdict: "unsupported_country", issues: [{ field: "country", kind: "missing" }], corrections: [] };
  }

  const missing: FieldIssue[] = [];
  if (!input.street?.trim()) missing.push({ field: "street", kind: "missing" });
  if (!input.city?.trim() && !input.postcode?.trim()) {
    missing.push({ field: "postcode", kind: "missing" });
  }
  if (missing.length > 0) {
    return { verdict: "missing_fields", issues: missing, corrections: [] };
  }

  const validate = config.validateFn ?? validateAddress;
  // Only construct a real client when the default validateAddress needs one —
  // the constructor throws without an API key, which a validateFn seam or an
  // injected client must not require.
  const client =
    clientOverride ?? (config.validateFn ? (undefined as unknown as AcurisClient) : buildClient(config));

  let result: ValidationResult;
  try {
    result = await validate(client, input, { country: countryIso3 });
  } catch (err) {
    if (err instanceof AcurisNotFoundError) {
      return { verdict: "unverifiable", issues: [{ field: "address", kind: "unmatched" }], corrections: [] };
    }
    if (err instanceof AcurisError) {
      return { verdict: "unavailable", issues: [], corrections: [] };
    }
    return { verdict: "unavailable", issues: [], corrections: [] };
  }

  return refineWithInput(classify(result, config), input);
}

/**
 * Input-aware post-processing of a raw classification:
 *
 * 1. House-number rewrite guard. When the exact house number is not in the
 *    reference data, /validate can return a *different* house number in
 *    `standardized` (the matched row's) while still reporting rooftop
 *    accuracy — match_components.house_number is false in that case. Echoing
 *    that back would re-route the parcel to the wrong building, so a
 *    correction that does not preserve the submitted house number downgrades
 *    to `unverifiable` on the house number and withholds the standardized
 *    form.
 * 2. Only report unmatched components the buyer actually submitted (an empty
 *    state field on a DEU address is not the agent's problem).
 * 3. Street + house number share one wire field in UCP/ACP — collapse the
 *    pair into a single street issue.
 */
export function refineWithInput(
  assessment: Assessment,
  input: FieldedAddressInput,
): Assessment {
  let a = assessment;

  if (
    (a.verdict === "deliverable" || a.verdict === "correctable") &&
    a.result?.match_components?.house_number === false &&
    !houseNumberPreserved(input, a.standardized?.house_number)
  ) {
    a = {
      ...a,
      verdict: "unverifiable",
      issues: [{ field: "house_number", kind: "unmatched" }],
      standardized: undefined,
    };
  }

  if (a.verdict === "unverifiable") {
    const supplied = (field: FieldIssue["field"]): boolean => {
      switch (field) {
        case "street":
        case "house_number":
          return Boolean(input.street?.trim() || input.house_number?.trim());
        case "city":
          return Boolean(input.city?.trim());
        case "state":
          return Boolean(input.state?.trim());
        case "postcode":
          return Boolean(input.postcode?.trim());
        default:
          return true;
      }
    };
    let issues = a.issues.filter((i) => supplied(i.field));
    if (issues.some((i) => i.field === "street")) {
      issues = issues.filter((i) => i.field !== "house_number");
    }
    if (issues.length === 0) issues = [{ field: "address", kind: "unmatched" }];
    a = { ...a, issues };
  }

  return a;
}

/**
 * True when the standardized house number already appears as a number token
 * in what the buyer typed (house numbers arrive embedded in the street line
 * for both UCP and ACP).
 */
function houseNumberPreserved(
  input: FieldedAddressInput,
  standardizedHno: string | undefined,
): boolean {
  if (!standardizedHno) return true;
  const typed = `${input.house_number ?? ""} ${input.street ?? ""}`;
  const tokens = typed.match(/\d+[a-zA-Z]?(?:[/-]\d+[a-zA-Z]?)*/g) ?? [];
  const std = standardizedHno.trim().toLowerCase();
  return tokens.some((t) => t.toLowerCase() === std);
}

export function classify(
  result: ValidationResult,
  config: AgenticCheckoutConfig = {},
): Assessment {
  const exactConfidence = config.exactConfidence ?? DEFAULT_EXACT;
  const minConfidence = config.minConfidence ?? DEFAULT_MIN;
  const corrections = result.corrections ?? [];
  const base = { result, standardized: result.standardized, corrections };

  // Street verified but the house number does not exist on it.
  if (result.house_number_not_found === true) {
    return {
      verdict: "undeliverable",
      issues: [{ field: "house_number", kind: "not_found" }],
      ...base,
    };
  }

  const addressLevel =
    result.accuracy_type !== null && ADDRESS_LEVEL.has(result.accuracy_type);
  const wasCorrected = result.input_corrected === true || corrections.length > 0;

  if (addressLevel && result.confidence >= exactConfidence && !wasCorrected) {
    return { verdict: "deliverable", issues: [], ...base };
  }

  if (addressLevel && result.confidence >= minConfidence) {
    if (wasCorrected && result.standardized) {
      return { verdict: "correctable", issues: [], ...base };
    }
    return { verdict: "deliverable", issues: [], ...base };
  }

  // Coarse tier (postcode/locality centroid) or low confidence: report which
  // components failed to match when the API tells us, else the whole address.
  const issues = componentIssues(result.match_components);
  return {
    verdict: "unverifiable",
    issues: issues.length > 0 ? issues : [{ field: "address", kind: "unmatched" }],
    ...base,
  };
}

function componentIssues(components: MatchComponents | undefined): FieldIssue[] {
  if (!components) return [];
  const map: Array<[keyof MatchComponents, FieldIssue["field"]]> = [
    ["street", "street"],
    ["house_number", "house_number"],
    ["city", "city"],
    ["state", "state"],
    ["zip", "postcode"],
  ];
  return map
    .filter(([key]) => components[key] === false)
    .map(([, field]) => ({ field, kind: "unmatched" as const }));
}

export function buildClient(config: AgenticCheckoutConfig): AcurisClient {
  return new AcurisClient({
    apiKey: config.apiKey ?? process.env.ACURIS_API_KEY,
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs ?? 3000,
    userAgent: "acuris-agentic-checkout/0.1.0",
  });
}

/** Field labels for human-readable message content. */
export const FIELD_LABELS: Record<FieldIssue["field"], string> = {
  street: "street",
  house_number: "house number",
  city: "city",
  state: "state / region",
  postcode: "postal code",
  country: "country",
  address: "address",
};
