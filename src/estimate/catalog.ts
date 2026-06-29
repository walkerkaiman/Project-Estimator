/**
 * Catalog type definitions.
 *
 * The catalog is the app-wide, shareable database of materials, vendors,
 * phases, tasks, labor rates, and material recipes.
 *
 * IMPORTANT: No real prices, rates, or vendor names live in this repo.
 * Real data is loaded from the app-data dir (written by the importer script
 * or edited in-app) and is git-ignored. The repo ships only a synthetic
 * example catalog (see catalog-example.ts) for tests and first-run.
 */

// ── Material catalog ─────────────────────────────────────────────────────────

export interface Material {
  id: string;
  name: string;
  unit: string;         // e.g. "each", "LF", "yards", "sq ft", "gallons"
  unitCost: number;     // current price per unit
  vendor: string;       // preferred vendor name
  notes: string;
}

// ── Vendors & units (dropdown sources) ───────────────────────────────────────

export interface Vendor {
  id: string;
  name: string;
}

export interface UnitDefinition {
  id: string;
  label: string;       // display label, e.g. "Linear Feet"
  abbr: string;        // abbreviation, e.g. "LF"
}

// ── Phases & tasks ───────────────────────────────────────────────────────────

/** A construction phase (e.g. Foundation, Slab, Floor 1). User-editable. */
export interface Phase {
  id: string;
  name: string;
  order: number;
}

/**
 * Scope inputs required for a task.
 * These become the variables available in formulas for this task.
 */
export type ScopeRole = 'length' | 'width' | 'height' | 'spacing' | 'count' | 'area' | 'volume';

export interface ScopeInputDef {
  role: ScopeRole;
  label: string;       // e.g. "Length (ft)", "Height / Depth (ft)"
  unit: string;        // display unit hint
  required: boolean;
}

/**
 * A single material line within a task recipe.
 *
 * `factor` is the per-unit consumption rate (e.g. 2 sheets of plywood per LF).
 * `orderQtyFormula` is an optional editable expression that overrides the
 * simple `ROUNDUP(factor * primaryDimension, 0)` default when special rounding
 * or conditional logic is needed (e.g. doubling when height > 2 ft).
 *
 * Variables available in formulas: Length, Width, Height, Spacing, Count,
 * Area, Volume, factor — plus ROUNDUP, ROUNDDOWN, ROUND, IF, SUM, MIN, MAX.
 */
export interface RecipeLine {
  materialId: string;
  factor: number;
  orderQtyFormula: string;   // e.g. "IF(Height>2, ROUNDUP(factor*2*(Length/32),0), ROUNDUP(factor*(Length/32),0))"
}

/**
 * A task within a phase (e.g. "Build Forms - One Sided" in Foundation).
 * User-editable: name, rates, recipes, and formulas are all mutable in-app.
 */
export interface Task {
  id: string;
  phaseId: string;
  name: string;
  laborUnit: string;          // unit the labor rate is priced in, e.g. "LF", "sq ft"
  laborRate: number;          // cost per labor unit ($/unit)
  laborQtyFormula: string;    // expression yielding the labor quantity
  scopeInputs: ScopeInputDef[];
  recipe: RecipeLine[];       // ordered list of materials this task consumes
}

// ── Full catalog ──────────────────────────────────────────────────────────────

export interface Catalog {
  version: number;
  materials: Material[];
  vendors: Vendor[];
  units: UnitDefinition[];
  phases: Phase[];
  tasks: Task[];
}

export const CATALOG_VERSION = 1;

export function emptyCatalog(): Catalog {
  return {
    version: CATALOG_VERSION,
    materials: [],
    vendors: [],
    units: [],
    phases: [],
    tasks: [],
  };
}
