import * as XLSX from "xlsx";

export type FieldKey =
  | "container_number"
  | "seal_number"
  | "mbl_number"
  | "etd_date"
  | "vessel_name"
  | "voyage_number"
  | "pol"
  | "agent_name";

export type FieldStatus = "Confirmed" | "Needs Review" | "Missing" | "Conflict" | "Manually Corrected";

export type ShipmentField = {
  key: FieldKey;
  label: string;
  value: string;
  originalValue: string;
  confidence: number;
  status: FieldStatus;
  sourceFile: string;
  sourcePage: number;
  evidence: string;
};

export type ShipmentFields = Record<FieldKey, ShipmentField>;

export type DocumentValidation = {
  valid: boolean;
  reason?: string;
  kind?: "pdf" | "excel" | "word" | "text";
};

export const FIELD_DEFINITIONS: Array<Pick<ShipmentField, "key" | "label">> = [
  { key: "container_number", label: "Container Number" },
  { key: "seal_number", label: "Seal Number" },
  { key: "mbl_number", label: "MBL Number" },
  { key: "etd_date", label: "ETD" },
  { key: "vessel_name", label: "Vessel" },
  { key: "voyage_number", label: "Voyage" },
  { key: "pol", label: "POL" },
  { key: "agent_name", label: "Our Agent" },
];

export const REQUIRED_FIELDS: FieldKey[] = [
  "container_number",
  "mbl_number",
  "etd_date",
  "vessel_name",
  "voyage_number",
  "pol",
];

export const DEMO_VALUES: Record<FieldKey, string> = {
  container_number: "BMOU4873674",
  seal_number: "SAMPLE-123456",
  mbl_number: "SIJEAAEC26005671",
  etd_date: "2026/09/05",
  vessel_name: "YES",
  voyage_number: "26706W",
  pol: "DUBAI",
  agent_name: "ABC Shipping (demo)",
};

export function createDemoFields(sourceFile = "Demo shipment data") : ShipmentFields {
  return Object.fromEntries(
    FIELD_DEFINITIONS.map(({ key, label }) => [
      key,
      {
        key,
        label,
        value: DEMO_VALUES[key],
        originalValue: DEMO_VALUES[key],
        confidence: key === "agent_name" || key === "seal_number" ? 82 : 98,
        status: key === "agent_name" || key === "seal_number" ? "Needs Review" : "Confirmed",
        sourceFile,
        sourcePage: sourceFile === "Demo shipment data" ? 0 : 1,
        evidence: sourceFile === "Demo shipment data" ? "Demo mode — not extracted from a real document" : `Detected near the ${label.toLowerCase()} label`,
      },
    ]),
  ) as ShipmentFields;
}

function sourceFieldStatus(value: string): FieldStatus {
  return value ? "Confirmed" : "Missing";
}

function extractLabeledValue(text: string, labels: string[]): string {
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = text.match(new RegExp(`(?:${labelPattern})\\s*(?:[:=\\-\\t,])\\s*([^\\r\\n,;|]+)`, "i"));
  return match?.[1]?.trim().replace(/\s{2,}/g, " ") || "";
}

type SourceText = { name: string; text: string; page: number };

async function extractPdfText(file: Blob, name: string): Promise<SourceText[]> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true } as any).promise;
    const pages: SourceText[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      pages.push({ name, text, page: pageNumber });
    }
    return pages;
  } catch {
    return [];
  }
}

function normalizeCandidate(key: FieldKey, value: string): string {
  const cleaned = value.trim().replace(/\s{2,}/g, " ");
  if (key === "container_number") return cleaned.replace(/\s+/g, "").toUpperCase();
  if (key === "etd_date") return normalizeDate(cleaned).value;
  return cleaned;
}

