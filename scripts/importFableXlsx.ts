/**
 * scripts/importFableXlsx.ts
 *
 * Node.js importer: reads the git-ignored source spreadsheet and writes a real
 * catalog.json into the app-data directory (also git-ignored).
 *
 * Usage:
 *   npx tsx scripts/importFableXlsx.ts [path/to/FABLE - Estimator.xlsx]
 *
 * The output file is NEVER committed. Only `catalog-example.ts` (with zero
 * prices) lives in the repo.
 *
 * -----------------------------------------------------------------------------
 * NOTE: This file is a scaffold. Mapping logic for your specific spreadsheet
 * columns, sheet names, and formula translations belongs here.
 * Run `npm install --save-dev tsx xlsx` before using.
 * -----------------------------------------------------------------------------
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ---------------------------------------------------------------------------
// You will need the `xlsx` package:  npm install --save-dev xlsx
// ---------------------------------------------------------------------------
// import XLSX from 'xlsx';

const xlsxPath = process.argv[2] ?? path.join(os.homedir(), 'Desktop', 'FABLE - Estimator.xlsx');
const outDir   = path.join(os.homedir(), 'AppData', 'Roaming', 'com.projectestimator.app');
const outPath  = path.join(outDir, 'catalog.json');

async function main(): Promise<void> {
  if (!fs.existsSync(xlsxPath)) {
    console.error(`Spreadsheet not found: ${xlsxPath}`);
    console.error('Usage: npx tsx scripts/importFableXlsx.ts [path/to/workbook.xlsx]');
    process.exit(1);
  }

  console.log(`Reading: ${xlsxPath}`);

  // ── TODO: install xlsx and uncomment this block ──────────────────────────
  // const workbook = XLSX.readFile(xlsxPath);
  // const sheetName = workbook.SheetNames[0];
  // const sheet = workbook.Sheets[sheetName];
  // const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
  // ─────────────────────────────────────────────────────────────────────────

  // Build catalog object from your spreadsheet rows here.
  // Shape must match src/estimate/catalog.ts → Catalog interface.
  const catalog = {
    version: 1,
    vendors: [],
    units: [],
    materials: [],
    phases: [],
    tasks: [],
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`Catalog written to: ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
