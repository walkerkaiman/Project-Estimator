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
