/**
 * scripts/importFableXlsx.ts
 *
 * Imports the "Expenses Repository.xlsx" workbook into a real catalog.json.
 *
 * Reads three types of sheets:
 *
 *   1. "Material Costs"  — all materials with unit cost, unit, vendor
 *   2. "Labor"           — phases (column headers) and task names (cell values)
 *   3. "Elements - *"    — per-phase task recipes: material names + quantity factor per unit
 *
 * The output catalog.json is written to the OS app-data directory and is
 * NEVER committed to git.
 *
 * Usage:
 *   npm run import:catalog
 *   npx tsx scripts/importFableXlsx.ts [path/to/Expenses Repository.xlsx]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import XLSX from 'xlsx';
import type {
  Catalog, Material, Phase, Task, Vendor, UnitDefinition, RecipeLine, ScopeInputDef, ScopeRole,
} from '../src/estimate/catalog.ts';
import { CATALOG_VERSION } from '../src/estimate/catalog.ts';

// ── Config ─────────────────────────────────────────────────────────────────────

const DEFAULT_XLSX = path.join(os.homedir(), 'Downloads', 'Expenses Repository.xlsx');
const MATERIAL_SHEET = 'Material Costs';
const LABOR_SHEET = 'Labor';
// Phase column indices in the Labor sheet (0-based)
const LABOR_PHASE_COLS: Record<string, number> = {
  'Foundation': 4,
  'Block':      5,
  'Slab':       6,
  'Floor 1':    7,
  'Floor 2':    8,
  'Floor 3':    9,
  'Roof':       10,
  'Prep':       11,
};
// Element sheets named "Elements - <PhaseName>"
const ELEMENT_SHEET_PREFIX = 'Elements - ';

// ── Output path ─────────────────────────────────────────────────────────────────

function getOutDir(): string {
  if (process.platform === 'win32') return path.join(os.homedir(), 'AppData', 'Roaming', 'com.projectestimator.app');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'com.projectestimator.app');
  return path.join(os.homedir(), '.local', 'share', 'com.projectestimator.app');
}

// ── Helpers ────────────────────────────────────────────────────────────────────

type Row = (string | number | boolean | null | undefined)[];

function cellStr(row: Row, col: number): string {
  const v = row[col];
  return v == null ? '' : String(v).trim();
}

function cellNum(row: Row, col: number): number {
  const v = row[col];
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : n;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function sheetRows(ws: XLSX.WorkSheet): Row[] {
  return XLSX.utils.sheet_to_json<Row>(ws, { header: 1, defval: '' });
}

// ── Unit mapping ───────────────────────────────────────────────────────────────

const UNIT_DEFS: UnitDefinition[] = [
  { id: 'each',      label: 'Each',          abbr: 'ea'    },
  { id: 'lf',        label: 'Linear Feet',   abbr: 'LF'    },
  { id: 'sqft',      label: 'Square Feet',   abbr: 'sq ft' },
  { id: 'yards',     label: 'Cubic Yards',   abbr: 'yd'    },
  { id: 'gallons',   label: 'Gallons',       abbr: 'gal'   },
  { id: 'lbs',       label: 'Pounds',        abbr: 'lbs'   },
  { id: 'multidims', label: 'Multi Dims',    abbr: 'multi' },
  { id: 'twodim',    label: 'Two Dims',      abbr: '2dim'  },
  { id: 'threedims', label: 'Three Dims',    abbr: '3dim'  },
];

function unitId(raw: string): string {
  const u = raw.trim().toLowerCase();
  if (u === 'lf' || u === 'linear feet') return 'lf';
  if (u === 'sq ft' || u === 'sqft' || u === 'square feet') return 'sqft';
  if (u === 'yards' || u === 'yd' || u === 'cubic yards') return 'yards';
  if (u === 'gallons' || u === 'gal') return 'gallons';
  if (u === 'lbs' || u === 'pounds') return 'lbs';
  if (u.startsWith('multi')) return 'multidims';
  if (u === 'two dim' || u === 'twodim' || u === '2dim') return 'twodim';
  if (u === 'three dims' || u === 'threedims' || u === '3dim') return 'threedims';
  return 'each';
}

/**
 * Derive scope inputs from the task's unit of measure.
 *
 *   LF        → Length
 *   sq ft     → Length + Width
 *   yards/vol → Length + Width + Height (for volume)
 *   Multi Dim → Length + Width + Height (user decides which apply)
 *   Two Dim   → Length + Width
 *   Three Dim → Length + Width + Height
 *   each      → Count
 */
function scopeInputsForUnit(u: string): ScopeInputDef[] {
  const uid = unitId(u);
  switch (uid) {
    case 'lf':
      return [{ role: 'length', label: 'Length (ft)', unit: 'ft', required: true }];
    case 'sqft':
    case 'twodim':
      return [
        { role: 'length', label: 'Length (ft)', unit: 'ft', required: true },
        { role: 'width',  label: 'Width (ft)',  unit: 'ft', required: true },
      ];
    case 'yards':
    case 'multidims':
    case 'threedims':
      return [
        { role: 'length', label: 'Length (ft)', unit: 'ft', required: true },
        { role: 'width',  label: 'Width (ft)',  unit: 'ft', required: true },
        { role: 'height', label: 'Height (ft)', unit: 'ft', required: true },
      ];
    case 'each':
    default:
      return [{ role: 'count', label: 'Count', unit: 'ea', required: true }];
  }
}

