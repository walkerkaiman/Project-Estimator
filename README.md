# Project Estimator

A standalone concrete construction estimating tool that combines a **PDF measurement canvas** with a **formula-driven bid estimator**. Measures directly on imported construction drawings, then auto-populates scope inputs for material and labor calculations.

Built with Vite + TypeScript + Tauri 2 (runs as a native desktop app on Windows and macOS, or in any modern browser).

---

## Features

| Feature | Description |
|---|---|
| **PDF viewer** | Load and pan/zoom construction drawings |
| **Scale calibration** | Click two known points → enter real-world dimension |
| **Linear measure** | Click-drag to measure distances |
| **Area measure (rect)** | Click-drag a rectangle to get area |
| **Area measure (polygon)** | Click vertices to close a polygon area |
| **Measurement assignment** | Tag any measurement → feeds directly into a task's scope input |
| **Phased estimate** | Phases → Tasks → Scope inputs → live material + labor cost recompute |
| **Price snapshots** | Bid prices are frozen at project save; refresh from master catalog explicitly |
| **Catalog manager** | Edit materials, unit costs, labor rates, phases, tasks, and formulas |
| **CSV bulk pricing** | Export catalog to CSV → edit prices in Excel → re-import |
| **Bid summary** | Phase-by-phase material + labor total; CSV export |
| **Tauri desktop app** | Windows `.msi`, macOS `.dmg` — native file dialogs, no browser needed |

---

## Getting Started

### Requirements

- [Node.js](https://nodejs.org) 20+
- [Rust](https://rustup.rs) + `cargo` (for the Tauri desktop build only)

### Install & Run (browser dev mode)

```bash
git clone https://github.com/walkerkaiman/Project-Estimator.git
cd Project-Estimator
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Build the Desktop App

```bash
npm run tauri:build
```

Installers land in `src-tauri/target/release/bundle/`.

---

## Loading Your Real Catalog

The repository ships a **synthetic example catalog** (all prices = $0) so no proprietary data is committed.

To load your real rates and material costs, run the importer:

```bash
# Default: looks for "FABLE - Estimator.xlsx" on your Desktop
npm run import:catalog

# Or specify a path:
npx tsx scripts/importFableXlsx.ts "C:\Users\You\Documents\my-estimator.xlsx"
```

This writes a real `catalog.json` into your OS app-data directory (`AppData\Roaming\com.projectestimator.app\` on Windows). That file is git-ignored and never committed.

### Configuring the Importer

Open `scripts/importFableXlsx.ts` and edit `SHEET_MAP`:

```ts
const SHEET_MAP: SheetMapping[] = [
  {
    sheetName: 'Materials',   // ← exact sheet name in your workbook
    cols: {
      phase: 0,              // ← 0-based column index for each field
      task: 1,
      unit: 2,
      laborRate: 3,
      materialId: 4,
      materialName: 5,
      materialUnit: 6,
      materialUnitCost: 7,
      vendor: 8,
      recipeFactor: 9,
      formulaOverride: 10,
    },
  },
];
```

Set column indices to `-1` to skip a field. Add more entries for additional sheets.

---

## Bulk Price Updates (CSV)

1. Open **Catalog** → click **Export CSV**
2. Edit `unitCost` column in Excel (do not change `id` or other columns)
3. Open **Catalog** → click **Import CSV**

Only the `unitCost` column is updated on import. The import will flag stale price snapshots in any open project.

---

## Workflow

### First Use

1. **Load your catalog** via `npm run import:catalog`
2. **New Project** → phases and tasks auto-populate from the catalog
3. **Open a PDF** in the right panel → set the drawing scale (Scale tool)
4. **Measure** on the drawing → assign each measurement to a task scope input
5. Watch totals update live in the estimate panel
6. **Save** → `.estimate` file contains everything

### Ongoing Use

- **Open Project** → your measurements and scope inputs are restored
- **Refresh Prices** → pulls latest rates from the master catalog without losing scope data
- **Export Bid** → phase-by-phase breakdown as a CSV for your bid package

---

## Architecture

```
src/
├── estimate/
│   ├── catalog.ts          Type definitions (materials, phases, tasks, recipes)
│   ├── catalog-example.ts  Synthetic example catalog (zero prices, committed)
│   ├── formulaEngine.ts    Expression evaluator (ROUNDUP, IF, SUM, MIN, MAX…)
│   ├── project.ts          Project data model + price snapshots
│   ├── snapshot.ts         Snapshot helpers (take / refresh / stale)
│   └── measureAssign.ts    Links canvas markups → task scope inputs
├── canvas/
│   └── stage.ts            Konva stage manager for the PDF canvas
├── canvas-state/
│   └── canvasState.ts      Canvas-specific state (tool, zoom, selection)
├── geometry/
│   └── transform.ts        PDF ↔ Konva coordinate transforms
├── measure/
│   ├── scale.ts            Scale calibration math
│   └── units.ts            Unit formatting (ft-in, sq ft, etc.)
├── model/
│   └── document.ts         Markup type definitions (measure-linear, -rect, -poly…)
├── pdf/
│   └── renderer.ts         pdf.js wrapper
├── tools/
│   ├── baseTool.ts         Abstract base tool
│   ├── selectTool.ts       Selection + transformer
│   ├── scaleSetTool.ts     Scale calibration tool
│   ├── measureLinearTool.ts
│   ├── measureRectTool.ts
│   └── measurePolyTool.ts
├── storage/
│   ├── catalogStore.ts     Catalog persistence (app-data / localStorage)
│   └── projectStore.ts     .estimate file I/O
├── tauri/
│   └── integration.ts      Native file dialogs + Tauri detection
├── ui/
│   ├── estimateView.ts     Phases / tasks / scope inputs / live totals
│   ├── catalogManager.ts   Catalog editor modal
│   ├── bidExport.ts        Bid summary modal + CSV export
│   ├── csvBulk.ts          Bulk CSV price import/export
│   └── pdfCanvas.ts        PDF panel orchestration + tool management
├── appState.ts             Global estimate state + event bus
├── main.ts                 Application entry point
└── style.css               Dark theme UI styles

scripts/
└── importFableXlsx.ts      Node.js importer for the source spreadsheet

src-tauri/                  Tauri Rust shell + configuration
```

---

## Formula Syntax

Task recipes use a small expression language:

```
ROUNDUP(factor * Length / 32, 0)
IF(Height > 2, ROUNDUP(factor * 2 * (Length / 32), 0), ROUNDUP(factor * (Length / 32), 0))
```

**Available functions:** `ROUNDUP`, `ROUNDDOWN`, `ROUND`, `ABS`, `SUM`, `MIN`, `MAX`, `SQRT`, `IF`

**Available variables (from scope inputs):** `Length`, `Width`, `Height`, `Spacing`, `Count`, `Area`, `Volume`, plus `factor` (recipe line factor).

---

## Testing

```bash
npm test
```

40 unit tests cover the formula engine and example catalog integrity.

---

## Releases

Push a version tag to trigger a GitHub Actions build:

```bash
git tag v0.0.2 && git push origin v0.0.2
```

Windows (`.msi`) and macOS (universal `.dmg`) installers are published automatically.

---

## Data Privacy

- **No real prices or rates are committed to this repo.**
- The source spreadsheet (`.xlsx`) and generated real catalog (`catalog.json`) are git-ignored.
- Only `catalog-example.ts` (with all `unitCost: 0`) is committed.
- Store your real catalog on each machine by running the importer locally.
