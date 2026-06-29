/**
 * Project data model.
 *
 * A "project" is saved as a `.estimate` file (JSON). It embeds:
 *   - A price snapshot of the catalog taken at save time (so the bid doesn't
 *     silently change when catalog prices are updated later).
 *   - Per-task scope inputs (measurements, counts) filled in by the user.
 *   - The phases/tasks structure valid at the time of the snapshot; tasks can
 *     be added/renamed per-project without affecting the master catalog.
 */

import type { Material, Task, Phase } from './catalog.ts';

// ── Price snapshot ────────────────────────────────────────────────────────────

/** Material entry frozen at snapshot time — unitCost never changes after save. */
export interface SnapshotMaterial extends Pick<Material, 'id' | 'name' | 'unit' | 'unitCost' | 'vendor'> {}

export interface SnapshotTask extends Task {
  /** Labor rate locked at snapshot time. Overrides the master catalog rate. */
  lockedLaborRate?: number;
}

export interface PriceSnapshot {
  takenAt: string;            // ISO timestamp
  materials: SnapshotMaterial[];
}

// ── Scope entry (measurements / counts) ──────────────────────────────────────

/** A single filled-in scope input for one task on one project. */
export interface ScopeEntry {
  taskId: string;
  role: string;              // ScopeRole from catalog
  value: number;
  /** Optional: link to a markup ID in the RedlinePDF canvas (future). */
  markupId?: string;
}

// ── Project ───────────────────────────────────────────────────────────────────

export const ESTIMATE_FILE_VERSION = 1;

export interface EstimateProject {
  fileVersion: number;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;

  /** Phases & tasks for THIS project — copied from catalog at project creation,
   *  then editable independently. Phases can be added/renamed/removed per-project. */
  phases: Phase[];
  tasks: SnapshotTask[];

  /** Price snapshot — frozen costs used for this bid. */
  snapshot: PriceSnapshot;

  /** Whether prices should be refreshed from master catalog on next open. */
  snapshotStale: boolean;

  /** Per-task scope values entered by the user. */
  scope: ScopeEntry[];
}

export function newProject(name = 'Untitled Project'): EstimateProject {
  const now = new Date().toISOString();
  return {
    fileVersion: ESTIMATE_FILE_VERSION,
    name,
    description: '',
    createdAt: now,
    updatedAt: now,
    phases: [],
    tasks: [],
    snapshot: { takenAt: now, materials: [] },
    snapshotStale: false,
    scope: [],
  };
}
