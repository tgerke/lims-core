import { describe, expect, it } from "vitest";
import { formatAccessionId, isAccessionId } from "./index.js";

describe("formatAccessionId", () => {
  it("builds a sanitized, zero-padded id", () => {
    expect(formatAccessionId("STUDY-001", 42)).toBe("STUDY-001-00042");
    expect(formatAccessionId("s.0001/x", 1)).toBe("S-0001-X-00001");
  });

  it("round-trips through the validator", () => {
    expect(isAccessionId(formatAccessionId("STUDY", 99999))).toBe(true);
    expect(isAccessionId("not an id")).toBe(false);
  });
});
