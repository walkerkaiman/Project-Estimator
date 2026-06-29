/**
 * scripts/importFableXlsx.ts
 *
 * Reads the git-ignored source spreadsheet and writes catalog.json into the
 * OS app-data directory (also git-ignored).  The output is NEVER committed.
 *
 * Usage:
 *   npx tsx scripts/importFableXlsx.ts [path/to/workbook.xlsx]
 *
 * If no path is given it looks for "FABLE - Estimator.xlsx" on the Desktop.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  HOW TO CUSTOMISE
 * ──────────────────────────────────────────────────────────────────────────
 *
 *  1. Open the spreadsheet and note the exact sheet names.
 *  2. Edit SHEET_MAP below to match those names.
 *  3. For each sheet, set the zero-based column indices that hold each field
 *     (or set to -1 to skip that field).
 *  4. Set HEADER_ROWS to the number of header rows to skip on each sheet.
 *  5. Run:  npx tsx scripts/importFableXlsx.ts
 *
 *  The script will:
 *   • Parse every non-empty row.
 *   • Build material, phase, task, and labor-rate entries.
 *   • Write catalog.json into your app-data folder.
 *   • Print a summary table to stdout.
 * ──────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import XLSX from 'xlsx';
import type { Catalog, Material, Phase, Task, Vendor, UnitDefinition, RecipeLine, ScopeInputDef } from '../src/estimate/catalog.ts';
import { CATALOG_VERSION } from '../src/estimate/catalog.ts';

// ── Configuration ─────────────────────────────────────────────────────────────

const HEADER_ROWS = 2; // rows to skip at the top of each data sheet

/**
 * Describes how to parse a single sheet into the catalog.
 * Set column index to -1 to ignore that field.
 */
interface SheetMapping {
  /** Exact name of the Excel sheet (case-sensitive). */
  sheetName: string;
  /** Column index (0-based) for each field. */
  cols: {
    phase: number;       // phase / section name
    task: number;        // task / line-item name
    unit: number;        // unit of measure (LF, sq ft, yards, …)
    laborRate: number;   // labor cost per unit
    materialId: number;  // material identifier / SKU
    materialName: number;
    materialUnit: number;
    materialUnitCost: number;
    vendor: number;
    recipeFactor: number;// qty per primary unit (e.g. sheets of ply per LF)
    formulaOverride: number; // optional formula string that overrides the factor
  };
}

/**
 * Edit this array to match your spreadsheet's sheet names and column layout.
 * Add one entry per sheet that contains estimating data.
 */
const SHEET_MAP: SheetMapping[] = [
  {
    sheetName: 'Materials',        // ← change to your sheet name
    cols: {
      phase: 0,
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
  // Add more sheets here if your workbook has separate sheets per phase:
  // { sheetName: 'Foundation', cols: { ... } },
  // { sheetName: 'Slab',       cols: { ... } },
];

// ── Output path ───────────────────────────────────────────────────────────────

function getOutDir(): string {
  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'com.projectestimator.app');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'com.projectestimator.app');
  }
  return path.join(os.homedir(), '.local', 'share', 'com.projectestimator.app');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function cell(row: unknown[], col: number): string {
  if (col < 0 || col >= row.length) return '';
  const v = (row as (string | number | undefined)[])[col];
  return v == null ? '' : String(v).trim();
}

