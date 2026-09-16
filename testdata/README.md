# Test fixtures

Sample inputs and a headless demo used to exercise the split-manifest extraction
pipeline without a browser.

## Files

| File | Purpose |
| --- | --- |
| `manifest-sample.txt` | A clean, complete manifest. Every field should extract as `Confirmed`. |
| `manifest-mismatch.txt` | A second document whose MBL differs. Uploading it together with `manifest-sample.txt` should flag **MBL Number** as `Needs Review` (45%). |
| `run-demo.ts` | Runs `extractFieldsFromFiles()` over the fixtures and prints the field table, subject line, and plain-text body. |

## Browser walkthrough

1. `pnpm dev`, open the served URL, go to **New email**.
2. Drop `manifest-sample.txt` (and `manifest-mismatch.txt` to see conflict handling).
3. Click **Process documents** → review the extracted fields and confidence badges.
4. Create a TO recipient group in **Settings**, then **Generate email** → **Download .eml**.

## Headless run

```bash
pnpm exec tsx testdata/run-demo.ts
```