function extractCandidates(text: string, key: FieldKey): string[] {
  const labels: Record<FieldKey, string[]> = {
    container_number: ["Container No", "Container Number", "Container", "CNTR No", "CNTR", "Equipment No", "Equipment Number"],
    seal_number: ["Seal No", "Seal Number", "SealNo", "Seal"],
    mbl_number: ["MBL No", "MBL Number", "MBL", "Master BL", "Master B/L", "Master Bill of Lading"],
    etd_date: ["ETD", "ETD Date", "BLIssueDateH", "BLIssueDateM", "Estimated Time of Departure", "Departure Date"],
    vessel_name: ["Vessel Name", "VesselName", "Vessel", "VSL", "Ship Name"],
    voyage_number: ["Voyage No", "Voyage Number", "VoyageNo", "Voyage", "Voy", "VYG"],
    pol: ["Port of Loading", "Port of Load", "Loading Port", "POLText", "POL", "Load Port"],
    agent_name: ["Our Agent", "Local Agent", "Shipping Agent", "ShipperText", "Shipper Name", "Shipper", "S/O"],
  };
  const labelPattern = labels[key].slice().sort((a, b) => b.length - a.length).map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const allLabelPattern = Array.from(new Set(Object.values(labels).flat())).sort((a, b) => b.length - a.length).map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const values: string[] = [];
  const labeled = new RegExp(`(?:^|[\\s,|])(?:${labelPattern})\\s*(?:[:=\\t,]\\s*|\\s+)([^\\r\\n,;|]+)`, "gi");
  const nextLabel = new RegExp(`\\s+(?:${allLabelPattern})\\b`, "i");
  const labelOnly = new RegExp(`^(?:${allLabelPattern})$`, "i");
  for (const match of Array.from(text.matchAll(labeled))) {
    const rawValue = match[1].split(nextLabel)[0];
    if (labelOnly.test(rawValue.trim())) continue;
    const value = normalizeCandidate(key, rawValue);
    if (key === "agent_name" && /^\d{4}[\/-]\d{1,2}[\/-]\d{1,2}$/.test(value)) continue;
    if (key === "pol" && /^\d+$/.test(value)) continue;
    if (value) values.push(value);
  }
  if (key === "container_number") {
    for (const match of Array.from(text.matchAll(/\b[A-Z]{4}\s?\d{7}\b/gi))) values.push(normalizeCandidate(key, match[0]));
  }
  return Array.from(new Set(values));
}

export async function extractFieldsFromFiles(files: Array<{ file: Blob; name: string; kind: string }>): Promise<ShipmentFields> {
  const sourceFile = files[0]?.name || "Uploaded documents";
  const fields = createDemoFields(sourceFile);
  for (const { key } of FIELD_DEFINITIONS) {
    fields[key] = { ...fields[key], value: "", originalValue: "", confidence: 0, status: "Missing", evidence: "Not found in the uploaded source documents." };
  }

  const sources: SourceText[] = [];
  for (const item of files) {
    try {
      if (item.kind === "excel") {
        const workbook = XLSX.read(await item.file.arrayBuffer(), { type: "array" });
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as string[][];
          const csv = XLSX.utils.sheet_to_csv(sheet);
          const rowAndNextRow = rows.map((row, rowIndex) => row.map((cell, columnIndex) => {
            const nextRowValue = rows[rowIndex + 1]?.[columnIndex] || "";
            return nextRowValue ? `${cell} ${nextRowValue}` : cell;
          }).join(",")).join("\n");
          const headers = rows[0] || [];
          const headerValueRows = rows.slice(1).map((row) => headers.map((header, index) => header && row[index] !== "" ? `${header}: ${row[index]}` : "").filter(Boolean).join("\n")).join("\n");
          sources.push({ name: `${item.name} / ${sheetName}`, text: headerValueRows || `${csv}\n${rowAndNextRow}`, page: 1 });
        }
      } else if (item.kind === "pdf") {
        sources.push(...await extractPdfText(item.file, item.name));
      } else if (item.kind === "text" || item.kind === "word") {
        sources.push({ name: item.name, text: await item.file.text(), page: 1 });
      }
    } catch {
      // Leave unavailable source fields missing; never fabricate values.
    }
  }

  const checkedSources = Array.from(new Set([...files.map((file) => file.name), ...sources.map((source) => source.name)])).join("; ") || "No uploaded sources";
  for (const { key } of FIELD_DEFINITIONS) fields[key].sourceFile = `Checked: ${checkedSources}`;
  for (const field of FIELD_DEFINITIONS) {
    const candidates = sources.flatMap((source) => extractCandidates(source.text, field.key).map((value) => ({ value, source })));
    const unique = Array.from(new Set(candidates.map((candidate) => candidate.value)));
    if (!unique.length) continue;
    const mblStems = field.key === "mbl_number" ? unique.map((value) => value.match(/^(.+?)[A-Z]$/)?.[1] ?? "") : [];
    const sharedMblStem = mblStems.length > 1 && mblStems.every((stem) => stem && stem === mblStems[0]) ? mblStems[0] : "";
    const chosen = candidates.find((candidate) => candidate.value === unique[0])!;
    const multipleValues = unique.length > 1 && !sharedMblStem;
    const resolvedValue = sharedMblStem || chosen.value;
    const matchedSources = Array.from(new Set(candidates.filter((candidate) => candidate.value === unique[0]).map((candidate) => candidate.source.name))).join("; ");
    fields[field.key] = {
      ...fields[field.key],
      value: resolvedValue,
      originalValue: multipleValues ? "" : resolvedValue,
      confidence: multipleValues ? 45 : Math.min(99, 88 + Math.min(candidates.length * 3, 10)),
      status: multipleValues ? "Needs Review" : "Confirmed",
      sourceFile: `Checked: ${checkedSources} | Matched: ${multipleValues ? candidates.map((candidate) => candidate.source.name).join("; ") : matchedSources}`,
      sourcePage: chosen.source.page,
      evidence: multipleValues ? `Multiple values detected: ${unique.join(" vs ")}. Review the selected value; all uploaded sources were checked.` : sharedMblStem ? `Consolidated ${unique.length} line-item MBL values to shared master number ${sharedMblStem}. Checked all uploaded sources.` : `Explicit ${field.label.toLowerCase()} evidence found in ${matchedSources}. Checked all uploaded sources.`,
    };
  }
  return fields;
}

