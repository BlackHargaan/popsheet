# Popsheet

Turn any worksheet into a bubble sheet, then grade it from a scan or phone photo.

Everything runs in the browser. Worksheets, class lists and scans are stored on the
device (IndexedDB) and are never uploaded. Printed sheets carry only a short student
code; the code-to-name list stays on the teacher's device.

## How it works

1. **Worksheets** – upload a worksheet PDF, click to place answer bubbles, mark the key.
2. **Classes** – paste a list of names; each student gets a code.
3. **Print** – download one coded copy per student (plus spares).
4. **Scan** – drop in phone photos or a scanner PDF, any order, any way up.
5. **Results** – check flagged marks, see per-question stats, export CSV.

## Development

```bash
npm install
```

```bash
npm run dev
```

```bash
npx vitest run
```

The scanner tests need `pdftoppm` (poppler) to rasterise the generated sheets.

## Layout

- `src/core` – page geometry, printable-PDF builder, scan reader, grading. No browser APIs.
- `src/ui` – React screens.
- `src/store.ts` – on-device storage.