/**
 * Build the labor quantity formula based on the task's unit.
 */
function laborQtyFormula(u: string): string {
  const uid = unitId(u);
  switch (uid) {
    case 'lf':        return 'Length';
    case 'sqft':      return 'Length * Width';
    case 'twodim':    return 'Length * Width';
    case 'yards':     return 'ROUNDUP(Length * Width * Height / 27, 2)';
    case 'multidims': return 'Length';  // user will override per task
    case 'threedims': return 'Length * Width * Height';
    case 'each':
    default:          return 'Count';
  }
}

/**
 * Build the material order-qty formula based on the task unit + recipe factor.
 * `factor` is how many units of material are needed per 1 primary unit of the task.
 */
function orderQtyFormula(taskUnitRaw: string, factor: number): string {
  const uid = unitId(taskUnitRaw);
  switch (uid) {
    case 'lf':
      return `ROUNDUP(${factor} * Length, 0)`;
    case 'sqft':
    case 'twodim':
      return `ROUNDUP(${factor} * Length * Width, 0)`;
    case 'yards':
    case 'threedims':
      return `ROUNDUP(${factor} * Length * Width * Height / 27, 2)`;
    case 'multidims':
      return `ROUNDUP(${factor} * Length, 0)`;  // user overrides per task
    case 'each':
    default:
      return `ROUNDUP(${factor} * Count, 0)`;
  }
}

// ── Step 1: Materials ──────────────────────────────────────────────────────────

function importMaterials(wb: XLSX.WorkBook): { materials: Material[]; vendors: Vendor[] } {
  const ws = wb.Sheets[MATERIAL_SHEET];
  if (!ws) throw new Error(`Sheet "${MATERIAL_SHEET}" not found`);

  const rows = sheetRows(ws);
  // Row 0 is header; data starts at row 1
  const dataRows = rows.slice(1);

  const materials: Material[] = [];
  const vendorMap = new Map<string, Vendor>();
  const seenNames = new Set<string>();

  for (const row of dataRows) {
    const nameRaw = cellStr(row, 0);
    if (!nameRaw || nameRaw === '-- Various --') continue;
    if (typeof row[0] === 'number') continue;  // skip barcode-only rows
    if (nameRaw.startsWith('Fee - Tax')) continue;  // tax fee lines

    // Deduplicate by name
    if (seenNames.has(nameRaw)) continue;
    seenNames.add(nameRaw);

    const unitCost = cellNum(row, 1);
    const unit     = cellStr(row, 2) || 'each';
    const vendor   = cellStr(row, 3);
    const notes    = cellStr(row, 5);

    const id = 'mat-' + slugify(nameRaw);
    materials.push({ id, name: nameRaw, unit, unitCost, vendor: slugify(vendor) || '', notes });

    if (vendor && !vendorMap.has(slugify(vendor))) {
      vendorMap.set(slugify(vendor), { id: slugify(vendor), name: vendor });
    }
  }

  // Add "- Unspecified -" vendor if referenced
  if (!vendorMap.has('---unspecified---')) {
    vendorMap.set('unspecified', { id: 'unspecified', name: '- Unspecified -' });
  }

  const vendors = [...vendorMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { materials, vendors };
}

// ── Step 2: Phases & Tasks from Labor sheet ─────────────────────────────────────

function importPhasesAndTasks(wb: XLSX.WorkBook): { phases: Phase[]; tasksByPhase: Map<string, Set<string>> } {
  const ws = wb.Sheets[LABOR_SHEET];
  if (!ws) {
    console.warn(`  Labor sheet not found — no phases imported`);
    return { phases: [], tasksByPhase: new Map() };
  }

  const rows = sheetRows(ws);
  const phases: Phase[] = [];
  const tasksByPhase = new Map<string, Set<string>>();

  let order = 0;
  for (const [phaseName, col] of Object.entries(LABOR_PHASE_COLS)) {
    const id = 'phase-' + slugify(phaseName);
    phases.push({ id, name: phaseName, order: order++ });
    const tasks = new Set<string>();
    // Rows 1+ contain task names under each phase column
    for (let i = 1; i < rows.length; i++) {
      const taskName = cellStr(rows[i], col);
      if (taskName) tasks.add(taskName);
    }
    tasksByPhase.set(id, tasks);
  }

  return { phases, tasksByPhase };
}

// ── Step 3: Recipes from Elements sheets ────────────────────────────────────────

/**
 * Reads "Elements - <PhaseName>" sheet.
 *
 * Row 0: headers — "Foundation Elements", "Unit of Measure", "Material 1",
 *        "Material 1 - LF per Element", "Material 2", "Material 2 - LF per Element", ...
 *
 * Data rows: task name (col 0), unit (col 1), then pairs (matName, factor) starting at col 2.
 */
function importElementsSheet(
  wb: XLSX.WorkBook,
  phaseName: string,
  materials: Material[],
): Map<string, { unit: string; recipe: RecipeLine[] }> {
  const sheetName = ELEMENT_SHEET_PREFIX + phaseName;
  const ws = wb.Sheets[sheetName];
  const result = new Map<string, { unit: string; recipe: RecipeLine[] }>();
  if (!ws) return result;

  const rows = sheetRows(ws);
  const matByName = new Map(materials.map(m => [m.name.toLowerCase().trim(), m]));

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const taskName = cellStr(row, 0);
    if (!taskName) continue;

    const taskUnit = cellStr(row, 1) || 'LF';
    const recipe: RecipeLine[] = [];

    // Columns come in pairs: material name (even), factor (odd), starting at col 2
    for (let c = 2; c < row.length - 1; c += 2) {
      const matName = cellStr(row, c);
      const factorRaw = row[c + 1];
      if (!matName) continue;

      const factor = typeof factorRaw === 'number' ? factorRaw : parseFloat(String(factorRaw ?? ''));
      if (!isFinite(factor) || factor <= 0) continue;

      // Find material by name (case-insensitive)
      const mat = matByName.get(matName.toLowerCase().trim());
      if (!mat) {
        // Material referenced in Elements but not in Material Costs — note it
        console.warn(`    Material not found: "${matName}" (used in task "${taskName}")`);
        continue;
      }

      recipe.push({
        materialId: mat.id,
        factor,
        orderQtyFormula: orderQtyFormula(taskUnit, factor),
      });
    }

    result.set(taskName, { unit: taskUnit, recipe });
  }

  return result;
}

