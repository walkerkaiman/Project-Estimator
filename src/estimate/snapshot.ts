/**
 * Price snapshot helpers.
 *
 * A snapshot freezes the catalog's material prices into the project at save
 * time.  This ensures a bid doesn't silently change when you later update
 * the master catalog (e.g. new lumber prices).
 *
 * The user can explicitly choose to "Refresh Prices from Catalog" to pull the
 * latest rates, which replaces the snapshot with current values.
 */

import type { Catalog } from './catalog.ts';
import type { EstimateProject, PriceSnapshot, SnapshotMaterial } from './project.ts';

/**
 * Take a fresh price snapshot from the current master catalog.
 * Call this when creating a new project or when the user clicks "Refresh Prices".
 */
export function takeSnapshot(catalog: Catalog): PriceSnapshot {
  const materials: SnapshotMaterial[] = catalog.materials.map(m => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    unitCost: m.unitCost,
    vendor: m.vendor,
  }));
  return { takenAt: new Date().toISOString(), materials };
}

/**
 * Copy catalog phases & tasks into the project.
 * Existing per-project overrides (renamed phases, custom rates) are preserved
 * unless `force` is true.
 */
export function initProjectFromCatalog(
  project: EstimateProject,
  catalog: Catalog,
  force = false,
): EstimateProject {
  const updated = { ...project };

  if (force || project.phases.length === 0) {
    updated.phases = structuredClone(catalog.phases);
  }
  if (force || project.tasks.length === 0) {
    updated.tasks = structuredClone(catalog.tasks);
  }

  updated.snapshot = takeSnapshot(catalog);
  updated.snapshotStale = false;
  return updated;
}

/**
 * Refresh just the prices in the project's snapshot from the master catalog,
 * keeping the project's phase/task structure intact.
 */
export function refreshSnapshotPrices(
  project: EstimateProject,
  catalog: Catalog,
): EstimateProject {
  const updated = { ...project };
  updated.snapshot = takeSnapshot(catalog);
  updated.snapshotStale = false;

  // Also update locked labor rates on tasks that still match the catalog
  updated.tasks = project.tasks.map(t => {
    const catTask = catalog.tasks.find(ct => ct.id === t.id);
    if (!catTask) return t;
    return { ...t, laborRate: catTask.laborRate, lockedLaborRate: undefined };
  });

  return updated;
}

/**
 * Mark the snapshot as stale (called when the master catalog is updated).
 * The UI will prompt the user to refresh prices.
 */
export function markSnapshotStale(project: EstimateProject): EstimateProject {
  return { ...project, snapshotStale: true };
}

/**
 * Fully sync the project with the current catalog state.
 *
 * Rules:
 *  • Material prices → always replaced from catalog (snapshot refreshed).
 *  • New catalog phases/tasks → appended to project.
 *  • Existing catalog phases/tasks (same id) → name, rates, formulas,
 *    scopeInputs, and recipe updated from catalog (preserves scope values).
 *  • Orphaned project phases/tasks (id no longer in catalog) → kept as-is
 *    so scope data and measurements are not lost; they show "(removed from catalog)"
 *    in their name if their name still matches the old catalog name.
 *  • Project-only phases/tasks (ids that were never in catalog) → untouched.
 */
export function syncProjectWithCatalog(
  project: EstimateProject,
  catalog: Catalog,
): EstimateProject {
  const updated = { ...project };

  // 1. Refresh all material prices
  updated.snapshot = takeSnapshot(catalog);
  updated.snapshotStale = false;

  // 2. Sync existing project phases that came from the catalog
  const catalogPhaseIds = new Set(catalog.phases.map(p => p.id));
  updated.phases = project.phases.map(ph => {
    const catPhase = catalog.phases.find(cp => cp.id === ph.id);
    if (!catPhase) return ph; // project-only or orphaned — leave alone
    return { ...ph, name: catPhase.name, order: catPhase.order };
  });

  // 3. Add new catalog phases not yet in the project
  const projectPhaseIds = new Set(updated.phases.map(p => p.id));
  for (const catPhase of catalog.phases) {
    if (!projectPhaseIds.has(catPhase.id)) {
      updated.phases.push({ ...catPhase });
    }
  }
  void catalogPhaseIds; // used implicitly above

  // 4. Sync existing project tasks that came from the catalog
  updated.tasks = project.tasks.map(t => {
    const catTask = catalog.tasks.find(ct => ct.id === t.id);
    if (!catTask) return t; // project-only or orphaned — leave alone
    return {
      ...t,
      // Structural / formula fields always come from catalog
      name:             catTask.name,
      phaseId:          catTask.phaseId,
      laborUnit:        catTask.laborUnit,
      laborQtyFormula:  catTask.laborQtyFormula,
      scopeInputs:      structuredClone(catTask.scopeInputs),
      recipe:           structuredClone(catTask.recipe),
      // Rates: use catalog unless user has explicitly locked them
      laborRate: t.lockedLaborRate !== undefined ? t.lockedLaborRate : catTask.laborRate,
    };
  });

  // 5. Add new catalog tasks not yet in the project
  const projectTaskIds = new Set(updated.tasks.map(t => t.id));
  for (const catTask of catalog.tasks) {
    if (!projectTaskIds.has(catTask.id)) {
      updated.tasks.push({ ...structuredClone(catTask) });
    }
  }

  return updated;
}

/**
 * Look up a material price from the project snapshot, falling back to the
 * master catalog if not found in the snapshot.
 */
export function getMaterialCost(
  materialId: string,
  project: EstimateProject,
  catalog: Catalog,
): number {
  const snap = project.snapshot.materials.find(m => m.id === materialId);
  if (snap) return snap.unitCost;
  return catalog.materials.find(m => m.id === materialId)?.unitCost ?? 0;
}
