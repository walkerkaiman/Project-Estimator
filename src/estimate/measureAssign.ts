/**
 * Measurement Assignment
 *
 * Links canvas measurement markups to task scope inputs.
 * Multiple markups can be assigned to the same (taskId, role) slot —
 * the scope value is always the SUM of all assigned markups' values.
 *
 * Data shape:  markupId → { taskId, role }
 * Value cache: markupId → last known computed value (in-memory, rebuilt on load)
 */

import { appState } from '../appState.ts';
import type { MeasurementAssignment } from './project.ts';

export type { MeasurementAssignment };

// ── In-memory value cache ─────────────────────────────────────────────────────
// Stores the most recent computed value for each markup so we can sum multiple
// markups assigned to the same (taskId, role) pair.

const markupValueCache = new Map<string, number>();

/** Clear the cache (call on project-new / project-loaded before re-population). */
export function clearMarkupValueCache(): void {
  markupValueCache.clear();
}

// ── Accessors ─────────────────────────────────────────────────────────────────

export function getAssignments(): MeasurementAssignment[] {
  return appState.project.measureAssignments;
}

function setAssignments(assignments: MeasurementAssignment[]): void {
  appState.project.measureAssignments = assignments;
  appState.dirty = true;
}

export function getAssignmentForMarkup(markupId: string): MeasurementAssignment | undefined {
  return getAssignments().find(a => a.markupId === markupId);
}

export function getAssignmentsForTask(taskId: string): MeasurementAssignment[] {
  return getAssignments().filter(a => a.taskId === taskId);
}

// ── Mutation ──────────────────────────────────────────────────────────────────

export function assignMarkup(assignment: MeasurementAssignment): void {
  const existing = getAssignments().filter(a => a.markupId !== assignment.markupId);
  setAssignments([...existing, assignment]);
}

export function unassignMarkup(markupId: string): void {
  markupValueCache.delete(markupId);
  setAssignments(getAssignments().filter(a => a.markupId !== markupId));
}

// ── Value propagation ─────────────────────────────────────────────────────────

/**
 * Called whenever a measurement markup's value changes.
 *
 * Stores the value in the cache, then recomputes the SUM of all markups
 * assigned to the same (taskId, role) slot and writes it into the project scope.
 * This means multiple measurements compound automatically.
 *
 * @param markupId  The markup whose value changed.
 * @param value     New computed value (feet, sq ft, count, …).
 */
export function applyMeasurement(markupId: string, value: number): void {
  // Store this markup's value
  markupValueCache.set(markupId, value);

  const assignment = getAssignmentForMarkup(markupId);
  if (!assignment) return;

  // Sum every markup assigned to the same (taskId, role) slot
  const peers = getAssignments().filter(
    a => a.taskId === assignment.taskId && a.role === assignment.role,
  );
  const total = peers.reduce((sum, a) => sum + (markupValueCache.get(a.markupId) ?? 0), 0);

  const scope = appState.project.scope;
  const idx = scope.findIndex(
    s => s.taskId === assignment.taskId && s.role === assignment.role,
  );
  if (idx >= 0) {
    scope[idx].value = total;
  } else {
    scope.push({ taskId: assignment.taskId, role: assignment.role, value: total, markupId });
  }

  appState.dirty = true;
  appState.emit('scope-changed');
}

/**
 * Recompute the scope total for a (taskId, role) slot without a new value.
 * Useful after deleting a markup to recalculate remaining totals.
 */
export function recomputeSlotTotal(taskId: string, role: string): void {
  const peers = getAssignments().filter(a => a.taskId === taskId && a.role === role);
  if (peers.length === 0) return;

  const total = peers.reduce((sum, a) => sum + (markupValueCache.get(a.markupId) ?? 0), 0);
  const scope = appState.project.scope;
  const idx = scope.findIndex(s => s.taskId === taskId && s.role === role);
  if (idx >= 0) scope[idx].value = total;
  appState.dirty = true;
  appState.emit('scope-changed');
}
