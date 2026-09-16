import { readFileSync } from "node:fs";
import {
  extractFieldsFromFiles,
  buildSubject,
  buildPlainTextBody,
  validateContainerNumber,
  FIELD_DEFINITIONS,
  type ShipmentFields,
} from "../shared/shipping";

function show(label: string, fields: ShipmentFields) {
  console.log(`\n=== ${label} ===`);
  for (const { key, label: name } of FIELD_DEFINITIONS) {
    const f = fields[key];
    console.log(`  ${name.padEnd(18)} = ${JSON.stringify(f.value)}  [${f.status}, ${f.confidence}%]`);
  }
  console.log("  containers        =", JSON.stringify(fields.containers));
  console.log("  SUBJECT:", buildSubject(fields));
}

const main = async () => {
  const a = new File([readFileSync("testdata/manifest-sample.txt")], "manifest-sample.txt", { type: "text/plain" });
  const clean = await extractFieldsFromFiles([{ file: a, name: a.name, kind: "text" }]);
  show("Single clean manifest", clean);

  console.log("\n  container valid?", validateContainerNumber(clean.container_number.value));

  const b = new File([readFileSync("testdata/manifest-mismatch.txt")], "manifest-mismatch.txt", { type: "text/plain" });
  const conflict = await extractFieldsFromFiles([
    { file: a, name: a.name, kind: "text" },
    { file: b, name: b.name, kind: "text" },
  ]);
  show("Two docs (MBL conflict)", conflict);
  console.log("\n  MBL evidence:", conflict.mbl_number.evidence);

  console.log("\n=== Plain-text email body (clean run) ===\n" + buildPlainTextBody(clean, "Best regards,\nAlex Morgan"));
};

main();
