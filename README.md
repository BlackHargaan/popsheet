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

## Editing and backups

The **Select** tool moves existing items without adding questions. Shift-click to select
several items, then drag them together or use **Align left** / **Align top**. Alignment
uses the first selected item. Nearby edges and centres snap together while dragging;
hold Alt to skip snapping. Arrow keys move the selection 1 point; Shift moves 10 points.

**Undo** and **Redo** cover worksheet edits, including page-code moves. Use Ctrl/Cmd+Z
and Ctrl/Cmd+Shift+Z (or Ctrl+Y). Each drag is one undo step. Escape cancels a drag.
History lasts for the current editor visit and keeps up to 100 changes.

On the Worksheets screen, **Download backup** exports worksheets, classes, printed
versions, scans, grades and saved answer readings into a JSON file. **Restore backup**
shows a preview before importing. Matching worksheets and classes are skipped by
default; enable replacement to replace a matching worksheet and its entire saved
scan/grade/reading bundle. Other worksheets stay intact. Backup files contain student
data and should be kept private. Handwriting model downloads are not included.

Run `npm test` for unit and scan tests (Poppler is needed for scan tests). Run
`npm run test:e2e` for browser interaction tests; these use an installed Google Chrome
with an isolated test profile and start their own local development server.
