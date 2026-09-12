import { describe, expect, it } from "vitest";
import {
  buildEml,
  buildSubject,
  createDemoFields,
  getMissingRequiredFields,
  normalizeDate,
  validateContainerNumber,
} from "../shared/shipping";

describe("shipping helpers", () => {
  it("builds the required subject format", () => {
    expect(buildSubject(createDemoFields())).toBe(
      "SPLIT MANIFEST // CNTR: BMOU4873674 // VSL: YES 26706W // MBL: SIJEAAEC26005671 // ETD: 2026/09/05 // POL: DUBAI",
    );
  });

  it("normalizes common date formats and flags ambiguity", () => {
    expect(normalizeDate("2026-09-05")).toEqual({ value: "2026/09/05", ambiguous: false });
    expect(normalizeDate("05-Sep-2026")).toEqual({ value: "2026/09/05", ambiguous: false });
    expect(normalizeDate("05/09/2026").ambiguous).toBe(true);
  });

  it("accepts ISO-shaped container numbers and flags suspicious values", () => {
    expect(validateContainerNumber("BMOU4873674").valid).toBe(true);
    expect(validateContainerNumber("BMOU-4873674").suspicious).toBe(true);
  });

  it("blocks generation when a required field is missing", () => {
    const fields = createDemoFields();
    fields.mbl_number.value = "";
    expect(getMissingRequiredFields(fields)).toEqual(["MBL Number"]);
  });

  it("includes original filenames in generated Outlook-compatible EML", async () => {
    const file = new File(["%PDF-demo"], "MBL.pdf", { type: "application/pdf" });
    const eml = await buildEml("Subject", "<p>Body</p>", "Body", [{ name: file.name, file }]);
    expect(eml).toContain("Content-Disposition: attachment; filename=\"MBL.pdf\"");
    expect(eml).toContain("multipart/mixed");
    expect(eml).toContain("Subject: Subject");
  });
});