function numCell(row: unknown[], col: number): number {
  const s = cell(row, col);
  const n = parseFloat(s.replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : n;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const xlsxPath = process.argv[2]
    ?? path.join(os.homedir(), 'Desktop', 'FABLE - Estimator.xlsx');

  if (!fs.existsSync(xlsxPath)) {
    console.error(`\nSpreadsheet not found: ${xlsxPath}`);
    console.error('Usage: npx tsx scripts/importFableXlsx.ts [path/to/workbook.xlsx]\n');
    process.exit(1);
  }

  console.log(`\nReading: ${xlsxPath}\n`);
  const wb = XLSX.readFile(xlsxPath, { cellFormula: false, cellNF: false });

  const vendors  = new Map<string, Vendor>();
  const units    = new Map<string, UnitDefinition>();
  const materials= new Map<string, Material>();
  const phases   = new Map<string, Phase>();
  const tasks    = new Map<string, Task>();

  let phaseOrder = 0;

  // Built-in unit abbreviation lookup
  const unitAbbr: Record<string, string> = {
    'linear feet': 'LF', 'lf': 'LF', 'sq ft': 'sq ft', 'square feet': 'sq ft',
    'yards': 'yd³', 'cubic yards': 'yd³', 'each': 'ea', 'sheets': 'sh',
    'rolls': 'rl', 'gallons': 'gal', 'hours': 'hr',
  };

  function ensureUnit(label: string): string {
    if (!label) return '';
    const id = slugify(label);
    if (!units.has(id)) {
      units.set(id, { id, label, abbr: unitAbbr[label.toLowerCase()] ?? label });
    }
    return id;
  }

  function ensureVendor(name: string): string {
    if (!name) return '';
    const id = slugify(name);
    if (!vendors.has(id)) vendors.set(id, { id, name });
    return id;
  }

  function ensurePhase(name: string): string {
    if (!name) return '';
    const id = 'phase-' + slugify(name);
    if (!phases.has(id)) phases.set(id, { id, name, order: phaseOrder++ });
    return id;
  }

  let rowsProcessed = 0;

  for (const mapping of SHEET_MAP) {
    const ws = wb.Sheets[mapping.sheetName];
    if (!ws) {
      console.warn(`  Sheet not found: "${mapping.sheetName}" — skipping`);
      continue;
    }

    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const dataRows = rows.slice(HEADER_ROWS);

    for (const rawRow of dataRows) {
      const row = rawRow as unknown[];

      const phaseName    = cell(row, mapping.cols.phase);
      const taskName     = cell(row, mapping.cols.task);
      const unitLabel    = cell(row, mapping.cols.unit);
      const laborRate    = numCell(row, mapping.cols.laborRate);
      const matId        = cell(row, mapping.cols.materialId);
      const matName      = cell(row, mapping.cols.materialName);
      const matUnitLabel = cell(row, mapping.cols.materialUnit);
      const matUnitCost  = numCell(row, mapping.cols.materialUnitCost);
      const vendorName   = cell(row, mapping.cols.vendor);
      const factor       = numCell(row, mapping.cols.recipeFactor);
      const formulaOvr   = cell(row, mapping.cols.formulaOverride);

      if (!phaseName && !taskName && !matName) continue; // blank row

      rowsProcessed++;

      const phaseId = ensurePhase(phaseName);
      ensureUnit(unitLabel);

      // Material
      if (matName) {
        const matKey = matId || slugify(matName);
        const vendorId = ensureVendor(vendorName);
        const matUnitId = ensureUnit(matUnitLabel);
        if (!materials.has(matKey)) {
          materials.set(matKey, {
            id: matKey,
            name: matName,
            unit: matUnitId || matUnitLabel,
            unitCost: matUnitCost,
            vendor: vendorId,
            notes: '',
          });
        } else if (matUnitCost > 0) {
          // Update cost if a later row has a value
          materials.get(matKey)!.unitCost = matUnitCost;
        }
      }

      // Task
      if (taskName && phaseId) {
        const taskKey = `task-${phaseId}-${slugify(taskName)}`;
        if (!tasks.has(taskKey)) {
          const scopeInputs: ScopeInputDef[] = [
            { role: 'length', label: 'Length (ft)', unit: 'ft', required: true },
          ];
          tasks.set(taskKey, {
            id: taskKey,
            phaseId,
            name: taskName,
            laborUnit: unitLabel || 'LF',
            laborRate,
            laborQtyFormula: 'Length',
            scopeInputs,
            recipe: [],
          });
        } else if (laborRate > 0) {
          tasks.get(taskKey)!.laborRate = laborRate;
        }

        // Add recipe line if a material is referenced
        if (matName && factor > 0) {
          const matKey = matId || slugify(matName);
          const task = tasks.get(taskKey)!;
          const formula = formulaOvr || `ROUNDUP(${factor} * Length, 0)`;
          const existing = task.recipe.find((r: RecipeLine) => r.materialId === matKey);
          if (!existing) {
            task.recipe.push({ materialId: matKey, factor, orderQtyFormula: formula });
          }
        }
      }
    }

    console.log(`  Sheet "${mapping.sheetName}": ${dataRows.length} rows read`);
  }

  // ── Assemble catalog ────────────────────────────────────────────────────────

  const catalog: Catalog = {
    version: CATALOG_VERSION,
    vendors:   [...vendors.values()],
    units:     [...units.values()],
    materials: [...materials.values()],
    phases:    [...phases.values()].sort((a, b) => a.order - b.order),
    tasks:     [...tasks.values()],
  };

  // ── Write output ────────────────────────────────────────────────────────────

  const outDir = getOutDir();
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'catalog.json');
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), 'utf8');

  console.log(`\n✓ Imported ${rowsProcessed} rows`);
  console.log(`  Phases:    ${catalog.phases.length}`);
  console.log(`  Tasks:     ${catalog.tasks.length}`);
  console.log(`  Materials: ${catalog.materials.length}`);
  console.log(`  Vendors:   ${catalog.vendors.length}`);
  console.log(`\nCatalog written to:\n  ${outPath}\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
