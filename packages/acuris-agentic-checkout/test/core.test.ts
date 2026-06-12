import { describe, expect, it } from "vitest";
import type { ValidationResult } from "@acuris-geo/av-sdk";
import { assessAddress, classify } from "../src/core.js";

function result(partial: Partial<ValidationResult>): ValidationResult {
  return {
    accuracy_type: "rooftop",
    confidence: 0.99,
    match_type: "exact",
    match_score: 100,
    match_components: {},
    input_corrected: false,
    ...partial,
  } as ValidationResult;
}

describe("classify", () => {
  it("rooftop + high confidence + unchanged input → deliverable, no issues", () => {
    const a = classify(result({}));
    expect(a.verdict).toBe("deliverable");
    expect(a.issues).toEqual([]);
  });

  it("house_number_not_found → undeliverable on house_number", () => {
    const a = classify(result({ house_number_not_found: true, accuracy_type: "street_center" }));
    expect(a.verdict).toBe("undeliverable");
    expect(a.issues).toEqual([{ field: "house_number", kind: "not_found" }]);
  });

  it("address-level match with corrections → correctable", () => {
    const a = classify(
      result({
        input_corrected: true,
        corrections: ["Postcode corrected: 10117 → 10115"],
        standardized: { country: "deu", city: "Berlin", postcode: "10115", street: "Invalidenstraße" },
      }),
    );
    expect(a.verdict).toBe("correctable");
    expect(a.corrections).toHaveLength(1);
  });

  it("address-level match between min and exact confidence without corrections → deliverable", () => {
    const a = classify(result({ confidence: 0.8 }));
    expect(a.verdict).toBe("deliverable");
  });

  it("coarse accuracy tier → unverifiable with component issues", () => {
    const a = classify(
      result({
        accuracy_type: "locality",
        confidence: 0.9,
        match_components: { city: true, street: false, zip: false },
      }),
    );
    expect(a.verdict).toBe("unverifiable");
    expect(a.issues).toEqual([
      { field: "street", kind: "unmatched" },
      { field: "postcode", kind: "unmatched" },
    ]);
  });

  it("low confidence with no component detail → whole-address issue", () => {
    const a = classify(result({ confidence: 0.2, accuracy_type: null, match_components: {} }));
    expect(a.verdict).toBe("unverifiable");
    expect(a.issues).toEqual([{ field: "address", kind: "unmatched" }]);
  });

  it("respects custom thresholds", () => {
    const corrected = {
      input_corrected: true,
      standardized: { country: "deu" as const },
    };
    expect(classify(result({ confidence: 0.92, ...corrected }), { exactConfidence: 0.9 }).verdict)
      .toBe("correctable"); // still corrected → correctable even above exact
    expect(classify(result({ confidence: 0.92 }), { exactConfidence: 0.9 }).verdict)
      .toBe("deliverable");
    expect(classify(result({ confidence: 0.65 }), { minConfidence: 0.6 }).verdict)
      .toBe("deliverable");
  });
});

describe("assessAddress pre-checks", () => {
  it("missing country → unsupported_country without calling the API", async () => {
    const a = await assessAddress({ street: "Hauptstr. 1", city: "Worms" }, undefined, {
      validateFn: () => {
        throw new Error("must not be called");
      },
    });
    expect(a.verdict).toBe("unsupported_country");
  });

  it("missing street → missing_fields without calling the API", async () => {
    const a = await assessAddress({ city: "Worms", postcode: "67547" }, "deu", {
      validateFn: () => {
        throw new Error("must not be called");
      },
    });
    expect(a.verdict).toBe("missing_fields");
    expect(a.issues).toEqual([{ field: "street", kind: "missing" }]);
  });

  it("missing city AND postcode → missing_fields on postcode", async () => {
    const a = await assessAddress({ street: "Hauptstr. 1" }, "deu", {
      validateFn: () => {
        throw new Error("must not be called");
      },
    });
    expect(a.verdict).toBe("missing_fields");
    expect(a.issues).toEqual([{ field: "postcode", kind: "missing" }]);
  });

  it("validateFn result flows through classify", async () => {
    const a = await assessAddress(
      { street: "Hauptstr. 1", city: "Worms", postcode: "67547" },
      "deu",
      { validateFn: async () => result({ confidence: 0.97 }) },
    );
    expect(a.verdict).toBe("deliverable");
  });
});

describe("refineWithInput guards (live-API failure modes, 2026-06-12 smoke test)", () => {
  it("house-number rewrite (117 → 1 at rooftop/conf 1) downgrades to unverifiable and withholds the correction", async () => {
    // Real behavior observed live: Invalidenstrasse 117 → standardized
    // Invalidenstr. 1, accuracy rooftop, confidence 1, house_number: false.
    const a = await assessAddress(
      { street: "Invalidenstrasse 117", city: "Berlin", postcode: "10115" },
      "deu",
      {
        validateFn: async () =>
          result({
            confidence: 1,
            input_corrected: true,
            corrections: ["Street"],
            match_components: { city: true, street: true, zip: true, house_number: false, state: false },
            standardized: {
              country: "deu",
              city: "Berlin",
              postcode: "10115",
              street: "Invalidenstr.",
              house_number: "1",
            },
          }),
      },
    );
    expect(a.verdict).toBe("unverifiable");
    expect(a.issues).toEqual([{ field: "house_number", kind: "unmatched" }]);
    expect(a.standardized).toBeUndefined();
  });

  it("preserved house number with house_number:false flag stays correctable (US casing fix)", async () => {
    const a = await assessAddress(
      { street: "1600 Pennsylvania Ave NW", city: "Washington", state: "DC", postcode: "20500" },
      "usa",
      {
        validateFn: async () =>
          result({
            confidence: 1,
            input_corrected: true,
            corrections: ["Street"],
            match_components: { city: true, street: true, zip: true, state: true, house_number: false },
            standardized: {
              country: "usa",
              city: "WASHINGTON",
              state: "DC",
              postcode: "20500",
              street: "Pennsylvania Ave Nw",
              house_number: "1600",
            },
          }),
      },
    );
    expect(a.verdict).toBe("correctable");
    expect(a.standardized).toBeDefined();
  });

  it("unverifiable issues are filtered to fields the buyer supplied, street+hno collapse to one", async () => {
    const a = await assessAddress(
      { street: "Invalidenstrasse 99999", city: "Berlin", postcode: "10115" }, // no state submitted
      "deu",
      {
        validateFn: async () =>
          result({
            accuracy_type: "postcode_centroid",
            confidence: 0,
            match_components: { city: true, zip: true, street: false, house_number: false, state: false },
          }),
      },
    );
    expect(a.verdict).toBe("unverifiable");
    expect(a.issues).toEqual([{ field: "street", kind: "unmatched" }]);
  });
});
