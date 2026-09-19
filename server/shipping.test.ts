import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildEml,
  buildSubject,
  buildPlainTextBody,
  createDemoFields,
  extractFieldsFromFiles,
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
    const secondFile = new File(["booking"], "Booking.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const eml = await buildEml("Subject", "<p>Body</p>", "Body", [{ name: file.name, file }, { name: secondFile.name, file: secondFile }], { to: ["agent1@example.com", "agent2@example.com"], cc: ["kaivan@arameshabi.com"] });
    expect(eml).toContain("Content-Disposition: attachment; filename=\"MBL.pdf\"");
    expect(eml).toContain("Content-Disposition: attachment; filename=\"Booking.xlsx\"");
    expect(eml).toContain("multipart/mixed");
    expect(eml).toContain("Subject: Subject");
    expect(eml).toContain("To: agent1@example.com, agent2@example.com");
    expect(eml).toContain("Cc: kaivan@arameshabi.com");
  });

  it("uses explicit source labels for seal and agent instead of demo placeholders", async () => {
    const source = new File(["Seal Number: SEAL-7788\nOur Agent: Gulf Shipping LLC"], "Manifest.txt", { type: "text/plain" });
    const fields = await extractFieldsFromFiles([{ file: source, name: source.name, kind: "text" }]);
    expect(fields.seal_number.value).toBe("SEAL-7788");
    expect(fields.agent_name.value).toBe("Gulf Shipping LLC");
    expect(fields.seal_number.status).toBe("Confirmed");
  });

  it("flags conflicting values found across documents", async () => {
    const first = new File(["MBL: MASTER-001\nContainer: BMOU4873674"], "Manifest.txt", { type: "text/plain" });
    const second = new File(["MBL: MASTER-002\nContainer: BMOU4873674"], "MBL.txt", { type: "text/plain" });
    const fields = await extractFieldsFromFiles([
      { file: first, name: first.name, kind: "text" },
      { file: second, name: second.name, kind: "text" },
    ]);
    expect(fields.mbl_number.status).toBe("Needs Review");
    expect(fields.mbl_number.value).toBe("MASTER-001");
    expect(fields.mbl_number.sourceFile).toContain("Manifest.txt");
    expect(fields.mbl_number.sourceFile).toContain("MBL.txt");
  });

  it("extracts PDF-style fields when labels are separated by spaces", async () => {
    const pdfText = new File(["ETD 2026/09/05 Vessel YES Voyage 26706W POL DUBAI Container Number BMOU4873674 Seal Number SEAL-1 Shipper ABC Logistics"], "Booking.pdf", { type: "application/pdf" });
    const fields = await extractFieldsFromFiles([{ file: pdfText, name: pdfText.name, kind: "text" }]);
    expect(fields.etd_date.value).toBe("2026/09/05");
    expect(fields.vessel_name.value).toBe("YES");
    expect(fields.voyage_number.value).toBe("26706W");
    expect(fields.pol.value).toBe("DUBAI");
    expect(fields.container_number.value).toBe("BMOU4873674");
    expect(fields.agent_name.value).toBe("ABC Logistics");
  });

  it("extracts fields from Excel headers with values on the next row", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["ETD", "Vessel", "Voyage", "POL", "CNTR", "Seal", "Shipper"], ["2026/09/05", "YES", "26706W", "DUBAI", "BMOU4873674", "SEAL-2", "ABC Logistics"]]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Shipment");
    const excel = new File([XLSX.write(workbook, { bookType: "xlsx", type: "array" })], "Shipment.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const fields = await extractFieldsFromFiles([{ file: excel, name: excel.name, kind: "excel" }]);
    expect(fields.etd_date.value).toBe("2026/09/05");
    expect(fields.vessel_name.value).toBe("YES");
    expect(fields.container_number.value).toBe("BMOU4873674");
    expect(fields.agent_name.value).toBe("ABC Logistics");
  });

  it("extracts the supplied logistics workbook schema directly", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["MBL", "BLIssueDateH", "POL", "POLText", "ShipperText", "CNTR", "SealNo"],
      ["SIJEAAEC26005471A", "9/5/26", 29, "Jebel Ali", "LARA SHIPPING LINE LLC", "BMOU4873674", "CSL013491"],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const excel = new File([XLSX.write(workbook, { bookType: "xlsx", type: "array" })], "BMOU4873674-40X11.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const fields = await extractFieldsFromFiles([{ file: excel, name: excel.name, kind: "excel" }]);
    expect(fields.container_number.value).toBe("BMOU4873674");
    expect(fields.seal_number.value).toBe("CSL013491");
    expect(fields.etd_date.value).toBe("2026/09/05");
    expect(fields.pol.value).toBe("Jebel Ali");
    expect(fields.agent_name.value).toBe("LARA SHIPPING LINE LLC");
  });

  it("consolidates repeated line-item MBL suffixes into one master number", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["MBL", "CNTR"],
      ["SIJEAAEC26005471A", "BMOU4873674"],
      ["SIJEAAEC26005471B", "BMOU4873674"],
      ["SIJEAAEC26005471C", "BMOU4873674"],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
    const excel = new File([XLSX.write(workbook, { bookType: "xlsx", type: "array" })], "line-items.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const fields = await extractFieldsFromFiles([{ file: excel, name: excel.name, kind: "excel" }]);
    expect(fields.mbl_number.status).toBe("Confirmed");
    expect(fields.mbl_number.value).toBe("SIJEAAEC26005471");
  });

  it("retains containers from multiple Excel files under one MBL", async () => {
    const makeExcel = (name: string, container: string) => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["MBL", "CNTR"], ["ABC123456", container]]), "Manifest");
      return new File([XLSX.write(workbook, { bookType: "xlsx", type: "array" })], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    };
    const first = makeExcel("container-1.xlsx", "MSKU1234567");
    const second = makeExcel("container-2.xlsx", "TGHU7654321");
    const fields = await extractFieldsFromFiles([
      { file: first, name: first.name, kind: "excel" },
      { file: second, name: second.name, kind: "excel" },
    ]);
    expect(fields.containers).toEqual(["MSKU1234567", "TGHU7654321"]);
    expect(buildSubject(fields)).toContain("MSKU1234567 / TGHU7654321");
    expect(buildPlainTextBody(fields, "")).toContain("MSKU1234567, TGHU7654321");
  });

  it("extracts ETD, vessel, voyage, and seal per container from MBL-style Excel headers", async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["MBL", "ETDText", "VesselText", "VoyageText", "CNTR", "SealNo"],
      ["ABC123456", "2026/09/05", "OCEAN STAR", "W123", "MSKU1234567", "SEAL-001"],
      ["ABC123456", "2026/09/05", "OCEAN STAR", "W123", "TGHU7654321", "SEAL-002"],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "MBL");
    const excel = new File([XLSX.write(workbook, { bookType: "xlsx", type: "array" })], "MBL.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const fields = await extractFieldsFromFiles([{ file: excel, name: excel.name, kind: "excel" }]);
    expect(fields.etd_date.value).toBe("2026/09/05");
    expect(fields.vessel_name.value).toBe("OCEAN STAR");
    expect(fields.voyage_number.value).toBe("W123");
    expect(fields.containerSeals).toEqual([{ container: "MSKU1234567", seal: "SEAL-001" }, { container: "TGHU7654321", seal: "SEAL-002" }]);
  });
});