// ── Step 4: Assemble tasks ─────────────────────────────────────────────────────

function buildTasks(
  phases: Phase[],
  tasksByPhase: Map<string, Set<string>>,
  wb: XLSX.WorkBook,
  materials: Material[],
): Task[] {
  const tasks: Task[] = [];

  for (const phase of phases) {
    const phaseTaskNames = tasksByPhase.get(phase.id) ?? new Set<string>();
    // Try to load element recipes for this phase
    const phaseName = phase.name;
    const elementMap = importElementsSheet(wb, phaseName, materials);

    for (const taskName of phaseTaskNames) {
      const id = `task-${phase.id}-${slugify(taskName)}`;
      const elements = elementMap.get(taskName);
      const unitRaw = elements?.unit ?? 'LF';
      const recipe  = elements?.recipe ?? [];

      const task: Task = {
        id,
        phaseId: phase.id,
        name: taskName,
        laborUnit: unitRaw,
        laborRate: 0,   // rates are entered in-app or via CSV import — not in this spreadsheet
        laborQtyFormula: laborQtyFormula(unitRaw),
        scopeInputs: scopeInputsForUnit(unitRaw),
        recipe,
      };

      tasks.push(task);
    }
  }

  return tasks;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const xlsxPath = process.argv[2] ?? DEFAULT_XLSX;

  if (!fs.existsSync(xlsxPath)) {
    console.error(`\nSpreadsheet not found: ${xlsxPath}`);
    console.error('Usage: npm run import:catalog [path/to/workbook.xlsx]\n');
    process.exit(1);
  }

  console.log(`\nReading: ${xlsxPath}\n`);
  const wb = XLSX.readFile(xlsxPath, { cellFormula: false, cellNF: false });

  console.log('Step 1: Importing materials from "Material Costs"…');
  const { materials, vendors } = importMaterials(wb);
  console.log(`  → ${materials.length} materials, ${vendors.length} vendors`);

  console.log('Step 2: Importing phases and tasks from "Labor"…');
  const { phases, tasksByPhase } = importPhasesAndTasks(wb);
  console.log(`  → ${phases.length} phases`);
  for (const [phId, ts] of tasksByPhase) {
    const ph = phases.find(p => p.id === phId);
    console.log(`     ${ph?.name}: ${ts.size} tasks`);
  }

  console.log('Step 3: Building task recipes from "Elements - *" sheets…');
  const tasks = buildTasks(phases, tasksByPhase, wb, materials);
  const tasksWithRecipes = tasks.filter(t => t.recipe.length > 0);
  console.log(`  → ${tasks.length} tasks total, ${tasksWithRecipes.length} with material recipes`);

  const catalog: Catalog = {
    version: CATALOG_VERSION,
    vendors,
    units: UNIT_DEFS,
    materials,
    phases,
    tasks,
  };

  const outDir = getOutDir();
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'catalog.json');
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), 'utf8');

  console.log('\n✓ Catalog written to:');
  console.log(`  ${outPath}`);
  console.log('\nSummary:');
  console.log(`  Materials : ${materials.length}`);
  console.log(`  Vendors   : ${vendors.length}`);
  console.log(`  Phases    : ${phases.length}`);
  console.log(`  Tasks     : ${tasks.length}`);
  console.log(`  Tasks w/ recipes: ${tasksWithRecipes.length}`);
  console.log('\nNote: Labor rates ($/unit) start at $0.');
  console.log('      Set them in-app via Catalog → Labor Rates,');
  console.log('      or bulk-import via Catalog → Import CSV.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
