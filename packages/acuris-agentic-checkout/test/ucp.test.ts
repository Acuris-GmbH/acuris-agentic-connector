import { describe, expect, it } from "vitest";
import type { ValidationResult } from "@acuris-geo/av-sdk";
import { composeStreetLine, parseUcpCountry, validateUcpDestination } from "../src/ucp.js";
import type { UcpShippingDestination } from "../src/types.js";

const DEST: UcpShippingDestination = {
  id: "dest_1",
  street_address: "Invalidenstrasse 117",
  address_locality: "Berlin",
  postal_code: "10115",
  address_country: "DE",
  first_name: "Ada",
  last_name: "Lovelace",
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

describe("validateUcpDestination", () => {
  it("deliverable → empty messages", async () => {
    const check = await validateUcpDestination(DEST, { validateFn: stub({}) });
    expect(check.verdict).toBe("deliverable");
    expect(check.messages).toEqual([]);
  });

  it("unverifiable → address_unverifiable with per-field RFC 9535 paths", async () => {
    const check = await validateUcpDestination(DEST, {
      validateFn: stub({
        accuracy_type: "locality",
        confidence: 0.5,
        match_components: { zip: false },
      }),
    });
    expect(check.verdict).toBe("unverifiable");
    expect(check.messages).toEqual([
      {
        type: "error",
        code: "address_unverifiable",
        path: "$.fulfillment.methods[0].destinations[0].postal_code",
        content: "The postal code could not be verified against postal reference data.",
        content_type: "plain",
        severity: "recoverable",
      },
    ]);
  });

  it("house number not found → address_undeliverable on street_address", async () => {
    const check = await validateUcpDestination(DEST, {
      validateFn: stub({ house_number_not_found: true, accuracy_type: "street_center" }),
    });
    expect(check.messages[0]).toMatchObject({
      code: "address_undeliverable",
      path: "$.fulfillment.methods[0].destinations[0].street_address",
      severity: "recoverable",
    });
  });

  it("missing fields → missing_fulfillment_info per field", async () => {
    const check = await validateUcpDestination(
      { address_country: "DE", address_locality: "Berlin" },
      { validateFn: stub({}) },
    );
    expect(check.verdict).toBe("missing_fields");
    expect(check.messages.map((m) => m.code)).toEqual(["missing_fulfillment_info"]);
    expect(check.messages[0]?.path).toBe(
      "$.fulfillment.methods[0].destinations[0].street_address",
    );
  });

  it("correctable → warning + corrected destination preserving id and contact fields", async () => {
    const check = await validateUcpDestination(DEST, {
      validateFn: stub({
        input_corrected: true,
        corrections: ["Street corrected"],
        standardized: {
          country: "deu",
          city: "Berlin",
          postcode: "10115",
          street: "Invalidenstraße",
          house_number: "117",
        },
      }),
    });
    expect(check.verdict).toBe("correctable");
    expect(check.messages[0]).toMatchObject({ type: "warning", code: "address_standardized" });
    expect(check.correctedDestination).toMatchObject({
      id: "dest_1",
      street_address: "Invalidenstraße 117",
      address_country: "DE",
      first_name: "Ada",
    });
  });

  it("annotateCorrections:false suppresses the standardization warning", async () => {
    const check = await validateUcpDestination(DEST, {
      annotateCorrections: false,
      validateFn: stub({
        input_corrected: true,
        standardized: { country: "deu", street: "Invalidenstraße", house_number: "117" },
      }),
    });
    expect(check.messages).toEqual([]);
    expect(check.correctedDestination).toBeDefined();
  });

  it("custom method/destination indices change the path", async () => {
    const check = await validateUcpDestination(DEST, {
      methodIndex: 1,
      destinationIndex: 2,
      validateFn: stub({ accuracy_type: null, confidence: 0, match_components: {} }),
    });
    expect(check.messages[0]?.path).toBe("$.fulfillment.methods[1].destinations[2]");
  });

  it("unsupported country fails open by default, closed when configured", async () => {
    const dest = { ...DEST, address_country: "XX" };
    const open = await validateUcpDestination(dest, { validateFn: stub({}) });
    expect(open.verdict).toBe("unsupported_country");
    expect(open.messages).toEqual([]);

    const closed = await validateUcpDestination(dest, {
      failClosed: true,
      validateFn: stub({}),
    });
    expect(closed.messages[0]?.code).toBe("missing_fulfillment_info");
  });

  it("excluded country via unsupportedCountries skips validation", async () => {
    const check = await validateUcpDestination(DEST, {
      unsupportedCountries: ["DE"],
      validateFn: () => {
        throw new Error("must not be called");
      },
    });
    expect(check.verdict).toBe("unsupported_country");
    expect(check.messages).toEqual([]);
  });
});

describe("parseUcpCountry", () => {
  it("accepts alpha-2, alpha-3, rejects junk", () => {
    expect(parseUcpCountry("DE")).toBe("deu");
    expect(parseUcpCountry("deu")).toBe("deu");
    expect(parseUcpCountry("Germany")).toBeUndefined();
    expect(parseUcpCountry("XX")).toBeUndefined();
    expect(parseUcpCountry(undefined)).toBeUndefined();
  });
});

describe("composeStreetLine", () => {
  it("number-first for US/GB, street-first for DE", () => {
    expect(composeStreetLine("Main St", "123", "usa")).toBe("123 Main St");
    expect(composeStreetLine("Hauptstraße", "5", "deu")).toBe("Hauptstraße 5");
    expect(composeStreetLine("Hauptstraße", undefined, "deu")).toBe("Hauptstraße");
  });
});
