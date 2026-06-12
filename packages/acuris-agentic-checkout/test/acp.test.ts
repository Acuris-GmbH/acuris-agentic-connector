import { describe, expect, it } from "vitest";
import type { ValidationResult } from "@acuris-geo/av-sdk";
import { parseAcpCountry, validateAcpAddress } from "../src/acp.js";
import type { AcpAddress } from "../src/types.js";

const ADDR: AcpAddress = {
  name: "Ada Lovelace",
  line_one: "Invalidenstrasse 117",
  city: "Berlin",
  state: "BE",
  country: "DE",
  postal_code: "10115",
};

function stub(partial: Partial<ValidationResult>) {
  return async () =>
    ({
      accuracy_type: "rooftop",
      confidence: 0.99,
      match_type: "exact",
      match_score: 100,
      match_components: {},
      input_corrected: false,
      ...partial,
    }) as ValidationResult;
}

describe("validateAcpAddress", () => {
  it("deliverable → empty messages", async () => {
    const check = await validateAcpAddress(ADDR, { validateFn: stub({}) });
    expect(check.verdict).toBe("deliverable");
    expect(check.messages).toEqual([]);
  });

  it("2026-04-17 default: invalid field error with fulfillment_details param + resolution", async () => {
    const check = await validateAcpAddress(ADDR, {
      validateFn: stub({
        accuracy_type: "postcode",
        confidence: 0.4,
        match_components: { street: false },
      }),
    });
    expect(check.messages).toEqual([
      {
        type: "error",
        code: "invalid",
        param: "$.fulfillment_details.address.line_one",
        content_type: "plain",
        content: "The street could not be verified against postal reference data.",
        resolution: "recoverable",
      },
    ]);
  });

  it("2025-09-29 (Instant Checkout): flat fulfillment_address param, no resolution field", async () => {
    const check = await validateAcpAddress(ADDR, {
      version: "2025-09-29",
      validateFn: stub({
        accuracy_type: "postcode",
        confidence: 0.4,
        match_components: { zip: false },
      }),
    });
    expect(check.messages[0]).toEqual({
      type: "error",
      code: "invalid",
      param: "$.fulfillment_address.postal_code",
      content_type: "plain",
      content: "The postal code could not be verified against postal reference data.",
    });
    expect(check.messages[0]).not.toHaveProperty("resolution");
  });

  it("missing fields → code missing, only enum-safe codes used", async () => {
    const check = await validateAcpAddress(
      { country: "DE", city: "Berlin" },
      { version: "2025-09-29", validateFn: stub({}) },
    );
    expect(check.verdict).toBe("missing_fields");
    for (const m of check.messages) {
      expect(["missing", "invalid"]).toContain(m.code);
    }
  });

  it("house number not found → invalid on line_one", async () => {
    const check = await validateAcpAddress(ADDR, {
      validateFn: stub({ house_number_not_found: true, accuracy_type: "street_center" }),
    });
    expect(check.messages[0]).toMatchObject({
      code: "invalid",
      param: "$.fulfillment_details.address.line_one",
    });
  });

  it("correctable → info message + corrected address using formatted_address first line", async () => {
    const check = await validateAcpAddress(ADDR, {
      validateFn: stub({
        input_corrected: true,
        corrections: ["Street corrected"],
        standardized: {
          country: "deu",
          city: "Berlin",
          postcode: "10115",
          street: "Invalidenstraße",
          house_number: "117",
          formatted_address: "Invalidenstraße 117\n10115 Berlin\nGermany",
        },
      }),
    });
    expect(check.verdict).toBe("correctable");
    expect(check.messages[0]?.type).toBe("info");
    expect(check.correctedAddress).toMatchObject({
      name: "Ada Lovelace",
      line_one: "Invalidenstraße 117",
      postal_code: "10115",
      country: "DE",
    });
  });

  it("unsupported / unavailable fail open by default", async () => {
    const noCountry = await validateAcpAddress({ ...ADDR, country: undefined }, {
      validateFn: stub({}),
    });
    expect(noCountry.verdict).toBe("unsupported_country");
    expect(noCountry.messages).toEqual([]);

    const closed = await validateAcpAddress({ ...ADDR, country: undefined }, {
      failClosed: true,
      validateFn: stub({}),
    });
    expect(closed.messages).toHaveLength(1);
  });
});

describe("parseAcpCountry", () => {
  it("alpha-2 only", () => {
    expect(parseAcpCountry("DE")).toBe("deu");
    expect(parseAcpCountry("DEU")).toBeUndefined();
    expect(parseAcpCountry("")).toBeUndefined();
  });
});