export function validateDocumentFile(file: { name: string; type?: string; size: number }): DocumentValidation {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const maxBytes = 25 * 1024 * 1024;
  if (file.size > maxBytes) return { valid: false, reason: "File exceeds the 25 MB limit." };

  const typeByExtension: Record<string, DocumentValidation["kind"]> = {
    pdf: "pdf",
    xls: "excel",
    xlsx: "excel",
    doc: "word",
    docx: "word",
    txt: "text",
    csv: "text",
  };
  const kind = typeByExtension[extension];
  if (!kind) {
    return { valid: false, reason: "Unsupported format. Use PDF, Excel, Word, TXT, or CSV files." };
  }
  if (["image/png", "image/jpeg", "application/zip", "application/x-7z-compressed"].includes(file.type ?? "")) {
    return { valid: false, reason: "Images and archive files are not supported." };
  }
  return { valid: true, kind };
}

export function normalizeDate(input: string): { value: string; ambiguous: boolean } {
  const raw = input.trim();
  if (!raw) return { value: "", ambiguous: false };
  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return { value: `${iso[1]}/${iso[2].padStart(2, "0")}/${iso[3].padStart(2, "0")}`, ambiguous: false };
  const named = raw.match(/^(\d{1,2})[- ]([A-Za-z]{3,})[- ](\d{4})$/);
  if (named) {
    const monthMap: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
    const month = monthMap[named[2].slice(0, 3).toLowerCase()];
    if (month) return { value: `${named[3]}/${month}/${named[1].padStart(2, "0")}`, ambiguous: false };
  }
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return { value: raw, ambiguous: true };
  const shortYear = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (shortYear) return { value: `20${shortYear[3]}/${shortYear[1].padStart(2, "0")}/${shortYear[2].padStart(2, "0")}`, ambiguous: false };
  return { value: raw, ambiguous: true };
}

export function validateContainerNumber(value: string): { valid: boolean; suspicious: boolean; message?: string } {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return { valid: false, suspicious: true, message: "Container number is required." };
  const shape = /^[A-Z]{4}\d{7}$/;
  if (!shape.test(normalized)) return { valid: false, suspicious: true, message: "Container number format may be invalid." };
  return { valid: true, suspicious: false };
}

export function getMissingRequiredFields(fields: ShipmentFields): string[] {
  return REQUIRED_FIELDS.filter((key) => !fields[key].value.trim()).map((key) => fields[key].label);
}

export function buildSubject(fields: ShipmentFields): string {
  const value = (key: FieldKey) => fields[key].value.trim();
  return `SPLIT MANIFEST // CNTR: ${value("container_number")} // VSL: ${value("vessel_name")} ${value("voyage_number")} // MBL: ${value("mbl_number")} // ETD: ${value("etd_date")} // POL: ${value("pol")}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}

export function buildPlainTextBody(fields: ShipmentFields, signatureText: string): string {
  const value = (key: FieldKey) => fields[key].value.trim() || "Not Found";
  return [
    "Dear Team,",
    "",
    "Please find attached the split manifest for the below shipment.",
    "",
    `Container Number: ${value("container_number")}`,
    `Seal Number: ${value("seal_number")}`,
    `MBL Number: ${value("mbl_number")}`,
    `ETD: ${value("etd_date")}`,
    `Vessel / Voyage: ${value("vessel_name")} ${value("voyage_number")}`,
    `POL: ${value("pol")}`,
    `Our Agent: ${value("agent_name")}`,
    "",
    "Please proceed accordingly.",
    "",
    signatureText.trim() || "Best regards,",
  ].join("\n");
}

export function buildHtmlBody(fields: ShipmentFields, signatureHtml: string): string {
  const value = (key: FieldKey) => escapeHtml(fields[key].value.trim() || "Not Found");
  const rows = [
    ["Container Number", value("container_number")],
    ["Seal Number", value("seal_number")],
    ["MBL Number", value("mbl_number")],
    ["ETD", value("etd_date")],
    ["Vessel / Voyage", `${value("vessel_name")} ${value("voyage_number")}`],
    ["POL", value("pol")],
    ["Our Agent", value("agent_name")],
  ].map(([label, detail]) => `<tr><td style="padding:10px 12px;border:1px solid #d9e2ec;color:#607286;font-weight:600">${label}</td><td style="padding:10px 12px;border:1px solid #d9e2ec;color:#172b4d">${detail}</td></tr>`).join("");
  const signature = signatureHtml.trim() || "<p>Best regards,</p>";
  return `<div style="font-family:Arial,sans-serif;color:#172b4d;font-size:14px;line-height:1.55"><p>Dear Team,</p><p>Please find attached the split manifest for the below shipment.</p><table style="border-collapse:collapse;width:100%;max-width:680px;margin:18px 0"><thead><tr><th colspan="2" style="padding:10px 12px;text-align:left;background:#edf4fb;border:1px solid #d9e2ec;color:#0b5cad">Shipment details</th></tr></thead><tbody>${rows}</tbody></table><p>Please proceed accordingly.</p>${signature}</div>`;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index]);
    }
  }
  return btoa(binary);
}

function foldBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

export async function buildEml(
  subject: string,
  htmlBody: string,
  textBody: string,
  attachments: Array<{ name: string; file: Blob }>,
): Promise<string> {
  const mixedBoundary = `=_SplitManifestMixed_${Date.now()}`;
  const altBoundary = `=_SplitManifestAlt_${Date.now()}`;
  const lines = [
    "MIME-Version: 1.0",
    "From: ",
    "To: ",
    `Subject: ${subject}`,
    "Content-Type: multipart/mixed; boundary=\"" + mixedBoundary + "\"",
    "X-Split-Manifest-Mode: Outlook-compatible draft preparation only",
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary=\"${altBoundary}\"`,
    "",
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    textBody,
    "",
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    htmlBody,
    "",
    `--${altBoundary}--`,
  ];

  for (const attachment of attachments) {
    const bytes = new Uint8Array(await attachment.file.arrayBuffer());
    const safeName = attachment.name.replace(/[\r\n"\\]/g, "_");
    lines.push(
      "",
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.file.type || "application/octet-stream"}; name="${safeName}"`,
      `Content-Disposition: attachment; filename="${safeName}"`,
      "Content-Transfer-Encoding: base64",
      "",
      foldBase64(base64FromBytes(bytes)),
    );
  }
  lines.push("", `--${mixedBoundary}--`, "");
  return lines.join("\r\n");
}
